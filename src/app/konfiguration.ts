import type { Protokoll } from '../basis/grenzen';
import {
    type Aufzaehlung,
    KARTENARTEN,
    KARTENTYPEN,
    KARTEN_HOECHSTENS,
    type Karte,
    type Kartentyp,
    type Profil,
    type Recht,
    alsKarte,
    alsProfil,
    istKennung,
    text,
} from './rechte';

/**
 * Karten und Profile stehen in den Instanzeinstellungen, je in einem eigenen Reiter (KONZEPT-KARTEN.md, Abschnitt 3).
 * Der Admin speichert sie als flache Zeilen: jedes Teil ein eigenes Feld, auch die Teile anderer Typen, die er nur
 * ausblendet. Hier werden die Zeilen zu Karten und Profilen; was nicht passt, fällt mit Warnung weg.
 */
export type Zeile = Record<string, unknown>;

export interface Konfiguration {
    karten: Map<string, Karte>;
    profile: Map<string, Profil>;
}

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

export function zeileAusKarte(id: string, karte: Karte): Zeile {
    return {
        id,
        name: karte.name,
        typ: karte.typ,
        raum: karte.raum,
        ...karte.teile,
        ...Object.fromEntries(
            Object.entries(karte.bezeichnungen ?? {}).map(([teil, b]) => [bezeichnungsfeld(teil), b]),
        ),
    };
}

export function zeileAusProfil(id: string, profil: Profil): Zeile {
    const raeume = (recht: Recht): string[] => profil.raeume.filter(r => r.recht === recht).map(r => r.enum);
    const karten = (recht: Recht): string[] => profil.karten.filter(k => k.recht === recht).map(k => k.id);
    return {
        id,
        name: profil.name,
        raeumeSchreiben: raeume('schreiben'),
        raeumeLesen: raeume('lesen'),
        kartenSchreiben: karten('schreiben'),
        kartenLesen: karten('lesen'),
        gesperrt: [...profil.gesperrt],
    };
}

function lies<T>(
    roh: unknown,
    was: string,
    folge: string,
    umwandeln: (z: Zeile) => T | string[],
    log: Protokoll,
    hoechstens = Infinity,
): Map<string, T> {
    const ergebnis = new Map<string, T>();
    for (const z of zeilen(roh)) {
        const id = eintrag(z.id);
        const name = eintrag(z.name) || id || '?';
        const wert = !istKennung(id)
            ? ['ID erlaubt nur a bis z, 0 bis 9 und _']
            : ergebnis.has(id)
              ? [`ID ${id} doppelt`]
              : ergebnis.size >= hoechstens
                ? [`mehr als ${hoechstens}`]
                : umwandeln(z);
        if (Array.isArray(wert)) {
            log.warn(`${was} „${name}“ ist unbrauchbar und ${folge}: ${wert.join('; ')}`);
            continue;
        }
        ergebnis.set(id, wert);
    }
    return ergebnis;
}

export function liesKonfiguration(native: { karten?: unknown; profile?: unknown }, log: Protokoll): Konfiguration {
    return {
        karten: lies(native.karten, 'Karte', 'fehlt auf den Handys', karteAusZeile, log, KARTEN_HOECHSTENS),
        profile: lies(native.profile, 'Profil', 'gibt keine Rechte', profilAusZeile, log),
    };
}

export interface Option {
    value: string;
    label: ioBroker.Translated;
}

const SPRACHEN = ['en', 'de'] as const;
const je = (f: (sprache: (typeof SPRACHEN)[number]) => string): ioBroker.Translated =>
    Object.fromEntries(SPRACHEN.map(s => [s, f(s)])) as ioBroker.Translated;
const nachText = (a: Option, b: Option): number => a.label.en.localeCompare(b.label.en);

const TYPNAMEN: Record<Kartentyp, ioBroker.Translated> = {
    lampe: { en: 'Lamp', de: 'Lampe' },
    schalter: { en: 'Switch', de: 'Schalter' },
    messwert: { en: 'Measurement', de: 'Messwert' },
    thermostat: { en: 'Thermostat', de: 'Thermostat' },
};
const OHNE_RAUM: ioBroker.Translated = { en: 'no room', de: 'ohne Raum' };

// Auswahl für die Profile: Räume aus ioBroker
export function raumoptionen(raeume: Aufzaehlung[]): Option[] {
    return raeume.map(r => ({ value: r.id, label: je(s => text(r.name, s, r.id)) })).sort(nachText);
}

// Auswahl für die Profile: die Karten im Formular, auch noch nicht gespeicherte, mit Typ und Raum
export function kartenoptionen(roh: unknown, raeume: Aufzaehlung[]): Option[] {
    const raum = new Map(raeume.map(r => [r.id, r]));
    return zeilen(roh)
        .filter(z => istKennung(eintrag(z.id)) && eintrag(z.name))
        .map(z => {
            const typ = TYPNAMEN[z.typ as Kartentyp];
            const r = raum.get(eintrag(z.raum));
            return {
                value: eintrag(z.id),
                label: je(s => {
                    const wo = r ? text(r.name, s, r.id) : OHNE_RAUM[s];
                    return typ ? `${eintrag(z.name)} (${typ[s]}, ${wo})` : `${eintrag(z.name)} (${wo})`;
                }),
            };
        })
        .sort(nachText);
}

/**
 * Reihenfolge im Reiter Karten: nach Raum wie in der App, Karten ohne Raum oder mit einem Raum, den es nicht mehr gibt,
 * zuletzt, im Raum nach Namen. Der Admin zeigt die Liste in der gespeicherten Reihenfolge und sortiert nicht selbst.
 * Liefert undefined, wenn die Reihenfolge schon stimmt; jeder Gleichstand endet bei der ID, damit sie sich nie hin und her
 * ändert. Zeilen, die keine sind, kommen unverändert ans Ende.
 */
export function nachRaeumen(roh: unknown, raeume: Aufzaehlung[], sprache: string): unknown[] | undefined {
    if (!Array.isArray(roh)) {
        return undefined;
    }
    const raumname = new Map(raeume.map(r => [r.id, text(r.name, sprache, r.id)]));
    const vergleiche = new Intl.Collator(sprache).compare;
    const schluessel = (z: unknown): string[] | undefined => {
        if (!z || typeof z !== 'object' || Array.isArray(z)) {
            return undefined;
        }
        const zeile = z as Zeile;
        const raum = eintrag(zeile.raum);
        const name = raumname.get(raum);
        return name === undefined
            ? ['1', '', '', eintrag(zeile.name), eintrag(zeile.id)]
            : ['0', name, raum, eintrag(zeile.name), eintrag(zeile.id)];
    };
    const sortiert = roh
        .map(z => ({ z, s: schluessel(z) }))
        .sort((a, b) => {
            if (!a.s || !b.s) {
                return (a.s ? 0 : 1) - (b.s ? 0 : 1);
            }
            for (let i = 0; i < a.s.length; i++) {
                const unterschied = vergleiche(a.s[i], b.s[i]) || (a.s[i] < b.s[i] ? -1 : a.s[i] > b.s[i] ? 1 : 0);
                if (unterschied !== 0) {
                    return unterschied;
                }
            }
            return 0;
        })
        .map(({ z }) => z);
    return sortiert.every((z, i) => z === roh[i]) ? undefined : sortiert;
}
