import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';

export function base32(daten: Buffer): string {
    let ergebnis = '';
    let puffer = 0;
    let bits = 0;
    for (const byte of daten) {
        puffer = (puffer << 8) | byte;
        bits += 8;
        while (bits >= 5) {
            bits -= 5;
            ergebnis += BASE32[(puffer >>> bits) & 31];
        }
    }
    if (bits > 0) {
        ergebnis += BASE32[(puffer << (5 - bits)) & 31];
    }
    return ergebnis;
}

export function sha256(text: string): Buffer {
    return createHash('sha256').update(text, 'utf8').digest();
}

// Vergleich über den Hash: timingSafeEqual braucht gleich lange Puffer, und die Länge des Gegebenen verrät so nichts.
export function passtZuHash(gegeben: string, erwartetHash: Buffer): boolean {
    return erwartetHash.length === 32 && timingSafeEqual(sha256(gegeben), erwartetHash);
}

// Base32 klein, weil die Adapter-ID später als DNS-Name im Internet taugen muss.
export const neueAdapterId = (): string => base32(randomBytes(16));
export const neueAppId = (): string => base32(randomBytes(5));
export const neuerZugang = (): string => randomBytes(32).toString('base64url');
export const neuesGeheimnis = (): string => randomBytes(16).toString('base64url');
export const neueHinweisId = (): string => randomBytes(6).toString('base64url');
