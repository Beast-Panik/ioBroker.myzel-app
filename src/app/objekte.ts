import gemeinsam from '../../protokoll/v1/gemeinsam.schema.json';
import type { Geraet } from '../basis/anmeldung';
import { erstellePruefer } from '../basis/schema';
import type { Katalogquelle } from './katalog';
import type { Zeile } from './konfiguration';
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
    benachrichtigung: { de: 'Benachrichtigung', en: 'Notification' },
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
    'benachrichtigung.app': text('App', 'App'),
    'benachrichtigung.paket': text('Paketname', 'Package name'),
    'benachrichtigung.titel': text('Titel', 'Title'),
    'benachrichtigung.text': text('Text', 'Text'),
    'benachrichtigung.zeit': { name: { de: 'Zeit', en: 'Time' }, type: 'number', role: 'date', ...nurLesen },
    'benachrichtigung.json': { ...text('Alles als JSON', 'All as JSON'), role: 'json' },
    'hinweis.senden': { ...text('Hinweis senden', 'Send notice'), write: true },
    'hinweis.status': text('Hinweisstatus', 'Notice state'),
} satisfies Record<string, ioBroker.StateCommon>;

export type Datenpunktname = keyof typeof DATENPUNKTE;
export type Appwerte = Partial<Record<Datenpunktname, ioBroker.StateValue>>;

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

// Apps als eigene Objekte, nicht in den Instanzeinstellungen: Änderungen daran starten die Instanz nicht neu.
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

    // Frisch gelesen, damit nichts verloren geht, was inzwischen in den Einstellungen steht
    public async ergaenzeEinstellungen(karten: Zeile[], profile: Zeile[]): Promise<void> {
        const objekt = await this.adapter.getForeignObjectAsync(`system.adapter.${this.adapter.namespace}`);
        const native = (objekt?.native ?? {}) as { karten?: unknown; profile?: unknown };
        const bisher = (w: unknown): unknown[] => (Array.isArray(w) ? w : []);
        await this.adapter.updateConfig({
            karten: [...bisher(native.karten), ...karten],
            profile: [...bisher(native.profile), ...profile],
        });
    }

    // Frisch gelesen: Geordnet wird, was gerade gespeichert ist. true, wenn sich die Reihenfolge geändert hat.
    public async ordneKarten(ordnung: (karten: unknown) => unknown[] | undefined): Promise<boolean> {
        const objekt = await this.adapter.getForeignObjectAsync(`system.adapter.${this.adapter.namespace}`);
        const karten = ordnung((objekt?.native as { karten?: unknown } | undefined)?.karten);
        if (!karten) {
            return false;
        }
        await this.adapter.updateConfig({ karten });
        return true;
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
