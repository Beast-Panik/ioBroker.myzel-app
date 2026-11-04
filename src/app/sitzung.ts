import { ANMELDENACHRICHTEN } from '../basis/anmeldung';
import { GRENZEN, type Grenzen, type Protokoll } from '../basis/grenzen';
import { SCHLIESSCODE, type Verbindung } from '../basis/kern';
import { type Nachricht, type Nachrichtenpruefer, nummerAus } from '../basis/schema';
import { Eimer, Ueberlast } from '../basis/schutz';

const SETZE_JE_SEKUNDE = 20;

export type Behandler = (nachricht: Nachricht) => void | Promise<void>;

export interface SitzungOptionen {
    pruefer: Nachrichtenpruefer;
    log: Protokoll;
    behandler: Partial<Record<string, Behandler>>;
    grenzen?: Grenzen;
}

export class Sitzung {
    private readonly grenzen: Grenzen;
    private readonly nachrichten: Eimer;
    private readonly setze: Eimer;
    private readonly ueberlast: Ueberlast;
    private ungueltige = 0;
    private inArbeit = 0;

    public constructor(
        public readonly appId: string,
        public readonly verbindung: Verbindung,
        private readonly o: SitzungOptionen,
    ) {
        this.grenzen = o.grenzen ?? GRENZEN;
        const jetzt = Date.now();
        this.nachrichten = new Eimer(this.grenzen.nachrichtenJeSekunde, this.grenzen.nachrichtenStoss, jetzt);
        this.setze = new Eimer(SETZE_JE_SEKUNDE, SETZE_JE_SEKUNDE, jetzt);
        this.ueberlast = new Ueberlast(this.grenzen);
        verbindung.empfaenger = text => this.empfange(text);
    }

    private empfange(text: string | undefined): void {
        const jetzt = Date.now();
        if (!this.nachrichten.nimm(jetzt)) {
            this.zuviel(jetzt, nummerAus(text));
            return;
        }
        const gelesen = this.o.pruefer.lies(text, jetzt);
        if (gelesen.art === 'version') {
            this.ungueltig('Protokollversion gibt es nur bei der Anmeldung', undefined);
            return;
        }
        if (gelesen.art === 'ungueltig') {
            this.ungueltig(gelesen.grund, gelesen.n);
            return;
        }
        const nachricht = gelesen.nachricht;
        const n = nummerAus(nachricht);
        if (ANMELDENACHRICHTEN.includes(nachricht.t)) {
            this.ungueltig(`${nachricht.t} nach der Anmeldung`, n);
            return;
        }
        if (nachricht.t === 'setze' && !this.setze.nimm(jetzt)) {
            this.zuviel(jetzt, n);
            return;
        }
        const behandler = this.o.behandler[nachricht.t];
        if (!behandler) {
            this.verbindung.sendeFehler('intern', { text: `${nachricht.t} ist noch nicht umgesetzt`, n });
            return;
        }
        // Antwortet ioBroker langsam, liefe sonst jede weitere Nachricht in eine Warteschlange ohne Ende.
        if (this.inArbeit >= this.grenzen.inArbeitJeSitzung) {
            this.zuviel(jetzt, n);
            return;
        }
        this.inArbeit++;
        Promise.resolve()
            .then(() => behandler(nachricht))
            .catch((fehler: Error) => {
                this.o.log.error(`App ${this.appId}, ${nachricht.t}: ${fehler.message}`);
                this.verbindung.sendeFehler('intern', { n });
            })
            .finally(() => this.inArbeit--);
    }

    private zuviel(jetzt: number, n: number | undefined): void {
        this.verbindung.sendeFehler('zuviel', { n });
        if (this.ueberlast.abgelehnt(jetzt)) {
            this.o.log.warn(`App ${this.appId} getrennt: Ratenbegrenzung anhaltend überschritten`);
            this.verbindung.schliesse(SCHLIESSCODE.zuviel, 'zuviel');
        }
    }

    private ungueltig(grund: string, n: number | undefined): void {
        this.o.log.debug(`App ${this.appId}: ungültige Nachricht, ${grund}`);
        this.verbindung.sendeFehler('ungueltig', { text: grund, n });
        if (++this.ungueltige >= this.grenzen.ungueltigeNachrichten) {
            this.o.log.warn(`App ${this.appId} getrennt: ${this.ungueltige} ungültige Nachrichten`);
            this.verbindung.schliesse(SCHLIESSCODE.ungueltig, 'ungueltig');
        }
    }
}
