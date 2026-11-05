import { expect } from 'chai';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { NAMESPACE, Speicherablage, Speicherquelle } from '../test/speicher';
import { type Server, starteServer } from '../src/app/server';
import type { Protokoll } from '../src/basis/grenzen';
import { qrInhalt } from '../src/basis/kopplung';
import { neueAdapterId, neuerZugang } from '../src/basis/kodierung';
import { erzeugeIdentitaet, fingerabdruck } from '../src/basis/zertifikat';
import { liesQr, simuliere, woerter, zerlegeAdresse } from './app-simulator';

const adapterId = neueAdapterId();
const identitaet = erzeugeIdentitaet(adapterId);
const fp = fingerabdruck(identitaet.zertifikat);
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

describe('App-Simulator: QR-Code lesen', () => {
    const gueltig = qrInhalt({
        adapterId,
        fingerabdruck: fp,
        geheimnis: 'A'.repeat(22),
        adressen: ['192.168.1.5:8095', '[fd00::5]:8095'],
    });

    it('liest, was der Adapter erzeugt, auch IPv6', () => {
        expect(liesQr(gueltig)).to.deep.equal({
            adapterId,
            fingerabdruck: fp,
            geheimnis: 'A'.repeat(22),
            adressen: ['192.168.1.5:8095', '[fd00::5]:8095'],
        });
    });

    for (const [fall, qr, erwartet] of [
        ['anderes Schema', gueltig.replace('myzelapp:', 'https:'), 'kein Kopplungscode'],
        ['neuere Formatversion', gueltig.replace('v=1', 'v=2'), 'Formatversion 2'],
        ['Geheimnis fehlt', gueltig.replace(/&g=[^&]+/, ''), 'g: geheimnis'],
        ['Fingerabdruck zu kurz', gueltig.replace(/f=[^&]+/, 'f=abc'), 'f: fingerabdruck'],
        ['Adapter-ID doppelt', `${gueltig}&a=${adapterId}`, 'a: adapterId'],
        ['keine Adresse', gueltig.replace(/&h=[^&]+/g, ''), 'eine bis vier'],
        ['fünf Adressen', `${gueltig}${'&h=10.0.0.1%3A1'.repeat(3)}`, 'eine bis vier'],
        ['Adresse mit Pfad', gueltig.replace('192.168.1.5%3A8095', 'evil.example%2Fx%3A1'), 'ungültig'],
        ['unbekanntes Feld', `${gueltig}&x=1`, 'unbekanntes Feld x'],
        ['kein URI', 'Hallo', 'kein gültiger URI'],
    ]) {
        it(`lehnt ab: ${fall}`, () => {
            const ergebnis = liesQr(qr);
            expect(ergebnis).to.be.an('array');
            expect((ergebnis as string[]).join('; ')).to.contain(erwartet);
        });
    }

    it('zerlegt Adressen und Befehlszeilen', () => {
        expect(zerlegeAdresse('[fd00::5]:8095')).to.deep.equal({ host: 'fd00::5', port: 8095 });
        expect(zerlegeAdresse('192.168.1.5:18095')).to.deep.equal({ host: '192.168.1.5', port: 18095 });
        expect(woerter('benachrichtigung Signal org.signal "Anna B" "Bis gleich!"')).to.deep.equal([
            'benachrichtigung',
            'Signal',
            'org.signal',
            'Anna B',
            'Bis gleich!',
        ]);
    });
});

describe('App-Simulator gegen den Server', function () {
    this.timeout(10_000);
    let server: Server;
    let ablage: Speicherablage;
    let log: string[];
    let ordner: string;

    beforeEach(async () => {
        log = [];
        const protokoll: Protokoll = {
            debug: t => log.push(`debug ${t}`),
            info: t => log.push(`info ${t}`),
            warn: t => log.push(`warn ${t}`),
            error: t => log.push(`error ${t}`),
        };
        const quelle = new Speicherquelle(protokoll)
            .objekt_('system.config', { type: 'config', common: { language: 'de' } })
            .datenpunkt('zigbee.0.lampe.state', { type: 'boolean' }, false)
            .raum('flur', 'Flur', [])
            .karte('flurlicht', {
                name: 'Flurlicht',
                typ: 'schalter',
                raum: 'enum.rooms.flur',
                teile: { schalten: 'zigbee.0.lampe.state' },
            })
            .profil('familie', {
                name: 'Familie',
                raeume: [{ enum: 'enum.rooms.flur', recht: 'schreiben' }],
                karten: [],
                gesperrt: [],
            });
        ablage = new Speicherablage(quelle);
        let bereit!: () => void;
        const laeuft = new Promise<void>(r => (bereit = r));
        server = await starteServer({
            adapterId,
            namespace: NAMESPACE,
            identitaet,
            ablage,
            port: 0,
            adressen: () => [`127.0.0.1:${server.heimnetz.port}`],
            katalog: quelle.katalog,
            zustaende: quelle,
            log: protokoll,
            zustand: l => l && bereit(),
            nachlaufMs: 1000,
            textLaenge: 100,
            hinweisFristMs: 60_000,
        });
        await laeuft;
        quelle.beiAenderung = (id, state) => server.geaendert(id, state);
        ordner = mkdtempSync(join(tmpdir(), 'myzel-simulator-'));
    });

    afterEach(async () => {
        await server.beende();
        rmSync(ordner, { recursive: true, force: true });
    });

    function starte(argumente: string[]): { ein: PassThrough; aus: string[]; ende: Promise<number> } {
        const ein = new PassThrough();
        const aus: string[] = [];
        return { ein, aus, ende: simuliere(argumente, ein, zeile => aus.push(zeile)) };
    }

    it('koppelt, speichert den Zugang nur für den Eigentümer lesbar, meldet sich an und bestätigt Hinweise', async () => {
        const datei = join(ordner, 'app.local.json');
        const { geheimnis } = server.kopplung.starte();
        const adresse = `127.0.0.1:${server.heimnetz.port}`;
        const qr = qrInhalt({ adapterId, fingerabdruck: fp, geheimnis, adressen: [adresse] });
        const kopplung = starte(['koppeln', qr, '--datei', datei, '--name', 'Tablet Flur']);
        const anfrage = await server.kopplung.warte(3000);
        expect(anfrage?.name).to.equal('Tablet Flur');
        const appId = await server.dienst.kopplungAnnehmen(anfrage!, 'familie');
        await bis(() => kopplung.aus.some(z => z.startsWith('< {"t":"willkommen"')));
        kopplung.ein.write('akku 57\n');
        await bis(() => kopplung.aus.some(z => z.includes('"code":"aus"')));
        kopplung.ein.write('ende\n');
        expect(await kopplung.ende).to.equal(0);

        const gespeichert = JSON.parse(readFileSync(datei, 'utf8'));
        expect(gespeichert).to.include({ adapterId, fingerabdruck: fp, app: appId });
        expect(gespeichert.adressen).to.deep.equal([adresse]);
        expect(statSync(datei).mode & 0o777).to.equal(0o600);
        const ausgabe = kopplung.aus.join('\n');
        expect(ausgabe).to.not.contain(gespeichert.zugang);
        expect(ausgabe).to.not.contain(geheimnis);

        const sitzung = starte(['verbinden', '--datei', datei, '--bestaetigen']);
        await bis(() => sitzung.aus.some(z => z.startsWith('< {"t":"willkommen"')));
        sitzung.ein.write('abo zigbee.0.lampe.state\nsetze zigbee.0.lampe.state true\nsetze\n');
        await bis(() => sitzung.aus.some(z => z.startsWith('< {"t":"quittung"')));
        expect(sitzung.aus.filter(z => z.startsWith('! nicht gesendet'))).to.have.length(1);
        expect(sitzung.aus.some(z => z.startsWith('< {"t":"werte"'))).to.equal(true);
        const state = ablage.skript(appId!, 'hinweis.senden', 'Paket ist da');
        server.geaendert(`${NAMESPACE}.apps.${appId}.hinweis.senden`, state);
        await bis(() => ablage.werte_.get(appId!)?.['hinweis.status'] === 'angezeigt');
        sitzung.ein.write('ende\n');
        expect(await sitzung.ende).to.equal(0);
        expect(sitzung.aus.join('\n')).to.not.contain(gespeichert.zugang);
    });

    it('falscher Fingerabdruck: bricht im Handshake ab, der Zugang erreicht den Server nicht', async () => {
        const datei = join(ordner, 'falsch.local.json');
        const anderer = fingerabdruck(erzeugeIdentitaet(neueAdapterId()).zertifikat);
        writeFileSync(
            datei,
            JSON.stringify({
                adapterId,
                fingerabdruck: anderer,
                adressen: [`127.0.0.1:${server.heimnetz.port}`],
                app: 'abcdefgh',
                zugang: neuerZugang(),
            }),
        );
        const { aus, ende } = starte(['verbinden', '--datei', datei]);
        expect(await ende).to.equal(1);
        expect(aus).to.include(`! 127.0.0.1:${server.heimnetz.port}: Fingerabdruck passt nicht`);
        expect(aus).to.include('! keine Adresse erreichbar');
        await pause(100);
        expect(log.filter(z => z.includes('Anmeldung'))).to.deep.equal([]);
    });

    it('ohne Kopplung oder mit unbekannter Option: Hinweis statt Verbindung', async () => {
        expect(await starte(['verbinden', '--datei', join(ordner, 'fehlt.json')]).ende).to.equal(2);
        const falsch = starte(['verbinden', '--port', '1']);
        expect(await falsch.ende).to.equal(2);
        expect(falsch.aus[0]).to.contain('unbekannte Option --port');
    });
});
