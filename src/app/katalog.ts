import type { Protokoll } from '../basis/grenzen';
import { type Ordner, appIdAus } from './objekte';
import {
    type Aufzaehlung,
    type Etage,
    type Etagenkopf,
    type Karte,
    type Merkmale,
    type Objektquelle,
    type Profil,
    alsEtage,
    alsKarte,
    alsProfil,
    istKennung,
    merkmale,
    text,
} from './rechte';
import { type Zone, alsZone, istZonenId } from './zonen';

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
    etagen: {
        pruefe: alsEtage,
        unbrauchbar: (id: string) => `Etage ${id} ist unbrauchbar, ihre Räume stehen ohne Etage`,
    },
    zonen: { pruefe: alsZone, unbrauchbar: (id: string) => `Zone ${id} ist unbrauchbar und fehlt auf den Handys` },
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
    private readonly eintraege = {
        karten: new Map<string, Karte>(),
        profile: new Map<string, Profil>(),
        etagen: new Map<string, Etage>(),
        zonen: new Map<string, Zone>(),
    };
    private zonenSortiert?: [string, Zone][];
    // Zonen, deren Objekt es gibt, die aber gerade unbrauchbar sind: Sie fehlen auf den Handys, gelten aber nicht als
    // gelöscht, sonst verlören ihre Datenpunkte bei einem Tippfehler im Objektbrowser die Einstellungen etwa für History.
    private readonly zonenUnbrauchbar = new Set<string>();
    // Breite und Länge aus den Systemeinstellungen, für „Zuhause“ im Reiter Zonen
    private systemort?: { breite: number; laenge: number };
    private etagenSortiert?: [string, Etage][];
    private kartenSortiert?: [string, Karte][];
    private profileSortiert?: [string, Profil][];
    private puffer?: [string, Objektaenderung][];
    private laden: Promise<void> = Promise.resolve();
    private hoerer: () => void = () => undefined;
    private appHoerer: (appId: string, objekt: Objektaenderung) => void = () => undefined;

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
                this.quelle.objekte('config', `${this.namespace}.etagen.`),
                this.quelle.objekte('config', `${this.namespace}.zonen.`),
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

    // Jede Änderung am Objekt einer App sofort, vor der gesammelten Neuberechnung
    public beiApp(hoerer: (appId: string, objekt: Objektaenderung) => void): void {
        this.appHoerer = hoerer;
    }

    public geaendert(id: string, objekt: Objektaenderung): void {
        // Auch während des Ladens gleich: Ausschalten soll nicht auf den Katalog warten
        const appId = appIdAus(this.namespace, id);
        if (appId) {
            this.appHoerer(appId, objekt);
        }
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

    // Nur brauchbare Zonen, nach Namen sortiert
    public zonen(): [string, Zone][] {
        this.zonenSortiert ??= [...this.eintraege.zonen].sort(
            ([a, x], [b, y]) => x.name.localeCompare(y.name, this.sprache) || a.localeCompare(b),
        );
        return this.zonenSortiert;
    }

    public zone(zonenId: string): Zone | undefined {
        return this.eintraege.zonen.get(zonenId);
    }

    // Ob es das Objekt der Zone gibt, auch wenn sie gerade unbrauchbar ist
    public gibtZone(zonenId: string): boolean {
        return this.eintraege.zonen.has(zonenId) || this.zonenUnbrauchbar.has(zonenId);
    }

    public zuhause(): { breite: number; laenge: number } | undefined {
        return this.systemort;
    }

    public karten(): [string, Karte][] {
        this.kartenSortiert ??= [...this.eintraege.karten].sort(([a], [b]) => a.localeCompare(b));
        return this.kartenSortiert;
    }

    public karte(kartenId: string): Karte | undefined {
        return this.eintraege.karten.get(kartenId);
    }

    // Von oben nach unten; bei gleicher Position nach Namen, damit die Folge nie vom Zufall des Ladens abhängt
    public alleEtagen(): [string, Etage][] {
        this.etagenSortiert ??= [...this.eintraege.etagen].sort(
            ([a, x], [b, y]) => x.position - y.position || x.name.localeCompare(y.name) || a.localeCompare(b),
        );
        return this.etagenSortiert;
    }

    public etagen(): Etagenkopf[] {
        return this.alleEtagen().map(([id, e]) => ({ id, name: e.name, kurz: e.kurz }));
    }

    // Nach Etagen, darin wie im Admin geordnet; ein Raum in zwei Etagen zählt bei der oberen. Räume ohne Etage zuletzt
    // nach Namen in der Systemsprache, wie die App sie vor Protokoll 5 selbst ordnete.
    public raeume(): Aufzaehlung[] {
        if (!this.raeumeSortiert) {
            const folge: Aufzaehlung[] = [];
            const vergeben = new Set<string>();
            for (const [etage, e] of this.alleEtagen()) {
                for (const id of e.raeume) {
                    const raum = this.raeumeNachId.get(id);
                    if (raum && !vergeben.has(id)) {
                        vergeben.add(id);
                        folge.push({ ...raum, etage });
                    }
                }
            }
            const name = (r: Aufzaehlung): string => text(r.name, this.sprache, r.id);
            const rest = [...this.raeumeNachId.values()]
                .filter(r => !vergeben.has(r.id))
                .sort((a, b) => name(a).localeCompare(name(b), this.sprache) || a.id.localeCompare(b.id));
            this.raeumeSortiert = [...folge, ...rest];
        }
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
            this.systemort = ortAus(objekt?.common);
            const sprache = (objekt?.common as { language?: unknown } | undefined)?.language;
            const neu = typeof sprache === 'string' && sprache !== '' ? sprache : SPRACHE;
            if (neu === this.sprache) {
                return false;
            }
            this.sprache = neu;
            // Räume ohne Etage stehen nach Namen in der Systemsprache
            this.raeumeSortiert = undefined;
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
        for (const ordner of ['karten', 'profile', 'etagen', 'zonen'] as const) {
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
        if (ordner === 'zonen' ? !istZonenId(id) : !istKennung(id)) {
            return false;
        }
        this.kartenSortiert = undefined;
        this.profileSortiert = undefined;
        this.etagenSortiert = undefined;
        this.raeumeSortiert = undefined;
        this.zonenSortiert = undefined;
        const eintraege: Map<string, unknown> = this.eintraege[ordner];
        if (ordner === 'zonen') {
            this.zonenUnbrauchbar.delete(id);
        }
        if (objekt?.type !== 'config') {
            return eintraege.delete(id);
        }
        const eintrag = EINTRAEGE[ordner].pruefe(objekt.native);
        if (Array.isArray(eintrag)) {
            this.log.warn(`${EINTRAEGE[ordner].unbrauchbar(id)}: ${eintrag.join('; ')}`);
            if (ordner === 'zonen') {
                this.zonenUnbrauchbar.add(id);
            }
            return eintraege.delete(id);
        }
        eintraege.set(id, structuredClone(eintrag));
        return true;
    }
}

// Breite und Länge der Systemeinstellungen; ioBroker speichert sie je nach Alter als Zahl oder Text, 0 und 0 heißt leer.
function ortAus(common: unknown): { breite: number; laenge: number } | undefined {
    const c = common as { latitude?: unknown; longitude?: unknown } | undefined;
    const zahl = (w: unknown): number =>
        typeof w === 'number' ? w : typeof w === 'string' && w.trim() !== '' ? Number(w) : NaN;
    const breite = zahl(c?.latitude);
    const laenge = zahl(c?.longitude);
    if (!Number.isFinite(breite) || !Number.isFinite(laenge) || Math.abs(breite) > 90 || Math.abs(laenge) > 180) {
        return undefined;
    }
    return breite === 0 && laenge === 0 ? undefined : { breite, laenge };
}
