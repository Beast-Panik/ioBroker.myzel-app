import type { Protokoll } from '../basis/grenzen';
import type { Verbindung, Weg } from '../basis/kern';
import type { Nachricht } from '../basis/schema';
import {
    type Appablage,
    type Appwerte,
    type Benachrichtigungswerte,
    type Handydaten,
    LETZTE,
    ordnerFuer,
} from './objekte';

interface Akku {
    stand: number;
    laedt: boolean;
    zeit: number;
}

interface Anruf {
    status: string;
    richtung?: string;
    nummer?: string;
    name?: string;
    zeit: number;
}

interface Benachrichtigungsapp {
    app: string;
    paket: string;
}

interface Benachrichtigung extends Benachrichtigungsapp {
    titel?: string;
    text?: string;
    zeit: number;
    nachgeliefert?: boolean;
}

// Nach Zeichen statt UTF-16-Einheiten, sonst bliebe ein halbes Emoji stehen.
export function kuerze(text: string, laenge: number): string {
    return text.length <= laenge ? text : [...text].slice(0, laenge).join('');
}

export interface HandyeingangOptionen {
    appId: string;
    verbindung: Verbindung;
    ablage: Appablage;
    log: Protokoll;
    textLaenge: number;
    handydaten: Handydaten;
}

/** Handydaten einer Sitzung: nur eingeschaltete Datenarten, mit ack=true und der Zeit vom Handy (Abschnitt 6 des Konzepts). */
export class Handyeingang {
    public handydaten: Handydaten;
    // Nacheinander, sonst überholt ein späteres Ereignis ein früheres zwischen den Einzelwerten.
    private reihe: Promise<void> = Promise.resolve();

    public constructor(private readonly o: HandyeingangOptionen) {
        this.handydaten = o.handydaten;
    }

    public akku(m: Nachricht): Promise<void> {
        const a = m as unknown as Akku;
        return this.schreibe('akku', { 'akku.stand': a.stand, 'akku.laedt': a.laedt }, a.zeit);
    }

    // Leer statt fehlend, sonst bliebe die Nummer des letzten Anrufs stehen. Status zuletzt: Ein Skript, das auf
    // klingelt reagiert, findet Nummer und Name schon vor.
    public anruf(m: Nachricht): Promise<void> {
        const a = m as unknown as Anruf;
        return this.schreibe(
            'anruf',
            {
                'anruf.richtung': a.richtung ?? '',
                'anruf.nummer': a.nummer ?? '',
                'anruf.name': a.name ?? '',
                'anruf.status': a.status,
            },
            a.zeit,
        );
    }

    // Erst der Ordner der App, dann letzte, je mit json zuletzt: Ein Skript, das darauf reagiert, sieht immer eine
    // vollständige Benachrichtigung, und mit letzte.json ist alles geschrieben.
    public benachrichtigung(m: Nachricht): Promise<void> {
        const b = m as unknown as Benachrichtigung;
        const inhalt = {
            app: b.app,
            paket: b.paket,
            titel: kuerze(b.titel ?? '', this.o.textLaenge),
            text: kuerze(b.text ?? '', this.o.textLaenge),
            zeit: b.zeit,
            nachgeliefert: b.nachgeliefert === true,
        };
        const werte: Benachrichtigungswerte = {
            app: inhalt.app,
            paket: inhalt.paket,
            titel: inhalt.titel,
            text: inhalt.text,
            zeit: inhalt.zeit,
            json: JSON.stringify(inhalt),
        };
        const ordner = ordnerFuer(b.paket);
        return this.erledige('benachrichtigung', 'benachrichtigung', async () => {
            if (ordner) {
                await this.o.ablage.schreibeBenachrichtigung(this.o.appId, ordner, b.app, werte, b.zeit);
            }
            await this.o.ablage.schreibeBenachrichtigung(this.o.appId, LETZTE, b.app, werte, b.zeit);
        });
    }

    // Ab Protokoll 4. Bei doppeltem Paketnamen gilt der letzte Eintrag.
    public auswahl(m: Nachricht): Promise<void> {
        const namen = new Map<string, string>();
        for (const a of m.apps as Benachrichtigungsapp[]) {
            const ordner = ordnerFuer(a.paket);
            if (ordner) {
                namen.set(ordner, a.app);
            }
        }
        return this.erledige('benachrichtigung', 'Auswahl', async () => {
            for (const ordner of await this.o.ablage.benachrichtigungsordner(this.o.appId)) {
                if (!namen.has(ordner)) {
                    await this.o.ablage.entferneBenachrichtigungsordner(this.o.appId, ordner);
                }
            }
            for (const [ordner, name] of namen) {
                await this.o.ablage.legeBenachrichtigungsordner(this.o.appId, ordner, name);
            }
            this.o.log.debug(`App ${this.o.appId}: Auswahl mit ${namen.size} Apps übernommen`);
        });
    }

    private schreibe(art: keyof Handydaten, werte: Appwerte, zeit: number): Promise<void> {
        return this.erledige(art, art, () => this.o.ablage.schreibe(this.o.appId, werte, zeit));
    }

    private erledige(art: keyof Handydaten, was: string, aufgabe: () => Promise<void>): Promise<void> {
        if (!this.handydaten[art]) {
            this.o.log.debug(`App ${this.o.appId}: ${art} abgelehnt, nicht eingeschaltet`);
            this.o.verbindung.sendeFehler('aus', { text: `${art} ist für diese App nicht eingeschaltet` });
            return Promise.resolve();
        }
        this.reihe = this.reihe.then(async () => {
            try {
                await aufgabe();
            } catch {
                // Ohne Fehlertext: Er könnte Rufnummer oder Nachrichteninhalt enthalten.
                this.o.log.warn(`App ${this.o.appId}: ${was} nicht geschrieben`);
                this.o.verbindung.sendeFehler('intern');
            }
        });
        return this.reihe;
    }
}

export interface AnwesenheitOptionen {
    ablage: Appablage;
    nachlaufMs: number;
    log: Protokoll;
}

/** anwesend: true, solange die App über das Heimnetz verbunden ist, false erst nach dem Nachlauf. */
export class Anwesenheit {
    private readonly nachlauf = new Map<string, NodeJS.Timeout>();
    private readonly entfernt = new Set<string>();

    public constructor(private readonly o: AnwesenheitOptionen) {}

    // Nach einem Neustart ist offen, ob die App noch da ist: Nachlauf wie nach einer Trennung, statt sofort abwesend.
    public async starte(appIds: string[]): Promise<void> {
        for (const appId of appIds) {
            if ((await this.o.ablage.zustand(appId, 'anwesend'))?.val === true) {
                this.getrennt(appId, 'lokal');
            }
        }
    }

    public async angemeldet(appId: string, weg: Weg): Promise<void> {
        if (weg !== 'lokal') {
            return;
        }
        clearTimeout(this.nachlauf.get(appId));
        this.nachlauf.delete(appId);
        await this.o.ablage.schreibe(appId, { anwesend: true });
    }

    public getrennt(appId: string, weg: Weg): void {
        if (weg !== 'lokal') {
            return;
        }
        clearTimeout(this.nachlauf.get(appId));
        if (this.entfernt.has(appId)) {
            this.abwesend(appId);
            return;
        }
        this.nachlauf.set(
            appId,
            setTimeout(() => this.abwesend(appId), this.o.nachlaufMs),
        );
    }

    // Sofort abwesend statt nach dem Nachlauf: Sonst gälte die entfernte App noch Minuten als da, und der Nachlauf
    // legte einen inzwischen gelöschten Datenpunkt neu an.
    public entferne(appId: string): void {
        this.entfernt.add(appId);
        if (this.nachlauf.has(appId)) {
            clearTimeout(this.nachlauf.get(appId));
            this.abwesend(appId);
        }
    }

    public beende(): void {
        this.nachlauf.forEach(t => clearTimeout(t));
        this.nachlauf.clear();
    }

    private abwesend(appId: string): void {
        this.nachlauf.delete(appId);
        this.o.ablage
            .schreibe(appId, { anwesend: false })
            .catch((fehler: Error) => this.o.log.error(`Anwesenheit der App ${appId}: ${fehler.message}`));
    }
}
