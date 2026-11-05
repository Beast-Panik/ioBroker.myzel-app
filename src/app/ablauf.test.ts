import { expect } from 'chai';
import https from 'node:https';
import { type Duplex, duplexPair } from 'node:stream';
import tls from 'node:tls';
import WebSocket from 'ws';
import { Gegenstelle } from '../../werkzeuge/gegenstelle';
import { NAMESPACE, Speicherablage, Speicherquelle } from '../../test/speicher';
import { GRENZEN, type Grenzen, type Protokoll } from '../basis/grenzen';
import { SCHLIESSCODE } from '../basis/kern';
import { neueAdapterId, neuerZugang, sha256 } from '../basis/kodierung';
import { erzeugeIdentitaet, fingerabdruck } from '../basis/zertifikat';
import type { Karte, Profil } from './rechte';
import { type Server, starteServer } from './server';

interface Umgebung {
    server: Server;
    port: number;
    ablage: Speicherablage;
    quelle: Speicherquelle;
    log: string[];
}

const WOHNZIMMER = { de: 'Wohnzimmer', en: 'Living room' };
const LAMPE: Karte = {
    name: 'Lampe',
    typ: 'lampe',
    raum: 'enum.rooms.wohnzimmer',
    teile: { schalten: 'zigbee.0.lampe.state', helligkeit: 'zigbee.0.lampe.helligkeit' },
};
const familie = (teil: Partial<Profil>): Profil => ({
    name: 'Familie',
    raeume: [{ enum: 'enum.rooms.wohnzimmer', recht: 'schreiben' }],
    karten: [],
    gesperrt: [],
    ...teil,
});

function welt(log: Protokoll): Speicherquelle {
    return new Speicherquelle(log)
        .objekt_('system.config', { type: 'config', common: { language: 'de' } })
        .datenpunkt(
            'zigbee.0.lampe.state',
            { type: 'boolean', role: 'switch.light', name: { de: 'Lampe', en: 'Lamp' } },
            false,
        )
        .datenpunkt('zigbee.0.lampe.helligkeit', { type: 'number', min: 0, max: 100, unit: '%' }, 40)
        .datenpunkt(
            'zigbee.0.sensor.temperatur',
            { type: 'number', write: false, unit: '°C', name: { de: 'Temperatur', en: 'Temperature' } },
            21.5,
        )
        .datenpunkt('zigbee.0.tuer.offen', { type: 'boolean' }, false)
        .raum('wohnzimmer', WOHNZIMMER, [])
        .karte('lampe', LAMPE)
        .karte('temperatur', {
            name: 'Fühler',
            typ: 'messwert',
            raum: 'enum.rooms.wohnzimmer',
            teile: { wert1: 'zigbee.0.sensor.temperatur' },
        })
        .karte('tuer', { name: 'Tür', typ: 'messwert', raum: '', teile: { wert1: 'zigbee.0.tuer.offen' } })
        .profil('familie', familie({}));
}

const adapterId = neueAdapterId();
const identitaet = erzeugeIdentitaet(adapterId);
const fp = fingerabdruck(identitaet.zertifikat);
const geraet = { android: '15', appVersion: '1.0.0' };
// Kürzer als das Sammeln der Änderungen (100 ms), damit eine Rechteänderung vor der nächsten aenderung wirkt
const NEUBERECHNUNG_MS = 50;
const NACHLAUF_MS = 150;
const TEXTLAENGE = 20;
const HINWEISFRIST_MS = 3000;
const pause = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

async function abgewiesen(versuch: Promise<unknown>): Promise<string> {
    try {
        await versuch;
    } catch (fehler) {
        return (fehler as Error).message;
    }
    throw new Error('Verbindung wurde angenommen');
}

async function bis(bedingung: () => boolean, ms = 2000): Promise<void> {
    const ende = Date.now() + ms;
    while (!bedingung()) {
        if (Date.now() > ende) {
            throw new Error('Bedingung nicht erfüllt');
        }
        await pause(10);
    }
}

describe('Ablauf über TLS mit Kopplung und Anmeldung', function () {
    this.timeout(10_000);
    let u: Umgebung;
    let adressen: string[] = [];
    const geheimnisse: string[] = [];

    async function starte(
        aenderung: Partial<Grenzen> = {},
        ablage = new Speicherablage(),
        hinweisFristMs = HINWEISFRIST_MS,
        nachlaufMs = NACHLAUF_MS,
    ): Promise<void> {
        await u?.server.beende();
        const log: string[] = [];
        const protokoll: Protokoll = {
            debug: t => log.push(`debug ${t}`),
            info: t => log.push(`info ${t}`),
            warn: t => log.push(`warn ${t}`),
            error: t => log.push(`error ${t}`),
        };
        const quelle = welt(protokoll);
        let bereit!: () => void;
        const laeuft = new Promise<void>(r => (bereit = r));
        const server = await starteServer({
            adapterId,
            identitaet,
            ablage,
            port: 0,
            adressen: () => adressen,
            katalog: quelle.katalog,
            zustaende: quelle,
            log: protokoll,
            zustand: l => l && bereit(),
            grenzen: { ...GRENZEN, ...aenderung },
            neuberechnungMs: NEUBERECHNUNG_MS,
            nachlaufMs,
            textLaenge: TEXTLAENGE,
            hinweisFristMs,
            namespace: NAMESPACE,
        });
        await laeuft;
        quelle.beiAenderung = (id, state) => server.geaendert(id, state);
        u = { server, port: server.heimnetz.port!, ablage, quelle, log };
    }

    const verbinde = (o?: Parameters<typeof Gegenstelle.verbinde>[2]): Promise<Gegenstelle> =>
        Gegenstelle.verbinde(u.port, fp, o);

    async function kopple(
        profil = 'familie',
        version = 3,
    ): Promise<{
        g: Gegenstelle;
        appId: string;
        zugang: string;
        willkommen: Record<string, any>;
    }> {
        const { geheimnis } = u.server.kopplung.starte();
        geheimnisse.push(geheimnis);
        const g = await verbinde();
        g.sende({ t: 'koppeln', v: version, geheimnis, name: 'Tablet Flur', geraet });
        const anfrage = await u.server.kopplung.warte(2000);
        expect(anfrage?.name).to.equal('Tablet Flur');
        const appId = await u.server.dienst.kopplungAnnehmen(anfrage!, profil);
        const gekoppelt = await g.naechste();
        expect(gekoppelt).to.include({ t: 'gekoppelt', app: appId });
        geheimnisse.push(gekoppelt.zugang);
        return { g, appId: appId!, zugang: gekoppelt.zugang, willkommen: await g.naechste() };
    }

    async function melde(
        appId: string,
        zugang: string,
        o?: Parameters<typeof Gegenstelle.verbinde>[2],
        version = 3,
    ): Promise<Gegenstelle> {
        const g = await verbinde(o);
        g.sende({ t: 'hallo', v: version, app: appId, zugang, geraet });
        return g;
    }

    async function erwarteFehler(g: Gegenstelle, code: string, schliesscode: number): Promise<Record<string, any>> {
        const fehler = await g.naechste();
        expect(fehler).to.include({ t: 'fehler', code });
        expect((await g.geschlossen()).code).to.equal(schliesscode);
        return fehler;
    }

    beforeEach(() => {
        adressen = [];
        return starte();
    });
    afterEach(() => {
        for (const g of geheimnisse) {
            expect(u.log.join('\n'), 'Geheimnis im Log').to.not.contain(g);
        }
        geheimnisse.length = 0;
    });
    after(() => u.server.beende());

    it('spricht nur TLS 1.3 und zeigt das Zertifikat mit dem erwarteten Fingerabdruck', async () => {
        const alt = await new Promise<string>(resolve => {
            const s = tls.connect({
                host: '127.0.0.1',
                port: u.port,
                maxVersion: 'TLSv1.2',
                rejectUnauthorized: false,
            });
            s.on('secureConnect', () => resolve('verbunden'));
            s.on('error', (e: NodeJS.ErrnoException) => resolve(e.code ?? e.message));
        });
        expect(alt).to.not.equal('verbunden');
        const g = await verbinde();
        g.schliesse();
    });

    it('antwortet auf andere Pfade, Anfragen ohne Upgrade und mit Origin-Kopf nicht mit WebSocket', async () => {
        expect(await abgewiesen(verbinde({ pfad: '/v2' }))).to.contain('404');
        expect(await abgewiesen(verbinde({ kopf: { Origin: 'http://192.168.1.9' } }))).to.contain('403');
        const status = await new Promise<number | undefined>((resolve, reject) => {
            https
                .get({ host: '127.0.0.1', port: u.port, path: '/v1', rejectUnauthorized: false }, a =>
                    resolve(a.statusCode),
                )
                .on('error', reject);
        });
        expect(status).to.equal(404);
    });

    it('koppelt eine App, schickt gekoppelt und willkommen und legt sie mit Hash des Zugangs ab', async () => {
        const { g, appId, zugang, willkommen } = await kopple();
        expect(willkommen).to.deep.equal({
            t: 'willkommen',
            v: 3,
            adapter: adapterId,
            adressen: [`127.0.0.1:${u.port}`],
            handydaten: { akku: false, anruf: false, benachrichtigung: false },
            profil: 'Familie',
            raeume: [{ id: 'enum.rooms.wohnzimmer', name: 'Wohnzimmer' }],
            karten: [
                {
                    id: 'lampe',
                    name: 'Lampe',
                    typ: 'lampe',
                    raum: 'enum.rooms.wohnzimmer',
                    teile: {
                        schalten: { id: 'zigbee.0.lampe.state', typ: 'boolean', recht: 'schreiben' },
                        helligkeit: {
                            id: 'zigbee.0.lampe.helligkeit',
                            typ: 'number',
                            einheit: '%',
                            min: 0,
                            max: 100,
                            schritt: 1,
                            recht: 'schreiben',
                        },
                    },
                },
                {
                    id: 'temperatur',
                    name: 'Fühler',
                    typ: 'messwert',
                    raum: 'enum.rooms.wohnzimmer',
                    teile: {
                        wert1: {
                            id: 'zigbee.0.sensor.temperatur',
                            typ: 'number',
                            einheit: '°C',
                            recht: 'lesen',
                            name: 'Temperatur',
                        },
                    },
                },
            ],
        });
        const daten = u.ablage.apps.get(appId)!;
        expect(daten).to.include({
            name: 'Tablet Flur',
            profil: 'familie',
            zugangHash: sha256(zugang).toString('hex'),
        });
        expect(JSON.stringify(daten)).to.not.contain(zugang);
        expect(u.ablage.werte_.get(appId)).to.include({ online: true, weg: 'lokal' });
        g.schliesse();
        await bis(() => u.ablage.werte_.get(appId)?.online === false);
        expect(u.ablage.werte_.get(appId)?.zuletzt).to.be.a('number');
    });

    it('meldet eine gekoppelte App mit ihrem Zugang an und übernimmt neue Geräteangaben', async () => {
        const { g: erste, appId, zugang } = await kopple();
        erste.schliesse();
        const g = await verbinde();
        g.sende({ t: 'hallo', v: 3, app: appId, zugang, geraet: { android: '16', appVersion: '1.1.0' } });
        expect((await g.naechste()).t).to.equal('willkommen');
        expect(u.ablage.apps.get(appId)?.geraet).to.deep.equal({ android: '16', appVersion: '1.1.0' });
        g.schliesse();
    });

    it('lehnt unbekannte Apps und falsche Zugänge mit 4001 ab, ohne der App den Grund zu nennen', async () => {
        const { g: erste, appId } = await kopple();
        erste.schliesse();
        const falsch = await erwarteFehler(await melde(appId, neuerZugang()), 'zugang', SCHLIESSCODE.zugang);
        const unbekannt = await erwarteFehler(await melde('abcdefgh', neuerZugang()), 'zugang', SCHLIESSCODE.zugang);
        expect(falsch).to.deep.equal(unbekannt);
        expect(falsch).to.not.have.property('text');
        expect(u.log.join('\n')).to.contain(`Zugang der App ${appId} falsch`).and.contain('App abcdefgh unbekannt');
    });

    it('lehnt ein falsches Geheimnis mit 4001 ab', async () => {
        u.server.kopplung.starte();
        const g = await verbinde();
        g.sende({ t: 'koppeln', v: 3, geheimnis: 'A'.repeat(22), name: 'X', geraet });
        await erwarteFehler(g, 'zugang', SCHLIESSCODE.zugang);
    });

    it('nimmt ein Geheimnis nur einmal an', async () => {
        const { geheimnis } = u.server.kopplung.starte();
        const erste = await verbinde();
        erste.sende({ t: 'koppeln', v: 3, geheimnis, name: 'Erste', geraet });
        await u.server.kopplung.warte(2000);
        const zweite = await verbinde();
        zweite.sende({ t: 'koppeln', v: 3, geheimnis, name: 'Zweite', geraet });
        await erwarteFehler(zweite, 'zugang', SCHLIESSCODE.zugang);
        erste.schliesse();
    });

    it('falsche Geheimnisse machen den Schlüssel nicht ungültig, gesperrt wird nur die Adresse', async () => {
        await starte({ fehlversuche: 100 });
        const { geheimnis } = u.server.kopplung.starte();
        for (let i = 0; i < 6; i++) {
            const g = await verbinde();
            g.sende({ t: 'koppeln', v: 3, geheimnis: `${'B'.repeat(21)}${i}`, name: 'X', geraet });
            await erwarteFehler(g, 'zugang', SCHLIESSCODE.zugang);
        }
        const g = await verbinde();
        g.sende({ t: 'koppeln', v: 3, geheimnis, name: 'Richtig', geraet });
        expect((await u.server.kopplung.warte(2000))?.name).to.equal('Richtig');
        g.schliesse();
    });

    it('ein neuer Schlüssel macht den alten ungültig', async () => {
        const { geheimnis } = u.server.kopplung.starte();
        u.server.kopplung.starte();
        const g = await verbinde();
        g.sende({ t: 'koppeln', v: 3, geheimnis, name: 'X', geraet });
        await erwarteFehler(g, 'zugang', SCHLIESSCODE.zugang);
    });

    it('Ablehnung im Admin: fehler abgelehnt und 4005', async () => {
        const { geheimnis } = u.server.kopplung.starte();
        const g = await verbinde();
        g.sende({ t: 'koppeln', v: 3, geheimnis, name: 'X', geraet });
        u.server.kopplung.ablehnen((await u.server.kopplung.warte(2000))!);
        await erwarteFehler(g, 'abgelehnt', SCHLIESSCODE.abgelehnt);
    });

    it('wartende Kopplung läuft mit dem Schlüssel ab: fehler abgelaufen und 4006', async () => {
        await starte({ einmalMs: 300 });
        const { geheimnis } = u.server.kopplung.starte();
        const g = await verbinde();
        g.sende({ t: 'koppeln', v: 3, geheimnis, name: 'X', geraet });
        const anfrage = await u.server.kopplung.warte(2000);
        await erwarteFehler(g, 'abgelaufen', SCHLIESSCODE.abgelaufen);
        expect(await u.server.dienst.kopplungAnnehmen(anfrage!, 'familie')).to.equal(undefined);
        expect(u.ablage.apps.size).to.equal(0);
    });

    it('trennt eine App, die während der Kopplung schon Nachrichten schickt', async () => {
        const { geheimnis } = u.server.kopplung.starte();
        const g = await verbinde();
        g.sende({ t: 'koppeln', v: 3, geheimnis, name: 'X', geraet });
        const anfrage = await u.server.kopplung.warte(2000);
        g.sende({ t: 'abo', ids: [] });
        await erwarteFehler(g, 'ungueltig', SCHLIESSCODE.ungueltig);
        expect(await u.server.dienst.kopplungAnnehmen(anfrage!, 'familie')).to.equal(undefined);
    });

    it('andere Protokollversion: fehler version mit den unterstützten Versionen und 4002', async () => {
        const g = await verbinde();
        g.sende({ t: 'hallo', v: 6, app: 'abcdefgh', zugang: neuerZugang(), geraet, neu: true });
        const fehler = await erwarteFehler(g, 'version', SCHLIESSCODE.version);
        expect(fehler.unterstuetzt).to.deep.equal([3, 4, 5]);
        const alt = await verbinde();
        alt.sende({ t: 'koppeln', v: 2, geheimnis: 'A'.repeat(22), name: 'X', geraet });
        expect((await erwarteFehler(alt, 'version', SCHLIESSCODE.version)).unterstuetzt).to.deep.equal([3, 4, 5]);
    });

    it('Etagen nur für Apps ab Version 5, auch leer; ältere bekommen keine', async () => {
        const neu = await kopple('familie', 5);
        expect(neu.willkommen).to.include({ v: 5 }).and.have.deep.property('etagen', []);
        neu.g.schliesse();
        const alt = await kopple('familie', 4);
        expect(alt.willkommen).to.not.have.property('etagen');
        alt.g.schliesse();
    });

    it('spricht Version 3 und 4 und antwortet in der Version der App', async () => {
        const { g, appId, zugang, willkommen } = await kopple('familie', 4);
        expect(willkommen).to.include({ t: 'willkommen', v: 4 });
        g.schliesse();
        await bis(() => u.ablage.werte_.get(appId)?.online === false);
        const alt = await melde(appId, zugang);
        expect(await alt.naechste()).to.include({ t: 'willkommen', v: 3 });
        alt.schliesse();
    });

    const vorher: [string, string | Buffer][] = [
        ['kaputtes JSON', '{"t":'],
        ['Binärframe', Buffer.from('{"t":"hallo"}')],
        ['abo vor der Anmeldung', '{"t":"abo","ids":[]}'],
        ['hallo mit falschem Feld', JSON.stringify({ t: 'hallo', v: 3, app: 'ABCDEFGH', zugang: 'x', geraet })],
    ];
    for (const [fall, daten] of vorher) {
        it(`vor der Anmeldung trennt jeder Fehler mit 4003: ${fall}`, async () => {
            const g = await verbinde();
            g.sendeRoh(daten);
            await erwarteFehler(g, 'ungueltig', SCHLIESSCODE.ungueltig);
        });
    }

    it('trennt ohne Anmeldung innerhalb der Frist mit 4009', async () => {
        await starte({ anmeldungMs: 200 });
        const g = await verbinde();
        expect((await g.geschlossen()).code).to.equal(SCHLIESSCODE.frist);
    });

    it('trennt nackte TCP-Verbindungen ohne TLS nach der Frist', async () => {
        await starte({ anmeldungMs: 200 });
        const net = await import('node:net');
        const roh = net.connect(u.port, '127.0.0.1');
        await new Promise(r => roh.on('close', r));
    });

    it('sperrt eine Adresse nach 5 Fehlversuchen', async () => {
        for (let i = 0; i < 5; i++) {
            await erwarteFehler(await melde('abcdefgh', neuerZugang()), 'zugang', SCHLIESSCODE.zugang);
        }
        await abgewiesen(verbinde());
        expect(u.log.join('\n')).to.contain('Adresse 127.0.0.1 nach wiederholten Fehlversuchen gesperrt');
    });

    it('begrenzt Verbindungen ohne Anmeldung je Adresse', async () => {
        const offen = await Promise.all([1, 2, 3, 4, 5].map(() => verbinde()));
        await abgewiesen(verbinde());
        offen.forEach(g => g.schliesse());
    });

    it('begrenzt Verbindungen ohne Anmeldung je IPv6-/64, nicht je Adresse', async () => {
        const von = (adresse: string): Promise<Gegenstelle> => {
            const [kernSeite, appSeite] = duplexPair();
            kernSeite.on('close', () => appSeite.destroy());
            u.server.nimm(kernSeite, { weg: 'lokal', adresse });
            return verbinde({ strom: appSeite });
        };
        const offen = await Promise.all([1, 2, 3, 4, 5].map(i => von(`2001:db8:0:1::${i}`)));
        await abgewiesen(von('2001:db8:0:1::99'));
        (await von('2001:db8:0:2::1')).schliesse();
        offen.forEach(g => g.schliesse());
    });

    it('begrenzt Verbindungen ohne Anmeldung insgesamt, angemeldete zählen nicht mit', async () => {
        await starte({ ohneAnmeldung: 3 });
        const { g } = await kopple();
        const offen = await Promise.all([1, 2, 3].map(() => verbinde()));
        await abgewiesen(verbinde());
        expect(u.log.join('\n')).to.contain('3 Verbindungen ohne Anmeldung insgesamt');
        [g, ...offen].forEach(o => o.schliesse());
    });

    it('eine abgelaufene Anmeldefrist zählt als Fehlversuch', async () => {
        await starte({ anmeldungMs: 100, fehlversuche: 2 });
        for (let i = 0; i < 2; i++) {
            expect((await (await verbinde()).geschlossen()).code).to.equal(SCHLIESSCODE.frist);
        }
        await abgewiesen(verbinde());
        expect(u.log.join('\n')).to.contain('Adresse 127.0.0.1 nach wiederholten Fehlversuchen gesperrt');
    });

    it('eine neue Sitzung derselben App ersetzt die alte mit 4007, die App bleibt online', async () => {
        const { g: alt, appId, zugang } = await kopple();
        const neu = await melde(appId, zugang);
        expect((await neu.naechste()).t).to.equal('willkommen');
        expect((await alt.geschlossen()).code).to.equal(SCHLIESSCODE.ersetzt);
        await pause(50);
        expect(u.ablage.werte_.get(appId)?.online).to.equal(true);
        neu.schliesse();
    });

    it('nach der Anmeldung: fehler ungueltig mit laufender Nummer, die dritte ungültige Nachricht trennt', async () => {
        const { g } = await kopple();
        g.sende({ t: 'setze', n: 4, id: 'a.b*', val: 1 });
        expect(await g.naechste()).to.include({ t: 'fehler', code: 'ungueltig', n: 4 });
        g.sende({ t: 'hallo', v: 3, app: 'abcdefgh', zugang: neuerZugang(), geraet });
        expect(await g.naechste()).to.include({ t: 'fehler', code: 'ungueltig', text: 'hallo nach der Anmeldung' });
        g.sendeRoh('kaputt');
        await erwarteFehler(g, 'ungueltig', SCHLIESSCODE.ungueltig);
    });

    it('Ratenbegrenzung: zuviel, bei anhaltender Überlast Trennung mit 4004', async () => {
        await starte({ nachrichtenJeSekunde: 5, nachrichtenStoss: 5, ueberlastMs: 300, ueberlastPauseMs: 200 });
        const { g } = await kopple();
        const ende = Date.now() + 1000;
        let geschlossen = false;
        void g.geschlossen(3000).then(() => (geschlossen = true));
        while (!geschlossen && Date.now() < ende) {
            g.sende({ t: 'abo', ids: [] });
            await pause(5);
        }
        const codes = (await g.alle()).map(n => n.code);
        expect(codes).to.include('zuviel');
        expect((await g.geschlossen()).code).to.equal(SCHLIESSCODE.zuviel);
    });

    it('trennt bei Nachrichten über 64 KiB', async () => {
        const { g } = await kopple();
        g.sendeRoh(JSON.stringify({ t: 'abo', ids: ['x'.repeat(65 * 1024)] }));
        expect((await g.geschlossen()).code).to.equal(1009);
    });

    it('beantwortet Pings nur, solange die Gegenstelle mitliest', async () => {
        await starte({ sendepufferBytes: 64 * 1024 });
        const ws = new WebSocket(`wss://127.0.0.1:${u.port}/v1`, { rejectUnauthorized: false });
        ws.on('error', () => undefined);
        await new Promise(r => ws.on('open', r));
        (ws as unknown as { _socket: Duplex })._socket.pause();
        const getrennt = (): boolean => u.log.some(z => z.includes('Gegenstelle nimmt keine Nachrichten ab'));
        for (let runde = 0; runde < 400 && !getrennt(); runde++) {
            for (let i = 0; i < 1000; i++) {
                ws.ping(Buffer.alloc(125));
            }
            await pause(5);
        }
        expect(getrennt()).to.equal(true);
        ws.terminate();
    });

    it('trennt eine Gegenstelle, die nicht auf Pings antwortet', async () => {
        await starte({ pingMs: 50, totMs: 150 });
        const { g } = await kopple();
        const still = await verbinde({ autoPong: false });
        expect((await still.geschlossen()).code).to.equal(1006);
        g.schliesse();
    });

    it('ohne Profil sieht eine App nichts', async () => {
        const { g, willkommen } = await kopple('');
        expect(willkommen).to.include({ profil: '' });
        expect(willkommen.karten).to.deep.equal([]);
        g.sende({ t: 'abo', ids: ['zigbee.0.lampe.state'] });
        expect(await g.naechste()).to.include({ t: 'fehler', code: 'rechte' });
        expect(await g.naechste()).to.deep.equal({ t: 'werte', werte: {} });
        g.schliesse();
    });

    it('abo liefert werte nur für erlaubte IDs, Änderungen kommen gesammelt als aenderung', async () => {
        const { g } = await kopple();
        g.sende({ t: 'abo', ids: ['zigbee.0.lampe.state', 'zigbee.0.lampe.helligkeit', 'zigbee.0.tuer.offen'] });
        const fehler = await g.naechste();
        expect(fehler).to.include({ t: 'fehler', code: 'rechte' });
        expect(fehler.text).to.contain('zigbee.0.tuer.offen');
        expect(await g.naechste()).to.deep.equal({
            t: 'werte',
            werte: {
                'zigbee.0.lampe.state': { val: false, ack: true, ts: 1793720000000 },
                'zigbee.0.lampe.helligkeit': { val: 40, ack: true, ts: 1793720000000 },
            },
        });
        u.quelle.extern('zigbee.0.tuer.offen', true);
        u.quelle.extern('zigbee.0.lampe.state', true, true, 1793720001000);
        u.quelle.extern('zigbee.0.lampe.helligkeit', 50, true, 1793720001000);
        expect(await g.naechste()).to.deep.equal({
            t: 'aenderung',
            werte: {
                'zigbee.0.lampe.state': { val: true, ack: true, ts: 1793720001000 },
                'zigbee.0.lampe.helligkeit': { val: 50, ack: true, ts: 1793720001000 },
            },
        });
        await pause(150);
        expect(await g.alle()).to.deep.equal([]);
        g.schliesse();
    });

    it('große werte kommen in Teilen, ohne den Sendepuffer zu sprengen', async () => {
        await starte({ sendepufferBytes: 64 * 1024, teilBytes: 16 * 1024 });
        for (let i = 0; i < 40; i++) {
            u.quelle.datenpunkt(`zigbee.0.lampe.text${i}`, { type: 'string' }, `${i}`.padEnd(10_000, 'x'));
        }
        for (let k = 0; k < 10; k++) {
            const teile = Object.fromEntries(
                [1, 2, 3, 4].map(w => [`wert${w}`, `zigbee.0.lampe.text${k * 4 + w - 1}`]),
            );
            u.quelle.karte(`text${k}`, { name: `Text ${k}`, typ: 'messwert', raum: 'enum.rooms.wohnzimmer', teile });
        }
        const { g, willkommen } = await kopple();
        const ids: string[] = willkommen.karten.flatMap((k: { teile: Record<string, { id: string }> }) =>
            Object.values(k.teile).map(t => t.id),
        );
        expect(ids).to.have.length(43);
        g.sende({ t: 'abo', ids });
        const erhalten: string[] = [];
        while (erhalten.length < ids.length) {
            const teil = await g.naechste();
            expect(teil.t).to.equal('werte');
            expect(JSON.stringify(teil).length).to.be.below(32 * 1024);
            erhalten.push(...Object.keys(teil.werte));
        }
        expect(erhalten.sort()).to.deep.equal([...ids].sort());
        expect(u.log.join('\n')).to.not.contain('nimmt keine Nachrichten ab');
        g.schliesse();
    });

    // Am echten ioBroker gefunden: Schnell an und aus, das Gerät bestätigte „aus“ mit der Zeit seines Gateways, etwas
    // älter als der zuletzt gesendete Befehl. Die App zeigte danach dauerhaft „an“.
    it('eine Bestätigung mit älterem Zeitstempel kommt trotzdem an; es gilt die zuletzt gemeldete Änderung', async () => {
        const { g } = await kopple();
        g.sende({ t: 'abo', ids: ['zigbee.0.lampe.state'] });
        await g.naechste();
        g.sende({ t: 'setze', n: 1, id: 'zigbee.0.lampe.state', val: false });
        await g.naechste();
        const befehl = await g.naechste();
        expect(befehl.werte['zigbee.0.lampe.state']).to.include({ val: false, ack: false });
        const ts = befehl.werte['zigbee.0.lampe.state'].ts as number;
        u.quelle.extern('zigbee.0.lampe.state', false, true, ts - 500);
        expect((await g.naechste()).werte['zigbee.0.lampe.state']).to.deep.equal({
            val: false,
            ack: true,
            ts: ts - 500,
        });
        u.quelle.extern('zigbee.0.lampe.state', true, true, ts - 1000);
        expect((await g.naechste()).werte['zigbee.0.lampe.state']).to.include({ val: true, ack: true });
        g.schliesse();
    });

    it('ein neues Abo ersetzt das alte', async () => {
        const { g } = await kopple();
        g.sende({ t: 'abo', ids: ['zigbee.0.lampe.state', 'zigbee.0.lampe.helligkeit'] });
        await g.naechste();
        g.sende({ t: 'abo', ids: ['zigbee.0.lampe.helligkeit'] });
        expect(Object.keys((await g.naechste()).werte)).to.deep.equal(['zigbee.0.lampe.helligkeit']);
        expect(u.quelle.abonniert).to.deep.equal(new Set(['zigbee.0.lampe.helligkeit']));
        u.quelle.extern('zigbee.0.lampe.state', true);
        await pause(150);
        expect(await g.alle()).to.deep.equal([]);
        g.schliesse();
    });

    it('zwei Apps teilen ein Abo in ioBroker, gekündigt wird mit dem letzten', async () => {
        const erste = (await kopple()).g;
        const zweite = (await kopple()).g;
        for (const g of [erste, zweite]) {
            g.sende({ t: 'abo', ids: ['zigbee.0.lampe.state'] });
            await g.naechste();
        }
        expect(u.quelle.aufrufe.filter(a => a.startsWith('abonniere'))).to.deep.equal([
            'abonniere zigbee.0.lampe.state',
        ]);
        erste.schliesse();
        await pause(100);
        expect(u.quelle.abonniert.has('zigbee.0.lampe.state')).to.equal(true);
        zweite.schliesse();
        await bis(() => !u.quelle.abonniert.has('zigbee.0.lampe.state'));
    });

    it('setze schreibt mit ack=false, quittiert und meldet die Bestätigung als aenderung', async () => {
        const { g, appId } = await kopple();
        g.sende({ t: 'abo', ids: ['zigbee.0.lampe.state'] });
        await g.naechste();
        g.sende({ t: 'setze', n: 1, id: 'zigbee.0.lampe.state', val: true });
        expect(await g.naechste()).to.deep.equal({ t: 'quittung', n: 1, ok: true });
        expect(u.quelle.zustaende_.get('zigbee.0.lampe.state')).to.include({
            val: true,
            ack: false,
            c: `App ${appId}`,
        });
        expect((await g.naechste()).werte['zigbee.0.lampe.state']).to.include({ val: true, ack: false });
        u.quelle.extern('zigbee.0.lampe.state', true, true);
        expect((await g.naechste()).werte['zigbee.0.lampe.state']).to.include({ val: true, ack: true });
        g.schliesse();
    });

    const abgelehnt: [string, string, unknown, string][] = [
        ['nur lesen', 'zigbee.0.sensor.temperatur', 20, 'rechte'],
        ['nicht im Profil', 'zigbee.0.tuer.offen', true, 'rechte'],
        ['über max', 'zigbee.0.lampe.helligkeit', 101, 'ungueltig'],
        ['falscher Typ', 'zigbee.0.lampe.helligkeit', '50', 'ungueltig'],
    ];
    for (const [fall, id, val, fehler] of abgelehnt) {
        it(`setze lehnt ab und schreibt nichts: ${fall}`, async () => {
            const { g } = await kopple();
            const vorher = structuredClone(u.quelle.zustaende_.get(id));
            g.sende({ t: 'setze', n: 9, id, val });
            expect(await g.naechste()).to.deep.equal({ t: 'quittung', n: 9, ok: false, fehler });
            expect(u.quelle.zustaende_.get(id)).to.deep.equal(vorher);
            g.schliesse();
        });
    }

    it('ändert sich das Profil, bekommt die App rechte, entfallene IDs fallen aus dem Abo', async () => {
        const { g } = await kopple();
        g.sende({ t: 'abo', ids: ['zigbee.0.lampe.state', 'zigbee.0.sensor.temperatur'] });
        await g.naechste();
        u.quelle.extern('zigbee.0.sensor.temperatur', 23);
        u.quelle.profil(
            'familie',
            familie({ raeume: [{ enum: 'enum.rooms.wohnzimmer', recht: 'lesen' }], gesperrt: ['temperatur'] }),
        );
        const rechte = await g.naechste();
        expect(rechte).to.include({ t: 'rechte', profil: 'Familie' });
        expect(
            rechte.karten.map((k: { id: string; teile: Record<string, { recht: string }> }) => [
                k.id,
                Object.values(k.teile).map(t => t.recht),
            ]),
        ).to.deep.equal([['lampe', ['lesen', 'lesen']]]);
        await bis(() => !u.quelle.abonniert.has('zigbee.0.sensor.temperatur'));
        expect(u.quelle.abonniert).to.deep.equal(new Set(['zigbee.0.lampe.state']));
        await pause(150);
        expect(await g.alle(), 'keine aenderung für den gesperrten Datenpunkt').to.deep.equal([]);
        g.sende({ t: 'setze', n: 1, id: 'zigbee.0.lampe.state', val: true });
        expect(await g.naechste()).to.deep.equal({ t: 'quittung', n: 1, ok: false, fehler: 'rechte' });
        g.schliesse();
    });

    it('sammelt Änderungen zu einem rechte und schickt keins, wenn das Ergebnis gleich bleibt', async () => {
        const { g } = await kopple();
        u.quelle
            .datenpunkt('zigbee.0.lampe.farbe', { type: 'string' })
            .entferne('zigbee.0.sensor.temperatur')
            .karte('lampe', { ...LAMPE, teile: { ...LAMPE.teile, farbe: 'zigbee.0.lampe.farbe' } });
        const rechte = await g.naechste();
        expect(
            rechte.karten.map((k: { id: string; teile: Record<string, unknown> }) => [k.id, Object.keys(k.teile)]),
        ).to.deep.equal([['lampe', ['schalten', 'helligkeit', 'farbe']]]);
        u.quelle.datenpunkt('anderer.0.wert', { type: 'number' }).raum('kueche', 'Küche', ['anderer.0']);
        await pause(150);
        expect(await g.alle()).to.deep.equal([]);
        g.schliesse();
    });

    it('ein anderes Profil für die App wirkt sofort', async () => {
        const { g, appId } = await kopple();
        u.quelle.profil('gast', {
            name: 'Gast',
            raeume: [],
            karten: [{ id: 'tuer', recht: 'lesen' }],
            gesperrt: [],
        });
        await u.ablage.aendere(appId, { profil: 'gast' });
        u.quelle.app(appId, u.ablage.apps.get(appId));
        const rechte = await g.naechste();
        expect(rechte).to.include({ t: 'rechte', profil: 'Gast' });
        expect(rechte.karten.map((k: { id: string }) => k.id)).to.deep.equal(['tuer']);
        expect(rechte.raeume).to.deep.equal([]);
        g.schliesse();
    });

    it('neue Systemsprache: rechte mit Namen in dieser Sprache', async () => {
        const { g } = await kopple();
        u.quelle.objekt_('system.config', { type: 'config', common: { language: 'en' } });
        const rechte = await g.naechste();
        expect(rechte.raeume[0]).to.include({ name: 'Living room' });
        expect(rechte.karten[1].teile.wert1.name).to.equal('Temperature');
        g.schliesse();
    });

    it('ändert sich eine Karte, bekommt die App rechte; ein entfallenes Teil lässt sich nicht mehr setzen', async () => {
        const { g } = await kopple();
        u.quelle.karte('lampe', { ...LAMPE, name: 'Stehlampe', teile: { schalten: 'zigbee.0.lampe.state' } });
        const rechte = await g.naechste();
        expect(rechte.karten[0]).to.deep.include({ name: 'Stehlampe' });
        expect(Object.keys(rechte.karten[0].teile)).to.deep.equal(['schalten']);
        g.sende({ t: 'setze', n: 1, id: 'zigbee.0.lampe.helligkeit', val: 10 });
        expect(await g.naechste()).to.deep.equal({ t: 'quittung', n: 1, ok: false, fehler: 'rechte' });
        g.schliesse();
    });

    it('trennt mit 4008, wenn die App entfernt wird oder ihr Zugang sich ändert', async () => {
        const erste = await kopple();
        u.ablage.apps.delete(erste.appId);
        u.quelle.app(erste.appId, undefined);
        expect((await erste.g.geschlossen()).code).to.equal(SCHLIESSCODE.entfernt);
        const zweite = await kopple();
        await u.ablage.aendere(zweite.appId, { zugangHash: sha256(neuerZugang()).toString('hex') });
        u.quelle.app(zweite.appId, u.ablage.apps.get(zweite.appId));
        expect((await zweite.g.geschlossen()).code).to.equal(SCHLIESSCODE.entfernt);
        expect(u.log.join('\n')).to.contain(`App ${zweite.appId} entfernt oder Zugang geändert`);
    });

    async function mitHandydaten(version = 3): Promise<{ g: Gegenstelle; appId: string }> {
        const { g, appId } = await kopple('familie', version);
        await u.ablage.aendere(appId, { handydaten: { akku: true, anruf: true, benachrichtigung: true } });
        u.quelle.app(appId, u.ablage.apps.get(appId));
        const rechte = await g.naechste();
        expect(rechte).to.include({ t: 'rechte' });
        expect(rechte.handydaten).to.deep.equal({ akku: true, anruf: true, benachrichtigung: true });
        return { g, appId };
    }
    const vorhin = (): number => Date.now() - 1000;

    it('wird die App während der Anmeldung entfernt, bekommt sie kein willkommen', async () => {
        const { g, appId, zugang } = await kopple();
        g.schliesse();
        const lies = u.ablage.lies.bind(u.ablage);
        let aufrufe = 0;
        u.ablage.lies = async id => {
            const daten = await lies(id);
            if (++aufrufe === 2) {
                await u.server.dienst.entferne(appId);
            }
            return daten;
        };
        const neu = await melde(appId, zugang);
        expect((await neu.geschlossen()).code).to.equal(SCHLIESSCODE.entfernt);
        expect((await neu.alle()).map(n => n.t)).to.deep.equal([]);
    });

    it('ausgeschaltete Handydaten: fehler aus, nichts geschrieben', async () => {
        const { g, appId } = await kopple();
        g.sende({ t: 'akku', stand: 80, laedt: false, zeit: vorhin() });
        expect(await g.naechste()).to.include({ t: 'fehler', code: 'aus' });
        g.sende({ t: 'anruf', status: 'frei', zeit: vorhin() });
        expect(await g.naechste()).to.include({ t: 'fehler', code: 'aus' });
        expect(u.ablage.geschrieben.filter(e => /\.(akku|anruf)\./.test(e) && e.startsWith(appId))).to.deep.equal([]);
        g.schliesse();
    });

    it('Akku und Anruf: ack=true, Zeit vom Handy, Status zuletzt, fehlende Angaben leer', async () => {
        const { g, appId } = await mitHandydaten();
        const zeit = vorhin();
        geheimnisse.push('+4930123456', 'Erika Mustermann');
        g.sende({ t: 'akku', stand: 80, laedt: true, zeit });
        g.sende({
            t: 'anruf',
            status: 'klingelt',
            richtung: 'eingehend',
            nummer: '+4930123456',
            name: 'Erika Mustermann',
            zeit,
        });
        g.sende({ t: 'anruf', status: 'frei', zeit: zeit + 1 });
        await bis(() => u.ablage.geschrieben.some(e => e.startsWith(`${appId}.anruf.status=frei`)));
        expect(u.ablage.geschrieben.filter(e => /\.(akku|anruf)\./.test(e))).to.deep.equal([
            `${appId}.akku.stand=80@${zeit}`,
            `${appId}.akku.laedt=true@${zeit}`,
            `${appId}.anruf.richtung=eingehend@${zeit}`,
            `${appId}.anruf.nummer=+4930123456@${zeit}`,
            `${appId}.anruf.name=Erika Mustermann@${zeit}`,
            `${appId}.anruf.status=klingelt@${zeit}`,
            `${appId}.anruf.richtung=@${zeit + 1}`,
            `${appId}.anruf.nummer=@${zeit + 1}`,
            `${appId}.anruf.name=@${zeit + 1}`,
            `${appId}.anruf.status=frei@${zeit + 1}`,
        ]);
        expect(await g.alle()).to.deep.equal([]);
        g.schliesse();
    });

    it('Benachrichtigung: erst in den Ordner der App, dann in letzte, gekürzt nach Zeichen, json je zuletzt', async () => {
        const { g, appId } = await mitHandydaten();
        const zeit = vorhin();
        const titel = '😀'.repeat(30);
        const text = `${'x'.repeat(19)}😀😀`;
        geheimnisse.push(titel.slice(0, 10), text);
        g.sende({ t: 'benachrichtigung', app: 'Signal', paket: 'org.thoughtcrime.securesms', titel, text, zeit });
        await bis(() => u.ablage.geschrieben.some(e => e.includes('.letzte.json=')));
        const eintraege = u.ablage.geschrieben.filter(e => e.includes('.benachrichtigungen.'));
        const namen = ['app', 'paket', 'titel', 'text', 'zeit', 'json'];
        expect(eintraege.map(e => /\.benachrichtigungen\.([\w-]+\.\w+)=/.exec(e)?.[1])).to.deep.equal([
            ...namen.map(n => `org-thoughtcrime-securesms.${n}`),
            ...namen.map(n => `letzte.${n}`),
        ]);
        expect(eintraege.every(e => e.endsWith(`@${zeit}`))).to.equal(true);
        expect([...u.ablage.ordner_.get(appId)!]).to.deep.equal([
            ['org-thoughtcrime-securesms', 'Signal'],
            ['letzte', 'Letzte Benachrichtigung'],
        ]);
        for (const ordner of ['org-thoughtcrime-securesms', 'letzte']) {
            const wert = (n: string): ioBroker.StateValue | undefined =>
                u.ablage.zustaende_.get(`${appId}.benachrichtigungen.${ordner}.${n}`)?.val;
            expect(wert('titel')).to.equal('😀'.repeat(20));
            expect(wert('text')).to.equal(`${'x'.repeat(19)}😀`);
            expect(JSON.parse(wert('json') as string)).to.deep.equal({
                app: 'Signal',
                paket: 'org.thoughtcrime.securesms',
                titel: '😀'.repeat(20),
                text: `${'x'.repeat(19)}😀`,
                zeit,
                nachgeliefert: false,
            });
        }
        g.schliesse();
    });

    it('Auswahl: legt je App einen Ordner an, benennt um, entfernt abgewählte und lässt letzte stehen', async () => {
        const { g, appId } = await mitHandydaten(4);
        g.sende({ t: 'benachrichtigung', app: 'Signal', paket: 'org.signal', text: 'Hallo', zeit: vorhin() });
        await bis(() => u.ablage.geschrieben.some(e => e.includes('.letzte.json=')));
        g.sende({
            t: 'auswahl',
            apps: [
                { paket: 'org.signal', app: 'Signal Messenger' },
                { paket: 'com.whatsapp', app: 'WhatsApp' },
                { paket: 'com.whatsapp', app: 'WhatsApp Business' },
            ],
        });
        await bis(() => u.ablage.ordner_.get(appId)?.has('com-whatsapp') === true);
        expect(Object.fromEntries(u.ablage.ordner_.get(appId)!)).to.deep.equal({
            'org-signal': 'Signal Messenger',
            letzte: 'Letzte Benachrichtigung',
            'com-whatsapp': 'WhatsApp Business',
        });
        g.sende({ t: 'auswahl', apps: [{ paket: 'de.dkb.portalapp', app: 'DKB' }] });
        await bis(() => u.ablage.ordner_.get(appId)?.has('de-dkb-portalapp') === true);
        expect([...u.ablage.ordner_.get(appId)!.keys()].sort()).to.deep.equal(['de-dkb-portalapp', 'letzte']);
        expect(u.ablage.zustaende_.has(`${appId}.benachrichtigungen.org-signal.text`)).to.equal(false);
        expect(u.ablage.zustaende_.get(`${appId}.benachrichtigungen.letzte.text`)?.val).to.equal('Hallo');
        g.sende({ t: 'auswahl', apps: [] });
        await bis(() => !u.ablage.ordner_.get(appId)?.has('de-dkb-portalapp'));
        expect([...u.ablage.ordner_.get(appId)!.keys()]).to.deep.equal(['letzte']);
        expect(u.log.join('\n')).to.not.contain('DKB').and.not.contain('dkb');
        g.schliesse();
    });

    it('Auswahl bei ausgeschalteten Benachrichtigungen: fehler aus, kein Ordner', async () => {
        const { g, appId } = await kopple('familie', 4);
        g.sende({ t: 'auswahl', apps: [{ paket: 'org.signal', app: 'Signal' }] });
        expect(await g.naechste()).to.include({ t: 'fehler', code: 'aus' });
        expect(u.ablage.ordner_.has(appId)).to.equal(false);
        g.schliesse();
    });

    it('scheitert das Schreiben, bekommt die App fehler intern, das Log keinen Inhalt', async () => {
        const { g, appId } = await mitHandydaten();
        geheimnisse.push('Geheime Nachricht');
        u.ablage.scheitern = true;
        g.sende({
            t: 'benachrichtigung',
            app: 'Signal',
            paket: 'org.signal',
            text: 'Geheime Nachricht',
            zeit: vorhin(),
        });
        expect(await g.naechste()).to.include({ t: 'fehler', code: 'intern' });
        expect(u.log.join('\n')).to.contain(`App ${appId}: benachrichtigung nicht geschrieben`);
        u.ablage.scheitern = false;
        g.schliesse();
    });

    it('Anwesenheit: true über das Heimnetz, false erst nach dem Nachlauf, neue Anmeldung bricht ihn ab', async () => {
        const { g, appId, zugang } = await kopple();
        const anwesend = (): unknown => u.ablage.werte_.get(appId)?.anwesend;
        await bis(() => anwesend() === true);
        g.schliesse();
        await bis(() => u.ablage.werte_.get(appId)?.online === false);
        const wieder = await melde(appId, zugang);
        expect((await wieder.naechste()).t).to.equal('willkommen');
        await pause(NACHLAUF_MS + 50);
        expect(anwesend()).to.equal(true);
        wieder.schliesse();
        await pause(NACHLAUF_MS / 2);
        expect(anwesend()).to.equal(true);
        await bis(() => anwesend() === false, NACHLAUF_MS * 3);
    });

    it('eine entfernte App ist sofort abwesend, auch wenn ihr Nachlauf schon läuft', async () => {
        await starte({}, new Speicherablage(), HINWEISFRIST_MS, 60_000);
        const verbunden = await kopple();
        const getrennt = await kopple();
        getrennt.g.schliesse();
        await bis(() => u.ablage.werte_.get(getrennt.appId)?.online === false);
        expect(u.ablage.werte_.get(getrennt.appId)?.anwesend).to.equal(true);
        await u.server.dienst.entferne(getrennt.appId);
        expect(u.ablage.werte_.get(getrennt.appId)?.anwesend).to.equal(false);
        await u.server.dienst.entferne(verbunden.appId);
        await verbunden.g.geschlossen();
        await bis(() => u.ablage.werte_.get(verbunden.appId)?.anwesend === false);
        expect(u.ablage.werte_.get(verbunden.appId)?.online).to.equal(false);
    });

    it('nach einem Neustart laufen Apps, die anwesend waren, in den Nachlauf', async () => {
        const ablage = new Speicherablage();
        await ablage.lege('abcdefgh', {
            name: 'Tablet',
            zugangHash: sha256(neuerZugang()).toString('hex'),
            profil: 'familie',
            handydaten: { akku: false, anruf: false, benachrichtigung: false },
            gekoppeltAm: Date.now(),
            geraet,
        });
        await ablage.schreibe('abcdefgh', { online: true, anwesend: true });
        await starte({}, ablage);
        expect(ablage.werte_.get('abcdefgh')).to.include({ online: false, anwesend: true });
        await bis(() => ablage.werte_.get('abcdefgh')?.anwesend === false, NACHLAUF_MS * 3);
    });

    // Wie ein Skript: hinweis.senden ohne ack schreiben, dann der stateChange, den ioBroker auslöst
    function sendeHinweis(appId: string, val: ioBroker.StateValue, ts?: number): ioBroker.State {
        const state = u.ablage.skript(appId, 'hinweis.senden', val, ts);
        u.server.geaendert(`${NAMESPACE}.apps.${appId}.hinweis.senden`, state);
        return state;
    }
    const hinweisstatus = (appId: string): unknown => u.ablage.werte_.get(appId)?.['hinweis.status'];
    async function getrennt(): Promise<{ appId: string; zugang: string }> {
        const { g, appId, zugang } = await kopple();
        g.schliesse();
        await bis(() => u.ablage.werte_.get(appId)?.online === false);
        return { appId, zugang };
    }

    it('Hinweis an eine verbundene App: sofort hinweis und gesendet, nach angezeigt Status angezeigt und ack=true', async () => {
        const { g, appId } = await kopple();
        geheimnisse.push('Waschmaschine Keller', 'Programm beendet um 14 Uhr');
        const state = sendeHinweis(
            appId,
            JSON.stringify({ titel: 'Waschmaschine Keller', text: 'Programm beendet um 14 Uhr', wichtigkeit: 'hoch' }),
        );
        const hinweis = await g.naechste();
        expect(hinweis).to.deep.include({
            t: 'hinweis',
            titel: 'Waschmaschine Keller',
            text: 'Programm beendet um 14 Uhr',
            wichtigkeit: 'hoch',
            zeit: state.ts,
        });
        expect(hinweis.id).to.match(/^[A-Za-z0-9_-]{8}$/);
        await bis(() => hinweisstatus(appId) === 'gesendet');
        expect(u.ablage.zustaende_.get(`${appId}.hinweis.senden`)?.ack).to.equal(false);
        g.sende({ t: 'angezeigt', id: hinweis.id });
        await bis(() => hinweisstatus(appId) === 'angezeigt');
        expect(u.ablage.zustaende_.get(`${appId}.hinweis.senden`)).to.include({ ack: true, ts: state.ts });
        expect(u.ablage.hinweise_.get(appId)?.warteschlange).to.deep.equal([]);
        g.schliesse();
    });

    it('ohne Verbindung wartet der Hinweis und kommt bei jeder Anmeldung, bis er angezeigt ist', async () => {
        const { appId, zugang } = await getrennt();
        sendeHinweis(appId, 'Post ist da');
        await bis(() => hinweisstatus(appId) === 'wartet');
        const erste = await melde(appId, zugang);
        expect((await erste.naechste()).t).to.equal('willkommen');
        const hinweis = await erste.naechste();
        expect(hinweis).to.include({ t: 'hinweis', text: 'Post ist da', wichtigkeit: 'normal' });
        expect(hinweis).to.not.have.property('titel');
        await bis(() => hinweisstatus(appId) === 'gesendet');
        erste.schliesse();
        await bis(() => u.ablage.werte_.get(appId)?.online === false);
        const zweite = await melde(appId, zugang);
        await zweite.naechste();
        expect((await zweite.naechste()).id, 'gleicher Hinweis noch einmal').to.equal(hinweis.id);
        zweite.sende({ t: 'angezeigt', id: hinweis.id });
        await bis(() => hinweisstatus(appId) === 'angezeigt');
        zweite.schliesse();
    });

    const ungueltig: [string, ioBroker.StateValue][] = [
        ['leerer Text', ''],
        ['unbekanntes Feld', JSON.stringify({ text: 'x', farbe: 'rot' })],
        ['Text zu lang', JSON.stringify({ text: 'x'.repeat(2001) })],
        ['falsche Wichtigkeit', JSON.stringify({ text: 'x', wichtigkeit: 'dringend' })],
        ['Zahl statt Text', 42],
    ];
    for (const [fall, val] of ungueltig) {
        it(`hinweis.status ungueltig: ${fall}`, async () => {
            const { appId } = await getrennt();
            sendeHinweis(appId, val);
            await bis(() => hinweisstatus(appId) === 'ungueltig');
            expect(u.ablage.hinweise_.get(appId)?.warteschlange).to.deep.equal([]);
        });
    }

    it('zwei Hinweise aus derselben Millisekunde kommen beide an, derselbe zweimal nur einmal', async () => {
        const { appId } = await getrennt();
        const ts = Date.now();
        sendeHinweis(appId, 'eins', ts);
        sendeHinweis(appId, 'zwei', ts);
        sendeHinweis(appId, 'zwei', ts);
        await bis(() => u.ablage.hinweise_.get(appId)?.warteschlange.length === 2);
        await pause(50);
        expect(u.ablage.hinweise_.get(appId)?.warteschlange.map(h => h.text)).to.deep.equal(['eins', 'zwei']);
    });

    it('bei 20 wartenden: voll; ein älterer angezeigter Hinweis ändert den Status des letzten nicht', async () => {
        const { appId, zugang } = await getrennt();
        for (let i = 0; i < 21; i++) {
            sendeHinweis(appId, `Hinweis ${i}`);
        }
        await bis(() => hinweisstatus(appId) === 'voll');
        expect(u.ablage.hinweise_.get(appId)?.warteschlange).to.have.length(20);
        const g = await melde(appId, zugang);
        await g.naechste();
        const erster = await g.naechste();
        expect(erster.text).to.equal('Hinweis 0');
        g.sende({ t: 'angezeigt', id: erster.id });
        await bis(() => u.ablage.hinweise_.get(appId)?.warteschlange.length === 19);
        expect(hinweisstatus(appId)).to.equal('voll');
        g.schliesse();
    });

    it('nach der Frist: abgelaufen, Warnung im Log ohne Inhalt', async () => {
        await starte({}, new Speicherablage(), 100);
        const { appId } = await getrennt();
        geheimnisse.push('Geheimer Hinweistext');
        sendeHinweis(appId, 'Geheimer Hinweistext');
        await bis(() => hinweisstatus(appId) === 'abgelaufen', 1000);
        expect(u.ablage.hinweise_.get(appId)?.warteschlange).to.deep.equal([]);
        expect(u.log.join('\n')).to.match(new RegExp(`warn Hinweis [A-Za-z0-9_-]{8} der App ${appId} abgelaufen`));
    });

    it('nach einem Neustart: Fristen laufen weiter, Hinweise aus der Zeit ohne Adapter werden nachgeholt, keiner doppelt', async () => {
        const ablage = new Speicherablage();
        await ablage.lege('abcdefgh', {
            name: 'Tablet',
            zugangHash: sha256(neuerZugang()).toString('hex'),
            profil: 'familie',
            handydaten: { akku: false, anruf: false, benachrichtigung: false },
            gekoppeltAm: Date.now(),
            geraet,
        });
        const zeit = Date.now() - 400;
        await ablage.legeHinweise('abcdefgh', {
            warteschlange: [{ t: 'hinweis', id: 'altalt01', text: 'alt', wichtigkeit: 'normal', zeit }],
            letzter: 'altalt01',
            bearbeitet: zeit,
            pruefsumme: 'egal',
        });
        const spaeter = ablage.skript('abcdefgh', 'hinweis.senden', 'während der Adapter stand');
        await starte({}, ablage, 500);
        await u.server.dienst.holeHinweiseNach();
        await u.server.dienst.holeHinweiseNach();
        u.server.geaendert(`${NAMESPACE}.apps.abcdefgh.hinweis.senden`, spaeter);
        await pause(20);
        expect(ablage.hinweise_.get('abcdefgh')?.warteschlange.map(h => h.text)).to.deep.equal([
            'alt',
            'während der Adapter stand',
        ]);
        expect(hinweisstatus('abcdefgh')).to.equal('wartet');
        await bis(() => ablage.hinweise_.get('abcdefgh')?.warteschlange.length === 1, 1000);
        expect(ablage.hinweise_.get('abcdefgh')?.warteschlange[0].text).to.equal('während der Adapter stand');
    });

    it('nimmt Verbindungen über einen beliebigen Datenstrom an, so wie ein späterer Weg über das Internet', async () => {
        const { g: erste, appId, zugang } = await kopple();
        erste.schliesse();
        const ueberDatenstrom = async (): Promise<Gegenstelle> => {
            const [kernSeite, appSeite] = duplexPair();
            // Wie eine Vermittlung, die beim Ende der einen Seite auch die andere schließt
            kernSeite.on('close', () => appSeite.destroy());
            u.server.nimm(kernSeite, { weg: 'fern', adresse: 'vermittlung' });
            return melde(appId, zugang, { strom: appSeite });
        };
        await erwarteFehler(await ueberDatenstrom(), 'intern', SCHLIESSCODE.intern);
        expect(u.log.join('\n')).to.contain('keine Adresse des Adapters bekannt');
        adressen = ['192.168.1.5:8095'];
        const g = await ueberDatenstrom();
        expect((await g.naechste()).adressen).to.deep.equal(adressen);
        await bis(() => u.ablage.werte_.get(appId)?.weg === 'fern');
        await bis(() => u.ablage.werte_.get(appId)?.anwesend === false, 1000);
        g.schliesse();
    });
});
