import gemeinsam from '../../protokoll/v1/gemeinsam.schema.json';
import type { Geraet } from '../basis/anmeldung';
import { erstellePruefer } from '../basis/schema';
import type { Katalogquelle } from './katalog';
import type { Umstellungsablage } from './umstellung';
import type { Wert, Zustandsquelle } from './werte';

export interface Handydaten {
    akku: boolean;
    anruf: boolean;
    benachrichtigung: boolean;
}

export interface AppDaten {
    name: string;
    zugangHash: string;
    profil: string;
    handydaten: Handydaten;
    gekoppeltAm: number;
    geraet: Geraet;
}

export interface Hinweis {
    t: 'hinweis';
    id: string;
    titel?: string;
    text: string;
    wichtigkeit: 'normal' | 'hoch';
    zeit: number;
}

export interface Hinweisstand {
    warteschlange: Hinweis[];
    // ID des zuletzt geschriebenen Hinweises, leer wenn er abgewiesen wurde: Nur er bestimmt hinweis.status.
    letzter: string;
    // ts und Prüfsumme des zuletzt bearbeiteten hinweis.senden: Nach einem Neustart kommt keiner doppelt und keiner
    // gar nicht. Die Prüfsumme trennt zwei Hinweise aus derselben Millisekunde.
    bearbeitet: number;
    pruefsumme: string;
}

// Eigene Schnittstelle, damit die Abläufe ohne ioBroker testbar sind.
export interface Appablage {
    lies(appId: string): Promise<AppDaten | undefined>;
    alle(): Promise<string[]>;
    lege(appId: string, daten: AppDaten): Promise<void>;
    aendere(appId: string, daten: Partial<AppDaten>): Promise<void>;
    // Zugang und Hinweise weg; die übrigen Datenpunkte bleiben, bis man sie selbst löscht
    entferne(appId: string): Promise<void>;
    // In der Reihenfolge der Schlüssel, mit ack=true und ts, falls angegeben
    schreibe(appId: string, werte: Appwerte, ts?: number): Promise<void>;
    zustand(appId: string, name: Datenpunktname): Promise<ioBroker.State | null | undefined>;
    // Was es von Anfang an geben muss: hinweis.senden, damit Skripte schreiben können
    richteEin(appId: string): Promise<void>;
    // Die Ordner der Apps unter benachrichtigungen, ohne letzte
    benachrichtigungsordner(appId: string): Promise<string[]>;
    // Legt den Ordner samt Datenpunkten an oder benennt ihn um
    legeBenachrichtigungsordner(appId: string, ordner: string, name: string): Promise<void>;
    entferneBenachrichtigungsordner(appId: string, ordner: string): Promise<void>;
    // In der Reihenfolge der Schlüssel, mit ack=true und ts; fehlt der Ordner, entsteht er mit name
    schreibeBenachrichtigung(
        appId: string,
        ordner: string,
        name: string,
        werte: Benachrichtigungswerte,
        ts: number,
    ): Promise<void>;
    hinweise(appId: string): Promise<Hinweisstand>;
    legeHinweise(appId: string, stand: Hinweisstand): Promise<void>;
}

const nurLesen = { read: true, write: false } as const;
const text = (de: string, en: string): ioBroker.StateCommon => ({
    name: { de, en },
    type: 'string',
    role: 'text',
    ...nurLesen,
});

const KANAELE: Record<string, ioBroker.StringOrTranslated> = {
    akku: { de: 'Akku', en: 'Battery' },
    anruf: { de: 'Anruf', en: 'Call' },
    hinweis: { de: 'Hinweis', en: 'Notice' },
};

const DATENPUNKTE = {
    online: {
        name: { de: 'Verbunden', en: 'Connected' },
        type: 'boolean',
        role: 'indicator.reachable',
        def: false,
        ...nurLesen,
    },
    zuletzt: { name: { de: 'Zuletzt getrennt', en: 'Last disconnected' }, type: 'number', role: 'date', ...nurLesen },
    weg: { name: { de: 'Zugangsweg', en: 'Connection path' }, type: 'string', role: 'text', ...nurLesen },
    profil: text('Profil', 'Profile'),
    anwesend: { name: { de: 'Anwesend', en: 'Present' }, type: 'boolean', role: 'indicator', ...nurLesen },
    'akku.stand': {
        name: { de: 'Akkustand', en: 'Battery level' },
        type: 'number',
        role: 'value.battery',
        unit: '%',
        min: 0,
        max: 100,
        ...nurLesen,
    },
    'akku.laedt': { name: { de: 'Lädt', en: 'Charging' }, type: 'boolean', role: 'indicator', ...nurLesen },
    'anruf.status': text('Anrufstatus', 'Call state'),
    'anruf.richtung': text('Richtung', 'Direction'),
    'anruf.nummer': { ...text('Rufnummer', 'Phone number'), role: 'text.phone' },
    'anruf.name': text('Name', 'Name'),
    'hinweis.senden': { ...text('Hinweis senden', 'Send notice'), write: true },
    'hinweis.status': text('Hinweisstatus', 'Notice state'),
} satisfies Record<string, ioBroker.StateCommon>;

export type Datenpunktname = keyof typeof DATENPUNKTE;
export type Appwerte = Partial<Record<Datenpunktname, ioBroker.StateValue>>;

// Je Ordner unter benachrichtigungen, json zuletzt
const BENACHRICHTIGUNG = {
    app: text('App', 'App'),
    paket: text('Paketname', 'Package name'),
    titel: text('Titel', 'Title'),
    text: text('Text', 'Text'),
    zeit: { name: { de: 'Zeit', en: 'Time' }, type: 'number', role: 'date', ...nurLesen },
    json: { ...text('Alles als JSON', 'All as JSON'), role: 'json' },
} satisfies Record<string, ioBroker.StateCommon>;

export type Benachrichtigungswerte = Record<keyof typeof BENACHRICHTIGUNG, ioBroker.StateValue>;

// Die letzte Benachrichtigung aller Apps, neben den Ordnern je App
export const LETZTE = 'letzte';
const LETZTE_NAME: ioBroker.StringOrTranslated = { de: 'Letzte Benachrichtigung', en: 'Latest notification' };
const BENACHRICHTIGUNGEN_NAME: ioBroker.StringOrTranslated = { de: 'Benachrichtigungen', en: 'Notifications' };

/**
 * Ordner einer App unter benachrichtigungen: der Paketname mit - statt Punkt. Ein - kommt in Paketnamen nicht vor, die
 * Zuordnung ist also eindeutig und umkehrbar. undefined für einen Paketnamen, der letzte ergäbe.
 */
export function ordnerFuer(paket: string): string | undefined {
    const ordner = paket.replaceAll('.', '-');
    return ordner === LETZTE ? undefined : ordner;
}

const pruefeAppId = erstellePruefer({ $ref: `${gemeinsam.$id}#/$defs/appId` }, [gemeinsam]);

// App-ID, wenn objektId das Objekt einer App ist, mit name einer ihrer Datenpunkte
export function appIdAus(namespace: string, objektId: string, name?: Datenpunktname): string | undefined {
    const praefix = `${namespace}.apps.`;
    const ende = name ? `.${name}` : '';
    if (!objektId.startsWith(praefix) || !objektId.endsWith(ende)) {
        return undefined;
    }
    const appId = objektId.slice(praefix.length, objektId.length - ende.length);
    return pruefeAppId(appId).length === 0 ? appId : undefined;
}

const LEERER_STAND: Hinweisstand = { warteschlange: [], letzter: '', bearbeitet: 0, pruefsumme: '' };

// Andere können das Objekt ändern. Einträge prüft erst der Versand am Schema; hier nur, dass der Stand lesbar ist.
function alsHinweisstand(n: Record<string, unknown> | undefined): Hinweisstand {
    return Array.isArray(n?.warteschlange) &&
        typeof n.letzter === 'string' &&
        typeof n.bearbeitet === 'number' &&
        typeof n.pruefsumme === 'string'
        ? (n as unknown as Hinweisstand)
        : structuredClone(LEERER_STAND);
}

const istText = (w: unknown): w is string => typeof w === 'string';
const istJaNein = (w: unknown): w is boolean => typeof w === 'boolean';

// Andere Adapter und Skripte können Objekte ändern; ein beschädigtes gilt deshalb als unbekannte App.
function alsAppDaten(n: Record<string, any>): AppDaten | undefined {
    const h = n.handydaten as Record<string, unknown> | undefined;
    const g = n.geraet as Record<string, unknown> | undefined;
    const gueltig =
        istText(n.name) &&
        istText(n.zugangHash) &&
        /^[0-9a-f]{64}$/.test(n.zugangHash) &&
        istText(n.profil) &&
        typeof n.gekoppeltAm === 'number' &&
        istJaNein(h?.akku) &&
        istJaNein(h?.anruf) &&
        istJaNein(h?.benachrichtigung) &&
        istText(g?.android) &&
        istText(g?.appVersion);
    // Weitere Felder in handydaten gingen sonst an die App, deren Schema keine erlaubt.
    return gueltig
        ? ({ ...n, handydaten: { akku: h.akku, anruf: h.anruf, benachrichtigung: h.benachrichtigung } } as AppDaten)
        : undefined;
}

// Karten und Profile liegen als Objekte <ordner>.<id> vom Typ config, native ist die Karte oder das Profil.
export type Ordner = 'karten' | 'profile';
const ORDNERNAMEN: Record<Ordner, ioBroker.StringOrTranslated> = {
    karten: { de: 'Karten für die Apps', en: 'Cards for the apps' },
    profile: { de: 'Profile für die Apps', en: 'Profiles for the apps' },
};

// Eigene Schnittstelle, damit Seiten und Umstellung ohne ioBroker testbar sind.
export interface Eintragsablage {
    // native des Objekts; undefined, wenn dort kein config-Objekt liegt
    liesEintrag(ordner: Ordner, id: string): Promise<Record<string, unknown> | undefined>;
    // Ersetzt das Objekt ganz, damit nichts Altes stehen bleibt; fehlt es, entsteht es samt Ordner.
    schreibeEintrag(ordner: Ordner, id: string, name: string, native: object): Promise<void>;
    loescheEintrag(ordner: Ordner, id: string): Promise<void>;
}

// Apps, Karten und Profile als eigene Objekte, nicht in den Instanzeinstellungen: Änderungen daran starten die Instanz
// nicht neu.
export class IoBrokerAblage implements Appablage, Umstellungsablage {
    private readonly angelegt = new Set<string>();

    public constructor(private readonly adapter: ioBroker.Adapter) {}

    public async lies(appId: string): Promise<AppDaten | undefined> {
        const objekt = await this.adapter.getObjectAsync(`apps.${appId}`);
        if (objekt?.type !== 'device') {
            return undefined;
        }
        const daten = alsAppDaten(objekt.native);
        if (!daten) {
            this.adapter.log.warn(`Objekt der App ${appId} ist beschädigt, die App gilt als unbekannt`);
        }
        return daten;
    }

    public async alle(): Promise<string[]> {
        const praefix = `${this.adapter.namespace}.apps.`;
        const ansicht = await this.adapter.getObjectViewAsync('system', 'device', {
            startkey: praefix,
            endkey: `${praefix}香`,
        });
        return ansicht.rows.map(r => appIdAus(this.adapter.namespace, r.id)).filter(id => id !== undefined);
    }

    public async lege(appId: string, daten: AppDaten): Promise<void> {
        await this.adapter.setObjectAsync(`apps.${appId}`, {
            type: 'device',
            common: { name: daten.name, statusStates: { onlineId: `${this.adapter.namespace}.apps.${appId}.online` } },
            native: daten,
        });
        await this.richteEin(appId);
        await this.schreibe(appId, { profil: daten.profil });
    }

    public async richteEin(appId: string): Promise<void> {
        await this.sichere(appId, 'hinweis.senden');
        // Bis 0.2.x stand die letzte Benachrichtigung im Kanal benachrichtigung, jetzt unter benachrichtigungen.letzte.
        const alt = `apps.${appId}.benachrichtigung`;
        if (await this.adapter.getObjectAsync(alt)) {
            await this.adapter.delObjectAsync(alt, { recursive: true });
            this.adapter.log.info(`App ${appId}: Kanal benachrichtigung entfernt, jetzt unter benachrichtigungen`);
        }
    }

    public async benachrichtigungsordner(appId: string): Promise<string[]> {
        const praefix = `${this.adapter.namespace}.apps.${appId}.benachrichtigungen.`;
        const ansicht = await this.adapter.getObjectViewAsync('system', 'channel', {
            startkey: praefix,
            endkey: `${praefix}香`,
        });
        return ansicht.rows
            .map(r => r.id.slice(praefix.length))
            .filter(ordner => ordner !== LETZTE && ordner.length > 0 && !ordner.includes('.'));
    }

    // Nur bei neuem Namen geschrieben: Jede Auswahl nennt alle Apps, ihre Ordner bleiben meist, wie sie sind.
    public async legeBenachrichtigungsordner(appId: string, ordner: string, name: string): Promise<void> {
        const kanal = `apps.${appId}.benachrichtigungen.${ordner}`;
        await this.sichereBenachrichtigungen(appId);
        if ((await this.adapter.getObjectAsync(kanal))?.common?.name !== name) {
            await this.adapter.extendObjectAsync(kanal, { type: 'channel', common: { name }, native: {} });
        }
        await this.sichereZustaende(kanal);
    }

    public async entferneBenachrichtigungsordner(appId: string, ordner: string): Promise<void> {
        const kanal = `apps.${appId}.benachrichtigungen.${ordner}`;
        await this.adapter.delObjectAsync(kanal, { recursive: true });
        this.angelegt.delete(kanal);
    }

    public async schreibeBenachrichtigung(
        appId: string,
        ordner: string,
        name: string,
        werte: Benachrichtigungswerte,
        ts: number,
    ): Promise<void> {
        const kanal = `apps.${appId}.benachrichtigungen.${ordner}`;
        if (!this.angelegt.has(kanal)) {
            await this.sichereBenachrichtigungen(appId);
            await this.adapter.setObjectNotExistsAsync(kanal, {
                type: 'channel',
                common: { name: ordner === LETZTE ? LETZTE_NAME : name },
                native: {},
            });
            await this.sichereZustaende(kanal);
        }
        for (const [n, val] of Object.entries(werte)) {
            await this.adapter.setStateAsync(`${kanal}.${n}`, { val, ack: true, ts });
        }
    }

    public async hinweise(appId: string): Promise<Hinweisstand> {
        return alsHinweisstand((await this.adapter.getObjectAsync(`apps.${appId}.hinweis`))?.native);
    }

    // Ganzes Objekt statt extendObject: extendObject führt Listen stellenweise zusammen, aus [1, 2, 3] und [9] würde
    // [9, 2, 3]. Ein eigenes Objekt statt des Geräts, damit nicht jeder Hinweis die Rechte neu berechnen lässt.
    public async legeHinweise(appId: string, stand: Hinweisstand): Promise<void> {
        await this.adapter.setObjectAsync(`apps.${appId}.hinweis`, {
            type: 'channel',
            common: { name: KANAELE.hinweis },
            native: stand,
        });
    }

    public async aendere(appId: string, daten: Partial<AppDaten>): Promise<void> {
        await this.adapter.extendObjectAsync(`apps.${appId}`, { native: daten });
        if (daten.profil !== undefined) {
            await this.schreibe(appId, { profil: daten.profil });
        }
    }

    public async entferne(appId: string): Promise<void> {
        await this.adapter.delObjectAsync(`apps.${appId}.hinweis`, { recursive: true });
        await this.adapter.delObjectAsync(`apps.${appId}`);
        [...this.angelegt].filter(id => id.startsWith(`apps.${appId}.`)).forEach(id => this.angelegt.delete(id));
    }

    public async leereEinstellungen(): Promise<void> {
        await this.adapter.updateConfig({ karten: [], profile: [] });
    }

    public async liesEintrag(ordner: Ordner, id: string): Promise<Record<string, unknown> | undefined> {
        const objekt = await this.adapter.getObjectAsync(`${ordner}.${id}`);
        return objekt?.type === 'config' ? ((objekt.native ?? {}) as Record<string, unknown>) : undefined;
    }

    public async schreibeEintrag(ordner: Ordner, id: string, name: string, native: object): Promise<void> {
        if (!this.angelegt.has(ordner)) {
            await this.adapter.setObjectNotExistsAsync(ordner, {
                type: 'folder',
                common: { name: ORDNERNAMEN[ordner] },
                native: {},
            });
            this.angelegt.add(ordner);
        }
        await this.adapter.setObjectAsync(`${ordner}.${id}`, { type: 'config', common: { name }, native });
    }

    public async loescheEintrag(ordner: Ordner, id: string): Promise<void> {
        await this.adapter.delObjectAsync(`${ordner}.${id}`);
    }

    public async loescheObjekt(id: string): Promise<void> {
        await this.adapter.delObjectAsync(id);
    }

    public async schreibe(appId: string, werte: Appwerte, ts?: number): Promise<void> {
        for (const [name, val] of Object.entries(werte) as [Datenpunktname, ioBroker.StateValue][]) {
            await this.sichere(appId, name);
            await this.adapter.setStateAsync(
                `apps.${appId}.${name}`,
                ts === undefined ? { val, ack: true } : { val, ack: true, ts },
            );
        }
    }

    public zustand(appId: string, name: Datenpunktname): Promise<ioBroker.State | null | undefined> {
        return this.adapter.getStateAsync(`apps.${appId}.${name}`);
    }

    private async sichereBenachrichtigungen(appId: string): Promise<void> {
        const ordner = `apps.${appId}.benachrichtigungen`;
        if (!this.angelegt.has(ordner)) {
            await this.adapter.setObjectNotExistsAsync(ordner, {
                type: 'folder',
                common: { name: BENACHRICHTIGUNGEN_NAME },
                native: {},
            });
            this.angelegt.add(ordner);
        }
    }

    private async sichereZustaende(kanal: string): Promise<void> {
        for (const [n, common] of Object.entries(BENACHRICHTIGUNG)) {
            await this.adapter.setObjectNotExistsAsync(`${kanal}.${n}`, { type: 'state', common, native: {} });
        }
        this.angelegt.add(kanal);
    }

    // Erst beim ersten Wert: So entstehen keine Datenpunkte für ausgeschaltete Handydaten.
    private async sichere(appId: string, name: Datenpunktname): Promise<void> {
        const id = `apps.${appId}.${name}`;
        if (this.angelegt.has(id)) {
            return;
        }
        const kanal = name.includes('.') ? name.slice(0, name.indexOf('.')) : undefined;
        if (kanal) {
            await this.adapter.setObjectNotExistsAsync(`apps.${appId}.${kanal}`, {
                type: 'channel',
                common: { name: KANAELE[kanal] },
                native: {},
            });
        }
        await this.adapter.setObjectNotExistsAsync(id, { type: 'state', common: DATENPUNKTE[name], native: {} });
        this.angelegt.add(id);
    }
}

// Laden des Katalogs, Abo und Setzen
export class IoBrokerQuelle implements Katalogquelle, Zustandsquelle {
    public constructor(private readonly adapter: ioBroker.Adapter) {}

    public async objekte(typ: ioBroker.ObjectType, praefix: string): Promise<ioBroker.Object[]> {
        const ansicht = await this.adapter.getObjectViewAsync('system', typ, {
            startkey: praefix,
            endkey: `${praefix}香`,
        });
        // Die Ansicht config liefert als Zeilen-ID common.name, daher die ID aus dem Objekt.
        return ansicht.rows.map(r => r.value).filter(o => typeof o?._id === 'string');
    }

    public abonniere(ids: string[]): Promise<void> {
        return this.adapter.subscribeForeignStatesAsync(ids);
    }

    public kuendige(ids: string[]): Promise<void> {
        return this.adapter.unsubscribeForeignStatesAsync(ids);
    }

    public async lies(ids: string[]): Promise<Record<string, ioBroker.State | null | undefined>> {
        return ids.length > 0 ? await this.adapter.getForeignStatesAsync(ids) : {};
    }

    public async objekt(id: string): Promise<ioBroker.StateCommon | undefined> {
        const objekt = await this.adapter.getForeignObjectAsync(id);
        return objekt?.type === 'state' ? objekt.common : undefined;
    }

    public async schreibe(id: string, val: Wert, kommentar: string): Promise<void> {
        await this.adapter.setForeignStateAsync(id, { val, ack: false, c: kommentar });
    }
}
