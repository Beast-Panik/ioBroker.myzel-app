import { isDeepStrictEqual } from 'node:util';
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
import { type Adaptergrund, ZONEN_SEIT, type Zonenangabe, type Zonengrund, grundText } from './zonen';

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

interface Zonenwechsel {
    id: string;
    drin: boolean;
    zeit: number;
}

interface Zonenstand {
    aktiv: boolean;
    grund?: Zonengrund;
    drin: string[];
    zeit: number;
}

interface Standort {
    breite: number;
    laenge: number;
    genauigkeit: number;
    zeit: number;
}

interface Vorschlag {
    breite: number;
    laenge: number;
    genauigkeit: number;
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
    // Protokollversion der Sitzung: Zonen und Standort erst ab 7
    version: number;
    // Die Zonen, die die App zuletzt bekommen hat
    zonen: Zonenangabe[];
    // Name einer Zone, wie er jetzt im Katalog steht; die Liste oben folgt einer Umbenennung erst mit der Neuberechnung
    zonenname?: (zone: string) => string | undefined;
    // Systemsprache für den Text in zonen.grund
    sprache: () => string;
    // Ein Mittelpunkt vom Handy für den Reiter „Zonen“; geht nirgends sonst hin
    vorschlag?: (v: Vorschlag) => void;
    // Die Mengen gelten je App, nicht je Sitzung: Der Dienst hält die Eimer über neue Verbindungen hinweg.
    eimer?: Handyeimer;
    grenzen?: { zonenJeStunde: number; standortAbstandMs: number };
    jetzt?: () => number;
}

// Mengen je App (KONZEPT-ZONEN.md, Abschnitt 16.5): Zonenmeldungen höchstens 60 je Stunde, nach einem Stoß von 10;
// Standorte einer je Minute, nach einem Stoß von 2.
const ZONEN_JE_STUNDE = 60;
const ZONEN_STOSS = 10;
const STANDORT_ABSTAND_MS = 60_000;
const STANDORT_STOSS = 2;
// Ein Vorschlag je Minute: Er kommt nur auf einen Tipp in der App
const VORSCHLAG_ABSTAND_MS = 60_000;

export interface Handyeimer {
    zonen: Eimer;
    standort: Eimer;
    vorschlag: Eimer;
    // Zuletzt ins Log geschriebener Zonenstand; jede neue Verbindung schickt den Stand wieder, das Log nennt nur Änderungen
    imLog?: Zonenlog;
}

interface Zonenlog {
    aktiv: boolean;
    grund: string;
    drin: string[];
}

// Uhrzeit vom Handy für das Log, in der Zeitzone des Adapters wie die Zeilen selbst; Nachgeliefertes erkennt man so
function uhrzeit(ms: number): string {
    const d = new Date(ms);
    return [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2, '0')).join(':');
}

export function neueHandyeimer(g?: { zonenJeStunde: number; standortAbstandMs: number }): Handyeimer {
    return {
        zonen: new Eimer(ZONEN_STOSS, 3_600_000 / (g?.zonenJeStunde ?? ZONEN_JE_STUNDE)),
        standort: new Eimer(STANDORT_STOSS, g?.standortAbstandMs ?? STANDORT_ABSTAND_MS),
        vorschlag: new Eimer(1, VORSCHLAG_ABSTAND_MS),
    };
}

// Wie die Auswahl im Protokoll höchstens nennt
const ORDNER_HOECHSTENS = 100;

/** Handydaten einer Sitzung: nur eingeschaltete Datenarten, mit ack=true und der Zeit vom Handy (Abschnitt 6 des Konzepts). */
export class Handyeingang {
    // Ändern nur über uebernimm und schraenkeEin
    public handydaten: Handydaten;
    // Nacheinander, sonst überholt ein späteres Ereignis ein früheres zwischen den Einzelwerten.
    private reihe: Promise<void> = Promise.resolve();
    // Ordner nur für Apps, die das Handy zuletzt ausgewählt hat; ein falsches Handy legte sonst mit jedem neuen
    // Paketnamen einen Ordner an. Ohne Auswahl (Protokoll 3) höchstens ORDNER_HOECHSTENS.
    private ausgewaehlt?: Set<string>;
    private ohneAuswahl?: Set<string>;
    private zuVieleGemeldet = false;
    public zonen: Zonenangabe[];
    private readonly zonenEimer: Eimer;
    private readonly standortEimer: Eimer;
    private readonly vorschlagEimer: Eimer;
    private readonly eimer: Handyeimer;
    private readonly jetzt: () => number;

    public constructor(private readonly o: HandyeingangOptionen) {
        this.handydaten = o.handydaten;
        this.zonen = o.zonen;
        this.jetzt = o.jetzt ?? Date.now;
        const eimer = o.eimer ?? neueHandyeimer(o.grenzen);
        this.eimer = eimer;
        this.zonenEimer = eimer.zonen;
        this.standortEimer = eimer.standort;
        this.vorschlagEimer = eimer.vorschlag;
    }

    /**
     * Neue, geprüfte Freigaben aus der Neuberechnung. Endet die Freigabe der Zonen, sagt zonen.aktiv es gleich in der
     * Reihe, hinter allem, was die App vorher geschickt hat; sonst schriebe ein Stand, der kurz vorher kam, aktiv=true,
     * und danach schriebe niemand mehr etwas.
     */
    public uebernimm(handydaten: Handydaten, grund: Adaptergrund = 'admin'): void {
        const zonenEnden = this.handydaten.zonen === true && handydaten.zonen !== true;
        this.handydaten = handydaten;
        if (zonenEnden && this.o.version >= ZONEN_SEIT) {
            void this.zonenAus(grund);
        }
    }

    // Sofort bei einer Änderung am Objekt der App, vor der Neuberechnung: nur ausschalten, nie einschalten
    public schraenkeEin(bleibt: (art: keyof Handydaten) => boolean, grund: Adaptergrund = 'admin'): void {
        const neu = { ...this.handydaten };
        for (const art of Object.keys(neu) as (keyof Handydaten)[]) {
            neu[art] = neu[art] === true && bleibt(art);
        }
        if (!isDeepStrictEqual(neu, this.handydaten)) {
            this.uebernimm(neu, grund);
        }
    }

    // zonen.aktiv false mit Grund, falls es den Datenpunkt gibt und er noch nicht so steht
    public zonenAus(grund: Adaptergrund): Promise<void> {
        this.reihe = this.reihe.then(async () => {
            // In der Reihe, hinter einem Stand, der vorher kam: Der nächste nach dem Wiedereinschalten soll im Log
            // stehen, auch wenn er dem letzten gleicht
            this.eimer.imLog = undefined;
            try {
                await meldeZonenAus(this.o.ablage, this.o.appId, grundText(grund, this.o.sprache()));
            } catch {
                this.o.log.warn(`App ${this.o.appId}: Ende der Zonen nicht geschrieben`);
            }
        });
        return this.reihe;
    }

    // Betreten oder verlassen: erst der Datenpunkt der Zone, dann zonen.letzte. Ein Skript auf letzte sieht so den
    // Stand aller Zonen schon richtig.
    public zone(m: Nachricht): Promise<void> {
        const z = m as unknown as Zonenwechsel;
        if (!this.zonenPruefen('zone')) {
            return Promise.resolve();
        }
        const zone = this.zonen.find(x => x.id === z.id);
        // Ohne Freigabe antwortet erledige mit aus
        if (this.handydaten.zonen && !zone) {
            this.o.log.debug(`App ${this.o.appId}: Meldung zu einer Zone, die ihr nicht freigegeben ist`);
            this.o.verbindung.sendeFehler('abgelehnt', { text: 'Diese Zone ist für die App nicht freigegeben' });
            return Promise.resolve();
        }
        return this.erledige('zonen', 'Zonenwechsel', async () => {
            const id = zone!.id;
            const name = this.o.zonenname?.(id) ?? zone!.name;
            const letzte = JSON.stringify({
                zone: id,
                name,
                ereignis: z.drin ? 'betreten' : 'verlassen',
                zeit: z.zeit,
            });
            await this.o.ablage.schreibeZone(this.o.appId, id, name, z.drin, z.zeit);
            await this.o.ablage.schreibe(this.o.appId, { 'zonen.letzte': letzte }, z.zeit);
            // Nur Name und Zeit, nie ein Ort; der folgende Stand mit derselben Lage steht dann nicht noch einmal da
            this.o.log.info(
                `App ${this.o.appId}: Zone „${name}“ ${z.drin ? 'betreten' : 'verlassen'} um ${uhrzeit(z.zeit)}`,
            );
            const imLog = this.eimer.imLog;
            if (imLog?.aktiv) {
                const drin = new Set(imLog.drin);
                if (z.drin) {
                    drin.add(id);
                } else {
                    drin.delete(id);
                }
                this.eimer.imLog = { ...imLog, drin: [...drin].sort() };
            }
        });
    }

    // Ersetzt den Stand aller freigegebenen Zonen; ohne aktiv bleiben die Zonen, wie sie waren, nur aktiv und grund
    // ändern sich. Zonen, die inzwischen nicht mehr freigegeben sind, übergeht er.
    public zonenstand(m: Nachricht): Promise<void> {
        const s = m as unknown as Zonenstand;
        if (!this.zonenPruefen('zonenstand')) {
            return Promise.resolve();
        }
        const drin = new Set(s.drin);
        const zonen = [...this.zonen];
        const grund = s.aktiv ? '' : grundText(s.grund ?? 'keine_standorte', this.o.sprache());
        return this.erledige('zonen', 'Zonenstand', async () => {
            if (s.aktiv) {
                for (const zone of zonen) {
                    const name = this.o.zonenname?.(zone.id) ?? zone.name;
                    await this.o.ablage.schreibeZone(this.o.appId, zone.id, name, drin.has(zone.id), s.zeit);
                }
            }
            await this.o.ablage.schreibe(this.o.appId, { 'zonen.aktiv': s.aktiv, 'zonen.grund': grund }, s.zeit);
            this.logStand(s, grund, zonen);
        });
    }

    // Nur, wenn sich etwas geändert hat; die Zonen mit Namen, nie ein Ort
    private logStand(s: Zonenstand, grund: string, zonen: Zonenangabe[]): void {
        const neu: Zonenlog = {
            aktiv: s.aktiv,
            grund,
            drin: s.aktiv
                ? zonen
                      .map(z => z.id)
                      .filter(id => s.drin.includes(id))
                      .sort()
                : [],
        };
        if (isDeepStrictEqual(neu, this.eimer.imLog)) {
            return;
        }
        this.eimer.imLog = neu;
        const um = uhrzeit(s.zeit);
        if (!s.aktiv) {
            this.o.log.info(`App ${this.o.appId}: Zonen nicht aktiv um ${um}: ${grund}`);
            return;
        }
        const namen = neu.drin.map(id => `„${this.o.zonenname?.(id) ?? zonen.find(z => z.id === id)?.name ?? id}“`);
        this.o.log.info(
            `App ${this.o.appId}: Zonen aktiv um ${um}, ${namen.length === 0 ? 'in keiner Zone' : `drin: ${namen.join(', ')}`}`,
        );
    }

    // json zuletzt, wie bei den Benachrichtigungen. Koordinaten nie ins Log.
    public standort(m: Nachricht): Promise<void> {
        const s = m as unknown as Standort;
        if (this.o.version < ZONEN_SEIT) {
            this.o.verbindung.sendeFehler('ungueltig', { text: 'standort erst ab Protokollversion 7' });
            return Promise.resolve();
        }
        if (this.handydaten.standort && !this.standortEimer.nimm(this.jetzt())) {
            this.o.verbindung.sendeFehler('zuviel', { text: 'höchstens ein Standort je Minute' });
            return Promise.resolve();
        }
        const json = JSON.stringify({ breite: s.breite, laenge: s.laenge, genauigkeit: s.genauigkeit, zeit: s.zeit });
        return this.schreibe(
            'standort',
            {
                'standort.breite': s.breite,
                'standort.laenge': s.laenge,
                'standort.genauigkeit': s.genauigkeit,
                'standort.json': json,
            },
            s.zeit,
        );
    }

    // Bei der Anmeldung: Datenpunkte von Zonen, die die App nicht mehr hat, etwa nach einem Löschen im Objektbrowser,
    // während sie nicht verbunden war
    public entferneUebrige(behalten: (zone: string) => boolean): Promise<void> {
        this.reihe = this.reihe.then(async () => {
            try {
                for (const zone of (await this.o.ablage.zonenpunkte(this.o.appId)).filter(z => !behalten(z))) {
                    await this.o.ablage.entferneZone(this.o.appId, zone);
                }
            } catch (fehler) {
                this.o.log.warn(
                    `App ${this.o.appId}: Datenpunkte gelöschter Zonen nicht entfernt: ${(fehler as Error).message}`,
                );
            }
        });
        return this.reihe;
    }

    /**
     * Entfernt die Datenpunkte von Zonen, die der App entzogen oder gelöscht sind. In der Reihe, damit kein Wechsel, der
     * vor der Neuberechnung kam und noch aussteht, sie danach wieder anlegt.
     */
    public entferneZonen(zonen: string[]): Promise<void> {
        if (zonen.length === 0) {
            return this.reihe;
        }
        this.reihe = this.reihe.then(async () => {
            try {
                const da = await this.o.ablage.zonenpunkte(this.o.appId);
                for (const zone of zonen.filter(z => da.includes(z))) {
                    await this.o.ablage.entferneZone(this.o.appId, zone);
                }
            } catch (fehler) {
                this.o.log.warn(
                    `App ${this.o.appId}: Datenpunkte entzogener Zonen nicht entfernt: ${(fehler as Error).message}`,
                );
            }
        });
        return this.reihe;
    }

    // Nur mit der Datenart Zonen, nur im Speicher des Dienstes, nie ins Log
    public vorschlag(m: Nachricht): Promise<void> {
        const v = m as unknown as Vorschlag;
        if (this.o.version < ZONEN_SEIT) {
            this.o.verbindung.sendeFehler('ungueltig', { text: 'vorschlag erst ab Protokollversion 7' });
            return Promise.resolve();
        }
        if (!this.handydaten.zonen) {
            this.o.verbindung.sendeFehler('aus', { text: 'zonen ist für diese App nicht eingeschaltet' });
            return Promise.resolve();
        }
        if (!this.vorschlagEimer.nimm(this.jetzt())) {
            this.o.verbindung.sendeFehler('zuviel', { text: 'höchstens ein Vorschlag je Minute' });
            return Promise.resolve();
        }
        this.o.vorschlag?.({ breite: v.breite, laenge: v.laenge, genauigkeit: v.genauigkeit, zeit: v.zeit });
        this.o.log.info(`App ${this.o.appId}: Vorschlag für den Mittelpunkt einer Zone empfangen`);
        return Promise.resolve();
    }

    // Version und Menge; die Freigabe prüft erledige
    private zonenPruefen(was: string): boolean {
        if (this.o.version < ZONEN_SEIT) {
            this.o.verbindung.sendeFehler('ungueltig', { text: `${was} erst ab Protokollversion 7` });
            return false;
        }
        if (this.handydaten.zonen && !this.zonenEimer.nimm(this.jetzt())) {
            this.o.verbindung.sendeFehler('zuviel', { text: 'zu viele Zonenmeldungen' });
            return false;
        }
        return true;
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
            if (ordner && (await this.darfOrdner(ordner))) {
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
        if (this.handydaten.benachrichtigung) {
            this.ausgewaehlt = new Set(namen.keys());
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

    private async darfOrdner(ordner: string): Promise<boolean> {
        if (this.ausgewaehlt) {
            return this.ausgewaehlt.has(ordner);
        }
        this.ohneAuswahl ??= new Set(await this.o.ablage.benachrichtigungsordner(this.o.appId));
        if (this.ohneAuswahl.has(ordner)) {
            return true;
        }
        if (this.ohneAuswahl.size >= ORDNER_HOECHSTENS) {
            if (!this.zuVieleGemeldet) {
                this.zuVieleGemeldet = true;
                this.o.log.warn(
                    `App ${this.o.appId}: mehr als ${ORDNER_HOECHSTENS} Apps mit Benachrichtigungen, weitere nur unter ${LETZTE}`,
                );
            }
            return false;
        }
        this.ohneAuswahl.add(ordner);
        return true;
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

/** zonen.aktiv false mit dem Text, wenn es den Datenpunkt gibt und er nicht schon so steht. */
export async function meldeZonenAus(ablage: Appablage, appId: string, text: string): Promise<void> {
    const aktiv = await ablage.zustand(appId, 'zonen.aktiv');
    if (!aktiv) {
        return;
    }
    if (aktiv.val !== false || (await ablage.zustand(appId, 'zonen.grund'))?.val !== text) {
        await ablage.schreibe(appId, { 'zonen.aktiv': false, 'zonen.grund': text });
    }
}

// Eimer mit Marken: stoss sofort, danach eine je abstandMs
export class Eimer {
    private marken: number;
    private zeit?: number;

    public constructor(
        private readonly stoss: number,
        private readonly abstandMs: number,
    ) {
        this.marken = stoss;
    }

    public nimm(jetzt: number): boolean {
        if (this.zeit !== undefined) {
            this.marken = Math.min(this.stoss, this.marken + (jetzt - this.zeit) / this.abstandMs);
        }
        this.zeit = jetzt;
        if (this.marken < 1) {
            return false;
        }
        this.marken -= 1;
        return true;
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
