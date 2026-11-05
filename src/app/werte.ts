import type { Protokoll } from '../basis/grenzen';
import type { Fehlercode, Verbindung } from '../basis/kern';
import type { Rechtestand } from './rechte';

const SAMMELN_MS = 100;
const TEXT_HOECHSTENS = 65536;

export type Wert = string | number | boolean | null;

export interface Zustand {
    val: Wert;
    ack: boolean;
    ts: number;
}

// Eigene Schnittstelle, damit Abo und Setzen ohne ioBroker testbar sind.
export interface Zustandsquelle {
    abonniere(ids: string[]): Promise<void>;
    kuendige(ids: string[]): Promise<void>;
    lies(ids: string[]): Promise<Record<string, ioBroker.State | null | undefined>>;
    objekt(id: string): Promise<ioBroker.StateCommon | undefined>;
    schreibe(id: string, val: Wert, kommentar: string): Promise<void>;
}

// Werte, die das Schema nicht zulässt, werden null statt gekürzt: Ein gekürztes JSON wäre falsch, nicht nur kurz.
export function alsWert(val: unknown): Wert {
    if (typeof val === 'boolean' || val === null) {
        return val;
    }
    if (typeof val === 'number') {
        return Number.isFinite(val) ? val : null;
    }
    const text = typeof val === 'string' ? val : val === undefined ? undefined : JSON.stringify(val);
    return text !== undefined && text.length <= TEXT_HOECHSTENS ? text : null;
}

export function alsZustand(state: ioBroker.State | null | undefined): Zustand | null {
    if (!state) {
        return null;
    }
    return {
        val: alsWert(state.val),
        ack: state.ack === true,
        ts: Number.isFinite(state.ts) && state.ts > 0 ? Math.round(state.ts) : 0,
    };
}

const JSON_TYPEN = new Set(['json', 'array', 'object']);

export function pruefeSetzen(common: ioBroker.StateCommon, val: Wert): { code: Fehlercode; grund: string } | undefined {
    if (common.write === false) {
        return { code: 'rechte', grund: 'Datenpunkt ist nicht beschreibbar' };
    }
    const typ: string = common.type ?? 'mixed';
    if (typ === 'mixed') {
        return undefined;
    }
    if (typ === 'file') {
        return { code: 'ungueltig', grund: 'Datenpunkte vom Typ file werden nicht gesetzt' };
    }
    const erwartet = JSON_TYPEN.has(typ) ? 'string' : typ;
    if (typeof val !== erwartet || val === null) {
        return { code: 'ungueltig', grund: `Typ ${typ} erwartet` };
    }
    if (typeof val === 'number') {
        if (
            (typeof common.min === 'number' && val < common.min) ||
            (typeof common.max === 'number' && val > common.max)
        ) {
            return { code: 'ungueltig', grund: 'Zahl außerhalb von min und max' };
        }
    }
    if (JSON_TYPEN.has(typ)) {
        try {
            JSON.parse(val as string);
        } catch {
            return { code: 'ungueltig', grund: `Typ ${typ} erwartet gültiges JSON` };
        }
    }
    return undefined;
}

// 2000 IDs mit langen Texten ergäben über 100 MiB in einer Nachricht; jede ID steht in genau einem Teil.
export function inTeilen(werte: [string, Zustand | null][], hoechstens: number): Record<string, Zustand | null>[] {
    const teile: [string, Zustand | null][][] = [];
    let teil: [string, Zustand | null][] = [];
    let groesse = 0;
    for (const eintrag of werte) {
        const g = Buffer.byteLength(JSON.stringify(eintrag));
        if (teil.length > 0 && groesse + g > hoechstens) {
            teile.push(teil);
            teil = [];
            groesse = 0;
        }
        teil.push(eintrag);
        groesse += g;
    }
    if (teil.length > 0 || teile.length === 0) {
        teile.push(teil);
    }
    return teile.map(t => Object.fromEntries(t));
}

export interface Empfaenger {
    geaendert(id: string, state: ioBroker.State | null | undefined): void;
}

// Zählt Abos über alle Sitzungen, damit jede ID in ioBroker nur einmal abonniert und erst mit dem letzten Abo gekündigt wird.
export class Abostelle {
    private readonly empfaenger = new Map<string, Set<Empfaenger>>();

    public constructor(private readonly quelle: Zustandsquelle) {}

    public async ersetze(e: Empfaenger, alt: ReadonlySet<string>, neu: ReadonlySet<string>): Promise<void> {
        const abonnieren: string[] = [];
        const kuendigen: string[] = [];
        for (const id of neu) {
            if (alt.has(id)) {
                continue;
            }
            const liste = this.empfaenger.get(id) ?? new Set();
            if (liste.size === 0) {
                abonnieren.push(id);
            }
            this.empfaenger.set(id, liste.add(e));
        }
        for (const id of alt) {
            const liste = this.empfaenger.get(id);
            if (neu.has(id) || !liste?.delete(e) || liste.size > 0) {
                continue;
            }
            this.empfaenger.delete(id);
            kuendigen.push(id);
        }
        if (abonnieren.length > 0) {
            await this.quelle.abonniere(abonnieren);
        }
        if (kuendigen.length > 0) {
            await this.quelle.kuendige(kuendigen);
        }
    }

    public geaendert(id: string, state: ioBroker.State | null | undefined): void {
        for (const e of this.empfaenger.get(id) ?? []) {
            e.geaendert(id, state);
        }
    }

    public get abonniert(): number {
        return this.empfaenger.size;
    }
}

export interface WerteversandOptionen {
    appId: string;
    verbindung: Verbindung;
    stelle: Abostelle;
    quelle: Zustandsquelle;
    rechte: Rechtestand;
    log: Protokoll;
    // Kleiner als der Sendepuffer, sonst trennt schon ein einzelner Teil
    teilBytes: number;
}

/** Rechte, Abo, gesammelte Änderungen und Setzen für eine Sitzung (Abschnitt 5.4 des Detailentwurfs). */
export class Werteversand implements Empfaenger {
    private rechte_: Rechtestand;
    private ids: ReadonlySet<string> = new Set();
    private readonly offen = new Map<string, Zustand | null>();
    private sammeln?: NodeJS.Timeout;
    private reihe: Promise<void> = Promise.resolve();
    private wartendesAbo?: { ids: string[]; fertig: Promise<void> };
    private beendet = false;

    public constructor(private readonly o: WerteversandOptionen) {
        this.rechte_ = o.rechte;
    }

    public get rechte(): Rechtestand {
        return this.rechte_;
    }

    // Ein wartendes Abo wird ersetzt, nicht eingereiht: Jedes Abo ersetzt das vorige ganz, so bleibt die Reihe kurz.
    public abo(ids: string[]): Promise<void> {
        if (this.wartendesAbo) {
            this.wartendesAbo.ids = ids;
            return this.wartendesAbo.fertig;
        }
        const abo = { ids, fertig: Promise.resolve() };
        abo.fertig = this.nacheinander(() => {
            this.wartendesAbo = undefined;
            return this.ersetzeAbo(abo.ids);
        });
        this.wartendesAbo = abo;
        return abo.fertig;
    }

    // Wirkt sofort auf Setzen und Versand; das Abo verliert die IDs ohne Recht danach.
    public neueRechte(rechte: Rechtestand): Promise<void> {
        this.rechte_ = rechte;
        return this.nacheinander(async () => {
            if (!this.beendet) {
                await this.ersetze(new Set([...this.ids].filter(id => this.erlaubt(id))));
            }
        });
    }

    public async setze(n: number, id: string, val: Wert): Promise<void> {
        const v = this.o.verbindung;
        const ablehnen = (fehler: Fehlercode, grund: string): void => {
            this.o.log.debug(`App ${this.o.appId}: setze ${id} abgelehnt, ${grund}`);
            v.sende({ t: 'quittung', n, ok: false, fehler });
        };
        if (this.rechte_.recht(id) !== 'schreiben') {
            ablehnen('rechte', 'kein Recht schreiben');
            return;
        }
        try {
            const common = await this.o.quelle.objekt(id);
            if (!common) {
                ablehnen('rechte', 'Datenpunkt gibt es nicht mehr');
                return;
            }
            // Die Rechte können sich während des Lesens geändert haben.
            if (this.rechte_.recht(id) !== 'schreiben') {
                ablehnen('rechte', 'kein Recht schreiben');
                return;
            }
            const fehler = pruefeSetzen(common, val);
            if (fehler) {
                ablehnen(fehler.code, fehler.grund);
                return;
            }
            await this.o.quelle.schreibe(id, val, `App ${this.o.appId}`);
        } catch {
            // Ohne Fehlertext: Er könnte den Wert enthalten, und Werte aus setze gehören nie ins Log.
            this.o.log.warn(`App ${this.o.appId}: setze ${id} fehlgeschlagen`);
            v.sende({ t: 'quittung', n, ok: false, fehler: 'intern' });
            return;
        }
        v.sende({ t: 'quittung', n, ok: true });
    }

    public geaendert(id: string, state: ioBroker.State | null | undefined): void {
        if (this.beendet || !this.erlaubt(id)) {
            return;
        }
        // Die zuletzt gemeldete Änderung gilt, ohne Vergleich der Zeitstempel: ioBroker meldet in Reihenfolge, ts dagegen
        // darf der Schreiber setzen, etwa ein Geräteadapter mit der Zeit seines Gateways. Eine Bestätigung mit älterem ts
        // fiele sonst weg, und die App zeigte bis zur nächsten Änderung den falschen Stand.
        this.offen.set(id, alsZustand(state));
        // In der Reihe mit dem Abo: Sonst überholte eine Änderung die werte, deren Lesen vorher begonnen hat.
        this.sammeln ??= setTimeout(() => {
            this.nacheinander(() => this.versende()).catch((fehler: Error) =>
                this.o.log.error(`App ${this.o.appId}, aenderung: ${fehler.message}`),
            );
        }, SAMMELN_MS);
    }

    public async beende(): Promise<void> {
        this.beendet = true;
        clearTimeout(this.sammeln);
        await this.nacheinander(() => this.ersetze(new Set()));
    }

    private erlaubt(id: string): boolean {
        return this.ids.has(id) && this.rechte_.recht(id) !== undefined;
    }

    // Nacheinander, sonst überholt ein späterer Schritt den früheren beim Zählen in der Abostelle.
    private nacheinander(schritt: () => Promise<void>): Promise<void> {
        this.reihe = this.reihe.catch(() => undefined).then(schritt);
        return this.reihe;
    }

    // Eigener Stand vor der Abostelle: Scheitert das Abonnieren in ioBroker, zählt die Abostelle trotzdem schon um,
    // und beide müssen beim nächsten Mal vom selben Stand ausgehen.
    private async ersetze(neu: ReadonlySet<string>): Promise<void> {
        const alt = this.ids;
        this.ids = neu;
        for (const id of this.offen.keys()) {
            if (!neu.has(id)) {
                this.offen.delete(id);
            }
        }
        await this.o.stelle.ersetze(this, alt, neu);
    }

    private async ersetzeAbo(ids: string[]): Promise<void> {
        if (this.beendet) {
            return;
        }
        const ohneRecht = ids.filter(id => !this.rechte_.recht(id));
        if (ohneRecht.length > 0) {
            this.o.verbindung.sendeFehler('rechte', {
                text: `${ohneRecht.length} IDs ohne Recht, nicht abonniert: ${ohneRecht.join(', ')}`,
            });
        }
        const neu = new Set(ids.filter(id => this.rechte_.recht(id)));
        await this.ersetze(neu);
        // Erst abonnieren, dann lesen: Eine Änderung dazwischen kommt so als aenderung nach, statt verloren zu gehen. Sie
        // bleibt auch, wenn sie älter sein könnte als das Gelesene; dann folgt die neuere ebenfalls als aenderung.
        const states = await this.o.quelle.lies([...neu]);
        // Die Rechte können sich während des Lesens geändert haben.
        const werte = [...neu]
            .filter(i => this.erlaubt(i))
            .map((id): [string, Zustand | null] => [id, alsZustand(states[id])]);
        await this.sendeInTeilen('werte', werte);
    }

    private async versende(): Promise<void> {
        this.sammeln = undefined;
        const werte = [...this.offen].filter(([id]) => this.erlaubt(id));
        this.offen.clear();
        if (werte.length === 0 || this.beendet) {
            return;
        }
        await this.sendeInTeilen('aenderung', werte);
    }

    private async sendeInTeilen(t: 'werte' | 'aenderung', werte: [string, Zustand | null][]): Promise<void> {
        for (const teil of inTeilen(werte, this.o.teilBytes)) {
            await this.o.verbindung.sendeUndWarte({ t, werte: teil });
        }
    }
}
