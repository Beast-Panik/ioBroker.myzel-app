import adapterAnApp from '../../protokoll/v1/adapter-an-app.schema.json';
import gemeinsam from '../../protokoll/v1/gemeinsam.schema.json';
import { erstellePruefer } from '../basis/schema';
import type { AppDaten, Handydaten } from './objekte';

// Zonen und Standort (KONZEPT-ZONEN.md, Abschnitt 16): Orte im Admin, je App freigegeben, ab Protokoll 7.

// Ab dieser Protokollversion bekommt eine App Zonen und meldet Zonen und Standort
export const ZONEN_SEIT = 7;
export const ZONEN_HOECHSTENS = adapterAnApp.$defs.rechteInhalt.properties.zonen.maxItems;
export const ZONENNAME_LAENGE = adapterAnApp.$defs.zone.properties.name.maxLength;
export const RADIUS_VON = adapterAnApp.$defs.zone.properties.radius.minimum;
export const RADIUS_BIS = adapterAnApp.$defs.zone.properties.radius.maximum;
export const RADIUS_VORGABE = 300;
export const ZONENID_LAENGE = 30;

// Eine Zone als Objekt <namespace>.zonen.<id> vom Typ config, native ist der Eintrag
export interface Zone {
    name: string;
    breite: number;
    laenge: number;
    radius: number;
}

// Ein Standort vom Handy als Vorschlag für den Mittelpunkt einer Zone (KONZEPT-ZONEN.md, Abschnitt 17.7)
export interface Mittelpunktvorschlag {
    appId: string;
    breite: number;
    laenge: number;
    genauigkeit: number;
    zeit: number;
}

// So lange zeigt der Reiter „Zonen“ einen Vorschlag
export const VORSCHLAG_MS = 15 * 60_000;

// Was die App je Zone bekommt
export interface Zonenangabe extends Zone {
    id: string;
}

// Wie grund in zonenstand (app-an-adapter.schema.json); der Test hält beide gleich.
export type Zonengrund =
    'standort_aus' | 'berechtigung' | 'ungefaehr' | 'hintergrund' | 'energiesparen' | 'keine_standorte' | 'aus';

// Gründe, die der Adapter selbst schreibt: Freigabe im Admin beendet, App entfernt, App mit Protokoll vor 7
export type Adaptergrund = 'admin' | 'entfernt' | 'veraltet';

// Der Text in zonen.grund
export const GRUENDE: Record<Zonengrund | Adaptergrund, { de: string; en: string }> = {
    standort_aus: { de: 'Standort am Handy aus', en: 'Location switched off on the phone' },
    berechtigung: { de: 'Standort für die App nicht erlaubt', en: 'Location not allowed for the app' },
    ungefaehr: { de: 'Nur ungefährer Standort erlaubt', en: 'Only approximate location allowed' },
    hintergrund: { de: 'Standort im Hintergrund nicht erlaubt', en: 'Location in the background not allowed' },
    energiesparen: {
        de: 'Vom Energiesparen des Handys eingeschränkt',
        en: 'Restricted by the battery saving of the phone',
    },
    keine_standorte: { de: 'Seit Längerem keine Standorte', en: 'No locations for a long time' },
    aus: { de: 'In der App ausgeschaltet', en: 'Switched off in the app' },
    admin: { de: 'Im Admin ausgeschaltet', en: 'Switched off in the admin' },
    entfernt: { de: 'App im Admin entfernt', en: 'App removed in the admin' },
    veraltet: {
        de: 'Die App kennt keine Zonen, bitte aktualisieren',
        en: 'The app does not know zones, please update',
    },
};

export const grundText = (grund: Zonengrund | Adaptergrund, sprache: string): string =>
    sprache === 'de' ? GRUENDE[grund].de : GRUENDE[grund].en;

const { id: _id, ...zonenfelder } = adapterAnApp.$defs.zone.properties;
const pruefeZone = erstellePruefer(
    {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'breite', 'laenge', 'radius'],
        properties: zonenfelder,
    },
    [gemeinsam],
);

export function alsZone(native: unknown): Zone | string[] {
    const fehler = pruefeZone(native);
    return fehler.length > 0 ? fehler : (native as Zone);
}

const pruefeZonenId = erstellePruefer({ $ref: `${gemeinsam.$id}#/$defs/zonenId` }, [gemeinsam]);
export const istZonenId = (id: unknown): id is string => pruefeZonenId(id).length === 0;

/**
 * Mittelpunkt aus einem Feld „Breite, Länge“, wie Karten-Apps ihn kopieren: zwei Zahlen mit Dezimalpunkt, getrennt durch
 * Komma, Semikolon oder Leerraum. Ein Dezimalkomma wäre vom Trenner nicht zu unterscheiden und gilt nicht.
 */
export function liesMitte(text: unknown): { breite: number; laenge: number } | undefined {
    if (typeof text !== 'string') {
        return undefined;
    }
    const teile = text
        .trim()
        .split(/\s*[,;]\s*|\s+/)
        .filter(t => t !== '');
    if (teile.length !== 2 || !teile.every(t => /^[+-]?\d{1,3}(\.\d+)?$/.test(t))) {
        return undefined;
    }
    const [breite, laenge] = teile.map(Number);
    if (Math.abs(breite) > 90 || Math.abs(laenge) > 180) {
        return undefined;
    }
    // Sechs Nachkommastellen sind gut 10 cm, genauer misst kein Handy
    const runde = (w: number): number => Math.round(w * 1e6) / 1e6;
    return { breite: runde(breite), laenge: runde(laenge) };
}

// Vorschlag für die ID aus dem Namen: Kleinbuchstaben, Ziffern und _, vorn ein Buchstabe
export function zonenIdAus(name: string): string {
    const id = name
        .toLowerCase()
        .replaceAll('ä', 'ae')
        .replaceAll('ö', 'oe')
        .replaceAll('ü', 'ue')
        .replaceAll('ß', 'ss')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^[^a-z]+/, '')
        .slice(0, ZONENID_LAENGE)
        .replace(/_+$/, '');
    return id;
}

// Apps vor Protokoll 7 trennen bei unbekannten Feldern; sie bekommen nur die drei alten Datenarten.
export function handydatenFuer(h: Handydaten, version: number): Handydaten {
    const alt = { akku: h.akku, anruf: h.anruf, benachrichtigung: h.benachrichtigung };
    return version >= ZONEN_SEIT ? { ...alt, zonen: h.zonen === true, standort: h.standort === true } : alt;
}

// Die Zonen einer App, die es gibt und die ihr freigegeben sind, nach Namen; leer ohne die Datenart Zonen. Höchstens so
// viele, wie das Protokoll erlaubt: Ein Skript kann mehr Zonen anlegen als der Reiter, und mit einer Liste über der Grenze
// trennte die App jede Verbindung.
export function zonenDerApp(daten: AppDaten, alle: [string, Zone][]): Zonenangabe[] {
    if (daten.handydaten.zonen !== true) {
        return [];
    }
    const wahl = new Set(daten.zonenwahl ?? []);
    return alle
        .filter(([id]) => wahl.has(id))
        .slice(0, ZONEN_HOECHSTENS)
        .map(([id, z]) => ({ id, ...z }));
}

// Was in willkommen und rechte dazukommt: ab Protokoll 7 immer, auch leer
export function zonenFuer(daten: AppDaten, alle: [string, Zone][], version: number): { zonen?: Zonenangabe[] } {
    return version >= ZONEN_SEIT ? { zonen: zonenDerApp(daten, alle) } : {};
}
