import type { Protokoll } from '../basis/grenzen';
import {
    KARTENARTEN,
    KARTENTYPEN,
    type Karte,
    type Kartentyp,
    type Profil,
    type Recht,
    alsKarte,
    alsProfil,
    istKennung,
} from './rechte';

/**
 * Karten und Profile standen von K3 bis 0.3.x in den Instanzeinstellungen, als flache Zeilen des Admins: jedes Teil einer
 * Karte als eigenes Feld, Räume und Karten eines Profils je Recht als Liste. Seit 0.4.0 sind beide Objekte; diese Zeilen
 * liest nur noch die Umstellung (KONZEPT-KARTEN.md, Abschnitt 12).
 */
export type Zeile = Record<string, unknown>;

// Die Bezeichnung zu wert1 steht in bezeichnung1
export const bezeichnungsfeld = (teil: string): string => teil.replace(/^wert/, 'bezeichnung');

const eintrag = (w: unknown): string => (typeof w === 'string' ? w.trim() : '');
const liste = (w: unknown): string[] => (Array.isArray(w) ? w.map(eintrag).filter(Boolean) : []);
const zeilen = (w: unknown): Zeile[] =>
    Array.isArray(w) ? w.filter((z): z is Zeile => !!z && typeof z === 'object' && !Array.isArray(z)) : [];

export function karteAusZeile(z: Zeile): Karte | string[] {
    const typ = z.typ as Kartentyp;
    if (!KARTENTYPEN.includes(typ)) {
        return [`Typ ${String(z.typ)} unbekannt`];
    }
    const art = KARTENARTEN[typ];
    const teile: Record<string, string> = {};
    const bezeichnungen: Record<string, string> = {};
    for (const teil of Object.keys(art.teile)) {
        const dp = eintrag(z[teil]);
        if (!dp) {
            continue;
        }
        teile[teil] = dp;
        const bezeichnung = art.bezeichnungen ? eintrag(z[bezeichnungsfeld(teil)]) : '';
        if (bezeichnung) {
            bezeichnungen[teil] = bezeichnung;
        }
    }
    return alsKarte({
        name: eintrag(z.name),
        typ,
        raum: eintrag(z.raum),
        teile,
        ...(Object.keys(bezeichnungen).length > 0 ? { bezeichnungen } : {}),
    });
}

// Steht ein Raum oder eine Karte in beiden Listen, gilt schreiben.
const mitRecht = (schreiben: string[], lesen: string[]): [string, Recht][] => [
    ...schreiben.map((id): [string, Recht] => [id, 'schreiben']),
    ...lesen.filter(id => !schreiben.includes(id)).map((id): [string, Recht] => [id, 'lesen']),
];

export function profilAusZeile(z: Zeile): Profil | string[] {
    return alsProfil({
        name: eintrag(z.name),
        raeume: mitRecht(liste(z.raeumeSchreiben), liste(z.raeumeLesen)).map(([id, recht]) => ({ enum: id, recht })),
        karten: mitRecht(liste(z.kartenSchreiben), liste(z.kartenLesen)).map(([id, recht]) => ({ id, recht })),
        gesperrt: liste(z.gesperrt),
    });
}

// In jeder Liste gewinnt die erste Zeile einer ID; was nicht passt, fällt mit Warnung weg.
export function lies<T>(
    roh: unknown,
    was: string,
    folge: string,
    umwandeln: (z: Zeile) => T | string[],
    log: Protokoll,
): Map<string, T> {
    const ergebnis = new Map<string, T>();
    for (const z of zeilen(roh)) {
        const id = eintrag(z.id);
        const name = eintrag(z.name) || id || '?';
        const wert = !istKennung(id)
            ? ['ID erlaubt nur a bis z, 0 bis 9 und _']
            : ergebnis.has(id)
              ? [`ID ${id} doppelt`]
              : umwandeln(z);
        // Mit der ganzen Zeile, denn die Umstellung leert die Liste danach.
        if (Array.isArray(wert)) {
            log.warn(`${was} „${name}“ ist unbrauchbar und ${folge}: ${wert.join('; ')}. Zeile: ${JSON.stringify(z)}`);
            continue;
        }
        ergebnis.set(id, wert);
    }
    return ergebnis;
}
