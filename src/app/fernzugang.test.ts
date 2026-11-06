import { expect } from 'chai';
import { Speicherablage } from '../../test/speicher';
import { Vermittlernachbau } from '../../test/vermittler';
import {
    adapterSchluessel,
    appSchluessel,
    konfigurationszeile,
    neuesFerngeheimnis,
    vermittlerHash,
} from '../basis/fernschluessel';
import type { Protokoll } from '../basis/grenzen';
import { neueAdapterId } from '../basis/kodierung';
import { type Ferneinstellung, Fernverwaltung } from './fernzugang';
import type { AppDaten } from './objekte';

const pause = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

async function bis(bedingung: () => boolean, ms = 3000): Promise<void> {
    const ende = Date.now() + ms;
    while (!bedingung()) {
        if (Date.now() > ende) {
            throw new Error('Bedingung nicht erfüllt');
        }
        await pause(10);
    }
}

const appDaten = (zugangHash: string, fern?: boolean): AppDaten => ({
    name: 'Tablet',
    profil: 'familie',
    zugangHash,
    gekoppeltAm: 1,
    geraet: { android: '15', appVersion: '1.0.0' },
    handydaten: { akku: false, anruf: false, benachrichtigung: false },
    ...(fern !== undefined && { fern }),
});

describe('Verwaltung des Fernzugangs', function () {
    this.timeout(10_000);
    const adapterId = neueAdapterId();
    let gespeichert: Ferneinstellung | undefined;
    let geschrieben: Ferneinstellung[];
    let verbunden: boolean[];
    let geaendert: number;
    let log: string[];
    let apps: Speicherablage;
    let verwaltung: Fernverwaltung | undefined;
    let v: Vermittlernachbau | undefined;

    async function starte(): Promise<Fernverwaltung> {
        const protokoll: Protokoll = {
            debug: t => log.push(`debug ${t}`),
            info: t => log.push(`info ${t}`),
            warn: t => log.push(`warn ${t}`),
            error: t => log.push(`error ${t}`),
        };
        verwaltung = new Fernverwaltung({
            adapterId,
            ablage: {
                lies: () => Promise.resolve(gespeichert && { ...gespeichert }),
                schreibe: e => {
                    gespeichert = { ...e };
                    geschrieben.push({ ...e });
                    return Promise.resolve();
                },
            },
            apps,
            nimm: () => undefined,
            log: protokoll,
            verbunden: ja => verbunden.push(ja),
            geaendert: () => geaendert++,
        });
        await verwaltung.starte();
        return verwaltung;
    }

    async function mitVermittler(): Promise<{ f: Fernverwaltung; v: Vermittlernachbau; geheimnis: string }> {
        const geheimnis = neuesFerngeheimnis();
        v = await Vermittlernachbau.starte(vermittlerHash(adapterSchluessel(geheimnis)));
        // Über die Ablage, weil setzeAdresse nur https annimmt
        gespeichert = { adresse: v.adresse, geheimnis };
        const f = await starte();
        await bis(() => f.stand.art === 'verbunden');
        return { f, v, geheimnis };
    }

    beforeEach(() => {
        gespeichert = undefined;
        geschrieben = [];
        verbunden = [];
        geaendert = 0;
        log = [];
        apps = new Speicherablage();
    });
    afterEach(async () => {
        verwaltung?.beende();
        verwaltung = undefined;
        await v?.beende();
        v = undefined;
        for (const e of geschrieben) {
            expect(log.join('\n'), 'Geheimnis im Log').to.not.contain(e.geheimnis);
        }
    });

    it('erzeugt beim ersten Start ein Geheimnis und legt es ab; ohne Adresse ist der Fernzugang aus', async () => {
        const f = await starte();
        expect(geschrieben).to.have.length(1);
        expect(geschrieben[0].adresse).to.equal('');
        expect(Buffer.from(geschrieben[0].geheimnis, 'base64url')).to.have.length(32);
        expect(f.stand).to.deep.equal({ art: 'aus' });
        expect(f.zugang()).to.equal(undefined);
        expect(f.zeile).to.equal(konfigurationszeile(adapterId, geschrieben[0].geheimnis));
        expect(log).to.include('info Geheimnis für den Fernzugang erzeugt');
        f.beende();
        await starte();
        expect(geschrieben, 'beim zweiten Start nichts Neues').to.have.length(1);
    });

    const falsch = [
        'http://vermittler.example.org',
        'https://vermittler.example.org/?a=1',
        'https://vermittler.example.org/#a',
        'https://nutzer@vermittler.example.org',
        'https://vermittler.example.org:123456',
        'wss://vermittler.example.org',
        `https://${'a'.repeat(200)}.de`,
        'https://vermittler example.org',
    ];
    it('nimmt nur https-Adressen mit Namen an und speichert dann nichts', async () => {
        const f = await starte();
        for (const adresse of falsch) {
            expect(await f.setzeAdresse(adresse), adresse).to.have.length(1);
        }
        expect(geschrieben).to.have.length(1);
        expect(geaendert).to.equal(0);
    });

    it('neue Adresse: ohne Leerzeichen und Schrägstrich am Ende, Apps erfahren es; gleiche Adresse ändert nichts', async () => {
        const f = await starte();
        // Port 2: abgewiesen, ohne dass ein Name aufgelöst werden muss; Port 1 sperrt fetch selbst
        expect(await f.setzeAdresse('  https://127.0.0.1:2/myzel/ ')).to.deep.equal([]);
        expect(gespeichert?.adresse).to.equal('https://127.0.0.1:2/myzel');
        expect(f.zugang()).to.deep.equal({ adresse: 'https://127.0.0.1:2/myzel', geheimnis: gespeichert?.geheimnis });
        expect(geaendert).to.equal(1);
        await bis(() => f.stand.art === 'getrennt');
        expect((f.stand as { grund: string }).grund).to.contain('ECONNREFUSED');
        expect(await f.setzeAdresse('https://127.0.0.1:2/myzel')).to.deep.equal([]);
        expect(geaendert).to.equal(1);
        expect(await f.setzeAdresse('')).to.deep.equal([]);
        expect(f.stand).to.deep.equal({ art: 'aus' });
        expect(f.zugang()).to.equal(undefined);
        expect(geaendert).to.equal(2);
        expect(log).to.include('info Fernzugang ausgeschaltet');
    });

    it('neues Geheimnis und neue Adresse zugleich: beides bleibt, keins stellt das Alte wieder her', async () => {
        const f = await starte();
        const alt = geschrieben[0].geheimnis;
        await Promise.all([f.neuesGeheimnis(), f.setzeAdresse('https://vermittler.example.org')]);
        expect(gespeichert?.adresse).to.equal('https://vermittler.example.org');
        expect(gespeichert?.geheimnis).to.not.equal(alt);
        expect(f.zugang()).to.deep.equal(gespeichert);
        f.beende();
    });

    it('meldet nur freigegebene Apps, mit dem Hash ihres Schlüssels', async () => {
        await apps.lege('abcdefgh', appDaten('1'.repeat(64), true));
        await apps.lege('ijklmnop', appDaten('2'.repeat(64), false));
        await apps.lege('qrstuvwx', appDaten('3'.repeat(64)));
        const { v, geheimnis } = await mitVermittler();
        await bis(() => v.steuer.length === 1);
        expect(v.steuer[0]).to.deep.equal({
            art: 'apps',
            hashes: [vermittlerHash(appSchluessel(geheimnis, 'abcdefgh', '1'.repeat(64)))],
        });
        expect(verbunden).to.deep.equal([true]);
    });

    it('sammelt Änderungen an Apps zu einem Abgleich', async () => {
        await apps.lege('abcdefgh', appDaten('1'.repeat(64), true));
        const { f, v } = await mitVermittler();
        await bis(() => v.steuer.length === 1);
        await apps.aendere('abcdefgh', { fern: false });
        f.appsGeaendert();
        await apps.lege('ijklmnop', appDaten('2'.repeat(64), true));
        f.appsGeaendert();
        f.appsGeaendert();
        await bis(() => v.steuer.length === 2);
        await pause(700);
        expect(v.steuer).to.have.length(2);
        expect((v.steuer[1] as { hashes: string[] }).hashes).to.have.length(1);
    });

    it('neues Geheimnis: neue Zeile, neue Schlüssel, die alte Zeile gilt beim Vermittler nicht mehr', async () => {
        const { f, v, geheimnis } = await mitVermittler();
        const alteZeile = f.zeile;
        await f.neuesGeheimnis();
        expect(gespeichert?.geheimnis).to.not.equal(geheimnis);
        expect(f.zeile).to.not.equal(alteZeile);
        expect(f.zugang()?.geheimnis).to.equal(gespeichert?.geheimnis);
        expect(geaendert).to.equal(1);
        await bis(() => f.stand.art === 'getrennt');
        expect((f.stand as { grund: string }).grund).to.contain('Zeile für den Vermittler fehlt');
        expect(verbunden).to.deep.equal([true, false]);
        expect(v.steuerungen).to.equal(1);
        expect(log.some(z => z.startsWith('warn Fernzugang: Schlüssel neu erzeugt'))).to.equal(true);
    });
});
