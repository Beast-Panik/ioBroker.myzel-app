import { X509Certificate, createHash, createPrivateKey, generateKeyPairSync, randomBytes, sign } from 'node:crypto';

export interface Identitaet {
    zertifikat: string;
    schluessel: string;
}

const GUELTIG_JAHRE = 20;
const OID_ECDSA_SHA256 = '1.2.840.10045.4.3.2';
const OID_CN = '2.5.4.3';

function laenge(n: number): Buffer {
    if (n < 0x80) {
        return Buffer.from([n]);
    }
    const bytes: number[] = [];
    for (let r = n; r > 0; r >>= 8) {
        bytes.unshift(r & 0xff);
    }
    return Buffer.from([0x80 | bytes.length, ...bytes]);
}

const tlv = (tag: number, inhalt: Buffer): Buffer => Buffer.concat([Buffer.from([tag]), laenge(inhalt.length), inhalt]);
const folge = (...teile: Buffer[]): Buffer => tlv(0x30, Buffer.concat(teile));
const menge = (...teile: Buffer[]): Buffer => tlv(0x31, Buffer.concat(teile));
const explizit = (nr: number, inhalt: Buffer): Buffer => tlv(0xa0 | nr, inhalt);
const bitfolge = (b: Buffer): Buffer => tlv(0x03, Buffer.concat([Buffer.from([0]), b]));
const utf8 = (s: string): Buffer => tlv(0x0c, Buffer.from(s, 'utf8'));

function ganzzahl(bytes: Buffer): Buffer {
    let b = bytes;
    while (b.length > 1 && b[0] === 0 && b[1] < 0x80) {
        b = b.subarray(1);
    }
    if (b[0] >= 0x80) {
        b = Buffer.concat([Buffer.from([0]), b]);
    }
    return tlv(0x02, b);
}

function oid(text: string): Buffer {
    const t = text.split('.').map(Number);
    const bytes = [40 * t[0] + t[1]];
    for (const z of t.slice(2)) {
        const teil = [z & 0x7f];
        for (let r = z >> 7; r > 0; r >>= 7) {
            teil.unshift((r & 0x7f) | 0x80);
        }
        bytes.push(...teil);
    }
    return tlv(0x06, Buffer.from(bytes));
}

// GeneralizedTime statt UTCTime: Das Ablaufdatum liegt nach 2049, ab dort schreibt RFC 5280 sie vor.
function zeit(d: Date): Buffer {
    const iso = d.toISOString().replace(/[-:T]/g, '').slice(0, 14);
    return tlv(0x18, Buffer.from(`${iso}Z`, 'ascii'));
}

export const zertifikatsname = (adapterId: string): string => `myzel-app ${adapterId}`;

// Eigene DER-Kodierung statt @peculiar/x509, das 23 Pakete samt Polyfill nachzieht. Schlüssel und Signatur kommen aus OpenSSL.
export function erzeugeIdentitaet(adapterId: string, jetzt = new Date()): Identitaet {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const algorithmus = folge(oid(OID_ECDSA_SHA256));
    const name = folge(menge(folge(oid(OID_CN), utf8(zertifikatsname(adapterId)))));
    const ende = new Date(jetzt);
    ende.setUTCFullYear(ende.getUTCFullYear() + GUELTIG_JAHRE);
    const inhalt = folge(
        explizit(0, ganzzahl(Buffer.from([2]))),
        ganzzahl(randomBytes(16)),
        algorithmus,
        name,
        folge(zeit(jetzt), zeit(ende)),
        name,
        publicKey.export({ type: 'spki', format: 'der' }),
    );
    const der = folge(inhalt, algorithmus, bitfolge(sign('sha256', inhalt, privateKey)));
    const zeilen = der.toString('base64').match(/.{1,64}/g) ?? [];
    return {
        zertifikat: `-----BEGIN CERTIFICATE-----\n${zeilen.join('\n')}\n-----END CERTIFICATE-----\n`,
        schluessel: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    };
}

export function fingerabdruck(zertifikat: string): string {
    return createHash('sha256').update(new X509Certificate(zertifikat).raw).digest('base64url');
}

export function pruefeIdentitaet(adapterId: string, identitaet: Identitaet): string | undefined {
    let zertifikat: X509Certificate;
    try {
        zertifikat = new X509Certificate(identitaet.zertifikat);
    } catch {
        return 'Zertifikat nicht lesbar';
    }
    let schluessel;
    try {
        schluessel = createPrivateKey(identitaet.schluessel);
    } catch {
        return 'Schlüssel nicht lesbar';
    }
    if (schluessel.asymmetricKeyType !== 'ec' || schluessel.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
        return 'Schlüssel ist kein ECDSA P-256';
    }
    if (!zertifikat.checkPrivateKey(schluessel)) {
        return 'Schlüssel passt nicht zum Zertifikat';
    }
    if (zertifikat.subject !== `CN=${zertifikatsname(adapterId)}`) {
        return 'Zertifikat gehört zu einer anderen Adapter-ID';
    }
    return undefined;
}
