import type { Protokoll } from '../basis/grenzen';
import { type Ordner, appIdAus } from './objekte';
import {
    type Aufzaehlung,
    type Karte,
    type Merkmale,
    type Objektquelle,
    type Profil,
    alsKarte,
    alsProfil,
    istKennung,
    merkmale,
} from './rechte';

// Wie Admin: Englisch, solange im System keine Sprache gesetzt ist
const SPRACHE = 'en';

export type Objektaenderung = ioBroker.Object | null | undefined;

// Eigene Schnittstelle, damit der Katalog ohne ioBroker testbar ist.
export interface Katalogquelle {
    // Objekte vom Typ typ, deren ID mit praefix beginnt
    objekte(typ: ioBroker.ObjectType, praefix: string): Promise<ioBroker.Object[]>;
}

// Je Ordner: wie der Inhalt geprüft wird und was eine unbrauchbare Karte oder ein unbrauchbares Profil bewirkt
const EINTRAEGE = {
    karten: { pruefe: alsKarte, unbrauchbar: (id: string) => `Karte ${id} ist unbrauchbar und fehlt auf den Handys` },
    profile: { pruefe: alsProfil, unbrauchbar: (id: string) => `Profil ${id} ist unbrauchbar und gibt keine Rechte` },
} satisfies Record<Ordner, { pruefe: (native: unknown) => unknown; unbrauchbar: (id: string) => string }>;

/**
 * Alles, wovon die Rechte abhängen, im Speicher: Datenpunkte, Räume, Profile, Karten, Systemsprache. Karten und Profile
 * sind Objekte unter <namespace>.karten und <namespace>.profile und gelten ohne Neustart (KONZEPT-KARTEN.md, Abschnitt
 * 12). Alle Datenpunkte, nicht nur die aus Karten: Eine Ansichtsabfrage durchläuft in der Objektdatenbank ohnehin alle
 * Objekte. So wird einmal geladen und mit objectChange nachgeführt.
 */
export class Katalog implements Objektquelle {
    public sprache = SPRACHE;
    public readonly eigeneApps: string;
    private readonly datenpunkte = new Map<string, Merkmale>();
    private readonly raeumeNachId = new Map<string, Aufzaehlung>();
    private raeumeSortiert?: Aufzaehlung[];
    private readonly eintraege = { karten: new Map<string, Karte>(), profile: new Map<string, Profil>() };
    private kartenSortiert?: [string, Karte][];
    private profileSortiert?: [string, Profil][];
    private puffer?: [string, Objektaenderung][];
    private laden: Promise<void> = Promise.resolve();
    private hoerer: () => void = () => undefined;

    public constructor(
        private readonly namespace: string,
        private readonly log: Protokoll,
        private readonly quelle: Katalogquelle,
    ) {
        this.eigeneApps = `${namespace}.apps`;
    }

    // Erst abonnieren, dann laden: Änderungen während des Ladens hält der Katalog zurück und wendet sie danach an,
    // sonst überschriebe der ältere Ladestand sie. Nacheinander, sonst nähme ein zweites Laden dem ersten den Puffer.
    public lade(): Promise<void> {
        this.laden = this.laden.catch(() => undefined).then(() => this.ladeJetzt());
        return this.laden;
    }

    private async ladeJetzt(): Promise<void> {
        this.puffer = [];
        try {
            // system.config zuerst: Die Namen der Datenpunkte werden in der Systemsprache übernommen.
            const listen = await Promise.all([
                this.quelle.objekte('config', 'system.config'),
                this.quelle.objekte('state', ''),
                this.quelle.objekte('enum', 'enum.rooms.'),
                this.quelle.objekte('config', `${this.namespace}.karten.`),
                this.quelle.objekte('config', `${this.namespace}.profile.`),
            ]);
            for (const objekt of listen.flat()) {
                this.uebernimmSicher(objekt._id, objekt);
            }
            for (const [id, objekt] of this.puffer) {
                this.uebernimmSicher(id, objekt);
            }
        } finally {
            this.puffer = undefined;
        }
    }

    public beiAenderung(hoerer: () => void): void {
        this.hoerer = hoerer;
    }

    public geaendert(id: string, objekt: Objektaenderung): void {
        if (this.puffer) {
            this.puffer.push([id, objekt]);
            return;
        }
        if (this.uebernimmSicher(id, objekt)) {
            this.hoerer();
        }
    }

    public get anzahl(): number {
        return this.datenpunkte.size;
    }

    public profil(profilId: string): Profil | undefined {
        return this.eintraege.profile.get(profilId);
    }

    // Nur brauchbare Profile, nach Namen sortiert
    public alleProfile(): [string, Profil][] {
        this.profileSortiert ??= [...this.eintraege.profile].sort(
            ([a, x], [b, y]) => x.name.localeCompare(y.name) || a.localeCompare(b),
        );
        return this.profileSortiert;
    }

    public karten(): [string, Karte][] {
        this.kartenSortiert ??= [...this.eintraege.karten].sort(([a], [b]) => a.localeCompare(b));
        return this.kartenSortiert;
    }

    public karte(kartenId: string): Karte | undefined {
        return this.eintraege.karten.get(kartenId);
    }

    public raeume(): Aufzaehlung[] {
        this.raeumeSortiert ??= [...this.raeumeNachId.values()].sort((a, b) => a.id.localeCompare(b.id));
        return this.raeumeSortiert;
    }

    public datenpunkt(id: string): Merkmale | undefined {
        return this.datenpunkte.get(id);
    }

    public alleDatenpunkte(): IterableIterator<[string, Merkmale]> {
        return this.datenpunkte.entries();
    }

    // Objekte schreiben auch andere Adapter und Skripte: Ein kaputtes darf weder das Laden noch objectChange abbrechen.
    private uebernimmSicher(id: string, objekt: Objektaenderung): boolean {
        try {
            return this.uebernimm(id, objekt);
        } catch (fehler) {
            this.log.warn(`Objekt ${id} nicht übernommen: ${(fehler as Error).message}`);
            return false;
        }
    }

    // true, wenn sich etwas geändert haben kann, das Rechte einer App betrifft
    private uebernimm(id: string, objekt: Objektaenderung): boolean {
        if (id === 'system.config') {
            const sprache = (objekt?.common as { language?: unknown } | undefined)?.language;
            const neu = typeof sprache === 'string' && sprache !== '' ? sprache : SPRACHE;
            if (neu === this.sprache) {
                return false;
            }
            this.sprache = neu;
            if (this.datenpunkte.size === 0) {
                return true;
            }
            // Die Namen in der neuen Sprache bringt erst das Neuladen; gemeldet wird danach, nie mit gemischten Sprachen.
            this.lade().then(
                () => this.hoerer(),
                (fehler: Error) =>
                    this.log.error(`Katalog für die neue Systemsprache nicht geladen: ${fehler.message}`),
            );
            return false;
        }
        // Profilzuordnung oder Zugang einer App
        if (appIdAus(this.namespace, id)) {
            return true;
        }
        for (const ordner of ['karten', 'profile'] as const) {
            const praefix = `${this.namespace}.${ordner}.`;
            if (id.startsWith(praefix)) {
                return this.uebernimmEintrag(ordner, id.slice(praefix.length), objekt);
            }
        }
        if (id.startsWith('enum.rooms.')) {
            this.raeumeSortiert = undefined;
            if (objekt?.type !== 'enum') {
                return this.raeumeNachId.delete(id);
            }
            const members: unknown = objekt.common?.members;
            const mitglieder = Array.isArray(members) ? members.filter(m => typeof m === 'string') : [];
            this.raeumeNachId.set(id, { id, name: objekt.common?.name, mitglieder });
            return true;
        }
        if (objekt?.type === 'state') {
            this.datenpunkte.set(id, merkmale(id, objekt.common, this.sprache));
            return true;
        }
        return this.datenpunkte.delete(id);
    }

    // Ein unbrauchbarer Eintrag fehlt, bis er wieder passt; was darunter liegt, etwa ein Datenpunkt, ist keiner.
    private uebernimmEintrag(ordner: Ordner, id: string, objekt: Objektaenderung): boolean {
        if (!istKennung(id)) {
            return false;
        }
        this.kartenSortiert = undefined;
        this.profileSortiert = undefined;
        const eintraege: Map<string, unknown> = this.eintraege[ordner];
        if (objekt?.type !== 'config') {
            return eintraege.delete(id);
        }
        const eintrag = EINTRAEGE[ordner].pruefe(objekt.native);
        if (Array.isArray(eintrag)) {
            this.log.warn(`${EINTRAEGE[ordner].unbrauchbar(id)}: ${eintrag.join('; ')}`);
            return eintraege.delete(id);
        }
        eintraege.set(id, structuredClone(eintrag));
        return true;
    }
}
