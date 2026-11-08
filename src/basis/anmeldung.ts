import type { Protokoll } from './grenzen';
import { SCHLIESSCODE, type Verbindung } from './kern';
import type { Kopplung } from './kopplung';
import type { Nachrichtenpruefer } from './schema';

export interface Geraet {
    android: string;
    appVersion: string;
}

export interface Hallo {
    t: 'hallo';
    v: number;
    app: string;
    zugang: string;
    geraet: Geraet;
}

export interface Koppeln {
    t: 'koppeln';
    v: number;
    geheimnis: string;
    name: string;
    geraet: Geraet;
}

export const ANMELDENACHRICHTEN: readonly string[] = ['hallo', 'koppeln'];

// beschaedigt: Objekt der App da, aber nicht lesbar; der Zugang passt oder lässt sich nicht prüfen
export type Zugangspruefung = 'ok' | 'unbekannt' | 'falsch' | 'beschaedigt';

export interface Anmeldeziel {
    pruefeZugang(appId: string, zugang: string): Promise<Zugangspruefung>;
    angemeldet(verbindung: Verbindung, hallo: Hallo): Promise<void>;
}

export interface AnmeldungOptionen {
    pruefer: Nachrichtenpruefer;
    kopplung: Kopplung;
    fehlversuch: (adresse: string) => void;
    ziel: Anmeldeziel;
    log: Protokoll;
}

export class Anmeldung {
    public constructor(private readonly o: AnmeldungOptionen) {}

    public begruesse(v: Verbindung): void {
        let erhalten = false;
        v.empfaenger = text => {
            if (erhalten) {
                this.lehneAb(v, 'ungueltig', 'weitere Nachricht vor Abschluss der Anmeldung');
                return;
            }
            erhalten = true;
            this.erste(v, text).catch((fehler: Error) => {
                this.o.log.error(`Anmeldung von ${v.herkunft.adresse}: ${fehler.message}`);
                v.sendeFehler('intern');
                v.schliesse(SCHLIESSCODE.intern, 'interner Fehler');
            });
        };
    }

    private async erste(v: Verbindung, text: string | undefined): Promise<void> {
        const gelesen = this.o.pruefer.lies(text, Date.now());
        if (gelesen.art === 'version') {
            this.o.log.warn(
                `Anmeldung von ${v.herkunft.adresse} abgelehnt: Protokollversion ${gelesen.v} nicht unterstützt`,
            );
            v.sendeFehler('version', { unterstuetzt: this.o.pruefer.versionen });
            v.schliesse(SCHLIESSCODE.version, 'Version');
        } else if (gelesen.art === 'ungueltig') {
            this.lehneAb(v, 'ungueltig', gelesen.grund);
        } else if (gelesen.nachricht.t === 'hallo') {
            const hallo = gelesen.nachricht as unknown as Hallo;
            if (v.herkunft.weg === 'fern' && hallo.app !== v.herkunft.app) {
                this.lehneAb(v, 'zugang', `App ${hallo.app} über den Fernzugang einer anderen App`);
            } else {
                await this.hallo(v, hallo);
            }
        } else if (gelesen.nachricht.t === 'koppeln') {
            if (v.herkunft.weg === 'fern') {
                this.lehneAb(v, 'zugang', 'Koppeln geht nur im Heimnetz');
            } else {
                this.koppeln(v, gelesen.nachricht as unknown as Koppeln);
            }
        } else {
            this.lehneAb(v, 'ungueltig', `${gelesen.nachricht.t} vor der Anmeldung`);
        }
    }

    private async hallo(v: Verbindung, hallo: Hallo): Promise<void> {
        const ergebnis = await this.o.ziel.pruefeZugang(hallo.app, hallo.zugang);
        if (!v.offen) {
            return;
        }
        // Nicht 4001 und kein Fehlversuch: Die App behält ihre Kopplung und versucht es nach ihrem Takt wieder. Gewarnt
        // hat die Ablage schon, einmal je App.
        if (ergebnis === 'beschaedigt') {
            v.sendeFehler('intern');
            v.schliesse(SCHLIESSCODE.intern, 'Objekt beschädigt');
            this.o.log.debug(`Anmeldung von ${v.herkunft.adresse} abgewiesen: Objekt der App ${hallo.app} beschädigt`);
            return;
        }
        if (ergebnis !== 'ok') {
            this.lehneAb(
                v,
                'zugang',
                ergebnis === 'unbekannt' ? `App ${hallo.app} unbekannt` : `Zugang der App ${hallo.app} falsch`,
            );
            return;
        }
        v.fristErfuellt();
        await this.o.ziel.angemeldet(v, hallo);
    }

    private koppeln(v: Verbindung, koppeln: Koppeln): void {
        const anfrage = { verbindung: v, name: koppeln.name, geraet: koppeln.geraet, version: koppeln.v };
        if (!this.o.kopplung.melde(koppeln.geheimnis, anfrage)) {
            this.lehneAb(v, 'zugang', 'Einmalgeheimnis falsch, verbraucht oder abgelaufen');
            return;
        }
        v.fristErfuellt();
        this.o.log.info(`Kopplungsanfrage von ${v.herkunft.adresse}, wartet auf Bestätigung im Admin`);
    }

    // Beim Zugang bekommt die App keinen Grund, damit sie nicht erfährt, ob es die App-ID gibt.
    private lehneAb(v: Verbindung, code: 'zugang' | 'ungueltig', grund: string): void {
        v.sendeFehler(code, code === 'ungueltig' ? { text: grund } : {});
        v.schliesse(SCHLIESSCODE[code], code);
        this.o.log.warn(`Anmeldung von ${v.herkunft.adresse} abgelehnt: ${grund}`);
        this.o.fehlversuch(v.herkunft.adresse);
    }
}
