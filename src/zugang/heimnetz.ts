import net from 'node:net';
import os from 'node:os';
import type { Duplex } from 'node:stream';
import type { Protokoll } from '../basis/grenzen';
import type { Herkunft } from '../basis/kern';

const WIEDERHOLEN_MS = 60_000;
const HOECHSTENS_ADRESSEN = 4;
const NICHT_IM_HEIMNETZ = /^(lo|docker.*|br-.*|veth.*|virbr.*)$/;

// IPv4 in IPv6 (::ffff:192.168.1.5) wird zur IPv4-Adresse, damit Sperren und Log dieselbe Schreibweise sehen.
export function normalisiere(adresse: string): string {
    const v4 = adresse.startsWith('::ffff:') ? adresse.slice(7) : '';
    return net.isIPv4(v4) ? v4 : adresse;
}

export function alsAdresse(host: string, port: number): string {
    return net.isIPv6(host) ? `[${host}]:${port}` : `${host}:${port}`;
}

function privatV4(adresse: string): boolean {
    const [a, b] = adresse.split('.').map(Number);
    return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

const PRIVAT = new net.BlockList();
for (const [netz, laenge] of [
    ['10.0.0.0', 8],
    ['172.16.0.0', 12],
    ['192.168.0.0', 16],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
] as const) {
    PRIVAT.addSubnet(netz, laenge, 'ipv4');
}
for (const [netz, laenge] of [
    ['fc00::', 7],
    ['fe80::', 10],
    ['::1', 128],
] as const) {
    PRIVAT.addSubnet(netz, laenge, 'ipv6');
}

// Private Bereiche und die Netze der eigenen Schnittstellen, damit auch ein öffentliches IPv6-/64 im Heimnetz zählt.
// Alles andere kommt über eine Portweiterleitung aus dem Internet und würde sonst als anwesend gelten.
export function imHeimnetz(
    adresse: string,
    schnittstellen: () => NodeJS.Dict<os.NetworkInterfaceInfo[]> = () => os.networkInterfaces(),
): boolean {
    const art = net.isIPv4(adresse) ? 'ipv4' : net.isIPv6(adresse) ? 'ipv6' : undefined;
    if (!art) {
        return false;
    }
    if (PRIVAT.check(adresse, art)) {
        return true;
    }
    const eigene = new net.BlockList();
    for (const a of Object.values(schnittstellen()).flat()) {
        if (a?.cidr && a.family.toLowerCase() === art) {
            const [netz, laenge] = a.cidr.split('/');
            eigene.addSubnet(netz, Number(laenge), art);
        }
    }
    return eigene.check(adresse, art);
}

export function automatischeAdressen(
    port: number,
    schnittstellen: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces(),
): string[] {
    const v4 = new Set<string>();
    const v6 = new Set<string>();
    for (const [name, liste] of Object.entries(schnittstellen)) {
        if (NICHT_IM_HEIMNETZ.test(name)) {
            continue;
        }
        for (const a of liste ?? []) {
            if (a.internal) {
                continue;
            }
            if (a.family === 'IPv4' && privatV4(a.address)) {
                v4.add(alsAdresse(a.address, port));
            } else if (a.family === 'IPv6' && /^fd/i.test(a.address)) {
                v6.add(alsAdresse(a.address, port));
            }
        }
    }
    return [...v4, ...v6].slice(0, HOECHSTENS_ADRESSEN);
}

export interface HeimnetzOptionen {
    port: number;
    nimm: (strom: Duplex, herkunft: Herkunft) => void;
    log: Protokoll;
    zustand: (laeuft: boolean) => void;
    schnittstellen?: () => NodeJS.Dict<os.NetworkInterfaceInfo[]>;
}

// Bei belegtem Port kein Ausweichen auf einen anderen: Die Apps kennen den Port aus dem QR-Code.
export class Heimnetz {
    private server?: net.Server;
    private wiederholung?: NodeJS.Timeout;
    private beendet = false;
    private fremdGemeldet = false;

    public constructor(private readonly o: HeimnetzOptionen) {}

    public get port(): number | undefined {
        const a = this.server?.address();
        return typeof a === 'object' && a ? a.port : undefined;
    }

    public starte(): void {
        const server = net.createServer(socket => this.angenommen(socket));
        this.server = server;
        server.on('error', (fehler: NodeJS.ErrnoException) => {
            const grund = fehler.code === 'EADDRINUSE' ? `Port ${this.o.port} ist belegt` : fehler.message;
            this.o.log.error(`Server für Apps läuft nicht: ${grund}. Neuer Versuch in einer Minute.`);
            this.o.zustand(false);
            server.close();
            if (!this.beendet) {
                this.wiederholung = setTimeout(() => this.starte(), WIEDERHOLEN_MS);
            }
        });
        // Ohne Host lauscht Node auf :: und damit auch auf IPv4, ohne IPv6 auf 0.0.0.0.
        server.listen(this.o.port, () => {
            this.o.log.info(`Server für Apps läuft auf Port ${this.port}`);
            this.o.zustand(true);
        });
    }

    // Offene Verbindungen beendet der Kern.
    public beende(): void {
        this.beendet = true;
        clearTimeout(this.wiederholung);
        this.server?.close();
    }

    private angenommen(socket: net.Socket): void {
        const adresse = socket.remoteAddress && normalisiere(socket.remoteAddress);
        if (!adresse || !imHeimnetz(adresse, this.o.schnittstellen)) {
            this.meldeFremd(adresse);
            socket.destroy();
            return;
        }
        socket.setNoDelay(true);
        const eigeneAdresse =
            socket.localAddress && socket.localPort
                ? alsAdresse(normalisiere(socket.localAddress), socket.localPort)
                : undefined;
        this.o.nimm(socket, { weg: 'lokal', adresse, eigeneAdresse });
    }

    // Einmal als Warnung, damit eine Portweiterleitung auffällt; danach nur im Debug-Log, Scanner im Internet sind laut.
    private meldeFremd(adresse: string | undefined): void {
        const text = `Verbindung von ${adresse ?? 'unbekannter Adresse'} abgewiesen: nicht aus dem Heimnetz`;
        if (this.fremdGemeldet) {
            this.o.log.debug(text);
        } else {
            this.fremdGemeldet = true;
            this.o.log.warn(`${text}. Weitere nur im Debug-Log.`);
        }
    }
}
