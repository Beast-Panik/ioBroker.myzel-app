import { expect } from 'chai';
import type { Duplex } from 'node:stream';
import { WebSocket } from 'ws';
import { alsApp, Vermittlernachbau } from '../../test/vermittler';
import { adapterSchluessel, appSchluessel, neuesFerngeheimnis, vermittlerHash } from '../basis/fernschluessel';
import type { Protokoll } from '../basis/grenzen';
import type { Herkunft } from '../basis/kern';
import { Fern, type Fernapp, type Fernstand, type Fernzeiten, grundAus } from './fern';

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

const lies = (strom: Duplex, bytes: number): Promise<Buffer> =>
    new Promise((resolve, reject) => {
        const teile: Buffer[] = [];
        let laenge = 0;
        const weiter = (teil: Buffer): void => {
            teile.push(teil);
            laenge += teil.length;
            if (laenge >= bytes) {
                strom.off('data', weiter);
                resolve(Buffer.concat(teile));
            }
        };
        strom.on('data', weiter);
        strom.once('error', reject);
    });

describe('Zugangsweg fern gegen den Nachbau des Vermittlers', function () {
    this.timeout(10_000);
    const geheimnis = neuesFerngeheimnis();
    const app = (appId: string, zugangHash = '0'.repeat(64)): Fernapp & { schluessel: string } => {
        const schluessel = appSchluessel(geheimnis, appId, zugangHash);
        return { appId, hash: vermittlerHash(schluessel), schluessel };
    };
    const tablet = app('abcdefgh');
    let v: Vermittlernachbau;
    let fern: Fern | undefined;
    let log: string[];
    let staende: Fernstand[];
    let genommen: [Duplex, Herkunft][];
    let apps: Fernapp[];

    function starte(schluessel = adapterSchluessel(geheimnis), zeiten?: Partial<Fernzeiten>): Fern {
        const protokoll: Protokoll = {
            debug: t => log.push(`debug ${t}`),
            info: t => log.push(`info ${t}`),
            warn: t => log.push(`warn ${t}`),
            error: t => log.push(`error ${t}`),
        };
        fern = new Fern({
            adresse: v.adresse,
            adapterSchluessel: schluessel,
            apps: () => Promise.resolve(apps),
            nimm: (strom, herkunft) => genommen.push([strom, herkunft]),
            log: protokoll,
            stand: s => staende.push(s),
            zeiten,
        });
        fern.starte();
        return fern;
    }
    const verbunden = (): Promise<void> => bis(() => staende.at(-1)?.art === 'verbunden');

    beforeEach(async () => {
        v = await Vermittlernachbau.starte(vermittlerHash(adapterSchluessel(geheimnis)));
        log = [];
        staende = [];
        genommen = [];
        apps = [tablet];
    });
    afterEach(async () => {
        fern?.beende();
        fern = undefined;
        await v.beende();
        expect(log.join('\n'), 'Schlüssel im Log').to.not.contain(geheimnis).and.not.contain(tablet.schluessel);
    });

    it('meldet sich an, nennt die Apps und reicht eine Sitzung als Bytestrom an den Kern, in beide Richtungen', async () => {
        starte();
        await verbunden();
        expect(staende[0]).to.deep.equal({ art: 'verbindet' });
        await bis(() => v.steuer.length === 1);
        expect(v.steuer).to.deep.equal([{ art: 'apps', hashes: [tablet.hash] }]);
        expect(log).to.include(`info Fernzugang: mit dem Vermittler ${v.adresse} verbunden`);

        const appSeite = await alsApp(v.adresse, tablet.schluessel);
        appSeite.write(Buffer.from('hallo'));
        await bis(() => genommen.length === 1);
        const [kernSeite, herkunft] = genommen[0];
        expect(herkunft).to.deep.equal({ weg: 'fern', adresse: 'fern:abcdefgh', app: 'abcdefgh' });
        expect((await lies(kernSeite, 5)).toString()).to.equal('hallo');

        // Mehr als eine Nachricht des Vermittlers fasst: kommt in Stücken und vollständig an
        const gross = Buffer.alloc(200 * 1024, 7);
        const angekommen = lies(appSeite, gross.length);
        kernSeite.write(gross);
        expect((await angekommen).equals(gross)).to.equal(true);

        const zu = new Promise(r => appSeite.once('end', r));
        kernSeite.end();
        await zu;
    });

    it('schickt nach einem Abgleich die neue Liste; wer fehlt, kommt beim Vermittler nicht mehr durch', async () => {
        starte();
        await verbunden();
        const handy = app('ijklmnop');
        apps = [handy];
        await fern!.abgleich();
        await bis(() => v.steuer.length === 2);
        expect(v.steuer[1]).to.deep.equal({ art: 'apps', hashes: [handy.hash] });
        let fehler = '';
        await alsApp(v.adresse, tablet.schluessel).catch((f: Error) => (fehler = f.message));
        expect(fehler).to.contain('401');
    });

    it('übergeht Unlesbares, falsche Nummern und Sitzungen unbekannter Apps', async () => {
        starte();
        await verbunden();
        v.melde('{kaputt');
        v.melde({ art: 'etwas' });
        v.melde({ art: 'sitzung', nummer: '../app', app: tablet.hash });
        v.melde({ art: 'sitzung', nummer: 'f'.repeat(32), app: app('zzzzzzzz').hash });
        await bis(() => log.some(z => z.includes('unbekannten App')));
        expect(log.filter(z => z.startsWith('debug'))).to.have.length(4);
        // Die Steuerverbindung steht noch, eine echte Sitzung geht weiter durch
        const appSeite = await alsApp(v.adresse, tablet.schluessel);
        await bis(() => genommen.length === 1);
        appSeite.destroy();
        expect(v.steuerungen).to.equal(1);
    });

    it('wehrt Text auf einer Datenverbindung ab', async () => {
        starte();
        await verbunden();
        const appSeite = await alsApp(v.adresse, tablet.schluessel);
        appSeite.write(Buffer.from('x'));
        await bis(() => genommen.length === 1);
        const [kernSeite] = genommen[0];
        const fehler = new Promise<Error>(r => kernSeite.once('error', r));
        const [s] = v.sitzungen.values();
        s.app.emit('message', Buffer.from('{"t":"hallo"}'), false);
        expect((await fehler).message).to.equal('Text auf der Datenverbindung');
        appSeite.destroy();
    });

    it('verbindet neu, wenn der Vermittler die Steuerverbindung schließt, und nennt die Apps erneut', async () => {
        starte();
        await verbunden();
        v.steuerung!.close(1001);
        await bis(() => staende.at(-1)?.art === 'getrennt');
        expect(log).to.include('warn Fernzugang: Verbindung beendet (1001). Neuer Versuch läuft im Hintergrund.');
        await verbunden();
        await bis(() => v.steuer.length === 2);
        expect(v.steuerungen).to.equal(2);
        expect(v.steuer[1]).to.deep.equal(v.steuer[0]);
    });

    it('andere Protokollversion: getrennt mit Grund, nur der erste Fehler als Warnung, Abstand wächst', async () => {
        v.protokoll = 2;
        starte();
        const getrennt = (): Extract<Fernstand, { art: 'getrennt' }>[] =>
            staende.filter((s): s is Extract<Fernstand, { art: 'getrennt' }> => s.art === 'getrennt');
        await bis(() => getrennt().length === 2);
        const [erster, zweiter] = getrennt();
        expect(erster.grund).to.equal('Vermittler spricht Protokoll 2, der Adapter 1');
        expect(zweiter.naechsterVersuch - Date.now()).to.be.within(1500, 2000);
        expect(log.filter(z => z.startsWith('warn'))).to.have.length(1);
        expect(log.filter(z => z.startsWith('debug'))).to.have.length(1);
        expect(v.steuerungen).to.equal(0);
    });

    it('unbekannter Adapterschlüssel: Grund sagt, dass die Zeile beim Vermittler fehlt', async () => {
        starte(adapterSchluessel(neuesFerngeheimnis()));
        await bis(() => staende.at(-1)?.art === 'getrennt');
        expect((staende.at(-1) as { grund: string }).grund).to.contain('Zeile für den Vermittler fehlt');
    });

    type Getrennt = Extract<Fernstand, { art: 'getrennt' }>;
    const getrennt = (): Getrennt[] => staende.filter((s): s is Getrennt => s.art === 'getrennt');
    // Wie eine zweite Instanz mit demselben Schlüssel: Der Vermittler ersetzt die Steuerverbindung des Adapters.
    async function verdraenge(): Promise<WebSocket> {
        const vorher = getrennt().length;
        const andere = new WebSocket(`${v.adresse}/adapter`, {
            headers: { Authorization: `Bearer ${adapterSchluessel(geheimnis)}` },
        });
        andere.on('error', () => undefined);
        await bis(() => getrennt().length > vorher);
        return andere;
    }
    const abstand = (): number => getrennt().at(-1)!.naechsterVersuch - Date.now();

    it('verdrängt eine zweite Instanz den Adapter, wächst der Abstand, statt jede Sekunde neu zu verbinden', async () => {
        starte(undefined, { stabilMs: 60_000 });
        await verbunden();
        const erste = await verdraenge();
        expect(getrennt().at(-1)!.grund).to.contain('anderer Adapter mit demselben Schlüssel');
        expect(abstand()).to.be.within(800, 1000);
        await verbunden();
        const zweite = await verdraenge();
        expect(abstand(), 'nicht zurückgesetzt, obwohl kurz verbunden').to.be.within(1800, 2000);
        expect(log.filter(z => z.startsWith('warn'))).to.have.length(1);
        erste.terminate();
        zweite.terminate();
    });

    it('erst eine stabile Steuerverbindung setzt den Abstand zurück', async () => {
        starte(undefined, { stabilMs: 100 });
        await verbunden();
        await pause(150);
        const erste = await verdraenge();
        expect(abstand()).to.be.within(800, 1000);
        await verbunden();
        await pause(150);
        const zweite = await verdraenge();
        expect(abstand()).to.be.within(800, 1000);
        erste.terminate();
        zweite.terminate();
    });

    it('öffnet höchstens so viele Sitzungen je Zeitfenster und warnt dann einmal', async () => {
        starte(undefined, { sitzungenJeFenster: 2, fensterMs: 60_000 });
        await verbunden();
        await bis(() => v.steuer.length === 1);
        const seiten: Duplex[] = [];
        for (let i = 0; i < 4; i++) {
            seiten.push(await alsApp(v.adresse, tablet.schluessel));
        }
        await bis(() => genommen.length === 2);
        await bis(() => log.some(z => z.startsWith('warn Fernzugang: mehr als 2 Sitzungen')));
        await pause(200);
        expect(genommen).to.have.length(2);
        expect(log.filter(z => z.includes('mehr als 2 Sitzungen'))).to.have.length(1);
        seiten.forEach(s => s.destroy());
    });

    it('nach beende kein neuer Versuch', async () => {
        const f = starte();
        await verbunden();
        f.beende();
        await bis(() => v.steuerung === undefined);
        await pause(1200);
        expect(v.steuerungen).to.equal(1);
        expect(staende.at(-1)?.art).to.equal('verbunden');
    });

    it('übersetzt Fehler in Gründe, mit denen ein Mensch etwas anfangen kann', () => {
        const mitCode = (code: string, alsUrsache = false): Error =>
            alsUrsache
                ? Object.assign(new Error('fetch failed'), { cause: Object.assign(new Error('x'), { code }) })
                : Object.assign(new Error('x'), { code });
        expect(grundAus(new Error('Unexpected server response: 429'))).to.contain('bremst');
        expect(grundAus(new Error('Unexpected server response: 503'))).to.equal('Vermittler antwortet mit 503');
        expect(grundAus(mitCode('ENOTFOUND', true))).to.equal('Name des Vermittlers nicht gefunden');
        expect(grundAus(mitCode('ECONNREFUSED'))).to.equal('keine Verbindung (ECONNREFUSED)');
        expect(grundAus(mitCode('CERT_HAS_EXPIRED', true))).to.equal(
            'Zertifikat des Vermittlers ungültig (CERT_HAS_EXPIRED)',
        );
        expect(grundAus(Object.assign(new Error('x'), { name: 'TimeoutError' }))).to.equal('keine Antwort binnen 10 s');
        expect(grundAus(new TypeError('fetch failed', { cause: new Error('bad port') }))).to.contain('Port');
        expect(grundAus(new Error('anders'))).to.equal('anders');
    });
});
