import { Duplex } from 'node:stream';
import { WebSocket } from 'ws';
import type { Protokoll } from '../basis/grenzen';
import type { Herkunft } from '../basis/kern';

// Vermittlerprotokoll aus KONZEPT-FERNZUGANG.md, Abschnitt 4
export const VERMITTLERPROTOKOLL = 1;
// Grenze des Vermittlers ist 64 KiB je Nachricht; TLS gibt manchmal mehrere Datensätze auf einmal ab.
const NACHRICHT_BYTES = 32 * 1024;
const VERMITTLER_NACHRICHT_BYTES = 64 * 1024;
const FRIST_MS = 10_000;
// /info ist ein kleines JSON. Gezählt wird nach dem Entpacken: fetch entpackt gzip selbst, 1 KiB können dann
// Gigabyte werden.
const INFO_BYTES = 1024;

// Jede Verbindung zum Vermittler ist eine neue Verbindung von zu Hause zum Server. Vor dem Server sitzen
// Schutzmechanismen, die einen Anschluss bei vielen neuen Verbindungen in kurzer Zeit sperren; dann wäre der Adapter für
// alle Apps weg. Deshalb wächst der Abstand, und Sitzungen sind je Zeitfenster begrenzt, auch wenn eine App oder der
// Vermittler sich falsch verhält.
export const FERNZEITEN = {
    ersterVersuchMs: 1_000,
    letzterVersuchMs: 60_000,
    // Erst eine so lange stehende Steuerverbindung setzt den Abstand zurück. Sonst verbände ein Adapter, den der
    // Vermittler gleich wieder trennt, etwa weil eine zweite Instanz mit demselben Schlüssel läuft, jede Sekunde neu.
    stabilMs: 60_000,
    // Der Vermittler pingt die Steuerverbindung alle 30 s.
    stilleMs: 90_000,
    messenMs: 60_000,
    sitzungenJeFenster: 30,
    // Eine einzelne App, etwa ein verlorenes Handy, darf das Fenster nicht für alle aufbrauchen
    sitzungenJeApp: 10,
    fensterMs: 10 * 60_000,
};
export type Fernzeiten = typeof FERNZEITEN;

export interface Fernapp {
    appId: string;
    // SHA-256 des Vermittlerschlüssels der App, hex
    hash: string;
}

export type Fernstand =
    | { art: 'verbindet' }
    | { art: 'verbunden'; seit: number; verzoegerungMs?: number }
    | { art: 'getrennt'; grund: string; naechsterVersuch: number };

export interface FernOptionen {
    adresse: string;
    adapterSchluessel: string;
    apps: () => Promise<Fernapp[]>;
    nimm: (strom: Duplex, herkunft: Herkunft) => void;
    log: Protokoll;
    stand: (stand: Fernstand) => void;
    // Tests geben kürzere Zeiten vor
    zeiten?: Partial<Fernzeiten>;
}

// Eine WebSocket-Verbindung zum Vermittler als Bytestrom für den Kern. Gegendruck in beide Richtungen: Liest der Kern
// nicht, ruht der Empfang; geschrieben wird Stück für Stück erst, wenn das vorige abgegeben ist.
export class Datenstrom extends Duplex {
    public constructor(private readonly ws: WebSocket) {
        super();
        ws.on('message', (daten: Buffer, binaer: boolean) => {
            if (!binaer) {
                this.destroy(new Error('Text auf der Datenverbindung'));
            } else if (!this.push(daten)) {
                ws.pause();
            }
        });
        ws.once('close', () => {
            if (!this.destroyed) {
                this.push(null);
            }
        });
        ws.on('error', fehler => this.destroy(fehler));
    }

    public override _read(): void {
        this.ws.resume();
    }

    public override _write(chunk: Buffer, _kodierung: BufferEncoding, fertig: (fehler?: Error | null) => void): void {
        let rest = chunk;
        const weiter = (fehler?: Error): void => {
            if (fehler || rest.length === 0) {
                fertig(fehler);
                return;
            }
            const teil = rest.subarray(0, NACHRICHT_BYTES);
            rest = rest.subarray(teil.length);
            this.ws.send(teil, { binary: true }, weiter);
        };
        weiter();
    }

    public override _final(fertig: (fehler?: Error | null) => void): void {
        this.ws.close(1000);
        fertig();
    }

    public override _destroy(fehler: Error | null, fertig: (fehler?: Error | null) => void): void {
        if (this.ws.readyState !== WebSocket.CLOSED) {
            this.ws.terminate();
        }
        fertig(fehler);
    }
}

// Wählt sich beim Vermittler ein, hält die Steuerverbindung und reicht jede Sitzung einer bekannten App an den Kern.
export class Fern {
    private readonly z: Fernzeiten;
    private steuer?: WebSocket;
    private versuchMs: number;
    private wiederholung?: NodeJS.Timeout;
    private stille?: NodeJS.Timeout;
    private messen?: NodeJS.Timeout;
    private gepingt?: number;
    private seit = 0;
    private beendet = false;
    private letzterGrund = '';
    private hashZuApp = new Map<string, string>();
    // Wann zuletzt Sitzungen abgeholt wurden, nur im laufenden Fenster, mit App
    private abgeholt: { zeit: number; appId: string }[] = [];
    private gebremstGemeldet = 0;
    // Abgeholte Sitzungen, bis der Kern sie hat
    private readonly imAufbau = new Set<WebSocket>();
    // Abgleiche nacheinander, sonst überholte ein langsamer älterer einen neueren
    private abgleiche: Promise<void> = Promise.resolve();
    private readonly basis: string;

    public constructor(private readonly o: FernOptionen) {
        this.z = { ...FERNZEITEN, ...o.zeiten };
        this.versuchMs = this.z.ersterVersuchMs;
        this.basis = o.adresse.replace(/^https:/, 'wss:').replace(/\/+$/, '');
    }

    public starte(): void {
        void this.verbinde();
    }

    public beende(): void {
        this.beendet = true;
        this.raeumeAuf();
        clearTimeout(this.wiederholung);
        this.steuer?.terminate();
        this.imAufbau.forEach(ws => ws.terminate());
        this.imAufbau.clear();
    }

    // Neue Liste der freigegebenen Apps: Wer fehlt, verliert beim Vermittler sofort seine Sitzungen.
    public abgleich(): Promise<void> {
        const lauf = this.abgleiche.then(async () => {
            const apps = await this.o.apps();
            this.hashZuApp = new Map(apps.map(a => [a.hash, a.appId]));
            if (this.steuer?.readyState === WebSocket.OPEN) {
                this.steuer.send(JSON.stringify({ art: 'apps', hashes: [...this.hashZuApp.keys()] }));
            }
        });
        this.abgleiche = lauf.catch(() => undefined);
        return lauf;
    }

    private kopf(): {
        headers: Record<string, string>;
        maxPayload: number;
        perMessageDeflate: false;
        handshakeTimeout: number;
    } {
        return {
            headers: { Authorization: `Bearer ${this.o.adapterSchluessel}` },
            maxPayload: VERMITTLER_NACHRICHT_BYTES,
            perMessageDeflate: false,
            handshakeTimeout: FRIST_MS,
        };
    }

    private async verbinde(): Promise<void> {
        if (this.beendet) {
            return;
        }
        this.o.stand({ art: 'verbindet' });
        this.letzterGrund = '';
        try {
            await this.pruefeVersion();
            await this.abgleich();
        } catch (fehler) {
            this.spaeter((fehler as Error).message);
            return;
        }
        if (this.beendet) {
            return;
        }
        const ws = new WebSocket(`${this.basis}/adapter`, this.kopf());
        this.steuer = ws;
        ws.on('open', () => {
            this.seit = Date.now();
            this.o.log.info(`Fernzugang: mit dem Vermittler ${this.o.adresse} verbunden`);
            this.o.stand({ art: 'verbunden', seit: this.seit });
            ws.send(JSON.stringify({ art: 'apps', hashes: [...this.hashZuApp.keys()] }));
            this.lebt();
            this.messen = setInterval(() => {
                this.gepingt = Date.now();
                ws.ping();
            }, this.z.messenMs);
        });
        ws.on('ping', () => this.lebt());
        ws.on('pong', () => {
            this.lebt();
            if (this.gepingt !== undefined) {
                this.o.stand({ art: 'verbunden', seit: this.seit, verzoegerungMs: Date.now() - this.gepingt });
                this.gepingt = undefined;
            }
        });
        ws.on('message', (daten: Buffer, binaer: boolean) => {
            this.lebt();
            if (!binaer) {
                // Ein Fehler hier endete ungefangen und mit ihm der ganze Adapter, auch im Heimnetz
                try {
                    this.nachricht(daten.toString('utf8'));
                } catch (fehler) {
                    this.o.log.warn(
                        `Fernzugang: Nachricht des Vermittlers nicht verarbeitet: ${(fehler as Error).message}`,
                    );
                }
            }
        });
        ws.on('error', fehler => {
            this.letzterGrund = grundAus(fehler);
        });
        ws.on('close', (code: number, grund: Buffer) => {
            this.raeumeAuf();
            const stabil = this.seit > 0 && Date.now() - this.seit >= this.z.stabilMs;
            this.seit = 0;
            if (this.steuer === ws) {
                this.steuer = undefined;
                if (stabil) {
                    this.versuchMs = this.z.ersterVersuchMs;
                }
                const ersetzt = code === 1001 && grund.toString('utf8') === 'ersetzt';
                this.spaeter(
                    this.letzterGrund ||
                        (ersetzt
                            ? 'Ein anderer Adapter mit demselben Schlüssel hat sich beim Vermittler angemeldet'
                            : `Verbindung beendet (${code})`),
                );
            }
        });
    }

    private async pruefeVersion(): Promise<void> {
        let info: unknown;
        try {
            const antwort = await fetch(`${this.o.adresse.replace(/\/+$/, '')}/info`, {
                signal: AbortSignal.timeout(FRIST_MS),
                redirect: 'error',
            });
            if (!antwort.ok) {
                await antwort.body?.cancel();
                throw new Error(`antwortet mit ${antwort.status}`);
            }
            info = JSON.parse(await liesHoechstens(antwort, INFO_BYTES));
        } catch (fehler) {
            throw new Error(`Vermittler nicht erreichbar: ${grundAus(fehler as Error)}`);
        }
        const version = (info as { protokoll?: unknown } | null)?.protokoll;
        if (version !== VERMITTLERPROTOKOLL) {
            throw new Error(`Vermittler spricht Protokoll ${String(version)}, der Adapter ${VERMITTLERPROTOKOLL}`);
        }
    }

    private nachricht(text: string): void {
        let m: unknown;
        try {
            m = JSON.parse(text);
        } catch {
            this.o.log.debug('Fernzugang: unlesbare Nachricht vom Vermittler');
            return;
        }
        if (typeof m !== 'object' || m === null || Array.isArray(m)) {
            this.o.log.debug('Fernzugang: Nachricht vom Vermittler ist kein Objekt');
            return;
        }
        const { art, nummer, app } = m as { art?: unknown; nummer?: unknown; app?: unknown };
        if (art !== 'sitzung' || typeof nummer !== 'string' || !/^[0-9a-f]{32}$/.test(nummer)) {
            // Nur bekannte Arten ins Log; der Rest käme vom Vermittler
            this.o.log.debug(
                `Fernzugang: unbekannte Nachricht vom Vermittler (${typeof art === 'string' && /^[a-z]{1,20}$/.test(art) ? art : typeof art})`,
            );
            return;
        }
        const appId = typeof app === 'string' ? this.hashZuApp.get(app) : undefined;
        if (!appId) {
            this.o.log.debug('Fernzugang: Sitzung einer unbekannten App nicht geöffnet');
            return;
        }
        if (!this.darfAbholen(Date.now(), appId)) {
            return;
        }
        const daten = new WebSocket(`${this.basis}/adapter/sitzung/${nummer}`, this.kopf());
        this.imAufbau.add(daten);
        daten.on('error', fehler => this.o.log.debug(`Fernzugang, Sitzung der App ${appId}: ${fehler.message}`));
        daten.once('close', () => this.imAufbau.delete(daten));
        daten.once('open', () => {
            this.imAufbau.delete(daten);
            if (this.beendet) {
                daten.terminate();
                return;
            }
            this.o.nimm(new Datenstrom(daten), { weg: 'fern', adresse: `fern:${appId}`, app: appId });
        });
    }

    // Die App bekommt dann vom Vermittler nach 10 s Schluss und versucht es später wieder.
    private darfAbholen(jetzt: number, appId: string): boolean {
        this.abgeholt = this.abgeholt.filter(a => jetzt - a.zeit < this.z.fensterMs);
        if (this.abgeholt.filter(a => a.appId === appId).length >= this.z.sitzungenJeApp) {
            this.o.log.debug(`Fernzugang: App ${appId} hat zu viele Sitzungen in kurzer Zeit, vorerst keine weitere`);
            return false;
        }
        if (this.abgeholt.length < this.z.sitzungenJeFenster) {
            this.abgeholt.push({ zeit: jetzt, appId });
            return true;
        }
        if (jetzt - this.gebremstGemeldet >= this.z.fensterMs) {
            this.gebremstGemeldet = jetzt;
            this.o.log.warn(
                `Fernzugang: mehr als ${this.z.sitzungenJeFenster} Sitzungen in ${this.z.fensterMs / 60_000} Minuten, ` +
                    'weitere bleiben vorerst zu. Sonst sperrt der Schutz vor dem Vermittler womöglich diesen Anschluss.',
            );
        }
        return false;
    }

    private lebt(): void {
        clearTimeout(this.stille);
        this.stille = setTimeout(() => {
            this.letzterGrund = 'Vermittler antwortet nicht mehr';
            this.steuer?.terminate();
        }, this.z.stilleMs);
    }

    private raeumeAuf(): void {
        clearTimeout(this.stille);
        clearInterval(this.messen);
        this.gepingt = undefined;
    }

    private spaeter(grund: string): void {
        if (this.beendet) {
            return;
        }
        const naechsterVersuch = Date.now() + this.versuchMs;
        // Nur der erste Fehler einer Reihe als Warnung, sonst füllt ein ausgefallener Vermittler das Log.
        if (this.versuchMs === this.z.ersterVersuchMs) {
            this.o.log.warn(`Fernzugang: ${grund}. Neuer Versuch läuft im Hintergrund.`);
        } else {
            this.o.log.debug(`Fernzugang: ${grund}`);
        }
        this.o.stand({ art: 'getrennt', grund, naechsterVersuch });
        this.wiederholung = setTimeout(() => void this.verbinde(), this.versuchMs);
        this.versuchMs = Math.min(this.versuchMs * 2, this.z.letzterVersuchMs);
    }
}

// Für Log und Admin: was der Mensch tun kann, nicht der Stapel
export function grundAus(fehler: Error & { code?: string; cause?: unknown }): string {
    const status = /Unexpected server response: (\d+)/.exec(fehler.message)?.[1];
    if (status === '401') {
        return 'Der Vermittler kennt diesen Adapter nicht, die Zeile für den Vermittler fehlt dort oder ist veraltet';
    }
    if (status === '429') {
        return 'Der Vermittler bremst nach zu vielen Versuchen';
    }
    if (status) {
        return `Vermittler antwortet mit ${status}`;
    }
    const ursache = fehler.cause instanceof Error ? (fehler.cause as Error & { code?: string }) : undefined;
    const code = fehler.code ?? ursache?.code;
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
        return 'Name des Vermittlers nicht gefunden';
    }
    if (code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'ETIMEDOUT') {
        return `keine Verbindung (${code})`;
    }
    if (code && /CERT|SELF_SIGNED|UNABLE_TO_VERIFY/.test(code)) {
        return `Zertifikat des Vermittlers ungültig (${code})`;
    }
    // fetch sperrt einige Ports, etwa 1, 25 und 6000
    if (ursache?.message === 'bad port') {
        return 'Port für Webanfragen gesperrt, bitte einen anderen wählen';
    }
    if (fehler.name === 'TimeoutError') {
        return 'keine Antwort binnen 10 s';
    }
    return ursache?.message ?? fehler.message;
}

// Liest den Körper höchstens bis grenze Bytes, sonst Fehler
async function liesHoechstens(antwort: Response, grenze: number): Promise<string> {
    const leser = antwort.body?.getReader();
    if (!leser) {
        return '';
    }
    const teile: Uint8Array[] = [];
    let laenge = 0;
    for (;;) {
        const { done, value } = await leser.read();
        if (done) {
            break;
        }
        laenge += value.byteLength;
        if (laenge > grenze) {
            await leser.cancel();
            throw new Error('Antwort zu groß');
        }
        teile.push(value);
    }
    return Buffer.concat(teile).toString('utf8');
}
