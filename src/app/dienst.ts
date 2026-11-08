import { isDeepStrictEqual } from 'node:util';
import adapterAnApp from '../../protokoll/v1/adapter-an-app.schema.json';
import appAnAdapter from '../../protokoll/v1/app-an-adapter.schema.json';
import gemeinsam from '../../protokoll/v1/gemeinsam.schema.json';
import type { Anmeldeziel, Hallo, Zugangspruefung } from '../basis/anmeldung';
import { GRENZEN, type Grenzen, type Protokoll } from '../basis/grenzen';
import { SCHLIESSCODE, type Verbindung, type Weg } from '../basis/kern';
import { appSchluessel } from '../basis/fernschluessel';
import { neueAppId, neuerZugang, passtZuHash, sha256 } from '../basis/kodierung';
import type { Kopplung, Kopplungsanfrage } from '../basis/kopplung';
import { Nachrichtenpruefer } from '../basis/schema';
import type { Handyeimer } from './handydaten';
import { Anwesenheit, Handyeingang, meldeZonenAus, neueHandyeimer } from './handydaten';
import { Hinweise } from './hinweise';
import type { Katalog, Objektaenderung } from './katalog';
import { type AppDaten, type Appablage, type Appstand, type Handydaten, appIdAus } from './objekte';
import { FERN_SEIT, type Rechtestand, inhaltFuer, rechteFuer } from './rechte';
import { Sitzung } from './sitzung';
import { Abostelle, type Wert, Werteversand, type Zustandsquelle } from './werte';
import {
    type Mittelpunktvorschlag,
    VORSCHLAG_MS,
    ZONEN_SEIT,
    grundText,
    handydatenFuer,
    zonenDerApp,
    zonenFuer,
} from './zonen';

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
    // Vermittler und Geheimnis, wenn eine Adresse eingetragen ist
    fernzugang?: () => Fernzugang | undefined;
}

export interface Fernzugang {
    adresse: string;
    geheimnis: string;
}

// Was eine freigegebene App in willkommen und rechte bekommt (adapter-an-app.schema.json, rechteInhalt.fern)
interface Ferndaten {
    adresse: string;
    schluessel: string;
    pingS: number;
    totS: number;
}

// Ob ein Zugang laut Objekt der App gilt. Fehlt das Objekt oder passt der Zugang nicht zum Hash darin, gilt er nicht,
// auch wenn der Rest beschädigt ist. Sonst heißt beschädigt nur: vorerst nicht, die App behält ihre Kopplung.
type Zugangslage = { art: 'ok'; daten: AppDaten } | { art: Exclude<Zugangspruefung, 'ok'> };

function zugangslage(stand: Appstand, passt: (zugangHash: string) => boolean): Zugangslage {
    if (stand.art === 'fehlt') {
        return { art: 'unbekannt' };
    }
    const hash = stand.art === 'da' ? stand.daten.zugangHash : stand.zugangHash;
    if (hash !== undefined && !passt(hash)) {
        return { art: 'falsch' };
    }
    return stand.art === 'da' ? { art: 'ok', daten: stand.daten } : { art: 'beschaedigt' };
}

interface Angemeldet {
    sitzung: Sitzung;
    werte: Werteversand;
    handy: Handyeingang;
    zugangHash: string;
    version: number;
    fern?: Ferndaten;
    // Was die App zuletzt als Freigabe bekommen hat; handy.handydaten kann schon enger sein (appGeaendert)
    handydaten: Handydaten;
}

export class Dienst implements Anmeldeziel {
    private readonly sitzungen = new Map<string, Angemeldet>();
    // Eimer der Anmeldungen je App, nur für Apps mit gültigem Zugang
    private readonly anmeldungen = new Map<string, { marken: number; zeit: number; gemeldet: boolean }>();
    private readonly abostelle: Abostelle;
    private readonly anwesenheit: Anwesenheit;
    private readonly hinweise: Hinweise;
    // Je App der letzte Vorschlag für einen Mittelpunkt, nur im Speicher (KONZEPT-ZONEN.md, Abschnitt 17.7)
    private readonly vorschlaege = new Map<string, Mittelpunktvorschlag & { bis: number }>();
    // Mengen der Handydaten je App über alle Sitzungen; eine App, die immer wieder neu verbindet, bekäme sonst jedes Mal
    // einen vollen Stoß
    private readonly handyeimer = new Map<string, Handyeimer>();
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
        o.katalog.beiApp((appId, objekt) => this.appGeaendert(appId, objekt));
    }

    // Ausschalten im Admin gilt sofort, nicht erst mit der Neuberechnung nach rund 2 s: Danach schreibt der Adapter von
    // der Datenart nichts mehr, auch keinen Standort. Einschalten kommt mit der Neuberechnung und ihrer Prüfung.
    private appGeaendert(appId: string, objekt: Objektaenderung): void {
        const handy = this.sitzungen.get(appId)?.handy;
        if (!handy) {
            return;
        }
        const native: unknown = objekt?.type === 'device' ? objekt.native : undefined;
        const neu: unknown =
            native && typeof native === 'object' ? (native as { handydaten?: unknown }).handydaten : {};
        const an = (art: string): boolean =>
            !!neu && typeof neu === 'object' && (neu as Record<string, unknown>)[art] === true;
        handy.schraenkeEin(an, objekt ? 'admin' : 'entfernt');
    }

    // Adresse oder Geheimnis des Fernzugangs neu: Jede App bekommt den neuen Stand wie bei neuen Rechten.
    public fernzugangGeaendert(): void {
        this.vormerken();
    }

    // Die Vorschläge der letzten 15 Minuten, der neueste zuerst
    public mittelpunktvorschlaege(jetzt = Date.now()): Mittelpunktvorschlag[] {
        for (const [appId, v] of this.vorschlaege) {
            if (v.bis <= jetzt) {
                this.vorschlaege.delete(appId);
            }
        }
        return [...this.vorschlaege.values()].sort((a, b) => b.zeit - a.zeit).map(({ bis: _bis, ...v }) => v);
    }

    // Weg je angemeldeter App
    public verbindungen(): Map<string, Weg> {
        return new Map([...this.sitzungen].map(([appId, a]) => [appId, a.sitzung.verbindung.herkunft.weg]));
    }

    public geaendert(id: string, state: ioBroker.State | null | undefined): void {
        this.abostelle.geaendert(id, state);
        // ack=true schreibt der Adapter selbst, wenn ein Hinweis angezeigt wurde
        const hinweisFuer = state && !state.ack ? appIdAus(this.o.namespace, id, 'hinweis.senden') : undefined;
        if (state && hinweisFuer) {
            this.hinweise.neu(hinweisFuer, state);
        }
    }

    // Beim Start ist keine App verbunden, auch wenn der letzte Lauf das nicht mehr schreiben konnte. weg ist leer,
    // solange die App nicht verbunden ist; sonst zeigte der Gerätemanager den alten Weg.
    public async starte(): Promise<void> {
        const appIds = await this.o.ablage.alle();
        for (const appId of appIds) {
            await this.o.ablage.schreibe(appId, { online: false, weg: '' });
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
        return (await this.lageFuer(appId, zugang)).art;
    }

    public async angemeldet(v: Verbindung, hallo: Hallo): Promise<void> {
        if (!this.darfAnmelden(hallo.app, Date.now())) {
            v.sendeFehler('zuviel');
            v.schliesse(SCHLIESSCODE.zuviel, 'zu viele Anmeldungen');
            return;
        }
        // Noch einmal: Seit pruefeZugang kann das Objekt entfernt, beschädigt oder sein Zugang geändert worden sein.
        const lage = await this.lageFuer(hallo.app, hallo.zugang);
        if (lage.art === 'beschaedigt') {
            v.sendeFehler('intern');
            v.schliesse(SCHLIESSCODE.intern, 'Objekt beschädigt');
            return;
        }
        if (lage.art !== 'ok') {
            v.sendeFehler('zugang');
            v.schliesse(SCHLIESSCODE.zugang, 'zugang');
            return;
        }
        const daten = lage.daten;
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
            handydaten: { akku: false, anruf: false, benachrichtigung: false, zonen: false, standort: false },
            gekoppeltAm: Date.now(),
            geraet: anfrage.geraet,
            zonenwahl: [],
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
    // zonen.aktiv false, wie anwesend: Von der App kommt sicher nichts mehr.
    public async entferne(appId: string): Promise<void> {
        await this.o.ablage.entferne(appId);
        this.hinweise.vergiss(appId);
        this.vorschlaege.delete(appId);
        this.handyeimer.delete(appId);
        this.anwesenheit.entferne(appId);
        const angemeldet = this.sitzungen.get(appId);
        if (angemeldet) {
            angemeldet.handy.schraenkeEin(() => false, 'entfernt');
            angemeldet.sitzung.verbindung.schliesse(SCHLIESSCODE.entfernt, 'entfernt');
        } else {
            await meldeZonenAus(this.o.ablage, appId, grundText('entfernt', this.o.katalog.sprache)).catch(
                (fehler: Error) => this.o.log.warn(`App ${appId}: Ende der Zonen nicht geschrieben: ${fehler.message}`),
            );
        }
        this.o.log.info(`App ${appId} entfernt`);
    }

    private async freieAppId(): Promise<string> {
        for (let versuch = 0; versuch < 5; versuch++) {
            const appId = neueAppId();
            // Auch eine beschädigte App belegt ihre ID: Sie ist noch gekoppelt.
            if ((await this.o.ablage.stand(appId)).art === 'fehlt') {
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
        const fern = this.fernFuer(appId, daten, version);
        // Über den Vermittler nur mit Freigabe. Der Vermittler holt nur freigegebene Apps, doch seine Liste kann kurz
        // veraltet sein, und er gilt nicht als vertrauenswürdig.
        if (v.herkunft.weg === 'fern' && !fern) {
            this.o.log.info(`App ${appId}: Fernzugang nicht freigegeben, Verbindung über den Vermittler beendet`);
            v.schliesse(SCHLIESSCODE.fernAus, 'Fernzugang aus');
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
        const zonen = version >= ZONEN_SEIT ? zonenDerApp(daten, this.o.katalog.zonen()) : [];
        const handy = new Handyeingang({
            appId,
            verbindung: v,
            ablage: this.o.ablage,
            log: this.o.log,
            textLaenge: this.o.textLaenge,
            handydaten: daten.handydaten,
            version,
            zonen,
            zonenname: zone => this.o.katalog.zone(zone)?.name,
            sprache: () => this.o.katalog.sprache,
            vorschlag: v => this.vorschlaege.set(appId, { appId, ...v, bis: Date.now() + VORSCHLAG_MS }),
            eimer: this.eimerFuer(appId),
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
                zone: m => handy.zone(m),
                zonenstand: m => handy.zonenstand(m),
                standort: m => handy.standort(m),
                vorschlag: m => handy.vorschlag(m),
            },
            grenzen: this.o.grenzen,
        });
        const alt = this.sitzungen.get(appId);
        this.sitzungen.set(appId, {
            sitzung,
            werte,
            handy,
            zugangHash: daten.zugangHash,
            version,
            fern,
            handydaten: daten.handydaten,
        });
        if (alt) {
            this.o.log.info(`App ${appId}: neue Verbindung ersetzt die bisherige`);
            alt.sitzung.verbindung.schliesse(SCHLIESSCODE.ersetzt, 'ersetzt');
            // Die ersetzte Sitzung meldet keine Trennung mehr. Kommt die neue über den Vermittler, beginnt so der
            // Nachlauf; eine neue im Heimnetz beendet ihn gleich wieder.
            this.anwesenheit.getrennt(appId, alt.sitzung.verbindung.herkunft.weg);
        }
        v.beiTrennung(() => {
            this.getrennt(sitzung);
            werte.beende().catch((fehler: Error) => this.o.log.error(`Abo der App ${appId}: ${fehler.message}`));
        });
        // Ein Entfernen während der Anmeldung fand die Sitzung noch nicht; ab hier findet es sie, davor sieht es dieses Lesen.
        const nachher = zugangslage(await this.o.ablage.stand(appId), hash => hash === daten.zugangHash);
        if (nachher.art === 'beschaedigt') {
            this.o.log.info(`App ${appId}: Objekt während der Anmeldung beschädigt, Verbindung beendet`);
            v.schliesse(SCHLIESSCODE.intern, 'Objekt beschädigt');
            return;
        }
        if (nachher.art !== 'ok') {
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
            handydaten: handydatenFuer(daten.handydaten, version),
            ...zonenFuer(daten, this.o.katalog.zonen(), version),
            ...(fern && { fern }),
        });
        this.o.log.info(`App ${appId} verbunden über ${v.herkunft.weg} von ${v.herkunft.adresse}`);
        await this.o.ablage.schreibe(appId, { online: true, weg: v.herkunft.weg });
        await this.anwesenheit.angemeldet(appId, v.herkunft.weg);
        await this.hinweise.angemeldet(appId, v);
        if (version >= ZONEN_SEIT) {
            // Ausgeschaltet bleiben Wahl und Datenpunkte, gelöscht oder abgewählt verschwinden sie, auch wenn das geschah,
            // während die App nicht verbunden war
            const wahl = new Set(daten.zonenwahl ?? []);
            void handy.entferneUebrige(zone => wahl.has(zone) && this.o.katalog.gibtZone(zone));
        } else {
            // Etwa nach einer Rücksicherung einer älteren App: Sie meldet keine Zonen mehr
            void handy.zonenAus('veraltet');
        }
    }

    private eimerFuer(appId: string): Handyeimer {
        const da = this.handyeimer.get(appId);
        if (da) {
            return da;
        }
        const neu = neueHandyeimer();
        this.handyeimer.set(appId, neu);
        return neu;
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
            const stand = await this.o.ablage.stand(appId);
            if (this.beendet || this.sitzungen.get(appId) !== angemeldet) {
                continue;
            }
            const { sitzung, werte, handy } = angemeldet;
            const lage = zugangslage(stand, hash => hash === angemeldet.zugangHash);
            // Mit 1011 statt 4008 behält die App ihre Kopplung und meldet sich wieder an, sobald das Objekt heil ist.
            if (lage.art === 'beschaedigt') {
                this.o.log.info(`App ${appId}: Objekt beschädigt, Verbindung beendet, die App bleibt gekoppelt`);
                sitzung.verbindung.schliesse(SCHLIESSCODE.intern, 'Objekt beschädigt');
                continue;
            }
            if (lage.art !== 'ok') {
                this.o.log.info(`App ${appId} entfernt oder Zugang geändert, Verbindung beendet`);
                sitzung.verbindung.schliesse(SCHLIESSCODE.entfernt, 'entfernt');
                continue;
            }
            const daten = lage.daten;
            const fern = this.fernFuer(appId, daten, angemeldet.version);
            if (sitzung.verbindung.herkunft.weg === 'fern' && !fern) {
                this.o.log.info(`App ${appId}: Fernzugang ausgeschaltet, Verbindung über den Vermittler beendet`);
                sitzung.verbindung.schliesse(SCHLIESSCODE.fernAus, 'Fernzugang aus');
                continue;
            }
            const rechte = jeProfil.get(daten.profil) ?? rechteFuer(daten.profil, this.o.katalog);
            jeProfil.set(daten.profil, rechte);
            // Verglichen wird, was die App bekäme: Eine neue Etage ändert für eine App vor Protokoll 5 nichts.
            const fuerApp = inhaltFuer(rechte.inhalt, angemeldet.version);
            const rechteNeu = !isDeepStrictEqual(fuerApp, inhaltFuer(werte.rechte.inhalt, angemeldet.version));
            const fernNeu = !isDeepStrictEqual(fern, angemeldet.fern);
            const zonen = angemeldet.version >= ZONEN_SEIT ? zonenDerApp(daten, this.o.katalog.zonen()) : [];
            if (
                !rechteNeu &&
                !fernNeu &&
                isDeepStrictEqual(daten.handydaten, angemeldet.handydaten) &&
                isDeepStrictEqual(daten.handydaten, handy.handydaten) &&
                isDeepStrictEqual(zonen, handy.zonen)
            ) {
                continue;
            }
            if (rechteNeu) {
                werte
                    .neueRechte(rechte)
                    .catch((fehler: Error) => this.o.log.error(`Abo der App ${appId}: ${fehler.message}`));
            }
            handy.uebernimm(daten.handydaten);
            angemeldet.handydaten = daten.handydaten;
            // Ausgeschaltet behält die App ihre Wahl und die Datenpunkte bleiben; entzogen oder gelöscht verschwinden sie.
            // Eine gerade unbrauchbare Zone fehlt auf dem Handy, ihr Datenpunkt bleibt.
            const gewaehlt = new Set(daten.zonenwahl ?? []);
            const entzogen = handy.zonen.map(z => z.id).filter(id => !gewaehlt.has(id) || !this.o.katalog.gibtZone(id));
            handy.zonen = zonen;
            void handy.entferneZonen(entzogen);
            angemeldet.fern = fern;
            sitzung.verbindung.sende({
                t: 'rechte',
                ...fuerApp,
                handydaten: handydatenFuer(daten.handydaten, angemeldet.version),
                ...zonenFuer(daten, this.o.katalog.zonen(), angemeldet.version),
                ...(fern && { fern }),
            });
            this.o.log.debug(`App ${appId}: neue Rechte, ${rechte.inhalt.karten.length} Karten`);
        }
    }

    // Eimer je App: anmeldungenStoss sofort, danach eine je anmeldungAbstandMs
    private darfAnmelden(appId: string, jetzt: number): boolean {
        const g = this.o.grenzen ?? GRENZEN;
        const alt = this.anmeldungen.get(appId);
        const marken = alt
            ? Math.min(g.anmeldungenStoss, alt.marken + (jetzt - alt.zeit) / g.anmeldungAbstandMs)
            : g.anmeldungenStoss;
        if (marken < 1) {
            this.anmeldungen.set(appId, { marken, zeit: jetzt, gemeldet: true });
            if (!alt?.gemeldet) {
                this.o.log.warn(`App ${appId} meldet sich zu oft an, vorerst abgewiesen`);
            }
            return false;
        }
        this.anmeldungen.set(appId, { marken: marken - 1, zeit: jetzt, gemeldet: false });
        return true;
    }

    private async lageFuer(appId: string, zugang: string): Promise<Zugangslage> {
        return zugangslage(await this.o.ablage.stand(appId), hash => passtZuHash(zugang, Buffer.from(hash, 'hex')));
    }

    private fernFuer(appId: string, daten: AppDaten, version: number): Ferndaten | undefined {
        const zugang = this.o.fernzugang?.();
        if (version < FERN_SEIT || !zugang || daten.fern !== true) {
            return undefined;
        }
        const grenzen = this.o.grenzen ?? GRENZEN;
        return {
            adresse: zugang.adresse,
            schluessel: appSchluessel(zugang.geheimnis, appId, daten.zugangHash),
            pingS: grenzen.fernPingMs / 1000,
            totS: grenzen.fernTotMs / 1000,
        };
    }

    private getrennt(sitzung: Sitzung): void {
        if (this.sitzungen.get(sitzung.appId)?.sitzung !== sitzung) {
            return;
        }
        this.sitzungen.delete(sitzung.appId);
        this.o.log.info(`App ${sitzung.appId} getrennt`);
        this.o.ablage
            .schreibe(sitzung.appId, { online: false, weg: '', zuletzt: Date.now() })
            .catch((fehler: Error) => this.o.log.error(`Status der App ${sitzung.appId}: ${fehler.message}`));
        this.anwesenheit.getrennt(sitzung.appId, sitzung.verbindung.herkunft.weg);
    }
}
