import type { AdapterInstance } from '@iobroker/adapter-core';
import type { ActionContext, BackEndCommandJsonFormOptions, JsonFormData, JsonFormSchema } from '@iobroker/dm-utils';
import { expect } from 'chai';
import { Gegenstelle } from '../../werkzeuge/gegenstelle';
import { NAMESPACE, Speicherablage, Speicherquelle } from '../../test/speicher';
import { type Server, starteServer } from '../app/server';
import { GRENZEN, type Protokoll } from '../basis/grenzen';
import { SCHLIESSCODE } from '../basis/kern';
import { qrInhalt } from '../basis/kopplung';
import { neueAdapterId } from '../basis/kodierung';
import { erzeugeIdentitaet, fingerabdruck } from '../basis/zertifikat';
import { type Betrieb, Geraete, Verwaltung, geraetAus, neueKennung, profilAus } from './geraete';

const adapterId = neueAdapterId();
const identitaet = erzeugeIdentitaet(adapterId);
const fp = fingerabdruck(identitaet.zertifikat);
const geraet = { android: '15', appVersion: '1.0.0' };
const pause = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));
const de = (t: ioBroker.StringOrTranslated | undefined): string => (typeof t === 'string' ? t : (t?.de ?? ''));

async function bis(bedingung: () => boolean, ms = 2000): Promise<void> {
    const ende = Date.now() + ms;
    while (!bedingung()) {
        if (Date.now() > ende) {
            throw new Error('Bedingung nicht erfüllt');
        }
        await pause(10);
    }
}

// Der Admin als Folge vorbereiteter Antworten: Formulardaten, undefined für Abbrechen, true oder false für Ja und
// Nein, oder eine Funktion, die zum Zeitpunkt der Frage etwas tut und dann antwortet
class Dialog implements ActionContext {
    public readonly verlauf: string[] = [];
    public readonly formulare: { schema: JsonFormSchema; optionen?: BackEndCommandJsonFormOptions }[] = [];

    public constructor(private readonly antworten: unknown[] = []) {}

    public showMessage(text: ioBroker.StringOrTranslated): Promise<void> {
        this.verlauf.push(`meldung ${de(text)}`);
        return Promise.resolve();
    }

    public showConfirmation(text: ioBroker.StringOrTranslated): Promise<boolean> {
        this.verlauf.push(`frage ${de(text)}`);
        return this.naechste() as Promise<boolean>;
    }

    public showForm(
        schema: JsonFormSchema,
        optionen?: BackEndCommandJsonFormOptions,
    ): Promise<JsonFormData | undefined> {
        this.verlauf.push(`formular ${de(optionen?.title)}`);
        this.formulare.push({ schema, optionen });
        return this.naechste() as Promise<JsonFormData | undefined>;
    }

    public openProgress(title: ioBroker.StringOrTranslated): ReturnType<ActionContext['openProgress']> {
        this.verlauf.push(`fortschritt ${de(title)}`);
        return Promise.resolve({
            update: () => Promise.resolve(),
            close: () => {
                this.verlauf.push('fortschritt zu');
                return Promise.resolve();
            },
        });
    }

    private async naechste(): Promise<unknown> {
        if (this.antworten.length === 0) {
            throw new Error('keine Antwort vorbereitet');
        }
        const antwort = this.antworten.shift();
        return typeof antwort === 'function' ? await (antwort as () => unknown)() : antwort;
    }
}

interface Umgebung {
    server: Server;
    port: number;
    quelle: Speicherquelle;
    ablage: Speicherablage;
    verwaltung: Verwaltung;
    log: string[];
    adressen: string[];
    laeuft: boolean;
    adminOffen: string[];
}

describe('Gerätemanager', function () {
    this.timeout(10_000);
    let u: Umgebung;

    async function starte(warteMs = 2000, neuberechnungMs = 20, einmalMs = GRENZEN.einmalMs): Promise<void> {
        await u?.server.beende();
        const log: string[] = [];
        const protokoll: Protokoll = {
            debug: t => log.push(`debug ${t}`),
            info: t => log.push(`info ${t}`),
            warn: t => log.push(`warn ${t}`),
            error: t => log.push(`error ${t}`),
        };
        const quelle = new Speicherquelle(protokoll)
            .objekt_('system.config', { type: 'config', common: { language: 'de' } })
            .datenpunkt('zigbee.0.lampe.state', { type: 'boolean', name: { de: 'Lampe', en: 'Lamp' } }, false)
            .datenpunkt('zigbee.0.lampe.farbe', { type: 'string' }, 'rot')
            .datenpunkt('zigbee.0.sensor.temperatur', { type: 'number', write: false }, 21.5)
            .raum('wohnzimmer', { de: 'Wohnzimmer', en: 'Living room' }, ['zigbee.0.lampe', 'zigbee.0.sensor'])
            .profil('familie', {
                name: 'Familie',
                raeume: [{ enum: 'enum.rooms.wohnzimmer', recht: 'schreiben' }],
                freigaben: [],
                sperren: [],
            });
        const ablage = new Speicherablage(quelle);
        let bereit!: () => void;
        const laeuft = new Promise<void>(r => (bereit = r));
        const server = await starteServer({
            adapterId,
            namespace: NAMESPACE,
            identitaet,
            ablage,
            port: 0,
            adressen: () => u.adressen,
            katalog: quelle.katalog,
            zustaende: quelle,
            log: protokoll,
            zustand: l => l && bereit(),
            nachlaufMs: 1000,
            textLaenge: 100,
            hinweisFristMs: 60_000,
            neuberechnungMs,
            grenzen: { ...GRENZEN, einmalMs },
        });
        await laeuft;
        const betrieb: Betrieb = {
            adapterId,
            fingerabdruck: fp,
            adressen: () => u.adressen,
            kopplung: server.kopplung,
            dienst: server.dienst,
            katalog: quelle.katalog,
            ablage,
            adminOhneAnmeldung: () => Promise.resolve(u.adminOffen),
        };
        const verwaltung = new Verwaltung({
            namespace: NAMESPACE,
            log: protokoll,
            betrieb: () => (u.laeuft ? betrieb : undefined),
            warteMs,
        });
        u = {
            server,
            port: server.heimnetz.port!,
            quelle,
            ablage,
            verwaltung,
            log,
            adressen: ['192.168.1.5:8095', '[fd00::5]:8095'],
            laeuft: true,
            adminOffen: [],
        };
    }

    const qrAus = (dialog: Dialog): URL => new URL((dialog.formulare[0].schema.items.qr as { data: string }).data);

    // Startet die Kopplung im Admin und meldet eine App mit dem Geheimnis aus dem QR-Code, sobald der Admin wartet.
    async function koppleBisZurFrage(
        antworten: unknown[],
    ): Promise<{ dialog: Dialog; ergebnis: Promise<unknown>; g: Gegenstelle }> {
        const dialog = new Dialog(antworten);
        const ergebnis = u.verwaltung.koppeln(dialog);
        await bis(() => dialog.verlauf.includes('fortschritt Warte auf die App'));
        const qr = qrAus(dialog);
        const g = await Gegenstelle.verbinde(u.port, qr.searchParams.get('f')!);
        g.sende({ t: 'koppeln', v: 1, geheimnis: qr.searchParams.get('g'), name: 'Tablet Flur', geraet });
        await bis(() => dialog.verlauf.some(z => z.startsWith('frage')));
        return { dialog, ergebnis, g };
    }

    async function gekoppelt(profil = 'familie'): Promise<{ g: Gegenstelle; appId: string; zugang: string }> {
        const { ergebnis, g } = await koppleBisZurFrage([{ profil }, true]);
        expect(await ergebnis).to.deep.equal({ refresh: true });
        const nachricht = await g.naechste();
        await g.naechste();
        return { g, appId: nachricht.app, zugang: nachricht.zugang };
    }

    beforeEach(() => starte());
    after(() => u?.server.beende());

    describe('App koppeln', () => {
        it('zeigt den QR-Code nach Abschnitt 4 und koppelt mit dem gewählten Profil', async () => {
            const { dialog, ergebnis, g } = await koppleBisZurFrage([{ profil: 'familie' }, true]);
            const qr = qrAus(dialog);
            expect(qr.protocol).to.equal('myzelapp:');
            expect(qr.host).to.equal('koppeln');
            expect(qr.searchParams.get('v')).to.equal('1');
            expect(qr.searchParams.get('a')).to.equal(adapterId);
            expect(qr.searchParams.get('g')).to.match(/^[A-Za-z0-9_-]{22}$/);
            expect(qr.searchParams.getAll('h')).to.deep.equal(['192.168.1.5:8095', '[fd00::5]:8095']);
            expect(dialog.formulare[0].optionen?.ignoreApplyDisabled, 'Weiter ohne Änderung').to.equal(true);
            expect(dialog.verlauf).to.deep.equal([
                'formular App koppeln',
                'fortschritt Warte auf die App',
                'fortschritt zu',
                'frage App „Tablet Flur“ mit Profil „Familie“ koppeln? Anfrage von 127.0.0.1, Android 15, App 1.0.0.',
            ]);
            expect(await ergebnis).to.deep.equal({ refresh: true });
            const nachricht = await g.naechste();
            expect(nachricht.t).to.equal('gekoppelt');
            expect((await g.naechste()).datenpunkte).to.have.length(3);
            expect(u.ablage.apps.get(nachricht.app)?.profil).to.equal('familie');
            g.schliesse();
        });

        it('warnt über dem QR-Code, wenn ein Admin ohne Anmeldung läuft', async () => {
            const ohne = await koppleBisZurFrage([{ profil: 'familie' }, false]);
            expect(Object.keys(ohne.dialog.formulare[0].schema.items)).to.not.include('offen');
            ohne.g.schliesse();
            await ohne.ergebnis;
            u.adminOffen = ['admin.0', 'admin.1'];
            const mit = await koppleBisZurFrage([{ profil: 'familie' }, false]);
            const offen = mit.dialog.formulare[0].schema.items.offen as { text: ioBroker.Translated };
            expect(Object.keys(mit.dialog.formulare[0].schema.items)[0]).to.equal('offen');
            expect(offen.text.de).to.equal(
                'Achtung: admin.0, admin.1 läuft ohne Anmeldung. Wer den Admin erreicht, kann Apps koppeln und Profile ändern.',
            );
            mit.g.schliesse();
            await mit.ergebnis;
        });

        it('kodiert die Werte im QR-Code für eine URL', () => {
            const qr = qrInhalt({
                adapterId,
                fingerabdruck: fp,
                geheimnis: 'A'.repeat(22),
                adressen: ['[fd00::5]:8095'],
            });
            expect(qr).to.contain('&h=%5Bfd00%3A%3A5%5D%3A8095');
            expect(new URL(qr).searchParams.get('h')).to.equal('[fd00::5]:8095');
        });

        it('ein Profil, das es nicht gibt, wird zu keinem Profil', async () => {
            const { dialog, ergebnis, g } = await koppleBisZurFrage([{ profil: 'gibtsnicht' }, true]);
            expect(dialog.verlauf.at(-1)).to.contain('ohne Profil koppeln?');
            await ergebnis;
            const appId = (await g.naechste()).app;
            expect((await g.naechste()).datenpunkte).to.deep.equal([]);
            expect(u.ablage.apps.get(appId)?.profil).to.equal('');
            g.schliesse();
        });

        it('Nein: die App bekommt abgelehnt und 4005, nichts wird angelegt', async () => {
            const { ergebnis, g } = await koppleBisZurFrage([{ profil: 'familie' }, false]);
            expect(await ergebnis).to.deep.equal({ refresh: false });
            expect(await g.naechste()).to.include({ t: 'fehler', code: 'abgelehnt' });
            expect((await g.geschlossen()).code).to.equal(SCHLIESSCODE.abgelehnt);
            expect(u.ablage.apps.size).to.equal(0);
        });

        it('Abbrechen am QR-Code macht den Schlüssel ungültig', async () => {
            const dialog = new Dialog([undefined]);
            expect(await u.verwaltung.koppeln(dialog)).to.deep.equal({ refresh: false });
            const qr = qrAus(dialog);
            const g = await Gegenstelle.verbinde(u.port, fp);
            g.sende({ t: 'koppeln', v: 1, geheimnis: qr.searchParams.get('g'), name: 'X', geraet });
            expect(await g.naechste()).to.include({ t: 'fehler', code: 'zugang' });
        });

        it('meldet sich keine App, endet das Warten mit einer Meldung und der Schlüssel gilt nicht mehr', async () => {
            await starte(100);
            const dialog = new Dialog([{ profil: 'familie' }]);
            expect(await u.verwaltung.koppeln(dialog)).to.deep.equal({ refresh: false });
            expect(dialog.verlauf.slice(1)).to.deep.equal([
                'fortschritt Warte auf die App',
                'fortschritt zu',
                'meldung Keine App hat sich gemeldet. Der QR-Code gilt nicht mehr.',
            ]);
            const g = await Gegenstelle.verbinde(u.port, fp);
            g.sende({ t: 'koppeln', v: 1, geheimnis: qrAus(dialog).searchParams.get('g'), name: 'X', geraet });
            expect(await g.naechste()).to.include({ t: 'fehler', code: 'zugang' });
        });

        it('trennt die App vor dem Ja, kommt eine Meldung statt einer Kopplung', async () => {
            const app: { g?: Gegenstelle } = {};
            const vorDemJa = async (): Promise<boolean> => {
                app.g!.schliesse();
                await app.g!.geschlossen();
                await pause(50);
                return true;
            };
            const dialog = new Dialog([{ profil: 'familie' }, vorDemJa]);
            const ergebnis = u.verwaltung.koppeln(dialog);
            await bis(() => dialog.verlauf.includes('fortschritt Warte auf die App'));
            app.g = await Gegenstelle.verbinde(u.port, fp);
            app.g.sende({ t: 'koppeln', v: 1, geheimnis: qrAus(dialog).searchParams.get('g'), name: 'X', geraet });
            expect(await ergebnis).to.deep.equal({ refresh: false });
            expect(dialog.verlauf.at(-1)).to.equal('meldung Die App hat die Verbindung getrennt. Bitte neu koppeln.');
            expect(u.ablage.apps.size).to.equal(0);
        });

        it('ist der QR-Code beim Weiter schon abgelaufen, wartet der Admin nicht erst', async () => {
            await starte(2000, 20, 50);
            const spaet = async (): Promise<JsonFormData> => {
                await pause(100);
                return { profil: 'familie' };
            };
            const dialog = new Dialog([spaet]);
            await u.verwaltung.koppeln(dialog);
            expect(dialog.verlauf).to.deep.equal([
                'formular App koppeln',
                'meldung Keine App hat sich gemeldet. Der QR-Code gilt nicht mehr.',
            ]);
        });

        it('ohne bekannte Adresse kein QR-Code, sondern eine Meldung', async () => {
            u.adressen = [];
            const dialog = new Dialog();
            await u.verwaltung.koppeln(dialog);
            expect(dialog.verlauf).to.deep.equal([
                'meldung Keine Adresse des Adapters bekannt. Bitte in den Einstellungen eintragen.',
            ]);
        });

        it('läuft der Server nicht, sagt der Admin das', async () => {
            u.laeuft = false;
            const dialog = new Dialog();
            await u.verwaltung.koppeln(dialog);
            expect(dialog.verlauf).to.deep.equal(['meldung Der Adapter läuft nicht. Die Ursache steht im Log.']);
            expect(await u.verwaltung.geraete()).to.deep.equal([]);
        });
    });

    describe('Profile', () => {
        it('legt ein neues Profil an, leere Zeilen fallen weg, ohne Recht gilt lesen, Vorschau vor dem Speichern', async () => {
            const dialog = new Dialog([
                { profil: '' },
                {
                    name: ' Familie Süd ',
                    raeume: [{ enum: 'enum.rooms.wohnzimmer' }, { enum: '' }],
                    freigaben: [{ id: 'zigbee.0.lampe.farbe', recht: 'schreiben' }, {}],
                    sperren: [{ id: 'zigbee.0.sensor' }, { id: '' }],
                },
                true,
            ]);
            expect(await u.verwaltung.profile(dialog)).to.deep.equal({ refresh: true });
            expect(dialog.verlauf).to.deep.equal([
                'formular Profile',
                'formular Neues Profil',
                'frage Familie Süd: sieht 2 Datenpunkte, 1 davon schreibbar. Speichern?',
            ]);
            expect(u.quelle.katalog.profil('familie_sued')).to.deep.equal({
                name: 'Familie Süd',
                raeume: [{ enum: 'enum.rooms.wohnzimmer', recht: 'lesen' }],
                freigaben: [{ id: 'zigbee.0.lampe.farbe', recht: 'schreiben' }],
                sperren: ['zigbee.0.sensor'],
            });
        });

        it('die Auswahl zeigt je Profil die Vorschau', async () => {
            const dialog = new Dialog([undefined]);
            await u.verwaltung.profile(dialog);
            const auswahl = dialog.formulare[0].schema.items.profil as { options: { label: ioBroker.Translated }[] };
            expect(auswahl.options.map(o => o.label.de)).to.deep.equal([
                'Neues Profil',
                'Familie: sieht 3 Datenpunkte, 2 davon schreibbar',
            ]);
        });

        it('ohne Namen eine Meldung und das Formular erneut, mit den eingegebenen Daten', async () => {
            const eingabe = { name: '  ', raeume: [{ enum: 'enum.rooms.wohnzimmer', recht: 'lesen' }] };
            const dialog = new Dialog([{ profil: '' }, eingabe, undefined]);
            expect(await u.verwaltung.profile(dialog)).to.deep.equal({ refresh: false });
            expect(dialog.verlauf).to.deep.equal([
                'formular Profile',
                'formular Neues Profil',
                'meldung Bitte einen Namen eingeben.',
                'formular Neues Profil',
            ]);
            expect(dialog.formulare[2].optionen?.data).to.deep.equal(eingabe);
            expect(u.quelle.katalog.alleProfile()).to.have.length(1);
        });

        it('umbenennen behält die ID; Nein bei der Vorschau führt zurück ins Formular', async () => {
            const umbenannt = {
                name: 'Alle',
                raeume: [{ enum: 'enum.rooms.wohnzimmer', recht: 'schreiben' }],
                freigaben: [],
                sperren: [],
            };
            const dialog = new Dialog([{ profil: 'familie' }, umbenannt, false, umbenannt, true]);
            await u.verwaltung.profile(dialog);
            expect(dialog.verlauf.filter(z => z.startsWith('formular'))).to.deep.equal([
                'formular Profile',
                'formular Profil „Familie“',
                'formular Profil „Familie“',
            ]);
            expect(dialog.formulare[1].optionen?.data).to.deep.include({ name: 'Familie', loeschen: false });
            expect(u.quelle.katalog.profil('familie')?.name).to.equal('Alle');
            expect(u.quelle.katalog.alleProfile()).to.have.length(1);
        });

        it('löschen nimmt den Apps das Profil, die verbundene bekommt keine Datenpunkte mehr', async () => {
            const { g, appId } = await gekoppelt();
            const dialog = new Dialog([{ profil: 'familie' }, { name: 'Familie', loeschen: true }, true]);
            await u.verwaltung.profile(dialog);
            expect(dialog.verlauf.at(-1)).to.equal(
                'frage Profil „Familie“ löschen? Apps mit diesem Profil: 1. Sie sehen danach nichts.',
            );
            expect(u.quelle.katalog.profil('familie')).to.equal(undefined);
            expect(u.ablage.apps.get(appId)?.profil).to.equal('');
            expect(u.ablage.werte_.get(appId)?.profil).to.equal('');
            expect(await g.naechste()).to.deep.include({ t: 'rechte', profil: '', datenpunkte: [] });
            g.schliesse();
        });

        it('ein Profil, das inzwischen gelöscht ist, lässt sich nicht bearbeiten', async () => {
            const dialog = new Dialog([{ profil: 'weg' }]);
            await u.verwaltung.profile(dialog);
            expect(dialog.verlauf.at(-1)).to.equal('meldung Dieses Profil gibt es nicht mehr.');
        });
    });

    describe('Geräte', () => {
        const lampe = {
            name: 'Wohnzimmerlampe',
            typ: 'lampe' as const,
            teile: { schalten: 'zigbee.0.lampe.state', farbe: 'zigbee.0.lampe.farbe' },
        };

        it('legt ein Gerät an, leere Teile fallen weg, die ID kommt aus dem Namen', async () => {
            const dialog = new Dialog([
                { geraet: '' },
                { name: ' Wohnzimmerlampe ', typ: 'lampe', ...lampe.teile, helligkeit: '', farbtemperatur: null },
            ]);
            expect(await u.verwaltung.geraeteVerwalten(dialog)).to.deep.equal({ refresh: true });
            expect(dialog.verlauf).to.deep.equal(['formular Geräte', 'formular Neues Gerät']);
            expect(u.quelle.katalog.geraet('wohnzimmerlampe')).to.deep.equal(lampe);
            const felder = Object.keys(dialog.formulare[1].schema.items);
            expect(felder).to.deep.equal([
                'name',
                'typ',
                'hinweis',
                'schalten',
                'helligkeit',
                'farbe',
                'farbtemperatur',
            ]);
        });

        it('prüft jedes Teil und zeigt das Formular mit den eingegebenen Daten erneut', async () => {
            u.quelle
                .datenpunkt('zigbee.0.lampe.ct', { type: 'number' })
                .geraet('flur', { name: 'Flur', typ: 'lampe', teile: { schalten: 'zigbee.0.lampe.state' } });
            const falsch = [
                { name: 'X', schalten: 'zigbee.0.lampe.farbe' },
                { name: 'X', helligkeit: 'gibt.es.nicht' },
                { name: 'X', farbtemperatur: 'zigbee.0.lampe.ct' },
                { name: 'X', schalten: 'zigbee.0.lampe.state' },
                { name: 'X', farbe: 'zigbee.0.lampe.farbe', helligkeit: '' },
                { name: 'X' },
                { name: '', farbe: 'zigbee.0.lampe.farbe' },
            ];
            const dialog = new Dialog([{ geraet: '' }, ...falsch.slice(0, 4), falsch[5], falsch[6], undefined]);
            expect(await u.verwaltung.geraeteVerwalten(dialog)).to.deep.equal({ refresh: false });
            expect(dialog.verlauf.filter(z => z.startsWith('meldung'))).to.deep.equal([
                'meldung An und aus (true oder false): zigbee.0.lampe.farbe passt nicht.',
                'meldung Helligkeit (Zahl): Datenpunkt gibt.es.nicht gibt es nicht.',
                'meldung Lichtfarbe (Zahl mit min und max, K oder Mired): zigbee.0.lampe.ct passt nicht.',
                'meldung An und aus (true oder false): zigbee.0.lampe.state gehört schon zu „Flur“.',
                'meldung Bitte mindestens einen Datenpunkt verknüpfen.',
                'meldung Bitte einen Namen eingeben.',
            ]);
            expect(dialog.formulare[2].optionen?.data).to.deep.equal(falsch[0]);
            expect(u.quelle.katalog.geraete().map(([id]) => id)).to.deep.equal(['flur']);
            expect(geraetAus(falsch[4], u.quelle.katalog, '')).to.deep.equal({
                name: 'X',
                typ: 'lampe',
                teile: { farbe: 'zigbee.0.lampe.farbe' },
            });
        });

        it('bearbeiten behält die ID und darf die eigenen Datenpunkte behalten; die Auswahl zeigt Name und Typ', async () => {
            u.quelle.geraet('wohnzimmer', lampe);
            const dialog = new Dialog([
                { geraet: 'wohnzimmer' },
                { name: 'Stehlampe', typ: 'lampe', schalten: 'zigbee.0.lampe.state' },
            ]);
            await u.verwaltung.geraeteVerwalten(dialog);
            const auswahl = dialog.formulare[0].schema.items.geraet as { options: { label: ioBroker.Translated }[] };
            expect(auswahl.options.map(o => o.label.de)).to.deep.equal(['Neues Gerät', 'Wohnzimmerlampe (Lampe)']);
            expect(dialog.formulare[1].optionen?.data).to.deep.equal({
                name: 'Wohnzimmerlampe',
                typ: 'lampe',
                ...lampe.teile,
                loeschen: false,
            });
            expect(u.quelle.katalog.geraete()).to.deep.equal([
                ['wohnzimmer', { name: 'Stehlampe', typ: 'lampe', teile: { schalten: 'zigbee.0.lampe.state' } }],
            ]);
        });

        it('löschen erst nach der Frage; Nein führt zurück ins Formular', async () => {
            u.quelle.geraet('wohnzimmer', lampe);
            const loeschen = { ...lampe.teile, name: lampe.name, loeschen: true };
            const dialog = new Dialog([{ geraet: 'wohnzimmer' }, loeschen, false, loeschen, true]);
            expect(await u.verwaltung.geraeteVerwalten(dialog)).to.deep.equal({ refresh: true });
            expect(dialog.verlauf.at(-1)).to.equal(
                'frage Gerät „Wohnzimmerlampe“ löschen? Seine Datenpunkte bleiben und erscheinen auf den Handys wieder als einzelne Kacheln.',
            );
            expect(dialog.verlauf.filter(z => z.startsWith('formular'))).to.have.length(3);
            expect(u.quelle.katalog.geraete()).to.deep.equal([]);
        });

        it('ein Gerät, das inzwischen gelöscht ist, lässt sich nicht bearbeiten', async () => {
            const dialog = new Dialog([{ geraet: 'weg' }]);
            await u.verwaltung.geraeteVerwalten(dialog);
            expect(dialog.verlauf.at(-1)).to.equal('meldung Dieses Gerät gibt es nicht mehr.');
        });
    });

    describe('je App', () => {
        it('Profil wählen wirkt sofort und schreibt den Datenpunkt profil', async () => {
            const { g, appId } = await gekoppelt();
            await u.verwaltung.profilWaehlen(appId, new Dialog([{ profil: '' }]));
            expect(u.ablage.apps.get(appId)?.profil).to.equal('');
            expect(u.ablage.werte_.get(appId)?.profil).to.equal('');
            expect(await g.naechste()).to.deep.include({ t: 'rechte', datenpunkte: [] });
            await u.verwaltung.profilWaehlen(appId, new Dialog([{ profil: 'gibtsnicht' }]));
            expect(u.ablage.apps.get(appId)?.profil).to.equal('');
            g.schliesse();
        });

        it('Handydaten: nur echtes true schaltet ein, die App bekommt die neuen Schalter', async () => {
            const { g, appId } = await gekoppelt();
            const dialog = new Dialog([{ akku: true, anruf: 'true', benachrichtigung: 1 }]);
            expect(await u.verwaltung.handydaten(appId, dialog)).to.deep.equal({ refresh: 'devices' });
            expect(u.ablage.apps.get(appId)?.handydaten).to.deep.equal({
                akku: true,
                anruf: false,
                benachrichtigung: false,
            });
            expect((await g.naechste()).handydaten).to.deep.equal({
                akku: true,
                anruf: false,
                benachrichtigung: false,
            });
            const texte = Object.values(dialog.formulare[0].schema.items).map(i => de(i.text as ioBroker.Translated));
            expect(texte.join(' ')).to.contain('History-Adapter');
            g.schliesse();
        });

        it('Entfernen: Zugang weg, Verbindung sofort mit 4008 getrennt, eine neue Anmeldung scheitert', async () => {
            // Sofort heißt: nicht erst mit der Neuberechnung der Rechte
            await starte(2000, 5000);
            const { g, appId, zugang } = await gekoppelt();
            const dialog = new Dialog([true]);
            expect(await u.verwaltung.entferne(appId, dialog)).to.deep.equal({ refresh: 'devices' });
            expect(dialog.verlauf[0]).to.contain('App „Tablet Flur“ entfernen?');
            expect((await g.geschlossen()).code).to.equal(SCHLIESSCODE.entfernt);
            expect(u.ablage.apps.has(appId)).to.equal(false);
            expect(u.log).to.include(`info App ${appId} entfernt`);
            const neu = await Gegenstelle.verbinde(u.port, fp);
            neu.sende({ t: 'hallo', v: 1, app: appId, zugang, geraet });
            expect(await neu.naechste()).to.include({ t: 'fehler', code: 'zugang' });
        });

        it('Entfernen mit Nein ändert nichts', async () => {
            const { g, appId } = await gekoppelt();
            await u.verwaltung.entferne(appId, new Dialog([false]));
            expect(u.ablage.apps.has(appId)).to.equal(true);
            g.schliesse();
        });

        it('eine App, die es nicht mehr gibt, bekommt eine Meldung', async () => {
            const dialog = new Dialog();
            await u.verwaltung.handydaten('abcdefgh', dialog);
            expect(dialog.verlauf).to.deep.equal(['meldung Diese App gibt es nicht mehr.']);
        });

        it('scheitert ioBroker, steht der Fehler im Log und der Admin bekommt eine Meldung', async () => {
            const { g, appId } = await gekoppelt();
            u.ablage.scheitern = true;
            const dialog = new Dialog([{ profil: '' }]);
            expect(await u.verwaltung.profilWaehlen(appId, dialog)).to.deep.equal({ refresh: 'devices' });
            expect(dialog.verlauf.at(-1)).to.equal('meldung Das hat nicht geklappt. Die Ursache steht im Log.');
            expect(u.log).to.include('error Gerätemanager, Profil wählen: Datenbank weg');
            u.ablage.scheitern = false;
            g.schliesse();
        });

        it('Gerätekarte: Name, Verbindung aus online, Akku nur mit eingeschaltetem Akku', async () => {
            const { g, appId } = await gekoppelt();
            const [ohne] = await u.verwaltung.geraete();
            expect(ohne).to.deep.include({ id: appId, name: 'Tablet Flur', model: 'Android 15, App 1.0.0' });
            expect(ohne.status).to.deep.equal({
                connection: {
                    stateId: `${NAMESPACE}.apps.${appId}.online`,
                    mapping: { true: 'connected', false: 'disconnected' },
                },
            });
            await u.ablage.aendere(appId, { handydaten: { akku: true, anruf: false, benachrichtigung: false } });
            const [mit] = await u.verwaltung.geraete();
            expect(mit.status).to.deep.include({ battery: { stateId: `${NAMESPACE}.apps.${appId}.akku.stand` } });
            expect(mit.actions?.map(a => a.id)).to.deep.equal(['profil', 'handydaten', 'entfernen']);
            g.schliesse();
        });
    });
});

describe('Anbindung an dm-utils', () => {
    // Wie das Log in js-controller: Die Methoden brauchen this.
    class Log {
        public readonly meldungen: string[] = [];
        public level = 'info';
        public silly(t: string): void {
            this.meldungen.push(`silly ${t}`);
        }
        public debug(t: string): void {
            this.meldungen.push(`debug ${t}`);
        }
        public info(t: string): void {
            this.meldungen.push(`info ${t}`);
        }
        public warn(t: string): void {
            this.meldungen.push(`warn ${t}`);
        }
        public error(t: string): void {
            this.meldungen.push(`error ${t}`);
        }
    }

    it('Fehler in dm-utils landen im Log, nicht als unbehandelte Ablehnung', async () => {
        const log = new Log();
        let empfange!: (nachricht: unknown) => void;
        const adapter = {
            log,
            on: (ereignis: string, fn: (nachricht: unknown) => void) => {
                if (ereignis === 'message') {
                    empfange = fn;
                }
            },
        } as unknown as AdapterInstance;
        const still: Protokoll = {
            debug: () => undefined,
            info: () => undefined,
            warn: () => undefined,
            error: () => undefined,
        };
        new Geraete(adapter, new Verwaltung({ namespace: NAMESPACE, log: still, betrieb: () => undefined }));
        const unbehandelt: unknown[] = [];
        const fang = (grund: unknown): number => unbehandelt.push(grund);
        process.on('unhandledRejection', fang);
        try {
            empfange({ command: 'dm:deviceInfo', message: 'abcdefgh', from: 'system.adapter.javascript.0', _id: 1 });
            empfange({ command: 'dm:instanceAction', from: 'system.adapter.javascript.0', _id: 2 });
            await new Promise(r => setTimeout(r, 20));
        } finally {
            process.off('unhandledRejection', fang);
        }
        expect(unbehandelt).to.deep.equal([]);
        expect(log.meldungen.filter(m => m.startsWith('error'))).to.have.length(2);
    });
});

describe('Profil-ID und Formular', () => {
    it('Profil-ID aus dem Namen: klein, Umlaute ausgeschrieben, Akzente weg, höchstens 40 Zeichen, frei', () => {
        const frei = (): boolean => false;
        expect(neueKennung('Familie Süd', frei, 'profil')).to.equal('familie_sued');
        expect(neueKennung('Größe & Maß', frei, 'profil')).to.equal('groesse_mass');
        expect(neueKennung('Crème brûlée', frei, 'profil')).to.equal('creme_brulee');
        expect(neueKennung('!!!', frei, 'profil')).to.equal('profil');
        expect(neueKennung('x'.repeat(80), frei, 'profil')).to.have.length(36);
        const vergeben = new Set(['gast', 'gast_2']);
        expect(neueKennung('Gast', id => vergeben.has(id), 'profil')).to.equal('gast_3');
        expect(neueKennung(`${'a'.repeat(36)}`, id => id === 'a'.repeat(36), 'profil')).to.match(/^[a-z0-9_]{1,40}$/);
    });

    it('Formulardaten werden geprüft, nicht übernommen', () => {
        expect(profilAus({ name: 'x'.repeat(61) })).to.deep.equal({
            en: 'The name has at most 60 characters.',
            de: 'Der Name hat höchstens 60 Zeichen.',
        });
        const falsch = profilAus({ name: 'A', raeume: [{ enum: 'enum.functions.licht', recht: 'schreiben' }] });
        expect(de(falsch as ioBroker.Translated)).to.match(/^Profil ungültig/);
        expect(profilAus({ name: 'A', raeume: 'kaputt', freigaben: [null, 5], sperren: [{ id: 7 }] })).to.deep.equal({
            name: 'A',
            raeume: [],
            freigaben: [],
            sperren: [],
        });
    });
});
