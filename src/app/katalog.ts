import type { Protokoll } from '../basis/grenzen';
import { appIdAus } from './objekte';
import {
    type Aufzaehlung,
    type Geraet,
    type Merkmale,
    type Objektquelle,
    type Profil,
    alsGeraet,
    alsProfil,
    istKennung,
    liegtUnter,
    merkmale,
} from './rechte';

// Wie Admin: Englisch, solange im System keine Sprache gesetzt ist
const SPRACHE = 'en';

export type Objektaenderung = ioBroker.Object | null | undefined;

const KENNUNG = 'ID erlaubt nur a bis z, 0 bis 9 und _';

// Eigene Schnittstelle, damit der Katalog ohne ioBroker testbar ist.
export interface Katalogquelle {
    // Objekte vom Typ typ, deren ID mit praefix beginnt
    objekte(typ: ioBroker.ObjectType, praefix: string): Promise<ioBroker.Object[]>;
}

/**
 * Alles, wovon die Rechte abhängen, im Speicher: Datenpunkte, Räume, Funktionen, Profile, Geräte, Systemsprache.
 * Eine Ansichtsabfrage durchläuft in der Objektdatenbank alle Objekte. Je Raummitglied eine Abfrage würde den
 * js-controller bei jeder Anmeldung und jeder Neuberechnung belasten; so wird einmal geladen und mit objectChange
 * nachgeführt.
 */
export class Katalog implements Objektquelle {
    public sprache = SPRACHE;
    public readonly eigeneApps: string;
    private readonly datenpunkte = new Map<string, Merkmale>();
    private sortiert?: string[];
    private readonly raeume = new Map<string, Aufzaehlung>();
    private readonly funktionen = new Map<string, Aufzaehlung>();
    private readonly profile = new Map<string, Profil>();
    private readonly profilPraefix: string;
    private readonly geraeteNachId = new Map<string, Geraet>();
    private geraeteSortiert?: [string, Geraet][];
    private readonly geraetPraefix: string;
    private puffer?: [string, Objektaenderung][];
    private laden: Promise<void> = Promise.resolve();
    private hoerer: () => void = () => undefined;

    public constructor(
        private readonly namespace: string,
        private readonly log: Protokoll,
        private readonly quelle: Katalogquelle,
    ) {
        this.profilPraefix = `${namespace}.profile.`;
        this.geraetPraefix = `${namespace}.geraete.`;
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
                this.quelle.objekte('enum', 'enum.'),
                this.quelle.objekte('config', this.profilPraefix),
                this.quelle.objekte('config', this.geraetPraefix),
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
        return this.profile.get(profilId);
    }

    // Nur brauchbare Profile, nach Namen sortiert
    public alleProfile(): [string, Profil][] {
        return [...this.profile].sort(([, a], [, b]) => a.name.localeCompare(b.name));
    }

    public geraet(geraetId: string): Geraet | undefined {
        return this.geraeteNachId.get(geraetId);
    }

    public geraete(): [string, Geraet][] {
        this.geraeteSortiert ??= [...this.geraeteNachId].sort(([a], [b]) => a.localeCompare(b));
        return this.geraeteSortiert;
    }

    public aufzaehlungen(art: 'rooms' | 'functions'): Aufzaehlung[] {
        return [...(art === 'rooms' ? this.raeume : this.funktionen).values()].sort((a, b) => a.id.localeCompare(b.id));
    }

    public zustaende(praefix: string): Map<string, Merkmale> {
        this.sortiert ??= [...this.datenpunkte.keys()].sort();
        const ergebnis = new Map<string, Merkmale>();
        for (let i = ersterAb(this.sortiert, praefix); i < this.sortiert.length; i++) {
            const id = this.sortiert[i];
            if (!id.startsWith(praefix)) {
                break;
            }
            if (liegtUnter(id, praefix)) {
                ergebnis.set(id, this.datenpunkte.get(id)!);
            }
        }
        return ergebnis;
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
        const art = id.startsWith('enum.rooms.')
            ? this.raeume
            : id.startsWith('enum.functions.')
              ? this.funktionen
              : undefined;
        if (art) {
            if (objekt?.type !== 'enum') {
                return art.delete(id);
            }
            const members: unknown = objekt.common?.members;
            const mitglieder = Array.isArray(members) ? members.filter(m => typeof m === 'string') : [];
            art.set(id, { id, name: objekt.common?.name, mitglieder });
            return true;
        }
        if (id.startsWith(this.profilPraefix)) {
            return this.uebernimmProfil(id.slice(this.profilPraefix.length), objekt);
        }
        if (id.startsWith(this.geraetPraefix)) {
            this.geraeteSortiert = undefined;
            return this.uebernimmGeraet(id.slice(this.geraetPraefix.length), objekt);
        }
        if (objekt?.type === 'state') {
            if (!this.datenpunkte.has(id)) {
                this.sortiert = undefined;
            }
            this.datenpunkte.set(id, merkmale(id, objekt.common, this.sprache));
            return true;
        }
        if (this.datenpunkte.delete(id)) {
            this.sortiert = undefined;
            return true;
        }
        return false;
    }

    private uebernimmProfil(profilId: string, objekt: Objektaenderung): boolean {
        if (objekt?.type !== 'config') {
            return this.profile.delete(profilId);
        }
        const profil = istKennung(profilId) ? alsProfil(objekt.native) : [KENNUNG];
        if (Array.isArray(profil)) {
            this.log.warn(`Profil ${profilId} ist unbrauchbar und gibt keine Rechte: ${profil.join('; ')}`);
            return this.profile.delete(profilId);
        }
        this.profile.set(profilId, profil);
        return true;
    }

    private uebernimmGeraet(geraetId: string, objekt: Objektaenderung): boolean {
        if (objekt?.type !== 'config') {
            return this.geraeteNachId.delete(geraetId);
        }
        const geraet = istKennung(geraetId) ? alsGeraet(objekt.native) : [KENNUNG];
        if (Array.isArray(geraet)) {
            this.log.warn(`Gerät ${geraetId} ist unbrauchbar und fehlt auf den Handys: ${geraet.join('; ')}`);
            return this.geraeteNachId.delete(geraetId);
        }
        this.geraeteNachId.set(geraetId, geraet);
        return true;
    }
}

function ersterAb(sortiert: string[], praefix: string): number {
    let von = 0;
    let bis = sortiert.length;
    while (von < bis) {
        const mitte = (von + bis) >>> 1;
        if (sortiert[mitte] < praefix) {
            von = mitte + 1;
        } else {
            bis = mitte;
        }
    }
    return von;
}
