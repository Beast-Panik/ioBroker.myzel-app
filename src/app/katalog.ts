import type { Protokoll } from '../basis/grenzen';
import type { Konfiguration } from './konfiguration';
import { appIdAus } from './objekte';
import { type Aufzaehlung, type Karte, type Merkmale, type Objektquelle, type Profil, merkmale } from './rechte';

// Wie Admin: Englisch, solange im System keine Sprache gesetzt ist
const SPRACHE = 'en';

export type Objektaenderung = ioBroker.Object | null | undefined;

// Eigene Schnittstelle, damit der Katalog ohne ioBroker testbar ist.
export interface Katalogquelle {
    // Objekte vom Typ typ, deren ID mit praefix beginnt
    objekte(typ: ioBroker.ObjectType, praefix: string): Promise<ioBroker.Object[]>;
}

/**
 * Alles, wovon die Rechte abhängen, im Speicher: Datenpunkte, Räume, Profile, Karten, Systemsprache. Karten und Profile
 * kommen aus den Instanzeinstellungen; ändern sie sich, startet ioBroker die Instanz neu. Alle Datenpunkte, nicht nur die
 * aus Karten: Eine Ansichtsabfrage durchläuft in der Objektdatenbank ohnehin alle Objekte. So wird einmal geladen und mit
 * objectChange nachgeführt.
 */
export class Katalog implements Objektquelle {
    public sprache = SPRACHE;
    public readonly eigeneApps: string;
    private readonly datenpunkte = new Map<string, Merkmale>();
    private readonly raeumeNachId = new Map<string, Aufzaehlung>();
    private raeumeSortiert?: Aufzaehlung[];
    private profile = new Map<string, Profil>();
    private kartenSortiert: [string, Karte][] = [];
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

    // Einmal beim Start; die Tests ändern damit Karten und Profile wie ein Neustart mit neuen Einstellungen.
    public konfiguriere(konfiguration: Konfiguration): void {
        this.profile = new Map(konfiguration.profile);
        this.kartenSortiert = [...konfiguration.karten].sort(([a], [b]) => a.localeCompare(b));
        this.hoerer();
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

    public karten(): [string, Karte][] {
        return this.kartenSortiert;
    }

    public raeume(): Aufzaehlung[] {
        this.raeumeSortiert ??= [...this.raeumeNachId.values()].sort((a, b) => a.id.localeCompare(b.id));
        return this.raeumeSortiert;
    }

    public datenpunkt(id: string): Merkmale | undefined {
        return this.datenpunkte.get(id);
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
}
