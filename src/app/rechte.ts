import adapterAnApp from '../../protokoll/v1/adapter-an-app.schema.json';
import gemeinsam from '../../protokoll/v1/gemeinsam.schema.json';
import { erstellePruefer } from '../basis/schema';

export type Recht = 'lesen' | 'schreiben';

export interface Profil {
    name: string;
    raeume: { enum: string; recht: Recht }[];
    freigaben: { id: string; recht: Recht }[];
    sperren: string[];
}

export type Teil = 'schalten' | 'helligkeit' | 'farbe' | 'farbtemperatur';

// KONZEPT-GERAETE.md, Abschnitt 2: Typ des Datenpunkts je Teil einer Lampe
export const TEILTYP: Readonly<Record<Teil, 'boolean' | 'number' | 'string'>> = {
    schalten: 'boolean',
    helligkeit: 'number',
    farbe: 'string',
    farbtemperatur: 'number',
};
export const TEILE = Object.keys(TEILTYP) as Teil[];

export interface Geraet {
    name: string;
    typ: 'lampe';
    teile: Partial<Record<Teil, string>>;
}

export const GERAETE_HOECHSTENS = adapterAnApp.$defs.rechteInhalt.properties.geraete.maxItems;

export interface Aufzaehlung {
    id: string;
    name: ioBroker.StringOrTranslated;
    mitglieder: string[];
}

const MERKMALE = ['name', 'type', 'role', 'unit', 'min', 'max', 'step', 'states', 'write'] as const;

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
    geraete(): [string, Geraet][];
    aufzaehlungen(art: 'rooms' | 'functions'): Aufzaehlung[];
    // Datenpunkte mit genau dieser ID oder darunter
    zustaende(praefix: string): Map<string, Merkmale>;
}

export interface Datenpunkt {
    id: string;
    name: string;
    typ: string;
    rolle?: string;
    einheit?: string;
    min?: number;
    max?: number;
    schritt?: number;
    auswahl?: Record<string, string>;
    recht: Recht;
}

export interface Gruppe {
    id: string;
    name: string;
    mitglieder: string[];
}

export interface Geraeteintrag extends Geraet {
    id: string;
}

export interface Rechteinhalt {
    profil: string;
    datenpunkte: Datenpunkt[];
    raeume: Gruppe[];
    funktionen: Gruppe[];
    geraete: Geraeteintrag[];
}

const TYPEN = new Set(['number', 'string', 'boolean', 'json', 'mixed', 'array', 'object', 'file']);
const RANG: Record<Recht, number> = { lesen: 1, schreiben: 2 };
const FEST_GESPERRT = ['system'];

const pruefeObjektId = erstellePruefer({ $ref: `${gemeinsam.$id}#/$defs/objektId` }, [gemeinsam]);
const pruefeProfil = erstellePruefer({
    type: 'object',
    required: ['name', 'raeume', 'freigaben', 'sperren'],
    properties: {
        name: { type: 'string', minLength: 1, maxLength: 60 },
        raeume: {
            type: 'array',
            items: {
                type: 'object',
                required: ['enum', 'recht'],
                properties: {
                    enum: { type: 'string', pattern: '^enum\\.rooms\\.' },
                    recht: { enum: ['lesen', 'schreiben'] },
                },
            },
        },
        freigaben: {
            type: 'array',
            items: {
                type: 'object',
                required: ['id', 'recht'],
                properties: { id: { type: 'string', minLength: 1 }, recht: { enum: ['lesen', 'schreiben'] } },
            },
        },
        sperren: { type: 'array', items: { type: 'string', minLength: 1 } },
    },
});

export function alsProfil(native: unknown): Profil | string[] {
    const fehler = pruefeProfil(native);
    return fehler.length > 0 ? fehler : (native as Profil);
}

const geraetFeld = (feld: string): object => ({ $ref: `${adapterAnApp.$id}#/$defs/geraet/properties/${feld}` });
const pruefeGeraet = erstellePruefer(
    {
        type: 'object',
        required: ['name', 'typ', 'teile'],
        properties: {
            name: { type: 'string', minLength: 1, maxLength: 200 },
            typ: geraetFeld('typ'),
            teile: geraetFeld('teile'),
        },
    },
    [gemeinsam, adapterAnApp],
);

// Nur der Aufbau; ob die Datenpunkte passen, hängt von ihnen ab und wird bei jeder Berechnung der Rechte geprüft.
export function alsGeraet(native: unknown): Geraet | string[] {
    const fehler = pruefeGeraet(native);
    return fehler.length > 0 ? fehler : (native as Geraet);
}

const pruefeKennung = erstellePruefer({ $ref: `${gemeinsam.$id}#/$defs/kennung` }, [gemeinsam]);
export const istKennung = (id: unknown): id is string => pruefeKennung(id).length === 0;

const zahl = (w: unknown): number | undefined => (typeof w === 'number' && Number.isFinite(w) ? w : undefined);

// Die Lichtfarbe braucht ihren Bereich: Ohne ihn weiß die App nicht, wo warm und wo kalt liegt.
export function passtZuTeil(teil: Teil, typ: unknown, min: unknown, max: unknown): boolean {
    if (typ !== TEILTYP[teil]) {
        return false;
    }
    const von = zahl(min);
    const bis = zahl(max);
    return teil !== 'farbtemperatur' || (von !== undefined && bis !== undefined && von < bis);
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

// Kürzt auf die Grenzen des Schemas: Die App trennt bei jeder Abweichung.
export function beschreibe(id: string, common: Merkmale, recht: Recht, sprache: string): Datenpunkt {
    const felder: Omit<Datenpunkt, 'id' | 'name' | 'typ' | 'recht'> = {
        rolle: kurz(common.role, 100),
        einheit: kurz(common.unit, 30),
        min: zahl(common.min),
        max: zahl(common.max),
        schritt: zahl(common.step),
        auswahl: auswahl(common.states),
    };
    return {
        id,
        name: text(common.name, sprache, id).slice(0, 200),
        typ: common.type && TYPEN.has(common.type) ? common.type : 'mixed',
        ...Object.fromEntries(Object.entries(felder).filter(([, w]) => w !== undefined)),
        recht,
    };
}

export const liegtUnter = (id: string, praefix: string): boolean => id === praefix || id.startsWith(`${praefix}.`);

const gesperrt = (id: string, m: Merkmale, sperren: string[]): boolean =>
    [id, ...(m.ziele ?? [])].some(i => sperren.some(s => liegtUnter(i, s)));

/** Was eine App sehen und schreiben darf, nach Abschnitt 9 des Detailentwurfs. */
export class Rechtestand {
    private readonly rechte: Map<string, Recht>;

    public constructor(public readonly inhalt: Rechteinhalt) {
        this.rechte = new Map(inhalt.datenpunkte.map(d => [d.id, d.recht]));
    }

    public recht(id: string): Recht | undefined {
        return this.rechte.get(id);
    }

    // Geräte erst ab Version 2: Eine App mit Version 1 trennt bei einem unbekannten Feld.
    public inhaltFuer(version: number): Partial<Rechteinhalt> {
        if (version >= 2) {
            return this.inhalt;
        }
        const { geraete: _, ...ohneGeraete } = this.inhalt;
        return ohneGeraete;
    }

    public static leer(): Rechtestand {
        return new Rechtestand({ profil: '', datenpunkte: [], raeume: [], funktionen: [], geraete: [] });
    }
}

// Ohne Profil sieht eine App nichts.
export function rechteFuer(profilId: string, quelle: Objektquelle): Rechtestand {
    const profil = istKennung(profilId) ? quelle.profil(profilId) : undefined;
    return profil ? berechneRechte(profil, quelle) : Rechtestand.leer();
}

export function berechneRechte(profil: Profil, quelle: Objektquelle): Rechtestand {
    const { sprache } = quelle;
    const rechte = new Map<string, Recht>();
    const objekte = new Map<string, Merkmale>();
    const raeume = quelle.aufzaehlungen('rooms');
    const funktionen = quelle.aufzaehlungen('functions');

    for (const { enum: raumId, recht } of profil.raeume) {
        for (const mitglied of raeume.find(r => r.id === raumId)?.mitglieder ?? []) {
            for (const [id, common] of quelle.zustaende(mitglied)) {
                // Anrufe und Benachrichtigungen der Apps nur über Einzelfreigaben: Ein Raum ist dafür zu grob.
                if (gesperrt(id, common, [quelle.eigeneApps])) {
                    continue;
                }
                objekte.set(id, common);
                const bisher = rechte.get(id);
                if (!bisher || RANG[recht] > RANG[bisher]) {
                    rechte.set(id, recht);
                }
            }
        }
    }
    for (const { id, recht } of profil.freigaben) {
        const common = quelle.zustaende(id).get(id);
        if (common) {
            objekte.set(id, common);
            rechte.set(id, recht);
        }
    }

    const datenpunkte: Datenpunkt[] = [];
    for (const [id, recht] of rechte) {
        const common = objekte.get(id)!;
        if (gesperrt(id, common, [...profil.sperren, ...FEST_GESPERRT]) || pruefeObjektId(id).length > 0) {
            continue;
        }
        datenpunkte.push(beschreibe(id, common, common.write === false ? 'lesen' : recht, sprache));
    }
    datenpunkte.sort((a, b) => a.id.localeCompare(b.id));

    // Gruppen ordnen nur; auch ein Raum außerhalb des Profils zeigt seine erlaubten Datenpunkte.
    const gruppiere = (liste: Aufzaehlung[]): Gruppe[] =>
        liste
            .map(a => ({
                id: a.id,
                name: text(a.name, sprache, a.id).slice(0, 200),
                mitglieder: datenpunkte.filter(d => a.mitglieder.some(m => liegtUnter(d.id, m))).map(d => d.id),
            }))
            .filter(g => g.mitglieder.length > 0 && pruefeObjektId(g.id).length === 0);

    return new Rechtestand({
        profil: profil.name,
        datenpunkte,
        raeume: gruppiere(raeume),
        funktionen: gruppiere(funktionen),
        geraete: geraeteAus(datenpunkte, quelle),
    });
}

// Geräte geben keine Rechte, sie fassen nur erlaubte Datenpunkte zusammen. Ein Datenpunkt gehört zu höchstens einem
// Gerät; hat ein anderer Adapter das in den Objekten verletzt, gewinnt das Gerät mit der kleineren ID, für jedes Profil
// gleich.
function geraeteAus(datenpunkte: Datenpunkt[], quelle: Objektquelle): Geraeteintrag[] {
    const erlaubt = new Map(datenpunkte.map(d => [d.id, d]));
    const vergeben = new Set<string>();
    const geraete: Geraeteintrag[] = [];
    for (const [id, geraet] of quelle.geraete()) {
        const teile: Geraet['teile'] = {};
        for (const teil of TEILE) {
            const dpId = geraet.teile[teil];
            if (dpId === undefined || vergeben.has(dpId)) {
                continue;
            }
            vergeben.add(dpId);
            const d = erlaubt.get(dpId);
            if (d && passtZuTeil(teil, d.typ, d.min, d.max)) {
                teile[teil] = dpId;
            }
        }
        if (Object.keys(teile).length > 0 && geraete.length < GERAETE_HOECHSTENS) {
            geraete.push({ id, name: geraet.name, typ: geraet.typ, teile });
        }
    }
    return geraete;
}
