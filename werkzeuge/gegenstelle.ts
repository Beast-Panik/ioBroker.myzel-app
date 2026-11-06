// Verbindet sich wie die App, für Tests und den App-Simulator. Prüft jede Nachricht des Adapters gegen das Schema.
import { createHash } from 'node:crypto';
import net from 'node:net';
import type { Duplex } from 'node:stream';
import tls from 'node:tls';
import WebSocket from 'ws';
import { adapterPruefer } from '../src/app/dienst';

const pruefer = adapterPruefer();

export interface Schluss {
    code: number;
    grund: string;
}

export interface Verbindungsoptionen {
    host?: string;
    pfad?: string;
    kopf?: Record<string, string>;
    autoPong?: boolean;
    // Statt TCP ein beliebiger Datenstrom, so wie ihn ein Weg über das Internet liefern würde
    strom?: Duplex;
}

export type Eingang = Record<string, any> | Error;

export class Gegenstelle {
    private readonly eingang: Eingang[] = [];
    private wartend?: () => void;
    private hoerer?: (nachricht: Eingang) => void;
    public readonly schluss: Promise<Schluss>;
    // Wie oft der Adapter gepingt hat
    public pings = 0;

    private constructor(private readonly ws: WebSocket) {
        ws.on('ping', () => this.pings++);
        ws.on('message', daten => {
            const nachricht = JSON.parse((daten as Buffer).toString('utf8'));
            const fehler = pruefer.pruefe(nachricht);
            const eingang =
                fehler.length > 0
                    ? new Error(`Adapter sendet ungültiges ${nachricht.t}: ${fehler.join('; ')}`)
                    : nachricht;
            if (this.hoerer) {
                this.hoerer(eingang);
            } else {
                this.eingang.push(eingang);
                this.wartend?.();
            }
        });
        this.schluss = new Promise(resolve => ws.on('close', (code, grund) => resolve({ code, grund: String(grund) })));
    }

    // Der Fingerabdruck wird im TLS-Handshake geprüft, bevor die Verbindung offen ist: Wie in der App geht so nichts
    // Geheimes an einen falschen Server (Konzept 13, Pinning).
    public static verbinde(port: number, fingerabdruck: string, o: Verbindungsoptionen = {}): Promise<Gegenstelle> {
        const host = o.host ?? '127.0.0.1';
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(`wss://${net.isIPv6(host) ? `[${host}]` : host}:${port}${o.pfad ?? '/v1'}`, {
                headers: o.kopf,
                autoPong: o.autoPong ?? true,
                handshakeTimeout: 3000,
                createConnection: () => {
                    const socket = tls.connect({
                        host,
                        port,
                        socket: o.strom,
                        servername: net.isIP(host) ? '' : host,
                        rejectUnauthorized: false,
                    });
                    socket.once('secureConnect', () => {
                        const zertifikat = socket.getPeerX509Certificate();
                        const fp = zertifikat && createHash('sha256').update(zertifikat.raw).digest('base64url');
                        if (fp !== fingerabdruck) {
                            socket.destroy(new Error('Fingerabdruck passt nicht'));
                        }
                    });
                    return socket;
                },
            });
            ws.on('open', () => resolve(new Gegenstelle(ws)));
            ws.on('error', reject);
        });
    }

    public sende(nachricht: object): void {
        this.ws.send(JSON.stringify(nachricht));
    }

    public sendeRoh(daten: string | Buffer): void {
        this.ws.send(daten);
    }

    // Statt naechste: jede Nachricht sofort, auch die schon wartenden
    public lausche(hoerer: (nachricht: Eingang) => void): void {
        this.hoerer = hoerer;
        this.eingang.splice(0).forEach(hoerer);
    }

    public async naechste(ms = 2000): Promise<Record<string, any>> {
        const ende = Date.now() + ms;
        while (this.eingang.length === 0) {
            const rest = ende - Date.now();
            if (rest <= 0) {
                throw new Error('keine Nachricht vom Adapter');
            }
            await new Promise<void>(resolve => {
                const frist = setTimeout(resolve, rest);
                this.wartend = () => {
                    clearTimeout(frist);
                    resolve();
                };
            });
        }
        const nachricht = this.eingang.shift()!;
        if (nachricht instanceof Error) {
            throw nachricht;
        }
        return nachricht;
    }

    public async alle(): Promise<Record<string, any>[]> {
        const liste: Record<string, any>[] = [];
        while (this.eingang.length > 0) {
            liste.push(await this.naechste());
        }
        return liste;
    }

    public async geschlossen(ms = 2000): Promise<Schluss> {
        let frist: NodeJS.Timeout | undefined;
        const zeit = new Promise<never>((_, reject) => {
            frist = setTimeout(() => reject(new Error('Verbindung nicht geschlossen')), ms);
        });
        try {
            return await Promise.race([this.schluss, zeit]);
        } finally {
            clearTimeout(frist);
        }
    }

    public beende(): void {
        this.ws.close(1000);
    }

    public schliesse(): void {
        this.ws.terminate();
    }
}
