import type { AdapterInstance } from '@iobroker/adapter-core';
import {
    type ActionContext,
    type ConfigItemAny,
    type DeviceInfo,
    type DeviceLoadContext,
    DeviceManagement,
    type DeviceRefreshResponse,
    type InstanceDetails,
    type InstanceRefreshResponse,
    type JsonFormSchema,
} from '@iobroker/dm-utils';
import type { Dienst } from '../app/dienst';
import type { Katalog } from '../app/katalog';
import type { AppDaten, Appablage, Handydaten } from '../app/objekte';
import { type Profil, berechneRechte } from '../app/rechte';
import { GRENZEN, type Protokoll } from '../basis/grenzen';
import { type Kopplung, type Kopplungsanfrage, qrInhalt } from '../basis/kopplung';

type Text = ioBroker.Translated;

/** Was der Gerätemanager vom laufenden Adapter braucht; fehlt, solange der Server nicht läuft. */
export interface Betrieb {
    adapterId: string;
    fingerabdruck: string;
    adressen: () => string[];
    kopplung: Kopplung;
    dienst: Dienst;
    katalog: Katalog;
    ablage: Appablage;
    // Admin-Instanzen, die ohne Anmeldung laufen
    adminOhneAnmeldung: () => Promise<string[]>;
}

export interface VerwaltungOptionen {
    namespace: string;
    log: Protokoll;
    betrieb: () => Betrieb | undefined;
    warteMs?: number;
}

const T = {
    koppeln: { en: 'Pair app', de: 'App koppeln' },
    profilWaehlen: { en: 'Choose profile', de: 'Profil wählen' },
    handydaten: { en: 'Phone data', de: 'Handydaten' },
    entfernen: { en: 'Remove', de: 'Entfernen' },
    profil: { en: 'Profile', de: 'Profil' },
    keinProfil: { en: 'No profile (sees nothing)', de: 'Kein Profil (sieht nichts)' },
    weiter: { en: 'Next', de: 'Weiter' },
    scannen: {
        en: `Scan the QR code with the app, then press Next. The code is valid for ${GRENZEN.einmalMs / 60_000} minutes and once only.`,
        de: `Den QR-Code mit der App scannen, dann auf Weiter drücken. Der Code gilt ${GRENZEN.einmalMs / 60_000} Minuten und nur einmal.`,
    },
    warte: { en: 'Waiting for the app', de: 'Warte auf die App' },
    akku: { en: 'Battery', de: 'Akku' },
    anruf: { en: 'Calls', de: 'Anrufe' },
    benachrichtigung: { en: 'Notifications', de: 'Benachrichtigungen' },
    handydatenHinweis: {
        en: 'Each data type must also be switched on in the app. Switched off types are rejected and not written.',
        de: 'Jede Datenart muss auch in der App eingeschaltet sein. Was hier aus ist, lehnt der Adapter ab und schreibt nichts.',
    },
    persoenlich: {
        en: 'Calls and notifications contain personal data: phone numbers, contact names, message texts. Every adapter and script can read them. A history adapter on these data points stores them permanently.',
        de: 'Anrufe und Benachrichtigungen enthalten persönliche Daten: Rufnummern, Kontaktnamen, Nachrichtentexte. Jeder Adapter und jedes Skript kann sie lesen. Ein History-Adapter auf diesen Datenpunkten speichert sie dauerhaft.',
    },
    laeuftNicht: {
        en: 'The adapter is not running. The cause is in the log.',
        de: 'Der Adapter läuft nicht. Die Ursache steht im Log.',
    },
    fehler: {
        en: 'That did not work. The cause is in the log.',
        de: 'Das hat nicht geklappt. Die Ursache steht im Log.',
    },
    keineAdresse: {
        en: 'No address of the adapter is known. Please enter it in the settings.',
        de: 'Keine Adresse des Adapters bekannt. Bitte in den Einstellungen eintragen.',
    },
    abgelaufen: {
        en: 'No app has responded. The QR code is no longer valid.',
        de: 'Keine App hat sich gemeldet. Der QR-Code gilt nicht mehr.',
    },
    getrennt: {
        en: 'The app has disconnected. Please pair again.',
        de: 'Die App hat die Verbindung getrennt. Bitte neu koppeln.',
    },
    appWeg: { en: 'This app no longer exists.', de: 'Diese App gibt es nicht mehr.' },
} satisfies Record<string, Text>;

const vorschau = (n: number, m: number): Text => ({
    en: `sees ${n} card${n === 1 ? '' : 's'}, ${m} of them operable`,
    de: `sieht ${n} ${n === 1 ? 'Karte' : 'Karten'}, ${m} davon bedienbar`,
});
const mitName = (name: string, t: Text): Text => ({ en: `${name}: ${t.en}`, de: `${name}: ${t.de}` });

const HANDY = `data:image/svg+xml;base64,${Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="2" width="12" height="20" rx="2"/><path d="M10 18h4"/></svg>',
).toString('base64')}`;

// Konzept 5: Wer den Admin bedienen kann, kann koppeln. Ohne Anmeldung also jeder, der ihn im Netz erreicht.
export const adminOffen = (instanzen: string[]): { en: string; de: string } => ({
    en: `Caution: ${instanzen.join(', ')} runs without login. Anyone who can reach the admin can pair apps and change cards and profiles.`,
    de: `Achtung: ${instanzen.join(', ')} läuft ohne Anmeldung. Wer den Admin erreicht, kann Apps koppeln sowie Karten und Profile ändern.`,
});

const KEINE: InstanceRefreshResponse = { refresh: false };
const GERAETE: DeviceRefreshResponse<string> = { refresh: 'devices' };

const eintrag = (wert: unknown): string => (typeof wert === 'string' ? wert.trim() : '');

const panel = (items: Record<string, ConfigItemAny>): JsonFormSchema => ({ type: 'panel', items });

/**
 * Abläufe des Gerätemanagers, ohne ioBroker testbar (Abschnitt 10.2 des Detailentwurfs). Er zeigt nur die Apps; Karten
 * und Profile haben eigene Reiter in den Instanzeinstellungen (KONZEPT-KARTEN.md, Abschnitt 3).
 */
export class Verwaltung {
    private readonly warteMs: number;

    public constructor(private readonly o: VerwaltungOptionen) {
        this.warteMs = o.warteMs ?? GRENZEN.kopplungWartenMs;
    }

    public async geraete(): Promise<DeviceInfo<string>[]> {
        const b = this.o.betrieb();
        if (!b) {
            return [];
        }
        const liste: DeviceInfo<string>[] = [];
        for (const appId of await b.ablage.alle()) {
            const daten = await b.ablage.lies(appId);
            if (daten) {
                liste.push(this.appEintrag(appId, daten));
            }
        }
        return liste;
    }

    public koppeln(ctx: ActionContext): Promise<InstanceRefreshResponse> {
        return this.sicher(ctx, 'App koppeln', KEINE, async b => {
            const adressen = b.adressen();
            if (adressen.length === 0) {
                await ctx.showMessage(T.keineAdresse);
                return KEINE;
            }
            const offen = await b.adminOhneAnmeldung().catch(() => []);
            const { geheimnis, gueltigBis } = b.kopplung.starte();
            const qr = qrInhalt({ adapterId: b.adapterId, fingerabdruck: b.fingerabdruck, geheimnis, adressen });
            const antwort = await ctx.showForm(
                panel({
                    ...(offen.length > 0 ? { offen: { type: 'staticText', text: adminOffen(offen), xs: 12 } } : {}),
                    hinweis: { type: 'staticText', text: T.scannen, xs: 12 },
                    qr: { type: 'qrCode', data: qr, size: 280, level: 'M', xs: 12 },
                    profil: this.profilauswahl(b),
                }),
                {
                    title: T.koppeln,
                    data: { profil: '' },
                    buttons: ['cancel', { type: 'apply', label: T.weiter }],
                    ignoreApplyDisabled: true,
                },
            );
            if (!antwort || Date.now() > gueltigBis) {
                b.kopplung.brichAb();
                if (antwort) {
                    await ctx.showMessage(T.abgelaufen);
                }
                return KEINE;
            }
            const profilId = this.profilId(b, antwort.profil);
            const fortschritt = await ctx.openProgress(T.warte, { indeterminate: true });
            const anfrage = await b.kopplung.warte(this.warteMs).finally(() => fortschritt.close());
            if (!anfrage) {
                b.kopplung.brichAb();
                await ctx.showMessage(T.abgelaufen);
                return KEINE;
            }
            if (!(await ctx.showConfirmation(this.koppelnFrage(b, anfrage, profilId)))) {
                b.kopplung.ablehnen(anfrage);
                return KEINE;
            }
            if (!(await b.dienst.kopplungAnnehmen(anfrage, profilId))) {
                await ctx.showMessage(T.getrennt);
                return KEINE;
            }
            return { refresh: true };
        });
    }

    public profilWaehlen(appId: string, ctx: ActionContext): Promise<DeviceRefreshResponse<string>> {
        return this.sicherFuerApp(appId, ctx, 'Profil wählen', async (b, daten) => {
            const antwort = await ctx.showForm(panel({ profil: this.profilauswahl(b) }), {
                title: mitName(daten.name, T.profilWaehlen),
                data: { profil: daten.profil },
                buttons: ['cancel', 'apply'],
            });
            if (antwort) {
                const profil = this.profilId(b, antwort.profil);
                if (profil !== daten.profil) {
                    await b.ablage.aendere(appId, { profil });
                }
            }
            return GERAETE;
        });
    }

    public handydaten(appId: string, ctx: ActionContext): Promise<DeviceRefreshResponse<string>> {
        return this.sicherFuerApp(appId, ctx, 'Handydaten', async (b, daten) => {
            const antwort = await ctx.showForm(
                panel({
                    hinweis: { type: 'staticText', text: T.handydatenHinweis, xs: 12 },
                    akku: { type: 'checkbox', label: T.akku, xs: 12, newLine: true },
                    anruf: { type: 'checkbox', label: T.anruf, xs: 12, newLine: true },
                    benachrichtigung: { type: 'checkbox', label: T.benachrichtigung, xs: 12, newLine: true },
                    persoenlich: { type: 'staticText', text: T.persoenlich, xs: 12, newLine: true },
                }),
                {
                    title: mitName(daten.name, T.handydaten),
                    data: { ...daten.handydaten },
                    buttons: ['cancel', 'apply'],
                },
            );
            if (antwort) {
                const handydaten: Handydaten = {
                    akku: antwort.akku === true,
                    anruf: antwort.anruf === true,
                    benachrichtigung: antwort.benachrichtigung === true,
                };
                if (JSON.stringify(handydaten) !== JSON.stringify(daten.handydaten)) {
                    await b.ablage.aendere(appId, { handydaten });
                }
            }
            return GERAETE;
        });
    }

    public entferne(appId: string, ctx: ActionContext): Promise<DeviceRefreshResponse<string>> {
        return this.sicherFuerApp(appId, ctx, 'Entfernen', async (b, daten) => {
            const frage = {
                en: `Remove app "${daten.name}"? Its access is deleted and an existing connection is closed. The data points of the app remain.`,
                de: `App „${daten.name}“ entfernen? Ihr Zugang wird gelöscht und eine bestehende Verbindung getrennt. Die Datenpunkte der App bleiben stehen.`,
            };
            if (await ctx.showConfirmation(frage)) {
                await b.dienst.entferne(appId);
            }
            return GERAETE;
        });
    }

    // Ohne customInfo: Der Admin übernimmt dessen Inhalt nur beim ersten Anzeigen der Karte.
    private appEintrag(appId: string, daten: AppDaten): DeviceInfo<string> {
        const praefix = `${this.o.namespace}.apps.${appId}`;
        return {
            id: appId,
            identifier: appId,
            name: daten.name,
            icon: HANDY,
            model: `Android ${daten.geraet.android}, App ${daten.geraet.appVersion}`,
            status: {
                connection: { stateId: `${praefix}.online`, mapping: { true: 'connected', false: 'disconnected' } },
                ...(daten.handydaten.akku ? { battery: { stateId: `${praefix}.akku.stand` } } : {}),
            },
            actions: [
                {
                    id: 'profil',
                    icon: 'users',
                    description: T.profilWaehlen,
                    handler: (id, ctx) => this.profilWaehlen(id, ctx),
                },
                {
                    id: 'handydaten',
                    icon: 'settings',
                    description: T.handydaten,
                    handler: (id, ctx) => this.handydaten(id, ctx),
                },
                {
                    id: 'entfernen',
                    icon: 'delete',
                    description: T.entfernen,
                    handler: (id, ctx) => this.entferne(id, ctx),
                },
            ],
        };
    }

    private zaehle(b: Betrieb, profil: Profil): { n: number; m: number } {
        const karten = berechneRechte(profil, b.katalog).inhalt.karten;
        return {
            n: karten.length,
            m: karten.filter(k => Object.values(k.teile).some(t => t.recht === 'schreiben')).length,
        };
    }

    private profilauswahl(b: Betrieb): ConfigItemAny {
        const profile = b.katalog.alleProfile().map(([id, p]) => {
            const { n, m } = this.zaehle(b, p);
            return { label: mitName(p.name, vorschau(n, m)), value: id };
        });
        return {
            type: 'select',
            label: T.profil,
            options: [{ label: T.keinProfil, value: '' }, ...profile],
            noTranslation: true,
            xs: 12,
        };
    }

    // Nur ein Profil, das es gibt; sonst keins
    private profilId(b: Betrieb, wert: unknown): string {
        const id = eintrag(wert);
        return b.katalog.profil(id) ? id : '';
    }

    // Mit Adresse und Gerät: Hat jemand anderes den QR-Code abfotografiert, fällt es hier auf, nicht erst danach.
    private koppelnFrage(b: Betrieb, anfrage: Kopplungsanfrage, profilId: string): Text {
        const { name, geraet } = anfrage;
        const profil = b.katalog.profil(profilId)?.name;
        const von = `${anfrage.verbindung.herkunft.adresse}, Android ${geraet.android}`;
        const frage: Text = profil
            ? {
                  en: `Pair app "${name}" with profile "${profil}"?`,
                  de: `App „${name}“ mit Profil „${profil}“ koppeln?`,
              }
            : {
                  en: `Pair app "${name}" without a profile? It sees nothing until a profile is chosen.`,
                  de: `App „${name}“ ohne Profil koppeln? Sie sieht nichts, bis ein Profil gewählt ist.`,
              };
        return {
            en: `${frage.en} Request from ${von}, app ${geraet.appVersion}.`,
            de: `${frage.de} Anfrage von ${von}, App ${geraet.appVersion}.`,
        };
    }

    private sicherFuerApp(
        appId: string,
        ctx: ActionContext,
        was: string,
        schritt: (b: Betrieb, daten: AppDaten) => Promise<DeviceRefreshResponse<string>>,
    ): Promise<DeviceRefreshResponse<string>> {
        return this.sicher(ctx, was, GERAETE, async b => {
            const daten = await b.ablage.lies(appId);
            if (!daten) {
                await ctx.showMessage(T.appWeg);
                return GERAETE;
            }
            return schritt(b, daten);
        });
    }

    // Ein Fehler darf den Dialog im Admin nicht offen hängen lassen: dm-utils schickt dann kein Ergebnis.
    private async sicher<E>(
        ctx: ActionContext,
        was: string,
        sonst: E,
        schritt: (b: Betrieb) => Promise<E>,
    ): Promise<E> {
        const b = this.o.betrieb();
        try {
            if (!b) {
                await ctx.showMessage(T.laeuftNicht);
                return sonst;
            }
            return await schritt(b);
        } catch (fehler) {
            this.o.log.error(`Gerätemanager, ${was}: ${(fehler as Error).message}`);
            try {
                await ctx.showMessage(T.fehler);
            } catch {
                // kein Dialog mehr möglich, das Ergebnis schließt ihn
            }
            return sonst;
        }
    }
}

/** Anbindung an dm-utils */
export class Geraete extends DeviceManagement<AdapterInstance> {
    private gebunden?: ioBroker.Logger;

    public constructor(
        adapter: AdapterInstance,
        private readonly verwaltung: Verwaltung,
    ) {
        super(adapter);
    }

    protected override getInstanceInfo(): InstanceDetails {
        return {
            apiVersion: 'v3',
            actions: [
                { id: 'koppeln', icon: 'qrcode', title: T.koppeln, handler: ctx => this.verwaltung.koppeln(ctx) },
            ],
        };
    }

    // dm-utils hängt this.log.error ungebunden an .catch: Ohne gebundene Funktionen wird jeder Fehler dort, etwa bei
    // dm:deviceInfo von einem Skript, zur unbehandelten Ablehnung, und js-controller beendet den Adapter.
    protected override get log(): ioBroker.Logger {
        if (!this.gebunden) {
            const log = this.adapter.log;
            const gebunden = Object.create(log) as ioBroker.Logger;
            for (const stufe of ['silly', 'debug', 'info', 'warn', 'error'] as const) {
                gebunden[stufe] = log[stufe].bind(log);
            }
            this.gebunden = gebunden;
        }
        return this.gebunden;
    }

    protected override async loadDevices(context: DeviceLoadContext<string>): Promise<void> {
        const geraete = await this.verwaltung.geraete();
        context.setTotalDevices(geraete.length);
        geraete.forEach(g => context.addDevice(g));
    }
}
