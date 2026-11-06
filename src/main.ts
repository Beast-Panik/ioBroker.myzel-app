import * as utils from '@iobroker/adapter-core';
import gemeinsam from '../protokoll/v1/gemeinsam.schema.json';
import { type Betrieb, Geraete, Verwaltung, adminOffen } from './admin/geraete';
import type { Ablehnung } from './admin/eintraege';
import { FERNBEFEHLE, type Fernbetrieb, Fernseite } from './admin/fernseite';
import { KARTENBEFEHLE, Kartenseite } from './admin/kartenseite';
import { PROFILBEFEHLE, Profilseite } from './admin/profilseite';
import { RAUMBEFEHLE, Raumseite } from './admin/raumseite';
import type { Ferneinstellung } from './app/fernzugang';
import { Katalog } from './app/katalog';
import { IoBrokerAblage, IoBrokerQuelle, appIdAus } from './app/objekte';
import { kartenmaengel } from './app/rechte';
import { stelleUm } from './app/umstellung';
import { type Server, starteServer } from './app/server';
import { neueAdapterId } from './basis/kodierung';
import { erstellePruefer } from './basis/schema';
import { type Identitaet, erzeugeIdentitaet, fingerabdruck, pruefeIdentitaet } from './basis/zertifikat';
import { pruefeEinstellungen } from './einstellungen';
import { automatischeAdressen } from './zugang/heimnetz';

const IDENTITAET = 'identitaet';
const FERNZUGANG = 'fernzugang';
const pruefeAdapterId = erstellePruefer({ $ref: `${gemeinsam.$id}#/$defs/adapterId` }, [gemeinsam]);

class MyzelApp extends utils.Adapter {
    private server?: Server;
    private katalog?: Katalog;
    private betrieb?: Betrieb;
    private seiten: [readonly string[], { beantworte(befehl: string, roh: unknown): Promise<unknown> }][] = [];
    private beendet = false;

    public constructor(options: Partial<utils.AdapterOptions> = {}) {
        super({
            ...options,
            name: 'myzel-app',
        });
        this.on('ready', this.onReady.bind(this));
        this.on('stateChange', (id, state) => this.server?.geaendert(id, state));
        this.on('objectChange', (id, objekt) => {
            this.katalog?.geaendert(id, objekt);
            if (appIdAus(this.namespace, id)) {
                this.server?.fern?.appsGeaendert();
            }
        });
        this.on('message', obj => void this.beantworte(obj));
        this.on('unload', this.onUnload.bind(this));
    }

    private async onReady(): Promise<void> {
        // Vor dem Start, damit der Gerätemanager auch antwortet, wenn der Start scheitert. Nicht im Konstruktor:
        // Dort gibt es this.log noch nicht.
        new Geraete(this, new Verwaltung({ namespace: this.namespace, log: this.log, betrieb: () => this.betrieb }));
        const objekte = new IoBrokerQuelle(this);
        const seite = {
            namespace: this.namespace,
            katalog: () => this.katalog,
            ablage: new IoBrokerAblage(this),
            log: this.log,
            alleObjekte: () => objekte.alleObjekte(),
            aendereRaum: (raum: string, aendere: (mitglieder: string[]) => string[]) =>
                objekte.aendereRaum(raum, aendere),
        };
        this.seiten = [
            [KARTENBEFEHLE, new Kartenseite(seite)],
            [PROFILBEFEHLE, new Profilseite(seite)],
            [RAUMBEFEHLE, new Raumseite(seite)],
            [FERNBEFEHLE, new Fernseite({ namespace: this.namespace, betrieb: () => this.fernbetrieb() })],
        ];
        try {
            await this.starte();
        } catch (fehler) {
            this.log.error(`Start fehlgeschlagen, der Server läuft nicht: ${(fehler as Error).message}`);
        }
    }

    private async starte(): Promise<void> {
        await this.setStateAsync('info.connection', false, true);
        await this.setStateAsync('info.fernzugang', false, true);

        const fehler = pruefeEinstellungen(this.config);
        if (fehler.length > 0) {
            this.log.error(`Einstellungen ungültig, der Server startet nicht: ${fehler.join('; ')}`);
            return;
        }
        const identitaet = await this.identitaet();
        if (!identitaet) {
            return;
        }
        const fp = fingerabdruck(identitaet.zertifikat);
        this.log.info(`Fingerabdruck des Zertifikats: ${fp}`);

        const quelle = new IoBrokerQuelle(this);
        const ablage = new IoBrokerAblage(this);
        const adressen = (): string[] =>
            this.config.adressen.length > 0 ? this.config.adressen : automatischeAdressen(this.config.port);
        await stelleUm(this.namespace, quelle, this.config, ablage, this.log).catch((fehler: Error) =>
            this.log.error(`Umstellung auf Karten- und Profilobjekte: ${fehler.message}`),
        );
        const katalog = new Katalog(this.namespace, this.log, quelle);
        await this.subscribeForeignObjectsAsync('*');
        await katalog.lade();
        this.katalog = katalog;
        this.log.info(
            `${katalog.anzahl} Datenpunkte, ${katalog.karten().length} Karten und ` +
                `${katalog.alleProfile().length} Profile im Katalog`,
        );
        for (const mangel of kartenmaengel(katalog)) {
            this.log.warn(mangel);
        }
        const server = await starteServer({
            adapterId: identitaet.adapterId,
            namespace: this.namespace,
            identitaet,
            ablage,
            katalog,
            zustaende: quelle,
            port: this.config.port,
            adressen,
            log: this.log,
            zustand: laeuft => void this.setStateAsync('info.connection', laeuft, true),
            nachlaufMs: this.config.nachlaufMin * 60_000,
            textLaenge: this.config.textLaenge,
            hinweisFristMs: this.config.hinweisFristMin * 60_000,
            fernablage: { lies: () => this.liesFernzugang(), schreibe: e => this.schreibeFernzugang(e) },
            fernVerbunden: ja => void this.setStateAsync('info.fernzugang', ja, true),
        });
        if (this.beendet) {
            await server.beende();
            return;
        }
        this.server = server;
        this.betrieb = {
            adapterId: identitaet.adapterId,
            fingerabdruck: fp,
            adressen,
            kopplung: server.kopplung,
            dienst: server.dienst,
            katalog,
            ablage,
            adminOhneAnmeldung: () => this.adminOhneAnmeldung(),
        };
        await this.subscribeStatesAsync('apps.*.hinweis.senden');
        await server.dienst.holeHinweiseNach();
        const offen = await this.adminOhneAnmeldung().catch(() => []);
        if (offen.length > 0) {
            this.log.warn(adminOffen(offen).de);
        }
    }

    // Die Seiten in den Reitern Karten, Räume und Profile (admin/jsonConfig.json)
    private async beantworte(obj: ioBroker.Message): Promise<void> {
        const seite = this.seiten.find(([befehle]) => befehle.includes(obj?.command))?.[1];
        if (!obj?.callback || !seite) {
            return;
        }
        let antwort: unknown;
        try {
            antwort = await seite.beantworte(obj.command, obj.message);
        } catch (fehler) {
            this.log.warn(`${obj.command}: ${(fehler as Error).message}`);
            antwort = { fehler: 'gescheitert', einzelheiten: [(fehler as Error).message] } satisfies Ablehnung;
        }
        this.sendTo(obj.from, obj.command, antwort ?? null, obj.callback);
    }

    private fernbetrieb(): Fernbetrieb | undefined {
        const fern = this.server?.fern;
        const b = this.betrieb;
        const katalog = this.katalog;
        return fern && b && katalog
            ? { fern, ablage: b.ablage, verbindungen: () => b.dienst.verbindungen(), sprache: katalog.sprache }
            : undefined;
    }

    private async adminOhneAnmeldung(): Promise<string[]> {
        const praefix = 'system.adapter.admin.';
        const ansicht = await this.getObjectViewAsync('system', 'instance', {
            startkey: praefix,
            endkey: `${praefix}香`,
        });
        return ansicht.rows
            .filter(r => r.value?.common?.enabled === true && r.value.native?.auth !== true)
            .map(r => r.id.slice('system.adapter.'.length));
    }

    // Eigenes Objekt statt Instanz-Einstellungen: Eine Admin-Seite, die vor dem ersten Start geöffnet wurde, schreibt beim
    // Speichern ihren alten Stand zurück und würde die Identität sonst löschen. Alle Apps müssten dann neu koppeln.
    private async identitaet(): Promise<(Identitaet & { adapterId: string }) | undefined> {
        const objekt = await this.getObjectAsync(IDENTITAET);
        if (!objekt) {
            const adapterId = neueAdapterId();
            const neu = erzeugeIdentitaet(adapterId);
            await this.setObjectAsync(IDENTITAET, {
                type: 'config',
                common: { name: { de: 'Identität für die Apps', en: 'Identity for the apps' } },
                native: { adapterId, zertifikat: neu.zertifikat, schluessel: this.encrypt(neu.schluessel) },
            });
            this.log.info('Schlüssel und Zertifikat erzeugt');
            return { adapterId, ...neu };
        }
        const { adapterId, zertifikat, schluessel } = objekt.native as Record<string, unknown>;
        let grund: string | undefined = 'unvollständig';
        let gespeichert: (Identitaet & { adapterId: string }) | undefined;
        if (typeof adapterId === 'string' && typeof zertifikat === 'string' && typeof schluessel === 'string') {
            gespeichert = { adapterId, zertifikat, schluessel: this.decrypt(schluessel) };
            grund =
                pruefeAdapterId(adapterId).length > 0
                    ? 'Adapter-ID ungültig'
                    : pruefeIdentitaet(adapterId, gespeichert);
        }
        if (grund) {
            this.log.error(
                `Identität in ${this.namespace}.${IDENTITAET} unbrauchbar (${grund}), der Server startet nicht. ` +
                    'Abhilfe: Objekt löschen und Instanz neu starten, danach alle Apps neu koppeln.',
            );
            return undefined;
        }
        return gespeichert;
    }

    // Eigenes Objekt wie identitaet, aus demselben Grund. Ein unbrauchbares Geheimnis gilt als fehlend und wird neu erzeugt.
    private async liesFernzugang(): Promise<Ferneinstellung | undefined> {
        const n = (await this.getObjectAsync(FERNZUGANG))?.native as Record<string, unknown> | undefined;
        if (typeof n?.adresse !== 'string' || typeof n.geheimnis !== 'string') {
            return undefined;
        }
        const geheimnis = this.decrypt(n.geheimnis);
        if (!/^[A-Za-z0-9_-]{43}$/.test(geheimnis)) {
            this.log.warn(`Geheimnis in ${this.namespace}.${FERNZUGANG} unbrauchbar, wird neu erzeugt`);
            return undefined;
        }
        return { adresse: n.adresse, geheimnis };
    }

    private async schreibeFernzugang(e: Ferneinstellung): Promise<void> {
        await this.setObjectAsync(FERNZUGANG, {
            type: 'config',
            common: { name: { de: 'Fernzugang über den Vermittler', en: 'Remote access via relay' } },
            native: { adresse: e.adresse, geheimnis: this.encrypt(e.geheimnis) },
        });
    }

    private onUnload(callback: () => void): void {
        try {
            this.beendet = true;
            void this.setState('info.connection', false, true);
            void this.setState('info.fernzugang', false, true);
            (this.server?.beende() ?? Promise.resolve())
                .catch((fehler: Error) => this.log.error(`Fehler beim Beenden: ${fehler.message}`))
                .finally(callback);
        } catch (error) {
            this.log.error(`Fehler beim Beenden: ${(error as Error).message}`);
            callback();
        }
    }
}

if (require.main !== module) {
    module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new MyzelApp(options);
} else {
    (() => new MyzelApp())();
}
