import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020';
import { GRENZEN, type Grenzen } from './grenzen';

export interface Schema {
    $id: string;
    [schluessel: string]: unknown;
}

// Je Nachrichtentyp ein Verweis in oneOf auf $defs; geprüft wird direkt gegen den Typ, das gibt genaue Fehlertexte.
export interface Richtungsschema extends Schema {
    oneOf: { $ref: string }[];
    $defs: Record<string, object>;
}

export interface Nachricht {
    t: string;
    [feld: string]: unknown;
}

export type Gelesen =
    | { art: 'nachricht'; nachricht: Nachricht }
    | { art: 'version'; v: number }
    | { art: 'ungueltig'; grund: string; n?: number };

// Fehlertexte nennen nur Pfad und Regel, nie den Wert, und dürfen deshalb ins Log und an die Gegenstelle.
function texte(fehler: ErrorObject[] | null | undefined): string[] {
    return (fehler ?? []).map(f => `${f.instancePath || '/'} ${f.message ?? 'ungültig'}`);
}

function neuesAjv(bausteine: Schema[]): Ajv2020 {
    const ajv = new Ajv2020({ strict: true });
    for (const b of bausteine) {
        ajv.addSchema(b);
    }
    return ajv;
}

export function erstellePruefer(schema: object, bausteine: Schema[] = []): (daten: unknown) => string[] {
    const pruefe = neuesAjv(bausteine).compile(schema);
    return daten => (pruefe(daten) ? [] : texte(pruefe.errors));
}

// Auch aus sonst ungültigen Nachrichten, damit die App `fehler` ihrer Anfrage zuordnen kann.
export function nummerAus(daten: unknown): number | undefined {
    let o = daten;
    if (typeof o === 'string') {
        try {
            o = JSON.parse(o);
        } catch {
            return undefined;
        }
    }
    const n = (o as { n?: unknown } | null)?.n;
    return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 2 ** 31 - 1 ? n : undefined;
}

// Prüfreihenfolge aus Abschnitt 5.2 des Detailentwurfs.
export class Nachrichtenpruefer {
    private readonly typen = new Map<string, ValidateFunction>();
    private readonly mitVersion = new Set<string>();

    public constructor(
        richtung: Richtungsschema,
        bausteine: Schema[],
        public readonly versionen: number[],
        private readonly grenzen: Grenzen = GRENZEN,
    ) {
        const ajv = neuesAjv([...bausteine, richtung]);
        for (const { $ref } of richtung.oneOf) {
            const name = /^#\/\$defs\/(\w+)$/.exec($ref)?.[1];
            const felder = name
                ? (richtung.$defs[name] as { properties?: Record<string, { const?: unknown }> }).properties
                : undefined;
            const typ = felder?.t?.const;
            const pruefe = ajv.getSchema(`${richtung.$id}${$ref}`);
            if (typeof typ !== 'string' || !pruefe) {
                throw new Error(`Schema ${richtung.$id}: Verweis ${$ref} ist kein Nachrichtentyp`);
            }
            this.typen.set(typ, pruefe);
            if (felder?.v) {
                this.mitVersion.add(typ);
            }
        }
    }

    public pruefe(daten: unknown): string[] {
        const t = (daten as { t?: unknown } | null)?.t;
        if (typeof t !== 'string') {
            return ['/t fehlt oder ist keine Zeichenkette'];
        }
        const pruefe = this.typen.get(t);
        if (!pruefe) {
            return ['/t unbekannter Nachrichtentyp'];
        }
        return pruefe(daten) ? [] : texte(pruefe.errors);
    }

    public lies(text: string | undefined, jetzt: number): Gelesen {
        if (text === undefined) {
            return { art: 'ungueltig', grund: 'Binärframe statt Text' };
        }
        let daten: unknown;
        try {
            daten = JSON.parse(text);
        } catch {
            return { art: 'ungueltig', grund: 'kein JSON' };
        }
        if (typeof daten !== 'object' || daten === null || Array.isArray(daten)) {
            return { art: 'ungueltig', grund: 'kein JSON-Objekt' };
        }
        const o = daten as Record<string, unknown>;
        const n = nummerAus(o);
        // Vor dem Schema, das nur bekannte Versionen kennt: Eine neuere App soll „Version“ hören, nicht „ungültig“.
        if (
            typeof o.t === 'string' &&
            this.mitVersion.has(o.t) &&
            Number.isInteger(o.v) &&
            !this.versionen.includes(o.v as number)
        ) {
            return { art: 'version', v: o.v as number };
        }
        const fehler = this.pruefe(o);
        if (fehler.length > 0) {
            return { art: 'ungueltig', grund: fehler.join('; '), n };
        }
        if (typeof o.zeit === 'number' && o.zeit > jetzt + this.grenzen.zukunftMs) {
            return { art: 'ungueltig', grund: '/zeit liegt zu weit in der Zukunft', n };
        }
        return { art: 'nachricht', nachricht: o as Nachricht };
    }
}
