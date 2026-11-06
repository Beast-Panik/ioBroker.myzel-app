import type { Katalog } from '../app/katalog';
import type { Eintragsablage, Ordner } from '../app/objekte';
import { istKennung, text } from '../app/rechte';
import type { Protokoll } from '../basis/grenzen';

// Was die Seiten zeigen und übersetzen: nicht bereit, zu viele, weg, ungültig (mit Einzelheiten), gescheitert (mit
// Meldung)
export interface Ablehnung {
    fehler: 'nichtBereit' | 'zuViele' | 'weg' | 'ungueltig' | 'gescheitert';
    einzelheiten?: string[];
}

export const nachricht = (n: unknown): Record<string, unknown> =>
    (n && typeof n === 'object' && !Array.isArray(n) ? n : {}) as Record<string, unknown>;

// Adresse einer Seite unter admin/, wie iframeSendTo sie braucht, mit der Instanz, an die sie fragt
export function seitenadresse(namespace: string, datei: string): string {
    const adapter = namespace.slice(0, namespace.lastIndexOf('.'));
    return `adapter/${adapter}/${datei}?instanz=${encodeURIComponent(namespace)}`;
}

// Räume für die Seiten, in der Folge der App, mit Namen in der Systemsprache. Heißen zwei gleich, etwa ein mitgelieferter
// Raum von ioBroker und einer, den jemand oder ein Adapter dazu angelegt hat, steht die ID dahinter; sonst ließen sie
// sich in keiner Auswahl unterscheiden.
export function raeumeFuerSeiten(katalog: Katalog): { id: string; name: string }[] {
    const raeume = katalog.raeume().map(r => ({ id: r.id, name: text(r.name, katalog.sprache, r.id).trim() }));
    const schluessel = (name: string): string => name.toLocaleLowerCase();
    const anzahl = new Map<string, number>();
    for (const r of raeume) {
        anzahl.set(schluessel(r.name), (anzahl.get(schluessel(r.name)) ?? 0) + 1);
    }
    return raeume.map(r =>
        anzahl.get(schluessel(r.name))! > 1 ? { ...r, name: `${r.name} (${r.id.slice('enum.rooms.'.length)})` } : r,
    );
}

export interface Eintragsart<T extends { name: string }> {
    ordner: Ordner;
    // Anfang neuer IDs: k für Karten, p für Profile
    kennbuchstabe: string;
    // Für das Log
    was: string;
    // Bereinigt und prüft, was die Seite schickt
    pruefe(roh: unknown): T | string[];
    imKatalog(katalog: Katalog, id: string): T | undefined;
    anzahl(katalog: Katalog): number;
    hoechstens?: number;
}

/**
 * Anlegen, Ändern und Löschen von Karten und Profilen für ihre Seiten (KONZEPT-KARTEN.md, Abschnitt 12). Geprüft wird
 * hier, nicht in der Seite. Jede Änderung gilt sofort, ohne Neustart der Instanz: Der Katalog übernimmt sie gleich und
 * noch einmal mit objectChange, das schadet nicht.
 */
export class Eintraege<T extends { name: string }> {
    private readonly jetzt: () => number;

    public constructor(
        private readonly art: Eintragsart<T>,
        private readonly o: {
            namespace: string;
            ablage: Eintragsablage;
            log: Protokoll;
            jetzt?: () => number;
        },
    ) {
        this.jetzt = o.jetzt ?? Date.now;
    }

    // Ohne id ein neuer Eintrag
    public async speichere(katalog: Katalog, id: unknown, roh: unknown): Promise<{ id: string } | Ablehnung> {
        const eintrag = this.art.pruefe(roh);
        if (Array.isArray(eintrag)) {
            return { fehler: 'ungueltig', einzelheiten: eintrag };
        }
        let ziel: string;
        if (id === undefined) {
            if (this.art.hoechstens !== undefined && this.art.anzahl(katalog) >= this.art.hoechstens) {
                return { fehler: 'zuViele' };
            }
            ziel = await this.neueId(katalog);
        } else if (istKennung(id) && (await this.gibt(id))) {
            ziel = id;
        } else {
            return { fehler: 'weg' };
        }
        await this.o.ablage.schreibeEintrag(this.art.ordner, ziel, eintrag.name, eintrag);
        katalog.geaendert(this.objektId(ziel), {
            _id: this.objektId(ziel),
            type: 'config',
            common: { name: eintrag.name },
            native: eintrag,
        });
        this.o.log.info(`${this.art.was} „${eintrag.name}“ (${ziel}) gespeichert`);
        return { id: ziel };
    }

    public async loesche(katalog: Katalog, id: unknown): Promise<{ id: string } | Ablehnung> {
        if (!istKennung(id) || !(await this.gibt(id))) {
            return { fehler: 'weg' };
        }
        const name = this.art.imKatalog(katalog, id)?.name ?? id;
        await this.o.ablage.loescheEintrag(this.art.ordner, id);
        katalog.geaendert(this.objektId(id), null);
        this.o.log.info(`${this.art.was} „${name}“ (${id}) gelöscht`);
        return { id };
    }

    private async gibt(id: string): Promise<boolean> {
        return (await this.o.ablage.liesEintrag(this.art.ordner, id)) !== undefined;
    }

    private objektId(id: string): string {
        return `${this.o.namespace}.${this.art.ordner}.${id}`;
    }

    // Buchstabe und Zeit: nie wieder vergeben, damit ein Verweis auf einen gelöschten Eintrag, etwa eine gelöschte Karte
    // in einem Profil, keinem neuen Rechte gibt.
    private async neueId(katalog: Katalog): Promise<string> {
        for (let zeit = this.jetzt(); ; zeit++) {
            const id = `${this.art.kennbuchstabe}${zeit.toString(36)}`;
            if (!this.art.imKatalog(katalog, id) && !(await this.gibt(id))) {
                return id;
            }
        }
    }
}
