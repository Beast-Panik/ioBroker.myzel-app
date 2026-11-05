import { isDeepStrictEqual } from 'node:util';
import adapterAnApp from '../../protokoll/v1/adapter-an-app.schema.json';
import appAnAdapter from '../../protokoll/v1/app-an-adapter.schema.json';
import gemeinsam from '../../protokoll/v1/gemeinsam.schema.json';
import type { Anmeldeziel, Hallo, Zugangspruefung } from '../basis/anmeldung';
import { GRENZEN, type Grenzen, type Protokoll } from '../basis/grenzen';
import { SCHLIESSCODE, type Verbindung } from '../basis/kern';
import { neueAppId, neuerZugang, passtZuHash, sha256 } from '../basis/kodierung';
import type { Kopplung, Kopplungsanfrage } from '../basis/kopplung';
import { Nachrichtenpruefer } from '../basis/schema';
import { Anwesenheit, Handyeingang } from './handydaten';
import { Hinweise } from './hinweise';
import type { Katalog } from './katalog';
import { type AppDaten, type Appablage, appIdAus } from './objekte';
import { type Rechtestand, inhaltFuer, rechteFuer } from './rechte';
import { Sitzung } from './sitzung';
import { Abostelle, type Wert, Werteversand, type Zustandsquelle } from './werte';

const NEUBERECHNUNG_MS = 2000;

// Alle, die der Adapter spricht; er antwortet in der Version der App.
export const PROTOKOLLVERSIONEN: number[] = gemeinsam.$defs.version.enum;
export const NEUESTE_VERSION = Math.max(...PROTOKOLLVERSIONEN);

// versionen nur für Tests, die einen älteren Adapter nachstellen
export const appPruefer = (versionen = PROTOKOLLVERSIONEN): Nachrichtenpruefer =>
    new Nachrichtenpruefer(appAnAdapter, [gemeinsam], versionen);

export const adapterPruefer = (): Nachrichtenpruefer =>
    new Nachrichtenpruefer(adapterAnApp, [gemeinsam], PROTOKOLLVERSIONEN);

export interface DienstOptionen {
    adapterId: string;
    namespace: string;
    ablage: Appablage;
    pruefer: Nachrichtenpruefer;
    kopplung: Kopplung;
    log: Protokoll;
    adressen: () => string[];
    katalog: Katalog;
    zustaende: Zustandsquelle;
    nachlaufMs: number;
    textLaenge: number;
    hinweisFristMs: number;
    grenzen?: Grenzen;
    neuberechnungMs?: number;
}

interface Angemeldet {
    sitzung: Sitzung;
    werte: Werteversand;
    handy: Handyeingang;
    zugangHash: string;
    version: number;
}

export class Dienst implements Anmeldeziel {
    private readonly sitzungen = new Map<string, Angemeldet>();
    private readonly abostelle: Abostelle;
    private readonly anwesenheit: Anwesenheit;
    private readonly hinweise: Hinweise;
    private vorgemerkt?: NodeJS.Timeout;
    private neuberechnung: Promise<void> = Promise.resolve();
    private beendet = false;

    public constructor(private readonly o: DienstOptionen) {
        this.abostelle = new Abostelle(o.zustaende);
        this.anwesenheit = new Anwesenheit({ ablage: o.ablage, nachlaufMs: o.nachlaufMs, log: o.log });
        this.hinweise = new Hinweise({
            ablage: o.ablage,
            log: o.log,
            fristMs: o.hinweisFristMs,
            verbindung: appId => this.sitzungen.get(appId)?.sitzung.verbindung,
        });
        o.katalog.beiAenderung(() => this.vormerken());
    }

    public geaendert(id: string, state: ioBroker.State | null | undefined): void {
        this.abostelle.geaendert(id, state);
        // ack=true schreibt der Adapter selbst, wenn ein Hinweis angezeigt wurde
        const hinweisFuer = state && !state.ack ? appIdAus(this.o.namespace, id, 'hinweis.senden') : undefined;
        if (state && hinweisFuer) {
            this.hinweise.neu(hinweisFuer, state);
        }
    }

    // Beim Start ist keine App verbunden, auch wenn der letzte Lauf das nicht mehr schreiben konnte.
    public async starte(): Promise<void> {
        const appIds = await this.o.ablage.alle();
        for (const appId of appIds) {
            await this.o.ablage.schreibe(appId, { online: false });
            await this.o.ablage.richteEin(appId);
        }
        await this.anwesenheit.starte(appIds);
        await this.hinweise.starte(appIds);
    }

    // Erst nach dem Abonnieren von hinweis.senden, sonst ginge ein Hinweis aus der Zeit dazwischen verloren.
    public async holeHinweiseNach(): Promise<void> {
        await this.hinweise.holeNach(await this.o.ablage.alle());
    }

    public beende(): void {
        this.beendet = true;
        clearTimeout(this.vorgemerkt);
        this.anwesenheit.beende();
        this.hinweise.beende();
    }

    public async pruefeZugang(appId: string, zugang: string): Promise<Zugangspruefung> {
        const daten = await this.o.ablage.lies(appId);
        if (!daten) {
            return 'unbekannt';
        }
        return passtZuHash(zugang, Buffer.from(daten.zugangHash, 'hex')) ? 'ok' : 'falsch';
    }

    public async angemeldet(v: Verbindung, hallo: Hallo): Promise<void> {
        const daten = await this.o.ablage.lies(hallo.app);
        if (!daten) {
            v.sendeFehler('zugang');
            v.schliesse(SCHLIESSCODE.zugang, 'zugang');
            return;
        }
        if (daten.geraet.android !== hallo.geraet.android || daten.geraet.appVersion !== hallo.geraet.appVersion) {
            daten.geraet = hallo.geraet;
            await this.o.ablage.aendere(hallo.app, { geraet: hallo.geraet });
        }
        await this.oeffne(v, hallo.app, daten, hallo.v);
    }

    public async kopplungAnnehmen(anfrage: Kopplungsanfrage, profil: string): Promise<string | undefined> {
        if (!this.o.kopplung.abschliessen(anfrage)) {
            return undefined;
        }
        const appId = await this.freieAppId();
        const zugang = neuerZugang();
        const daten: AppDaten = {
            name: anfrage.name,
            zugangHash: sha256(zugang).toString('hex'),
            profil,
            handydaten: { akku: false, anruf: false, benachrichtigung: false },
            gekoppeltAm: Date.now(),
            geraet: anfrage.geraet,
        };
        await this.o.ablage.lege(appId, daten);
        this.o.log.info(`App ${appId} gekoppelt`);
        const v = anfrage.verbindung;
        if (v.offen) {
            v.sende({ t: 'gekoppelt', app: appId, zugang });
            await this.oeffne(v, appId, daten, anfrage.version);
        }
        return appId;
    }

    // Sofort, nicht erst mit der Neuberechnung der Rechte: Der Zugang gilt ab jetzt nicht mehr.
    public async entferne(appId: string): Promise<void> {
        await this.o.ablage.entferne(appId);
        this.hinweise.vergiss(appId);
        this.anwesenheit.entferne(appId);
        this.sitzungen.get(appId)?.sitzung.verbindung.schliesse(SCHLIESSCODE.entfernt, 'entfernt');
        this.o.log.info(`App ${appId} entfernt`);
    }

    private async freieAppId(): Promise<string> {
        for (let versuch = 0; versuch < 5; versuch++) {
            const appId = neueAppId();
            if (!(await this.o.ablage.lies(appId))) {
                return appId;
            }
        }
        throw new Error('keine freie App-ID gefunden');
    }

    private async oeffne(v: Verbindung, appId: string, daten: AppDaten, version: number): Promise<void> {
        if (!v.offen) {
            return;
        }
        const eingestellt = this.o.adressen();
        const eigene = v.herkunft.eigeneAdresse;
        const adressen = eingestellt.length > 0 || !eigene ? eingestellt : [eigene];
        if (adressen.length === 0) {
            this.o.log.error(
                `App ${appId} abgewiesen: keine Adresse des Adapters bekannt, bitte in den Einstellungen eintragen`,
            );
            v.sendeFehler('intern');
            v.schliesse(SCHLIESSCODE.intern, 'keine Adresse');
            return;
        }
        const rechte = rechteFuer(daten.profil, this.o.katalog);
        const werte = new Werteversand({
            appId,
            verbindung: v,
            stelle: this.abostelle,
            quelle: this.o.zustaende,
            rechte,
            log: this.o.log,
            teilBytes: (this.o.grenzen ?? GRENZEN).teilBytes,
        });
        const handy = new Handyeingang({
            appId,
            verbindung: v,
            ablage: this.o.ablage,
            log: this.o.log,
            textLaenge: this.o.textLaenge,
            handydaten: daten.handydaten,
        });
        const sitzung = new Sitzung(appId, v, {
            pruefer: this.o.pruefer,
            log: this.o.log,
            behandler: {
                abo: m => werte.abo(m.ids as string[]),
                setze: m => werte.setze(m.n as number, m.id as string, m.val as Wert),
                akku: m => handy.akku(m),
                anruf: m => handy.anruf(m),
                benachrichtigung: m => handy.benachrichtigung(m),
                auswahl: m => handy.auswahl(m),
                angezeigt: m => this.hinweise.angezeigt(appId, m.id as string),
            },
            grenzen: this.o.grenzen,
        });
        const alt = this.sitzungen.get(appId);
        this.sitzungen.set(appId, { sitzung, werte, handy, zugangHash: daten.zugangHash, version });
        if (alt) {
            this.o.log.info(`App ${appId}: neue Verbindung ersetzt die bisherige`);
            alt.sitzung.verbindung.schliesse(SCHLIESSCODE.ersetzt, 'ersetzt');
        }
        v.beiTrennung(() => {
            this.getrennt(sitzung);
            werte.beende().catch((fehler: Error) => this.o.log.error(`Abo der App ${appId}: ${fehler.message}`));
        });
        // Ein Entfernen während der Anmeldung fand die Sitzung noch nicht; ab hier findet es sie, davor sieht es dieses Lesen.
        if ((await this.o.ablage.lies(appId))?.zugangHash !== daten.zugangHash) {
            this.o.log.info(`App ${appId} während der Anmeldung entfernt, Verbindung beendet`);
            v.schliesse(SCHLIESSCODE.entfernt, 'entfernt');
            return;
        }
        v.sende({
            t: 'willkommen',
            v: version,
            adapter: this.o.adapterId,
            adressen,
            ...inhaltFuer(rechte.inhalt, version),
            handydaten: daten.handydaten,
        });
        this.o.log.info(`App ${appId} verbunden über ${v.herkunft.weg} von ${v.herkunft.adresse}`);
        await this.o.ablage.schreibe(appId, { online: true, weg: v.herkunft.weg });
        await this.anwesenheit.angemeldet(appId, v.herkunft.weg);
        await this.hinweise.angemeldet(appId, v);
    }

    // Gesammelt, weil eine Änderung selten allein kommt: Ein Adapter legt beim Start viele Objekte an.
    private vormerken(): void {
        if (this.beendet) {
            return;
        }
        this.vorgemerkt ??= setTimeout(() => {
            this.vorgemerkt = undefined;
            this.neuberechnung = this.neuberechnung
                .then(() => this.berechneNeu())
                .catch((fehler: Error) => this.o.log.error(`Neuberechnung der Rechte: ${fehler.message}`));
        }, this.o.neuberechnungMs ?? NEUBERECHNUNG_MS);
    }

    private async berechneNeu(): Promise<void> {
        const jeProfil = new Map<string, Rechtestand>();
        for (const [appId, angemeldet] of [...this.sitzungen]) {
            const daten = await this.o.ablage.lies(appId);
            if (this.beendet || this.sitzungen.get(appId) !== angemeldet) {
                continue;
            }
            const { sitzung, werte, handy } = angemeldet;
            if (daten?.zugangHash !== angemeldet.zugangHash) {
                this.o.log.info(`App ${appId} entfernt oder Zugang geändert, Verbindung beendet`);
                sitzung.verbindung.schliesse(SCHLIESSCODE.entfernt, 'entfernt');
                continue;
            }
            const rechte = jeProfil.get(daten.profil) ?? rechteFuer(daten.profil, this.o.katalog);
            jeProfil.set(daten.profil, rechte);
            // Verglichen wird, was die App bekäme: Eine neue Etage ändert für eine App vor Protokoll 5 nichts.
            const fuerApp = inhaltFuer(rechte.inhalt, angemeldet.version);
            const rechteNeu = !isDeepStrictEqual(fuerApp, inhaltFuer(werte.rechte.inhalt, angemeldet.version));
            if (!rechteNeu && isDeepStrictEqual(daten.handydaten, handy.handydaten)) {
                continue;
            }
            if (rechteNeu) {
                werte
                    .neueRechte(rechte)
                    .catch((fehler: Error) => this.o.log.error(`Abo der App ${appId}: ${fehler.message}`));
            }
            handy.handydaten = daten.handydaten;
            sitzung.verbindung.sende({ t: 'rechte', ...fuerApp, handydaten: daten.handydaten });
            this.o.log.debug(`App ${appId}: neue Rechte, ${rechte.inhalt.karten.length} Karten`);
        }
    }

    private getrennt(sitzung: Sitzung): void {
        if (this.sitzungen.get(sitzung.appId)?.sitzung !== sitzung) {
            return;
        }
        this.sitzungen.delete(sitzung.appId);
        this.o.log.info(`App ${sitzung.appId} getrennt`);
        this.o.ablage
            .schreibe(sitzung.appId, { online: false, zuletzt: Date.now() })
            .catch((fehler: Error) => this.o.log.error(`Status der App ${sitzung.appId}: ${fehler.message}`));
        this.anwesenheit.getrennt(sitzung.appId, sitzung.verbindung.herkunft.weg);
    }
}
