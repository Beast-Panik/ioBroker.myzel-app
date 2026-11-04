import http from 'node:http';
import type { Duplex } from 'node:stream';
import tls from 'node:tls';
import { WebSocket, WebSocketServer } from 'ws';
import { GRENZEN, type Grenzen, type Protokoll } from './grenzen';
import { sperrbereich } from './schutz';
import type { Identitaet } from './zertifikat';

export type Weg = 'lokal' | 'fern';

// Der Kern behandelt jeden Weg gleich; nur die Anwesenheit fragt später danach.
export interface Herkunft {
    weg: Weg;
    adresse: string;
    eigeneAdresse?: string;
}

export const SCHLIESSCODE = {
    zugang: 4001,
    version: 4002,
    ungueltig: 4003,
    zuviel: 4004,
    abgelehnt: 4005,
    abgelaufen: 4006,
    ersetzt: 4007,
    entfernt: 4008,
    frist: 4009,
    ende: 1001,
    intern: 1011,
} as const;

export type Fehlercode =
    'zugang' | 'version' | 'rechte' | 'ungueltig' | 'zuviel' | 'aus' | 'abgelehnt' | 'abgelaufen' | 'intern';

export interface Fehlerangaben {
    text?: string;
    n?: number;
    unterstuetzt?: number[];
}

// Ohne Antwort der Gegenstelle wartet ws bis zu 30 s auf den Abschluss; so lange soll keine Verbindung einen Platz belegen.
const SCHLIESSEN_HART_MS = 2_000;

export class Verbindung {
    // undefined bei Binärframes
    public empfaenger: (text: string | undefined) => void = () => undefined;
    private readonly trennungen: (() => void)[] = [];
    private getrennt = false;
    private schliesst = false;
    private letzteAntwort = Date.now();

    public constructor(
        private readonly ws: WebSocket,
        public readonly herkunft: Herkunft,
        private readonly grenzen: Grenzen,
        private readonly log: Protokoll,
        public readonly fristErfuellt: () => void,
    ) {
        ws.on('message', (daten, binaer) => {
            this.letzteAntwort = Date.now();
            if (!this.schliesst) {
                this.empfaenger(!binaer && Buffer.isBuffer(daten) ? daten.toString('utf8') : undefined);
            }
        });
        ws.on('pong', () => {
            this.letzteAntwort = Date.now();
        });
        // Statt autoPong: ws beantwortet sonst jeden Ping, auch wenn die Gegenstelle nichts liest.
        ws.on('ping', daten => {
            if (this.offen) {
                this.ws.pong(daten);
                this.pruefePuffer();
            }
        });
        ws.on('error', fehler => log.debug(`WebSocket von ${herkunft.adresse}: ${fehler.message}`));
        ws.on('close', () => {
            this.getrennt = true;
            for (const fn of this.trennungen.splice(0)) {
                fn();
            }
        });
    }

    public get offen(): boolean {
        return !this.schliesst && this.ws.readyState === WebSocket.OPEN;
    }

    public sende(nachricht: object): void {
        if (this.offen) {
            this.ws.send(JSON.stringify(nachricht));
            this.pruefePuffer();
        }
    }

    // Für große Antworten in Teilen: erst weiter, wenn der Teil an das Betriebssystem übergeben oder die Verbindung zu
    // ist. So bleibt der Sendepuffer bei einem Teil, statt über die Grenze zu wachsen.
    public sendeUndWarte(nachricht: object): Promise<void> {
        return new Promise(resolve => {
            if (!this.offen) {
                resolve();
                return;
            }
            const fertig = (): void => {
                this.ws.off('close', fertig);
                resolve();
            };
            this.ws.once('close', fertig);
            this.ws.send(JSON.stringify(nachricht), fertig);
            this.pruefePuffer();
        });
    }

    public sendeFehler(code: Fehlercode, angaben: Fehlerangaben = {}): void {
        const text = angaben.text?.slice(0, this.grenzen.fehlertextZeichen);
        this.sende({ t: 'fehler', code, ...angaben, ...(text === undefined ? {} : { text }) });
    }

    public schliesse(code: number, grund: string): void {
        if (this.schliesst) {
            return;
        }
        this.schliesst = true;
        this.ws.close(code, grund);
        setTimeout(() => this.ws.terminate(), SCHLIESSEN_HART_MS).unref();
    }

    public trenne(): void {
        this.schliesst = true;
        this.ws.terminate();
    }

    // Auch für schon getrennte Verbindungen, damit kein Aufrufer die Trennung verpasst.
    public beiTrennung(fn: () => void): void {
        if (this.getrennt) {
            fn();
        } else {
            this.trennungen.push(fn);
        }
    }

    public pinge(jetzt: number): void {
        if (jetzt - this.letzteAntwort >= this.grenzen.totMs) {
            this.log.debug(`Verbindung von ${this.herkunft.adresse} getrennt: keine Antwort auf Ping`);
            this.trenne();
        } else if (this.offen) {
            this.ws.ping();
        }
    }

    // Liest die Gegenstelle nicht mit, wird hart getrennt, statt den Speicher zu füllen.
    private pruefePuffer(): void {
        if (this.ws.bufferedAmount > this.grenzen.sendepufferBytes) {
            this.log.warn(`Verbindung von ${this.herkunft.adresse} getrennt: Gegenstelle nimmt keine Nachrichten ab`);
            this.trenne();
        }
    }
}

interface Eingang {
    tls: tls.TLSSocket;
    herkunft: Herkunft;
    frist: NodeJS.Timeout;
    vorAnmeldung: boolean;
    verbindung?: Verbindung;
}

export interface KernOptionen {
    identitaet: Identitaet;
    log: Protokoll;
    gesperrt: (adresse: string) => boolean;
    fehlversuch: (adresse: string) => void;
    verbunden: (verbindung: Verbindung) => void;
    grenzen?: Grenzen;
}

// Nimmt einen beliebigen Datenstrom und beendet TLS selbst: Ein späterer Weg über das Internet liefert nur einen weiteren
// Datenstrom und braucht hier keinen Umbau.
export class Kern {
    private readonly grenzen: Grenzen;
    private readonly kontext: tls.SecureContext;
    private readonly http = http.createServer();
    private readonly wss: WebSocketServer;
    private readonly eingaenge = new Set<Eingang>();
    private readonly zuordnung = new WeakMap<Duplex, Eingang>();
    private readonly takt: NodeJS.Timeout;
    private beendet = false;

    public constructor(private readonly o: KernOptionen) {
        this.grenzen = o.grenzen ?? GRENZEN;
        this.kontext = tls.createSecureContext({
            key: o.identitaet.schluessel,
            cert: o.identitaet.zertifikat,
            minVersion: 'TLSv1.3',
        });
        this.wss = new WebSocketServer({
            noServer: true,
            maxPayload: this.grenzen.nachrichtBytes,
            perMessageDeflate: false,
            clientTracking: false,
            autoPong: false,
        });
        this.http.on('request', (_anfrage: http.IncomingMessage, antwort: http.ServerResponse) => {
            antwort.writeHead(404, { connection: 'close', 'content-length': 0 }).end();
        });
        this.http.on('upgrade', (anfrage: http.IncomingMessage, socket: Duplex, kopf: Buffer) =>
            this.upgrade(anfrage, socket, kopf),
        );
        this.http.on('clientError', (_fehler: Error, socket: Duplex) => socket.destroy());
        this.takt = setInterval(() => {
            const jetzt = Date.now();
            for (const e of this.eingaenge) {
                e.verbindung?.pinge(jetzt);
            }
        }, this.grenzen.pingMs);
        this.takt.unref();
    }

    public nimm(strom: Duplex, herkunft: Herkunft): void {
        strom.on('error', () => undefined);
        const grund = this.ablehnung(herkunft.adresse);
        if (grund) {
            this.o.log.debug(`Verbindung von ${herkunft.adresse} abgewiesen: ${grund}`);
            strom.destroy();
            return;
        }
        const socket = new tls.TLSSocket(strom, { isServer: true, secureContext: this.kontext });
        const eingang: Eingang = {
            tls: socket,
            herkunft,
            vorAnmeldung: true,
            frist: setTimeout(() => this.fristAbgelaufen(eingang), this.grenzen.anmeldungMs),
        };
        this.eingaenge.add(eingang);
        this.zuordnung.set(socket, eingang);
        socket.on('error', fehler => this.o.log.debug(`TLS von ${herkunft.adresse}: ${fehler.message}`));
        socket.on('close', () => {
            clearTimeout(eingang.frist);
            this.eingaenge.delete(eingang);
            strom.destroy();
        });
        this.http.emit('connection', socket);
    }

    public async beende(): Promise<void> {
        this.beendet = true;
        clearInterval(this.takt);
        for (const e of this.eingaenge) {
            if (e.verbindung) {
                e.verbindung.schliesse(SCHLIESSCODE.ende, 'Adapter wird beendet');
            } else {
                e.tls.destroy();
            }
        }
        if (this.eingaenge.size > 0) {
            await new Promise(r => setTimeout(r, 300));
        }
        for (const e of this.eingaenge) {
            e.tls.destroy();
        }
        this.wss.close();
    }

    private ablehnung(adresse: string): string | undefined {
        if (this.beendet) {
            return 'Adapter wird beendet';
        }
        if (this.o.gesperrt(adresse)) {
            return 'Adresse gesperrt';
        }
        if (this.eingaenge.size >= this.grenzen.verbindungen) {
            return `mehr als ${this.grenzen.verbindungen} Verbindungen`;
        }
        const bereich = sperrbereich(adresse);
        let gesamt = 0;
        let vonHier = 0;
        for (const e of this.eingaenge) {
            if (e.vorAnmeldung) {
                gesamt++;
                vonHier += sperrbereich(e.herkunft.adresse) === bereich ? 1 : 0;
            }
        }
        // Gesamtgrenze, damit Verbindungen ohne Anmeldung nie alle Plätze belegen und angemeldete Apps Platz behalten
        if (gesamt >= this.grenzen.ohneAnmeldung) {
            return `${gesamt} Verbindungen ohne Anmeldung insgesamt`;
        }
        return vonHier >= this.grenzen.offenJeAdresse ? `${vonHier} Verbindungen ohne Anmeldung` : undefined;
    }

    private upgrade(anfrage: http.IncomingMessage, socket: Duplex, kopf: Buffer): void {
        const eingang = this.zuordnung.get(socket);
        if (!eingang || anfrage.method !== 'GET' || anfrage.url !== '/v1') {
            this.antworte(socket, 404);
            return;
        }
        // Die App sendet keinen Origin-Kopf, Browser immer: So kann keine Webseite im Heimnetz den Adapter ansprechen.
        if (anfrage.headers.origin !== undefined) {
            this.o.log.debug(`Verbindung von ${eingang.herkunft.adresse} abgewiesen: Origin-Kopf`);
            this.antworte(socket, 403);
            return;
        }
        this.wss.handleUpgrade(anfrage, socket, kopf, ws => {
            if (this.beendet || eingang.tls.destroyed) {
                ws.terminate();
                return;
            }
            eingang.verbindung = new Verbindung(ws, eingang.herkunft, this.grenzen, this.o.log, () => {
                clearTimeout(eingang.frist);
                eingang.vorAnmeldung = false;
            });
            this.o.verbunden(eingang.verbindung);
        });
    }

    private antworte(socket: Duplex, status: number): void {
        socket.end(`HTTP/1.1 ${status} ${http.STATUS_CODES[status]}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    }

    // Zählt als Fehlversuch: Wer Plätze ohne Anmeldung bis zur Frist belegt, wird wie bei falschem Zugang gesperrt.
    private fristAbgelaufen(eingang: Eingang): void {
        this.o.fehlversuch(eingang.herkunft.adresse);
        if (eingang.verbindung) {
            this.o.log.warn(`Anmeldung von ${eingang.herkunft.adresse} abgelehnt: keine Anmeldung innerhalb der Frist`);
            eingang.verbindung.schliesse(SCHLIESSCODE.frist, 'keine Anmeldung');
        } else {
            this.o.log.debug(`Verbindung von ${eingang.herkunft.adresse} getrennt: kein WebSocket innerhalb der Frist`);
            eingang.tls.destroy();
        }
    }
}
