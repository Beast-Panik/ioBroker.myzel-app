// ioBroker im Speicher für Tests: Apps, Profile, Karten, Räume, Datenpunkte und Zustände.
import type { Protokoll } from '../src/basis/grenzen';
import { Katalog, type Katalogquelle } from '../src/app/katalog';
import {
    type AppDaten,
    type Appablage,
    type Appwerte,
    type Benachrichtigungswerte,
    type Datenpunktname,
    type Hinweisstand,
    LETZTE,
    type Ordner,
} from '../src/app/objekte';
import type { Karte, Profil } from '../src/app/rechte';
import type { Umstellungsablage } from '../src/app/umstellung';
import type { Wert, Zustandsquelle } from '../src/app/werte';

export const NAMESPACE = 'myzel-app.0';
const still: Protokoll = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
};

export class Speicherablage implements Appablage, Umstellungsablage {
    public readonly apps = new Map<string, AppDaten>();
    public readonly werte_ = new Map<string, Appwerte>();
    public readonly zustaende_ = new Map<string, ioBroker.State>();
    public readonly hinweise_ = new Map<string, Hinweisstand>();
    // Je App die Ordner unter benachrichtigungen mit ihrem Namen, letzte eingeschlossen
    public readonly ordner_ = new Map<string, Map<string, string>>();
    // Reihenfolge der Schreibvorgänge mit ts, je Eintrag "<appId>.<name>=<wert>@<ts>"
    public readonly geschrieben: string[] = [];
    // Für Tests, die ein Scheitern der Datenbank brauchen
    public scheitern = false;
    // Ob die Umstellung Karten und Profile der Instanzeinstellungen geleert hat
    public geleert = false;
    // Was die Ablage unter karten und profile geschrieben hat, je mit native. Gelesen wird mit quelle aus deren
    // Objekten, damit auch zählt, was ein Test dort anlegt.
    public readonly eintraege_: Record<Ordner, Map<string, Record<string, unknown>>> = {
        karten: new Map(),
        profile: new Map(),
    };

    // Mit quelle wie in ioBroker: Änderungen an Apps und Profilen kommen als objectChange beim Katalog an.
    public constructor(private readonly quelle?: Speicherquelle) {}

    public lies(appId: string): Promise<AppDaten | undefined> {
        const daten = this.apps.get(appId);
        return Promise.resolve(daten && structuredClone(daten));
    }
    public alle(): Promise<string[]> {
        return Promise.resolve([...this.apps.keys()]);
    }
    public lege(appId: string, daten: AppDaten): Promise<void> {
        this.apps.set(appId, structuredClone(daten));
        this.quelle?.app(appId, daten);
        return Promise.resolve();
    }
    public aendere(appId: string, daten: Partial<AppDaten>): Promise<void> {
        if (this.scheitern) {
            return Promise.reject(new Error('Datenbank weg'));
        }
        this.apps.set(appId, { ...this.apps.get(appId)!, ...daten });
        this.quelle?.app(appId, this.apps.get(appId));
        return daten.profil === undefined ? Promise.resolve() : this.schreibe(appId, { profil: daten.profil });
    }
    public entferne(appId: string): Promise<void> {
        this.apps.delete(appId);
        this.hinweise_.delete(appId);
        this.quelle?.app(appId, undefined);
        return Promise.resolve();
    }
    public leereEinstellungen(): Promise<void> {
        this.geleert = true;
        return Promise.resolve();
    }
    public liesEintrag(ordner: Ordner, id: string): Promise<Record<string, unknown> | undefined> {
        return Promise.resolve(this.eintrag_(ordner, id));
    }
    public schreibeEintrag(ordner: Ordner, id: string, name: string, native: object): Promise<void> {
        if (this.scheitern) {
            return Promise.reject(new Error('Datenbank weg'));
        }
        this.eintraege_[ordner].set(id, structuredClone(native) as Record<string, unknown>);
        this.quelle?.eintrag(ordner, id, name, native);
        return Promise.resolve();
    }
    public loescheEintrag(ordner: Ordner, id: string): Promise<void> {
        this.eintraege_[ordner].delete(id);
        this.quelle?.eintrag(ordner, id, '', null);
        return Promise.resolve();
    }
    public legeKarte_(id: string, karte: Karte): Promise<void> {
        return this.schreibeEintrag('karten', id, karte.name, karte);
    }
    public legeProfil_(id: string, profil: Profil): Promise<void> {
        return this.schreibeEintrag('profile', id, profil.name, profil);
    }
    // Wie liesEintrag, für Erwartungen in Tests
    public karte_(id: string): Karte | undefined {
        return this.eintrag_('karten', id) as Karte | undefined;
    }
    public profil_(id: string): Profil | undefined {
        return this.eintrag_('profile', id) as Profil | undefined;
    }
    private eintrag_(ordner: Ordner, id: string): Record<string, unknown> | undefined {
        if (!this.quelle) {
            return structuredClone(this.eintraege_[ordner].get(id));
        }
        const objekt = this.quelle.get(`${NAMESPACE}.${ordner}.${id}`);
        return objekt?.type === 'config' ? structuredClone(objekt.native) : undefined;
    }
    public loescheObjekt(id: string): Promise<void> {
        this.quelle?.objekt_(`${NAMESPACE}.${id}`, null);
        return Promise.resolve();
    }
    public schreibe(appId: string, werte: Appwerte, ts?: number): Promise<void> {
        if (this.scheitern) {
            return Promise.reject(new Error('Datenbank weg'));
        }
        this.werte_.set(appId, { ...this.werte_.get(appId), ...werte });
        for (const [name, val] of Object.entries(werte)) {
            this.geschrieben.push(`${appId}.${name}=${String(val)}@${ts ?? 'jetzt'}`);
            const zeit = ts ?? Date.now();
            this.zustaende_.set(`${appId}.${name}`, { val, ack: true, ts: zeit, lc: zeit, from: 'myzel-app.0' });
        }
        return Promise.resolve();
    }
    public zustand(appId: string, name: Datenpunktname): Promise<ioBroker.State | undefined> {
        return Promise.resolve(this.zustaende_.get(`${appId}.${name}`));
    }
    public richteEin(): Promise<void> {
        return Promise.resolve();
    }
    public benachrichtigungsordner(appId: string): Promise<string[]> {
        return Promise.resolve([...(this.ordner_.get(appId)?.keys() ?? [])].filter(o => o !== LETZTE));
    }
    public legeBenachrichtigungsordner(appId: string, ordner: string, name: string): Promise<void> {
        if (this.scheitern) {
            return Promise.reject(new Error('Datenbank weg'));
        }
        this.ordnerVon(appId).set(ordner, name);
        return Promise.resolve();
    }
    public entferneBenachrichtigungsordner(appId: string, ordner: string): Promise<void> {
        this.ordnerVon(appId).delete(ordner);
        for (const id of [...this.zustaende_.keys()]) {
            if (id.startsWith(`${appId}.benachrichtigungen.${ordner}.`)) {
                this.zustaende_.delete(id);
            }
        }
        return Promise.resolve();
    }
    public schreibeBenachrichtigung(
        appId: string,
        ordner: string,
        name: string,
        werte: Benachrichtigungswerte,
        ts: number,
    ): Promise<void> {
        if (this.scheitern) {
            return Promise.reject(new Error('Datenbank weg'));
        }
        const da = this.ordnerVon(appId);
        if (!da.has(ordner)) {
            da.set(ordner, ordner === LETZTE ? 'Letzte Benachrichtigung' : name);
        }
        for (const [n, val] of Object.entries(werte)) {
            const id = `${appId}.benachrichtigungen.${ordner}.${n}`;
            this.geschrieben.push(`${id}=${String(val)}@${ts}`);
            this.zustaende_.set(id, { val, ack: true, ts, lc: ts, from: 'myzel-app.0' });
        }
        return Promise.resolve();
    }
    private ordnerVon(appId: string): Map<string, string> {
        const da = this.ordner_.get(appId) ?? new Map<string, string>();
        this.ordner_.set(appId, da);
        return da;
    }
    public hinweise(appId: string): Promise<Hinweisstand> {
        const stand = this.hinweise_.get(appId) ?? { warteschlange: [], letzter: '', bearbeitet: 0, pruefsumme: '' };
        return Promise.resolve(structuredClone(stand));
    }
    public legeHinweise(appId: string, stand: Hinweisstand): Promise<void> {
        this.hinweise_.set(appId, structuredClone(stand));
        return Promise.resolve();
    }

    // Wie ein Skript, das ohne ack schreibt; den stateChange löst der Test aus.
    public skript(appId: string, name: Datenpunktname, val: ioBroker.StateValue, ts = Date.now()): ioBroker.State {
        const state: ioBroker.State = { val, ack: false, ts, lc: ts, from: 'system.adapter.javascript.0' };
        this.zustaende_.set(`${appId}.${name}`, state);
        return state;
    }
}

// Objekte gehen wie objectChange in ioBroker an den echten Katalog und stehen ihm zum Neuladen bereit.
export class Speicherquelle implements Zustandsquelle, Katalogquelle {
    public readonly katalog: Katalog;
    private readonly alle = new Map<string, ioBroker.Object>();
    public readonly commons = new Map<string, ioBroker.StateCommon>();
    public readonly zustaende_ = new Map<string, ioBroker.State>();
    public readonly abonniert = new Set<string>();
    public readonly aufrufe: string[] = [];
    // Wie stateChange in ioBroker, nur für abonnierte IDs
    public beiAenderung: (id: string, state: ioBroker.State | null) => void = () => undefined;

    public constructor(log: Protokoll = still) {
        this.katalog = new Katalog(NAMESPACE, log, this);
    }

    public datenpunkt(id: string, common: Partial<ioBroker.StateCommon>, val?: ioBroker.StateValue): this {
        const voll: ioBroker.StateCommon = {
            name: id,
            type: 'mixed',
            role: 'state',
            read: true,
            write: true,
            ...common,
        };
        this.commons.set(id, voll);
        this.objekt_(id, { type: 'state', common: voll });
        if (val !== undefined) {
            this.zustaende_.set(id, { val, ack: true, ts: 1793720000000, lc: 1793720000000, from: 'test' });
        }
        return this;
    }

    public entferne(id: string): this {
        this.commons.delete(id);
        this.objekt_(id, null);
        return this;
    }

    public raum(id: string, name: ioBroker.StringOrTranslated, mitglieder: string[]): this {
        return this.objekt_(`enum.rooms.${id}`, { type: 'enum', common: { name, members: mitglieder } });
    }

    // Wie ein Profil- oder Kartenobjekt, das jemand anlegt, ändert oder löscht
    public profil(profilId: string, profil: Profil | null): this {
        return this.eintrag('profile', profilId, profil?.name ?? '', profil);
    }
    public karte(kartenId: string, karte: Karte | null): this {
        return this.eintrag('karten', kartenId, karte?.name ?? '', karte);
    }
    public eintrag(ordner: Ordner, id: string, name: string, native: object | null): this {
        return this.objekt_(
            `${NAMESPACE}.${ordner}.${id}`,
            native && { type: 'config', common: { name }, native: structuredClone(native) },
        );
    }

    // Objekte, wie sie ein früherer Stand des Adapters hinterließ (Umstellung)
    public alt(id: string, native: Record<string, unknown>): this {
        return this.objekt_(`${NAMESPACE}.${id}`, { type: 'config', common: {}, native });
    }

    public get(id: string): ioBroker.Object | undefined {
        return this.alle.get(id);
    }

    // Nach einer Änderung in der Speicherablage
    public app(appId: string, daten: AppDaten | undefined): this {
        return this.objekt_(`${NAMESPACE}.apps.${appId}`, daten ? { type: 'device', common: {}, native: daten } : null);
    }

    public objekt_(id: string, teil: Record<string, unknown> | null): this {
        const objekt = teil && ({ _id: id, native: {}, ...teil } as unknown as ioBroker.Object);
        if (objekt) {
            this.alle.set(id, objekt);
        } else {
            this.alle.delete(id);
        }
        this.katalog.geaendert(id, objekt);
        return this;
    }

    public objekte(typ: ioBroker.ObjectType, praefix: string): Promise<ioBroker.Object[]> {
        return Promise.resolve([...this.alle.values()].filter(o => o.type === typ && o._id.startsWith(praefix)));
    }

    public extern(id: string, val: ioBroker.StateValue, ack = true, ts = Date.now()): void {
        const state: ioBroker.State = { val, ack, ts, lc: ts, from: 'test' };
        this.zustaende_.set(id, state);
        if (this.abonniert.has(id)) {
            this.beiAenderung(id, state);
        }
    }

    public abonniere(ids: string[]): Promise<void> {
        this.aufrufe.push(`abonniere ${ids.join(',')}`);
        ids.forEach(id => this.abonniert.add(id));
        return Promise.resolve();
    }
    public kuendige(ids: string[]): Promise<void> {
        this.aufrufe.push(`kuendige ${ids.join(',')}`);
        ids.forEach(id => this.abonniert.delete(id));
        return Promise.resolve();
    }
    public lies(ids: string[]): Promise<Record<string, ioBroker.State | null>> {
        return Promise.resolve(Object.fromEntries(ids.map(id => [id, this.zustaende_.get(id) ?? null])));
    }
    public objekt(id: string): Promise<ioBroker.StateCommon | undefined> {
        return Promise.resolve(this.commons.get(id));
    }
    public schreibe(id: string, val: Wert, kommentar: string): Promise<void> {
        const ts = Date.now();
        const state: ioBroker.State = { val, ack: false, ts, lc: ts, from: 'system.adapter.myzel-app.0', c: kommentar };
        this.zustaende_.set(id, state);
        if (this.abonniert.has(id)) {
            this.beiAenderung(id, state);
        }
        return Promise.resolve();
    }
}
