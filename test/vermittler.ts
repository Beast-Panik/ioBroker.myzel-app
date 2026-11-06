// Vermittler für Tests: ein Nachbau in Node, der immer läuft, und der echte aus vermittler/, wenn Go da ist.
import { type ChildProcess, execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type IncomingMessage, request, type Server, STATUS_CODES } from 'node:http';
import https from 'node:https';
import net, { type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Duplex } from 'node:stream';
import tls from 'node:tls';
import { promisify } from 'node:util';
import { WebSocket, WebSocketServer } from 'ws';
import { sha256 } from '../src/basis/kodierung';
import { Datenstrom } from '../src/zugang/fern';

export interface Vermittler {
    // http, nicht https: TLS macht im Betrieb NPM Plus davor.
    adresse: string;
    // Hinter TLS das Zertifikat als PEM, damit auch andere Prozesse ihm vertrauen können, etwa die Tests der App
    zertifikat?: string;
    beende(): Promise<void>;
}

interface Sitzung {
    hash: string;
    app: WebSocket;
    adapter?: WebSocket;
    puffer: [Buffer, boolean][];
}

const ausfuehren = promisify(execFile);

const traeger = (anfrage: IncomingMessage): string | undefined => {
    const kopf = anfrage.headers.authorization;
    return kopf?.startsWith('Bearer ') ? sha256(kopf.slice(7).trim()).toString('hex') : undefined;
};

// Verhalten wie im Konzept, Abschnitt 4, ohne Grenzen und Sperren. Reicht auch Text durch, damit der Adapter sich
// selbst dagegen wehren muss.
export class Vermittlernachbau implements Vermittler {
    public protokoll = 1;
    // Was über die Steuerverbindung ankam, in Reihenfolge
    public readonly steuer: unknown[] = [];
    public steuerungen = 0;
    public steuerung?: WebSocket;
    public hashes = new Set<string>();
    public readonly sitzungen = new Map<string, Sitzung>();
    private readonly wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });

    private constructor(
        private readonly server: Server,
        private readonly adapterHash: string,
    ) {
        server.on('request', (anfrage, antwort) => {
            if (anfrage.url === '/info') {
                antwort.setHeader('Content-Type', 'application/json');
                antwort.end(JSON.stringify({ protokoll: this.protokoll }));
            } else {
                antwort.statusCode = 404;
                antwort.end();
            }
        });
        server.on('upgrade', (anfrage: IncomingMessage, socket: Duplex, kopf: Buffer) => {
            const status = this.upgrade(anfrage, socket, kopf);
            if (status) {
                socket.end(`HTTP/1.1 ${status} ${STATUS_CODES[status]}\r\nContent-Length: 0\r\n\r\n`);
            }
        });
    }

    public static async starte(adapterHash: string): Promise<Vermittlernachbau> {
        const server = createServer();
        await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
        return new Vermittlernachbau(server, adapterHash);
    }

    public get adresse(): string {
        return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    }

    // Wie der echte, wenn eine App sich meldet; für Nachrichten, die keine App auslösen kann
    public melde(nachricht: unknown): void {
        this.steuerung?.send(typeof nachricht === 'string' ? nachricht : JSON.stringify(nachricht));
    }

    public async beende(): Promise<void> {
        for (const c of this.wss.clients) {
            c.terminate();
        }
        this.server.closeAllConnections();
        await new Promise(r => this.server.close(r));
    }

    // Statuscode zum Abweisen oder undefined
    private upgrade(anfrage: IncomingMessage, socket: Duplex, kopf: Buffer): number | undefined {
        const hash = traeger(anfrage);
        const pfad = anfrage.url ?? '';
        const nimm = (weiter: (ws: WebSocket) => void): undefined => {
            this.wss.handleUpgrade(anfrage, socket, kopf, weiter);
            return undefined;
        };
        if (pfad === '/app') {
            if (!hash || !this.hashes.has(hash)) {
                return 401;
            }
            if (!this.steuerung) {
                return 503;
            }
            return nimm(app => this.app(app, hash));
        }
        if (hash !== this.adapterHash) {
            return 401;
        }
        if (pfad === '/adapter') {
            return nimm(ws => this.steuere(ws));
        }
        const nummer = /^\/adapter\/sitzung\/([0-9a-f]{32})$/.exec(pfad)?.[1];
        const s = nummer && this.sitzungen.get(nummer);
        if (!s || s.adapter) {
            return 404;
        }
        return nimm(adapter => this.verbinde(nummer, s, adapter));
    }

    private steuere(ws: WebSocket): void {
        this.steuerung?.close(1001, 'ersetzt');
        this.steuerung = ws;
        this.steuerungen++;
        ws.on('message', (daten: Buffer) => {
            const nachricht = JSON.parse(daten.toString('utf8')) as { art: string; hashes: string[] };
            this.steuer.push(nachricht);
            this.hashes = new Set(nachricht.hashes);
            for (const [nummer, s] of this.sitzungen) {
                if (!this.hashes.has(s.hash)) {
                    this.trenne(nummer, 4003);
                }
            }
        });
        ws.on('close', () => {
            if (this.steuerung === ws) {
                this.steuerung = undefined;
            }
        });
    }

    private app(app: WebSocket, hash: string): void {
        const nummer = randomBytes(16).toString('hex');
        const s: Sitzung = { hash, app, puffer: [] };
        this.sitzungen.set(nummer, s);
        app.on('message', (daten: Buffer, binaer: boolean) => {
            if (s.adapter) {
                s.adapter.send(daten, { binary: binaer });
            } else {
                s.puffer.push([daten, binaer]);
            }
        });
        app.on('close', () => this.trenne(nummer, 1000));
        this.melde({ art: 'sitzung', nummer, app: hash });
    }

    private verbinde(nummer: string, s: Sitzung, adapter: WebSocket): void {
        s.adapter = adapter;
        for (const [daten, binaer] of s.puffer.splice(0)) {
            adapter.send(daten, { binary: binaer });
        }
        adapter.on('message', (daten: Buffer, binaer: boolean) => s.app.send(daten, { binary: binaer }));
        adapter.on('close', () => this.trenne(nummer, 1000));
    }

    private trenne(nummer: string, code: number): void {
        const s = this.sitzungen.get(nummer);
        this.sitzungen.delete(nummer);
        s?.app.close(code);
        s?.adapter?.close(code);
    }
}

const QUELLE = path.resolve(__dirname, '../../vermittler');
let gebaut: Promise<string | undefined> | undefined;

// Baut den echten Vermittler einmal je Lauf; undefined ohne Go oder ohne Quelle, etwa auf GitHub.
function programm(): Promise<string | undefined> {
    gebaut ??= (async () => {
        if (!existsSync(path.join(QUELLE, 'go.mod'))) {
            return undefined;
        }
        const ordner = mkdtempSync(path.join(tmpdir(), 'myzel-vermittler-'));
        process.once('exit', () => rmSync(ordner, { recursive: true, force: true }));
        const ziel = path.join(ordner, 'vermittler');
        try {
            await ausfuehren('go', ['build', '-o', ziel, '.'], { cwd: QUELLE, timeout: 120_000 });
        } catch {
            return undefined;
        }
        return ziel;
    })();
    return gebaut;
}

async function freierPort(): Promise<number> {
    const s = createServer();
    await new Promise<void>(r => s.listen(0, '127.0.0.1', r));
    const { port } = s.address() as AddressInfo;
    await new Promise(r => s.close(r));
    return port;
}

export async function echterVermittler(zeile: string): Promise<Vermittler | undefined> {
    const datei = await programm();
    if (!datei) {
        return undefined;
    }
    const port = await freierPort();
    const prozess: ChildProcess = spawn(datei, [], {
        env: { MYZEL_ADAPTER: zeile, MYZEL_ADRESSE: `127.0.0.1:${port}` },
        stdio: 'ignore',
    });
    const adresse = `http://127.0.0.1:${port}`;
    const laeuft = (): Promise<boolean> =>
        fetch(`${adresse}/info`).then(
            a => a.ok,
            () => false,
        );
    const ende = Date.now() + 5000;
    while (!(await laeuft())) {
        if (Date.now() > ende || prozess.exitCode !== null) {
            prozess.kill();
            throw new Error('Vermittler startet nicht');
        }
        await new Promise(r => setTimeout(r, 50));
    }
    return {
        adresse,
        beende: () =>
            new Promise<void>(r => {
                prozess.once('exit', () => r());
                prozess.kill();
            }),
    };
}

// Mit openssl, weil der Name eine IP-Adresse ist und das Zertifikat dafür subjectAltName braucht
async function testzertifikat(): Promise<{ key: string; cert: string } | undefined> {
    const ordner = mkdtempSync(path.join(tmpdir(), 'myzel-tls-'));
    try {
        const key = path.join(ordner, 'key.pem');
        const cert = path.join(ordner, 'cert.pem');
        await ausfuehren(
            'openssl',
            [
                'req',
                '-x509',
                '-newkey',
                'ec',
                '-pkeyopt',
                'ec_paramgen_curve:prime256v1',
                '-nodes',
                '-days',
                '1',
                '-subj',
                '/CN=127.0.0.1',
                '-addext',
                'subjectAltName=IP:127.0.0.1',
                '-keyout',
                key,
                '-out',
                cert,
            ],
            { timeout: 10_000 },
        );
        return { key: readFileSync(key, 'utf8'), cert: readFileSync(cert, 'utf8') };
    } catch {
        return undefined;
    } finally {
        rmSync(ordner, { recursive: true, force: true });
    }
}

// Gibt es erst ab Node 22.19; die Typen folgen der kleinsten unterstützten Version.
const vertrauen = tls as typeof tls & {
    getCACertificates?: (art: 'default') => string[];
    setDefaultCACertificates?: (zertifikate: string[]) => void;
};

// TLS davor wie NPM Plus im Betrieb. Dem Zertifikat vertraut der ganze Testprozess, bis beende es zurücknimmt;
// undefined ohne openssl oder in Node ohne tls.setDefaultCACertificates.
export async function hinterTls(innen: Vermittler): Promise<Vermittler | undefined> {
    const zertifikat = vertrauen.setDefaultCACertificates ? await testzertifikat() : undefined;
    if (!zertifikat) {
        return undefined;
    }
    const ziel = new URL(innen.adresse);
    const offen = new Set<Duplex>();
    const merke = (s: Duplex): void => {
        offen.add(s);
        s.once('close', () => offen.delete(s));
    };
    const server = https.createServer(zertifikat, (anfrage, antwort) => {
        const weiter = request(
            {
                host: ziel.hostname,
                port: ziel.port,
                method: anfrage.method,
                path: anfrage.url,
                headers: anfrage.headers,
            },
            a => {
                antwort.writeHead(a.statusCode ?? 502, a.headers);
                a.pipe(antwort);
            },
        );
        weiter.on('error', () => antwort.destroy());
        anfrage.pipe(weiter);
    });
    server.on('connection', merke);
    server.on('upgrade', (anfrage: IncomingMessage, socket: Duplex, kopf: Buffer) => {
        const roh = net.connect(Number(ziel.port), ziel.hostname, () => {
            const zeilen = [`${anfrage.method} ${anfrage.url} HTTP/1.1`];
            for (let i = 0; i < anfrage.rawHeaders.length; i += 2) {
                zeilen.push(`${anfrage.rawHeaders[i]}: ${anfrage.rawHeaders[i + 1]}`);
            }
            roh.write(`${zeilen.join('\r\n')}\r\n\r\n`);
            roh.write(kopf);
            socket.pipe(roh).pipe(socket);
        });
        merke(roh);
        roh.on('error', () => socket.destroy());
        socket.on('error', () => roh.destroy());
        roh.on('close', () => socket.destroy());
        socket.on('close', () => roh.destroy());
    });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    const vorher = vertrauen.getCACertificates!('default');
    vertrauen.setDefaultCACertificates!([...vorher, zertifikat.cert]);
    return {
        adresse: `https://127.0.0.1:${(server.address() as AddressInfo).port}`,
        zertifikat: zertifikat.cert,
        async beende() {
            vertrauen.setDefaultCACertificates!(vorher);
            for (const s of offen) {
                s.destroy();
            }
            await new Promise(r => server.close(r));
            await innen.beende();
        },
    };
}

// Was die App macht: mit ihrem Schlüssel zum Vermittler, darüber dann TLS zum Adapter
export function alsApp(adresse: string, schluessel: string): Promise<Datenstrom> {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(`${adresse}/app`, {
            headers: { Authorization: `Bearer ${schluessel}` },
            perMessageDeflate: false,
        });
        ws.once('open', () => resolve(new Datenstrom(ws)));
        ws.once('error', reject);
    });
}
