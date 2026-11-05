import adapterAnApp from '../../protokoll/v1/adapter-an-app.schema.json';
import gemeinsam from '../../protokoll/v1/gemeinsam.schema.json';
import { erstellePruefer } from '../basis/schema';

export type Recht = 'lesen' | 'schreiben';

export interface Profil {
    name: string;
    raeume: { enum: string; recht: Recht }[];
    karten: { id: string; recht: Recht }[];
    gesperrt: string[];
}

export type Kartentyp = 'lampe' | 'schalter' | 'messwert' | 'thermostat';
type Datentyp = 'boolean' | 'number' | 'string';

export interface Teilart {
    typen: readonly Datentyp[];
    bedienbar: boolean;
    // Ein Regler: Bereich, falls der Datenpunkt keinen nennt, oder 'pflicht', wenn er einen nennen muss. Die Lichtfarbe
    // braucht ihren eigenen: Ohne ihn weiß niemand, wo warm und wo kalt liegt.
    bereich?: { min: number; max: number } | 'pflicht';
    // Schritt, falls der Datenpunkt keinen nennt
    schritt?: number;
}

export interface Kartenart {
    teile: Readonly<Record<string, Teilart>>;
    pflicht: readonly string[];
    // Mehrere Werte auf einer Karte brauchen je eine Bezeichnung
    bezeichnungen?: boolean;
}

const AN_AUS: Teilart = { typen: ['boolean'], bedienbar: true };
const ANZEIGE: Teilart = { typen: ['number', 'string', 'boolean'], bedienbar: false };

// KONZEPT-KARTEN.md, Abschnitt 2. Das Schema beschreibt dasselbe für die App; ein Test hält beide gleich.
export const KARTENARTEN: Readonly<Record<Kartentyp, Kartenart>> = {
    lampe: {
        teile: {
            schalten: AN_AUS,
            helligkeit: { typen: ['number'], bedienbar: true, bereich: { min: 0, max: 100 } },
            farbe: { typen: ['string'], bedienbar: true },
            farbtemperatur: { typen: ['number'], bedienbar: true, bereich: 'pflicht' },
        },
        pflicht: [],
    },
    schalter: { teile: { schalten: AN_AUS }, pflicht: ['schalten'] },
    messwert: {
        teile: { wert1: ANZEIGE, wert2: ANZEIGE, wert3: ANZEIGE, wert4: ANZEIGE },
        pflicht: [],
        bezeichnungen: true,
    },
    thermostat: {
        teile: {
            soll: { typen: ['number'], bedienbar: true, bereich: { min: 5, max: 30 }, schritt: 0.5 },
            ist: { typen: ['number'], bedienbar: false },
        },
        pflicht: ['soll'],
    },
};
export const KARTENTYPEN = Object.keys(KARTENARTEN) as Kartentyp[];

export interface Karte {
    name: string;
    typ: Kartentyp;
    // ID aus enum.rooms oder leer
    raum: string;
    // Teil auf Datenpunkt-ID
    teile: Record<string, string>;
    bezeichnungen?: Record<string, string>;
}

export const KARTEN_HOECHSTENS = adapterAnApp.$defs.rechteInhalt.properties.karten.maxItems;
export const NAME_LAENGE = 200;
export const BEZEICHNUNG_LAENGE = 60;

export interface Aufzaehlung {
    id: string;
    name: ioBroker.StringOrTranslated;
    mitglieder: string[];
}

const MERKMALE = ['name', 'type', 'unit', 'min', 'max', 'step', 'states', 'write'] as const;

// Nur was die Auswertung braucht: Der Katalog hält das für jeden Datenpunkt im Speicher.
export type Merkmale = Partial<Pick<ioBroker.StateCommon, (typeof MERKMALE)[number]>> & { ziele?: string[] };

// Wer einen Alias liest oder schreibt, erreicht sein Ziel; Sperren müssen deshalb auch dort greifen.
function aliasziele(alias: unknown): string[] {
    const id = (alias as { id?: unknown } | undefined)?.id;
    const ziele =
        id && typeof id === 'object' ? [(id as { read?: unknown }).read, (id as { write?: unknown }).write] : [id];
    return ziele.filter((z): z is string => typeof z === 'string' && z !== '');
}

// Den Namen nur in der Systemsprache: Namen in allen Sprachen sind rund 70 % des Speichers im Katalog.
export function merkmale(id: string, common: Partial<ioBroker.StateCommon> | undefined, sprache: string): Merkmale {
    const felder: Merkmale = Object.fromEntries(
        MERKMALE.filter(m => common?.[m] !== undefined).map(m => [m, common![m]]),
    );
    const ziele = aliasziele(common?.alias);
    return { ...felder, name: text(common?.name, sprache, id), ...(ziele.length > 0 ? { ziele } : {}) };
}

export interface Objektquelle {
    readonly sprache: string;
    // <namespace>.apps
    readonly eigeneApps: string;
    profil(profilId: string): Profil | undefined;
    // Nach ID sortiert
    karten(): [string, Karte][];
    // Nach ID sortiert
    raeume(): Aufzaehlung[];
    datenpunkt(id: string): Merkmale | undefined;
}

export interface Kartenteil {
    id: string;
    typ: Datentyp;
    einheit?: string;
    min?: number;
    max?: number;
    schritt?: number;
    auswahl?: Record<string, string>;
    recht: Recht;
    name?: string;
}

export interface Karteneintrag {
    id: string;
    name: string;
    typ: Kartentyp;
    raum?: string;
    teile: Record<string, Kartenteil>;
}

export interface Raum {
    id: string;
    name: string;
}

export interface Rechteinhalt {
    profil: string;
    raeume: Raum[];
    karten: Karteneintrag[];
}

const RANG: Record<Recht, number> = { lesen: 1, schreiben: 2 };
const FEST_GESPERRT = ['system'];

const hoeher = (a: Recht | undefined, b: Recht): Recht => (a && RANG[a] >= RANG[b] ? a : b);

const pruefeObjektId = erstellePruefer({ $ref: `${gemeinsam.$id}#/$defs/objektId` }, [gemeinsam]);
const kennung = { $ref: `${gemeinsam.$id}#/$defs/kennung` };
const rechtwahl = { enum: ['lesen', 'schreiben'] };

const pruefeProfil = erstellePruefer(
    {
        type: 'object',
        required: ['name', 'raeume', 'karten', 'gesperrt'],
        properties: {
            name: { type: 'string', minLength: 1, maxLength: 60 },
            raeume: {
                type: 'array',
                items: {
                    type: 'object',
                    required: ['enum', 'recht'],
                    properties: { enum: { type: 'string', pattern: '^enum\\.rooms\\.' }, recht: rechtwahl },
                },
            },
            karten: {
                type: 'array',
                items: { type: 'object', required: ['id', 'recht'], properties: { id: kennung, recht: rechtwahl } },
            },
            gesperrt: { type: 'array', items: kennung },
        },
    },
    [gemeinsam],
);

export function alsProfil(native: unknown): Profil | string[] {
    const fehler = pruefeProfil(native);
    return fehler.length > 0 ? fehler : (native as Profil);
}

// Je Typ nur seine Teile; welcher Datenpunkt passt, hängt vom Datenpunkt ab und wird bei jeder Berechnung geprüft.
const pruefeKarte = erstellePruefer(
    {
        type: 'object',
        required: ['name', 'typ', 'raum', 'teile'],
        properties: {
            name: { type: 'string', minLength: 1, maxLength: NAME_LAENGE },
            typ: { enum: KARTENTYPEN },
            raum: {
                anyOf: [
                    { const: '' },
                    {
                        allOf: [
                            { $ref: `${gemeinsam.$id}#/$defs/objektId` },
                            { type: 'string', pattern: '^enum\\.rooms\\.' },
                        ],
                    },
                ],
            },
        },
        oneOf: KARTENTYPEN.map(typ => {
            const art = KARTENARTEN[typ];
            const je = (schema: object): Record<string, object> =>
                Object.fromEntries(Object.keys(art.teile).map(teil => [teil, schema]));
            return {
                type: 'object',
                properties: {
                    typ: { const: typ },
                    teile: {
                        type: 'object',
                        additionalProperties: false,
                        minProperties: 1,
                        required: art.pflicht,
                        properties: je({ $ref: `${gemeinsam.$id}#/$defs/objektId` }),
                    },
                    bezeichnungen: art.bezeichnungen
                        ? {
                              type: 'object',
                              additionalProperties: false,
                              properties: je({ type: 'string', maxLength: BEZEICHNUNG_LAENGE }),
                          }
                        : false,
                },
            };
        }),
    },
    [gemeinsam],
);

export function alsKarte(native: unknown): Karte | string[] {
    const fehler = pruefeKarte(native);
    return fehler.length > 0 ? fehler : (native as Karte);
}

const pruefeKennung = erstellePruefer(kennung, [gemeinsam]);
export const istKennung = (id: unknown): id is string => pruefeKennung(id).length === 0;

const zahl = (w: unknown): number | undefined => (typeof w === 'number' && Number.isFinite(w) ? w : undefined);

export interface Bereich {
    min: number;
    max: number;
    schritt?: number;
}

// Fertig für Regler in App und Admin. Ohne eigenen Schritt ganze Schritte, sobald der Bereich das hergibt: Sonst
// schickten Regler Werte wie 34,271 % (G3).
export function bereich(art: Teilart, m: Pick<Merkmale, 'min' | 'max' | 'step'>): Bereich | undefined {
    if (!art.bereich) {
        return undefined;
    }
    const vorgabe = art.bereich === 'pflicht' ? undefined : art.bereich;
    const min = zahl(m.min) ?? vorgabe?.min;
    const max = zahl(m.max) ?? vorgabe?.max;
    if (min === undefined || max === undefined || min >= max) {
        return undefined;
    }
    const eigener = zahl(m.step);
    const schritt = eigener !== undefined && eigener > 0 ? eigener : (art.schritt ?? (max - min >= 10 ? 1 : undefined));
    return { min, max, ...(schritt !== undefined ? { schritt } : {}) };
}

export function text(name: ioBroker.StringOrTranslated | undefined, sprache: string, ersatz: string): string {
    if (typeof name === 'string') {
        return name;
    }
    const uebersetzt = name?.[sprache as ioBroker.Languages] ?? name?.en ?? Object.values(name ?? {})[0];
    return typeof uebersetzt === 'string' ? uebersetzt : ersatz;
}

// common.states gibt es als Objekt, als Liste und in alten Adaptern als Text "0:aus;1:an".
function auswahl(states: unknown): Record<string, string> | undefined {
    let paare: [string, unknown][] = [];
    if (typeof states === 'string') {
        paare = states
            .split(';')
            .filter(teil => teil.includes(':'))
            .map(teil => [teil.slice(0, teil.indexOf(':')), teil.slice(teil.indexOf(':') + 1)]);
    } else if (Array.isArray(states)) {
        paare = states.map((t, i) => [String(i), t]);
    } else if (states && typeof states === 'object') {
        paare = Object.entries(states);
    }
    const ergebnis = paare
        .filter(([, t]) => typeof t === 'string' || typeof t === 'number' || typeof t === 'boolean')
        .slice(0, 200)
        .map(([w, t]) => [w, String(t).slice(0, 200)]);
    return ergebnis.length > 0 ? Object.fromEntries(ergebnis) : undefined;
}

const kurz = (w: unknown, laenge: number): string | undefined =>
    typeof w === 'string' && w !== '' ? w.slice(0, laenge) : undefined;

// Kürzt auf die Grenzen des Schemas: Die App trennt bei jeder Abweichung. Nur für Datenpunkte, die zum Teil passen.
function beschreibe(id: string, m: Merkmale, art: Teilart, recht: Recht, name: string | undefined): Kartenteil {
    const regler = bereich(art, m);
    const felder = {
        einheit: kurz(m.unit, 30),
        min: regler?.min,
        max: regler?.max,
        schritt: regler?.schritt,
        // Text zu einem Wert braucht nur, was angezeigt wird
        auswahl: art.bedienbar ? undefined : auswahl(m.states),
        name: name?.slice(0, NAME_LAENGE),
    };
    return {
        id,
        typ: m.type as Datentyp,
        ...Object.fromEntries(Object.entries(felder).filter(([, w]) => w !== undefined)),
        recht,
    };
}

export const liegtUnter = (id: string, praefix: string): boolean => id === praefix || id.startsWith(`${praefix}.`);

const betrifft = (id: string, m: Merkmale | undefined, praefixe: string[]): boolean =>
    [id, ...(m?.ziele ?? [])].some(i => praefixe.some(p => liegtUnter(i, p)));

// Warum ein Datenpunkt nicht als Teil auf die Karte kommt; undefined, wenn er passt
function teilmangel(dp: string, m: Merkmale | undefined, art: Teilart): string | undefined {
    if (pruefeObjektId(dp).length > 0) {
        return 'ID ungültig';
    }
    if (!m) {
        return 'Datenpunkt fehlt';
    }
    if (betrifft(dp, m, FEST_GESPERRT)) {
        return 'unter system, nie freigegeben';
    }
    if (!art.typen.includes(m.type as Datentyp)) {
        return `Typ ${String(m.type)} statt ${art.typen.join(' oder ')}`;
    }
    if (art.bereich && bereich(art, m) === undefined) {
        return 'min und max fehlen oder passen nicht';
    }
    return undefined;
}

/**
 * Für das Log beim Start: Was an den Karten nicht passt. Der Admin prüft beim Speichern nur den Namen, und jedes Speichern
 * startet die Instanz neu; so steht ein unpassender Datenpunkt gleich danach im Log statt still auf dem Handy zu fehlen.
 */
export function kartenmaengel(quelle: Pick<Objektquelle, 'karten' | 'datenpunkt'>): string[] {
    const maengel: string[] = [];
    for (const [id, karte] of quelle.karten()) {
        const art = KARTENARTEN[karte.typ];
        const teile = Object.entries(karte.teile).map(([teil, dp]) => ({
            teil,
            dp,
            mangel: teilmangel(dp, quelle.datenpunkt(dp), art.teile[teil]),
        }));
        const schlecht = teile.filter(t => t.mangel !== undefined);
        if (schlecht.length === 0) {
            continue;
        }
        const bleiben = teile.filter(t => t.mangel === undefined).map(t => t.teil);
        const folge =
            bleiben.length === 0 || art.pflicht.some(p => !bleiben.includes(p))
                ? 'fehlt auf den Handys'
                : 'zeigt nicht alle Teile';
        const liste = schlecht.map(t => `${t.teil} ${t.dp}: ${t.mangel}`).join('; ');
        maengel.push(`Karte „${karte.name}“ (${id}) ${folge}: ${liste}`);
    }
    return maengel;
}

/** Was eine App sehen und schreiben darf, nach KONZEPT-KARTEN.md, Abschnitt 4. */
export class Rechtestand {
    private readonly rechte = new Map<string, Recht>();

    public constructor(public readonly inhalt: Rechteinhalt) {
        // Steht ein Datenpunkt in mehreren Karten, gilt das höchste Recht.
        for (const karte of inhalt.karten) {
            for (const t of Object.values(karte.teile)) {
                this.rechte.set(t.id, hoeher(this.rechte.get(t.id), t.recht));
            }
        }
    }

    public recht(id: string): Recht | undefined {
        return this.rechte.get(id);
    }

    public get anzahlDatenpunkte(): number {
        return this.rechte.size;
    }

    public static leer(): Rechtestand {
        return new Rechtestand({ profil: '', raeume: [], karten: [] });
    }
}

// Ohne Profil sieht eine App nichts.
export function rechteFuer(profilId: string, quelle: Objektquelle): Rechtestand {
    const profil = istKennung(profilId) ? quelle.profil(profilId) : undefined;
    return profil ? berechneRechte(profil, quelle) : Rechtestand.leer();
}

export function berechneRechte(profil: Profil, quelle: Objektquelle): Rechtestand {
    const raumrecht = new Map<string, Recht>();
    profil.raeume.forEach(r => raumrecht.set(r.enum, hoeher(raumrecht.get(r.enum), r.recht)));
    const einzeln = new Map<string, Recht>();
    profil.karten.forEach(k => einzeln.set(k.id, hoeher(einzeln.get(k.id), k.recht)));
    const gesperrt = new Set(profil.gesperrt);
    const raeume = new Map(quelle.raeume().map(r => [r.id, r]));

    const karten: Karteneintrag[] = [];
    for (const [id, karte] of quelle.karten()) {
        if (karten.length >= KARTEN_HOECHSTENS) {
            break;
        }
        if (gesperrt.has(id)) {
            continue;
        }
        const raum = raeume.has(karte.raum) ? karte.raum : undefined;
        // Anrufe und Benachrichtigungen der Apps nur über Einzelfreigaben: Ein Raum ist dafür zu grob.
        const persoenlich = Object.values(karte.teile).some(dp =>
            betrifft(dp, quelle.datenpunkt(dp), [quelle.eigeneApps]),
        );
        const recht = einzeln.get(id) ?? (raum && !persoenlich ? raumrecht.get(raum) : undefined);
        const eintrag = recht && kartenEintrag(id, karte, recht, raum, quelle);
        if (eintrag) {
            karten.push(eintrag);
        }
    }

    const sichtbar = new Set(karten.map(k => k.raum));
    return new Rechtestand({
        profil: profil.name,
        raeume: [...raeume.values()]
            .filter(r => sichtbar.has(r.id) && pruefeObjektId(r.id).length === 0)
            .map(r => ({ id: r.id, name: text(r.name, quelle.sprache, r.id).slice(0, NAME_LAENGE) })),
        karten,
    });
}

function kartenEintrag(
    id: string,
    karte: Karte,
    recht: Recht,
    raum: string | undefined,
    quelle: Objektquelle,
): Karteneintrag | undefined {
    const art = KARTENARTEN[karte.typ];
    const teile: Record<string, Kartenteil> = {};
    for (const [teil, teilart] of Object.entries(art.teile)) {
        const dp = karte.teile[teil];
        const m = dp === undefined ? undefined : quelle.datenpunkt(dp);
        if (dp === undefined || !m || teilmangel(dp, m, teilart) !== undefined) {
            continue;
        }
        const teilrecht = recht === 'schreiben' && teilart.bedienbar && m.write !== false ? 'schreiben' : 'lesen';
        const name = art.bezeichnungen ? karte.bezeichnungen?.[teil] || text(m.name, quelle.sprache, dp) : undefined;
        teile[teil] = beschreibe(dp, m, teilart, teilrecht, name);
    }
    if (Object.keys(teile).length === 0 || art.pflicht.some(p => !teile[p])) {
        return undefined;
    }
    return { id, name: karte.name.slice(0, NAME_LAENGE), typ: karte.typ, ...(raum ? { raum } : {}), teile };
}
