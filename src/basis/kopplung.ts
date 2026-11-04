import type { Geraet } from './anmeldung';
import { GRENZEN, type Grenzen } from './grenzen';
import { SCHLIESSCODE, type Verbindung } from './kern';
import { neuesGeheimnis, passtZuHash, sha256 } from './kodierung';

export interface Kopplungsanfrage {
    verbindung: Verbindung;
    name: string;
    geraet: Geraet;
    // Protokollversion aus koppeln; in ihr geht es nach der Kopplung weiter
    version: number;
}

export interface Qrangaben {
    adapterId: string;
    fingerabdruck: string;
    geheimnis: string;
    adressen: string[];
}

// Format des Kopplungslinks, unabhängig von der Protokollversion: Ein neues Protokoll braucht keinen neuen Link.
export const LINKFORMAT = 1;

// Abschnitt 4 des Detailentwurfs
export function qrInhalt(q: Qrangaben): string {
    const teile = [
        ['v', String(LINKFORMAT)],
        ['a', q.adapterId],
        ['f', q.fingerabdruck],
        ['g', q.geheimnis],
        ...q.adressen.map(h => ['h', h]),
    ];
    return `myzelapp://koppeln?${teile.map(([k, w]) => `${k}=${encodeURIComponent(w)}`).join('&')}`;
}

interface Einmalschluessel {
    hash: Buffer;
    benutzt: boolean;
    ablauf: NodeJS.Timeout;
}

export class Kopplung {
    private schluessel?: Einmalschluessel;
    private anfrage?: Kopplungsanfrage;
    private wartender?: (anfrage: Kopplungsanfrage | undefined) => void;

    public constructor(private readonly grenzen: Grenzen = GRENZEN) {}

    public starte(): { geheimnis: string; gueltigBis: number } {
        this.brichAb();
        const geheimnis = neuesGeheimnis();
        const ablauf = setTimeout(() => this.brichAb(), this.grenzen.einmalMs);
        ablauf.unref();
        this.schluessel = { hash: sha256(geheimnis), benutzt: false, ablauf };
        return { geheimnis, gueltigBis: Date.now() + this.grenzen.einmalMs };
    }

    // Falsche Geheimnisse machen den Schlüssel nicht ungültig: 128 Bit errät niemand, ein Zähler ließe nur jeden im
    // Heimnetz die Kopplung verhindern. Gezählt wird je Adresse in der Sperrliste.
    public melde(geheimnis: string, anfrage: Kopplungsanfrage): boolean {
        const s = this.schluessel;
        if (!s || s.benutzt || !passtZuHash(geheimnis, s.hash)) {
            return false;
        }
        s.benutzt = true;
        this.anfrage = anfrage;
        anfrage.verbindung.beiTrennung(() => {
            if (this.anfrage === anfrage) {
                this.anfrage = undefined;
            }
        });
        this.wecke(anfrage);
        return true;
    }

    public warte(fristMs: number): Promise<Kopplungsanfrage | undefined> {
        if (this.anfrage?.verbindung.offen) {
            return Promise.resolve(this.anfrage);
        }
        this.wecke(undefined);
        return new Promise(resolve => {
            const frist = setTimeout(() => this.wecke(undefined), fristMs);
            this.wartender = anfrage => {
                clearTimeout(frist);
                resolve(anfrage);
            };
        });
    }

    public abschliessen(anfrage: Kopplungsanfrage): boolean {
        if (this.anfrage !== anfrage || !anfrage.verbindung.offen) {
            return false;
        }
        this.anfrage = undefined;
        this.loescheSchluessel();
        return true;
    }

    public ablehnen(anfrage: Kopplungsanfrage): void {
        if (this.anfrage !== anfrage) {
            return;
        }
        this.anfrage = undefined;
        this.loescheSchluessel();
        anfrage.verbindung.sendeFehler('abgelehnt');
        anfrage.verbindung.schliesse(SCHLIESSCODE.abgelehnt, 'abgelehnt');
    }

    public brichAb(): void {
        this.loescheSchluessel();
        const anfrage = this.anfrage;
        this.anfrage = undefined;
        if (anfrage) {
            anfrage.verbindung.sendeFehler('abgelaufen');
            anfrage.verbindung.schliesse(SCHLIESSCODE.abgelaufen, 'abgelaufen');
        }
        this.wecke(undefined);
    }

    private loescheSchluessel(): void {
        if (this.schluessel) {
            clearTimeout(this.schluessel.ablauf);
            this.schluessel = undefined;
        }
    }

    private wecke(anfrage: Kopplungsanfrage | undefined): void {
        const wartender = this.wartender;
        this.wartender = undefined;
        wartender?.(anfrage);
    }
}
