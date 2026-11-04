import adapterAnApp from '../../protokoll/v1/adapter-an-app.schema.json';
import gemeinsam from '../../protokoll/v1/gemeinsam.schema.json';
import type { Protokoll } from '../basis/grenzen';
import type { Verbindung } from '../basis/kern';
import { neueHinweisId, sha256 } from '../basis/kodierung';
import { erstellePruefer } from '../basis/schema';
import type { Appablage, Hinweis, Hinweisstand } from './objekte';

const WARTEND_HOECHSTENS = 20;

export type Hinweisstatus = 'wartet' | 'gesendet' | 'angezeigt' | 'abgelaufen' | 'voll' | 'ungueltig';

// Grenzen für Titel und Text stehen nur im Schema der Nachricht.
const pruefeHinweis = erstellePruefer({ $ref: `${adapterAnApp.$id}#/$defs/hinweis` }, [adapterAnApp, gemeinsam]);

// Einfacher Text oder JSON mit titel, text und wichtigkeit; ein Text, der wie JSON aussieht, aber keins ist, bleibt Text.
export function alsHinweis(val: unknown, zeit: number): Hinweis | string[] {
    if (typeof val !== 'string') {
        return ['hinweis.senden braucht Text'];
    }
    let teile: Record<string, unknown> = { text: val };
    try {
        const json: unknown = JSON.parse(val);
        if (json && typeof json === 'object' && !Array.isArray(json)) {
            teile = json as Record<string, unknown>;
        }
    } catch {
        // kein JSON, also einfacher Text
    }
    const { titel, text, wichtigkeit = 'normal', ...rest } = teile;
    if (Object.keys(rest).length > 0) {
        return [`unbekannte Felder: ${Object.keys(rest).join(', ')}`.slice(0, 200)];
    }
    const hinweis = {
        t: 'hinweis',
        id: neueHinweisId(),
        ...(titel === undefined ? {} : { titel }),
        text,
        wichtigkeit,
        zeit,
    };
    const fehler = pruefeHinweis(hinweis);
    return fehler.length > 0 ? fehler : (hinweis as Hinweis);
}

const pruefsumme = (val: unknown): string => sha256(String(val)).toString('base64url');
const bearbeitet = (stand: Hinweisstand, state: ioBroker.State): boolean =>
    state.ts < stand.bearbeitet || (state.ts === stand.bearbeitet && pruefsumme(state.val) === stand.pruefsumme);

export interface HinweiseOptionen {
    ablage: Appablage;
    log: Protokoll;
    fristMs: number;
    verbindung: (appId: string) => Verbindung | undefined;
}

/** Hinweise an die Apps: Warteschlange je App, Frist, Status (Abschnitt 6.3 des Detailentwurfs). */
export class Hinweise {
    private readonly fristen = new Map<string, NodeJS.Timeout>();
    // Nacheinander, weil jeder Schritt den Stand einer App liest und ganz zurückschreibt
    private reihe: Promise<void> = Promise.resolve();
    private beendet = false;

    public constructor(private readonly o: HinweiseOptionen) {}

    public starte(appIds: string[]): Promise<void> {
        return this.nacheinander(async () => {
            for (const appId of appIds) {
                for (const hinweis of (await this.o.ablage.hinweise(appId)).warteschlange) {
                    this.planeFrist(appId, hinweis);
                }
            }
        });
    }

    // Was Skripte geschrieben haben, während der Adapter nicht lief oder noch nicht abonniert hatte
    public async holeNach(appIds: string[]): Promise<void> {
        for (const appId of appIds) {
            const state = await this.o.ablage.zustand(appId, 'hinweis.senden');
            if (state && !state.ack) {
                this.neu(appId, state);
            }
        }
        await this.reihe;
    }

    public neu(appId: string, state: ioBroker.State): void {
        void this.nacheinander(async () => {
            const stand = await this.o.ablage.hinweise(appId);
            if (bearbeitet(stand, state)) {
                return;
            }
            stand.bearbeitet = state.ts;
            stand.pruefsumme = pruefsumme(state.val);
            const hinweis = alsHinweis(state.val, state.ts);
            if (Array.isArray(hinweis) || stand.warteschlange.length >= WARTEND_HOECHSTENS) {
                const grund = Array.isArray(hinweis) ? hinweis.join('; ') : 'Warteschlange voll';
                this.o.log.debug(`Hinweis an App ${appId} abgewiesen: ${grund}`);
                stand.letzter = '';
                await this.o.ablage.legeHinweise(appId, stand);
                await this.status(appId, Array.isArray(hinweis) ? 'ungueltig' : 'voll');
                return;
            }
            stand.warteschlange.push(hinweis);
            stand.letzter = hinweis.id;
            await this.o.ablage.legeHinweise(appId, stand);
            this.planeFrist(appId, hinweis);
            const v = this.o.verbindung(appId);
            if (v?.offen) {
                v.sende(hinweis);
            }
            await this.status(appId, v?.offen ? 'gesendet' : 'wartet');
        });
    }

    // Alle noch nicht angezeigten, auch schon einmal gesendete: Die App erkennt doppelte an der ID.
    public angemeldet(appId: string, v: Verbindung): Promise<void> {
        return this.nacheinander(async () => {
            const stand = await this.o.ablage.hinweise(appId);
            const gueltig = stand.warteschlange.filter(h => pruefeHinweis(h).length === 0);
            gueltig.forEach(h => v.sende(h));
            if (gueltig.some(h => h.id === stand.letzter)) {
                await this.status(appId, 'gesendet');
            }
        });
    }

    public angezeigt(appId: string, id: string): Promise<void> {
        return this.nacheinander(async () => {
            const stand = await this.entferne(appId, id);
            if (stand?.letzter !== id) {
                return;
            }
            await this.status(appId, 'angezeigt');
            // ack=true nur, wenn hinweis.senden noch diesen Hinweis enthält und kein Skript inzwischen einen neuen schrieb
            const senden = await this.o.ablage.zustand(appId, 'hinweis.senden');
            if (senden?.ts === stand.bearbeitet && pruefsumme(senden.val) === stand.pruefsumme) {
                await this.o.ablage.schreibe(appId, { 'hinweis.senden': senden.val }, senden.ts);
            }
        });
    }

    // Die App ist entfernt, mit ihr die Warteschlange.
    public vergiss(appId: string): void {
        for (const [schluessel, frist] of this.fristen) {
            if (schluessel.startsWith(`${appId} `)) {
                clearTimeout(frist);
                this.fristen.delete(schluessel);
            }
        }
    }

    public beende(): void {
        this.beendet = true;
        this.fristen.forEach(f => clearTimeout(f));
        this.fristen.clear();
    }

    private planeFrist(appId: string, hinweis: Hinweis): void {
        const schluessel = `${appId} ${hinweis.id}`;
        clearTimeout(this.fristen.get(schluessel));
        this.fristen.set(
            schluessel,
            setTimeout(
                () => {
                    this.fristen.delete(schluessel);
                    void this.nacheinander(async () => {
                        const stand = await this.entferne(appId, hinweis.id);
                        if (!stand) {
                            return;
                        }
                        this.o.log.warn(`Hinweis ${hinweis.id} der App ${appId} abgelaufen, nicht angezeigt`);
                        if (stand.letzter === hinweis.id) {
                            await this.status(appId, 'abgelaufen');
                        }
                    });
                },
                Math.max(0, hinweis.zeit + this.o.fristMs - Date.now()),
            ),
        );
    }

    // Stand ohne den Hinweis, oder undefined, wenn er nicht (mehr) wartet
    private async entferne(appId: string, id: string): Promise<Hinweisstand | undefined> {
        const stand = await this.o.ablage.hinweise(appId);
        const vorher = stand.warteschlange.length;
        stand.warteschlange = stand.warteschlange.filter(h => h.id !== id);
        if (stand.warteschlange.length === vorher) {
            return undefined;
        }
        clearTimeout(this.fristen.get(`${appId} ${id}`));
        this.fristen.delete(`${appId} ${id}`);
        await this.o.ablage.legeHinweise(appId, stand);
        return stand;
    }

    private status(appId: string, status: Hinweisstatus): Promise<void> {
        return this.o.ablage.schreibe(appId, { 'hinweis.status': status });
    }

    private nacheinander(schritt: () => Promise<void>): Promise<void> {
        this.reihe = this.reihe
            .then(() => (this.beendet ? undefined : schritt()))
            // Ohne Fehlertext: Lesefehler von ioBroker können den Objektinhalt und damit Hinweistexte enthalten.
            .catch(() => this.o.log.error('Hinweise: Lesen oder Schreiben in ioBroker fehlgeschlagen'));
        return this.reihe;
    }
}
