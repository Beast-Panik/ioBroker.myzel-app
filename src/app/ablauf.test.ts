import { expect } from 'chai';
import https from 'node:https';
import { type Duplex, duplexPair } from 'node:stream';
import tls from 'node:tls';
import WebSocket from 'ws';
import { Gegenstelle } from '../../werkzeuge/gegenstelle';
import { NAMESPACE, Speicherablage, Speicherquelle } from '../../test/speicher';
import { alsApp, echterVermittler, hinterTls, type Vermittler, Vermittlernachbau } from '../../test/vermittler';
import {
    adapterSchluessel,
    appSchluessel,
    konfigurationszeile,
    neuesFerngeheimnis,
    vermittlerHash,
} from '../basis/fernschluessel';
import { GRENZEN, type Grenzen, type Protokoll } from '../basis/grenzen';
import { SCHLIESSCODE } from '../basis/kern';
import { neueAdapterId, neuerZugang, sha256 } from '../basis/kodierung';
import { erzeugeIdentitaet, fingerabdruck } from '../basis/zertifikat';
import type { Fernablage, Ferneinstellung } from './fernzugang';
import type { AppDaten, Handydaten } from './objekte';
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
// Beispielorte in Köln, keine echten Wohnorte
const ZUHAUSE = { name: 'Zuhause', breite: 50.941303, laenge: 6.958304, radius: 300 };
const ARBEIT = { name: 'Arbeit', breite: 50.9375, laenge: 6.9603, radius: 200 };
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
        {
            ablage = new Speicherablage(),
            hinweisFristMs = HINWEISFRIST_MS,
            nachlaufMs = NACHLAUF_MS,
            fernablage,
        }: { ablage?: Speicherablage; hinweisFristMs?: number; nachlaufMs?: number; fernablage?: Fernablage } = {},
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
            fernablage,
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

    // Wie ein fehlerhaftes object set: Das Objekt ist da, aber nicht lesbar.
    function beschaedige(appId: string, objekt: { type?: string; native?: unknown }): void {
        u.ablage.beschaedigt_.set(appId, objekt);
        u.quelle.objekt_(`${NAMESPACE}.apps.${appId}`, objekt);
    }
    function heile(appId: string): void {
        u.ablage.beschaedigt_.delete(appId);
        u.quelle.app(appId, u.ablage.apps.get(appId));
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
        expect(u.ablage.werte_.get(appId)?.weg, 'getrennt kein Weg').to.equal('');
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
        g.sende({ t: 'hallo', v: 8, app: 'abcdefgh', zugang: neuerZugang(), geraet, neu: true });
        const fehler = await erwarteFehler(g, 'version', SCHLIESSCODE.version);
        expect(fehler.unterstuetzt).to.deep.equal([3, 4, 5, 6, 7]);
        const alt = await verbinde();
        alt.sende({ t: 'koppeln', v: 2, geheimnis: 'A'.repeat(22), name: 'X', geraet });
        expect((await erwarteFehler(alt, 'version', SCHLIESSCODE.version)).unterstuetzt).to.deep.equal([3, 4, 5, 6, 7]);
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
        const stand = u.ablage.stand.bind(u.ablage);
        let aufrufe = 0;
        u.ablage.stand = async id => {
            const gelesen = await stand(id);
            if (++aufrufe === 2) {
                await u.server.dienst.entferne(appId);
            }
            return gelesen;
        };
        const neu = await melde(appId, zugang);
        expect((await neu.geschlossen()).code).to.equal(SCHLIESSCODE.entfernt);
        expect((await neu.alle()).map(n => n.t)).to.deep.equal([]);
    });

    // Wie am 6. 11. 2026 nach einem fehlerhaften object set: Das Objekt ist kurz kaputt, dann wieder heil.
    it('ein beschädigtes Objekt trennt mit 1011, die Kopplung bleibt, heil meldet sich die App wieder an', async () => {
        const { g, appId, zugang } = await kopple();
        const daten = u.ablage.apps.get(appId)!;
        beschaedige(appId, {
            type: 'device',
            native: { ...daten, handydaten: { ...daten.handydaten, akku: 'true' } },
        });
        expect((await g.geschlossen()).code).to.equal(SCHLIESSCODE.intern);
        await erwarteFehler(await melde(appId, zugang), 'intern', SCHLIESSCODE.intern);
        heile(appId);
        const wieder = await melde(appId, zugang);
        expect((await wieder.naechste()).t).to.equal('willkommen');
        wieder.schliesse();
        const log = u.log.join('\n');
        expect(log).to.contain(`App ${appId}: Objekt beschädigt, Verbindung beendet, die App bleibt gekoppelt`);
        expect(log).to.not.contain(`App ${appId} entfernt`);
    });

    it('mit beschädigtem Objekt: 1011 ohne Fehlversuch, auch wenn sich der Zugang nicht prüfen lässt', async () => {
        await starte({ fehlversuche: 2 });
        const { g, appId, zugang } = await kopple();
        g.schliesse();
        beschaedige(appId, { type: 'device', native: null });
        for (let i = 0; i < 3; i++) {
            await erwarteFehler(await melde(appId, zugang), 'intern', SCHLIESSCODE.intern);
        }
        // Ohne lesbaren Hash bekommt auch ein fremder Zugang 1011: Anmelden kann er sich so wenig wie die App.
        const fremd = await erwarteFehler(await melde(appId, neuerZugang()), 'intern', SCHLIESSCODE.intern);
        expect(fremd).to.not.have.property('text');
        expect(u.log.join('\n')).to.not.contain('gesperrt');
    });

    it('beschädigt, aber mit lesbarem Zugang: Ein anderer Zugang hebt die Kopplung weiter auf', async () => {
        const { g, appId, zugang } = await kopple();
        const daten = u.ablage.apps.get(appId)!;
        beschaedige(appId, { type: 'channel', native: daten });
        await erwarteFehler(await melde(appId, neuerZugang()), 'zugang', SCHLIESSCODE.zugang);
        await erwarteFehler(await melde(appId, zugang), 'intern', SCHLIESSCODE.intern);
        expect((await g.geschlossen()).code).to.equal(SCHLIESSCODE.intern);
        const zweite = await kopple();
        const anders = sha256(neuerZugang()).toString('hex');
        beschaedige(zweite.appId, { type: 'device', native: { ...daten, profil: 7, zugangHash: anders } });
        expect((await zweite.g.geschlossen()).code).to.equal(SCHLIESSCODE.entfernt);
        await erwarteFehler(await melde(zweite.appId, zweite.zugang), 'zugang', SCHLIESSCODE.zugang);
    });

    it('wird das Objekt während der Anmeldung beschädigt, bekommt die App 1011 und kein willkommen', async () => {
        const { g, appId, zugang } = await kopple();
        g.schliesse();
        const stand = u.ablage.stand.bind(u.ablage);
        // Beim zweiten Lesen in angemeldet, beim dritten in der Nachprüfung vor willkommen
        for (const beim of [2, 3]) {
            let aufrufe = 0;
            u.ablage.stand = id => (++aufrufe === beim ? Promise.resolve({ art: 'beschaedigt' }) : stand(id));
            const neu = await melde(appId, zugang);
            expect((await neu.geschlossen()).code).to.equal(SCHLIESSCODE.intern);
            expect((await neu.alle()).map(n => n.t)).to.deep.equal(beim === 2 ? ['fehler'] : []);
        }
        expect(u.log.join('\n')).to.contain(`App ${appId}: Objekt während der Anmeldung beschädigt`);
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

    it('Benachrichtigung einer App außerhalb der Auswahl: nur unter letzte, kein neuer Ordner', async () => {
        const { g, appId } = await mitHandydaten(4);
        g.sende({ t: 'auswahl', apps: [{ paket: 'org.signal', app: 'Signal' }] });
        await bis(() => u.ablage.ordner_.get(appId)?.has('org-signal') === true);
        g.sende({ t: 'benachrichtigung', app: 'Fremd', paket: 'com.fremd1', text: 'Hallo', zeit: vorhin() });
        await bis(() => u.ablage.zustaende_.get(`${appId}.benachrichtigungen.letzte.text`)?.val === 'Hallo');
        expect([...u.ablage.ordner_.get(appId)!.keys()].sort()).to.deep.equal(['letzte', 'org-signal']);
        g.schliesse();
    });

    it('meldet sich eine App in einer Schleife an, kommt nach dem Stoß zuviel', async () => {
        const { g: erste, appId, zugang } = await kopple();
        erste.schliesse();
        for (let i = 0; i < 5; i++) {
            const g = await melde(appId, zugang);
            expect((await g.naechste()).t).to.equal('willkommen');
            g.schliesse();
        }
        await erwarteFehler(await melde(appId, zugang), 'zuviel', SCHLIESSCODE.zuviel);
        expect(u.log.filter(z => z.includes('meldet sich zu oft an'))).to.have.length(1);
    });

    describe('Zonen und Standort (Protokoll 7)', () => {
        const AUS: Handydaten = { akku: false, anruf: false, benachrichtigung: false, zonen: false, standort: false };

        async function aendereApp(appId: string, daten: Partial<AppDaten>): Promise<void> {
            await u.ablage.aendere(appId, daten);
            u.quelle.app(appId, u.ablage.apps.get(appId));
        }

        async function mitZonen(
            zonenwahl: string[],
            handydaten: Partial<Handydaten> = {},
        ): Promise<{ g: Gegenstelle; appId: string; rechte: Record<string, any> }> {
            u.quelle.zone('zuhause', ZUHAUSE).zone('arbeit', ARBEIT);
            const { g, appId, willkommen } = await kopple('familie', 7);
            expect(willkommen.handydaten).to.deep.equal(AUS);
            expect(willkommen.zonen).to.deep.equal([]);
            await aendereApp(appId, { handydaten: { ...AUS, zonen: true, ...handydaten }, zonenwahl });
            const rechte = await g.naechste();
            expect(rechte).to.include({ t: 'rechte' });
            return { g, appId, rechte };
        }

        const zonenpunkte = (appId: string): string[] => [...(u.ablage.zonen_.get(appId)?.keys() ?? [])].sort();

        it('willkommen und rechte tragen die freigegebenen Zonen nach Namen; Protokoll 6 bekommt nichts davon', async () => {
            const { g, rechte } = await mitZonen(['zuhause', 'arbeit', 'gibtsnicht'], { standort: true });
            expect(rechte.handydaten).to.deep.equal({ ...AUS, zonen: true, standort: true });
            expect(rechte.zonen).to.deep.equal([
                { id: 'arbeit', ...ARBEIT },
                { id: 'zuhause', ...ZUHAUSE },
            ]);
            g.schliesse();
            const { g: alt, appId, willkommen } = await kopple('familie', 6);
            expect(willkommen.handydaten).to.deep.equal({ akku: false, anruf: false, benachrichtigung: false });
            expect(willkommen).not.to.have.property('zonen');
            await aendereApp(appId, { handydaten: { ...AUS, zonen: true, akku: true }, zonenwahl: ['zuhause'] });
            const neu = await alt.naechste();
            expect(neu.handydaten).to.deep.equal({ akku: true, anruf: false, benachrichtigung: false });
            expect(neu).not.to.have.property('zonen');
            // Zonenmeldungen gibt es erst ab 7
            alt.sende({ t: 'zone', id: 'zuhause', drin: true, zeit: vorhin() });
            expect(await alt.naechste()).to.include({ t: 'fehler', code: 'ungueltig' });
            alt.sende({ t: 'standort', breite: 0, laenge: 0, genauigkeit: 5, zeit: vorhin() });
            expect(await alt.naechste()).to.include({ t: 'fehler', code: 'ungueltig' });
            alt.sende({ t: 'vorschlag', breite: 0, laenge: 0, genauigkeit: 5, zeit: vorhin() });
            expect(await alt.naechste()).to.include({ t: 'fehler', code: 'ungueltig' });
            expect(zonenpunkte(appId)).to.deep.equal([]);
            alt.schliesse();
        });

        it('Zonenwechsel: erst zonen.<zone> mit Namen, dann letzte; fremde Zone abgelehnt; Standort aus', async () => {
            const { g, appId } = await mitZonen(['zuhause']);
            const zeit = vorhin();
            g.sende({ t: 'zone', id: 'zuhause', drin: true, zeit });
            await bis(() => u.ablage.geschrieben.some(e => e.startsWith(`${appId}.zonen.letzte=`)));
            expect(u.ablage.geschrieben.filter(e => e.startsWith(`${appId}.zonen.`))).to.deep.equal([
                `${appId}.zonen.zuhause=true@${zeit}`,
                `${appId}.zonen.letzte=${JSON.stringify({ zone: 'zuhause', name: 'Zuhause', ereignis: 'betreten', zeit })}@${zeit}`,
            ]);
            expect(u.ablage.zonen_.get(appId)?.get('zuhause')).to.deep.equal({ name: 'Zuhause', drin: true, ts: zeit });
            g.sende({ t: 'zone', id: 'arbeit', drin: true, zeit });
            expect(await g.naechste()).to.include({ t: 'fehler', code: 'abgelehnt' });
            g.sende({ t: 'standort', breite: 50.9, laenge: 6.9, genauigkeit: 5, zeit });
            expect(await g.naechste()).to.include({ t: 'fehler', code: 'aus' });
            expect(zonenpunkte(appId)).to.deep.equal(['zuhause']);
            expect(u.ablage.werte_.get(appId)).not.to.have.property('standort.json');
            g.schliesse();
        });

        it('Zonenstand: ersetzt den Stand aller Zonen der App; ohne aktiv bleiben sie, Grund in der Systemsprache', async () => {
            const { g, appId } = await mitZonen(['zuhause', 'arbeit']);
            const zeit = vorhin();
            g.sende({ t: 'zonenstand', aktiv: true, drin: ['arbeit'], zeit });
            await bis(() => u.ablage.werte_.get(appId)?.['zonen.aktiv'] === true);
            expect(u.ablage.zonen_.get(appId)?.get('arbeit')).to.include({ name: 'Arbeit', drin: true });
            expect(u.ablage.zonen_.get(appId)?.get('zuhause')).to.include({ name: 'Zuhause', drin: false });
            expect(u.ablage.werte_.get(appId)).to.include({ 'zonen.grund': '' });
            g.sende({ t: 'zonenstand', aktiv: false, grund: 'hintergrund', drin: [], zeit: zeit + 1 });
            await bis(() => u.ablage.werte_.get(appId)?.['zonen.aktiv'] === false);
            expect(u.ablage.werte_.get(appId)).to.include({ 'zonen.grund': 'Standort im Hintergrund nicht erlaubt' });
            g.sende({ t: 'zonenstand', aktiv: false, grund: 'aus', drin: [], zeit: zeit + 2 });
            await bis(() => u.ablage.werte_.get(appId)?.['zonen.grund'] === 'In der App ausgeschaltet');
            expect(u.ablage.zonen_.get(appId)?.get('arbeit')).to.include({ drin: true, ts: zeit });
            g.schliesse();
        });

        it('Standort: Breite, Länge, Genauigkeit, json zuletzt; nach zwei höchstens einer je Minute; nie im Log', async () => {
            const { g, appId } = await mitZonen([], { zonen: false, standort: true });
            const zeit = vorhin();
            geheimnisse.push('50.941303', '6.958304');
            g.sende({ t: 'standort', breite: 50.941303, laenge: 6.958304, genauigkeit: 12.5, zeit });
            g.sende({ t: 'standort', breite: 50.941303, laenge: 6.958304, genauigkeit: 8, zeit: zeit + 1 });
            g.sende({ t: 'standort', breite: 50.941303, laenge: 6.958304, genauigkeit: 4, zeit: zeit + 2 });
            expect(await g.naechste()).to.include({ t: 'fehler', code: 'zuviel' });
            await bis(() => u.ablage.werte_.get(appId)?.['standort.genauigkeit'] === 8);
            const json = JSON.stringify({ breite: 50.941303, laenge: 6.958304, genauigkeit: 8, zeit: zeit + 1 });
            expect(u.ablage.geschrieben.filter(e => e.includes('.standort.')).slice(-4)).to.deep.equal([
                `${appId}.standort.breite=50.941303@${zeit + 1}`,
                `${appId}.standort.laenge=6.958304@${zeit + 1}`,
                `${appId}.standort.genauigkeit=8@${zeit + 1}`,
                `${appId}.standort.json=${json}@${zeit + 1}`,
            ]);
            g.sende({ t: 'zone', id: 'zuhause', drin: true, zeit });
            expect(await g.naechste()).to.include({ t: 'fehler', code: 'aus' });
            g.schliesse();
        });

        it('Zonenmeldungen: nach einem Stoß von 10 kommt zuviel', async () => {
            const { g, appId } = await mitZonen(['zuhause']);
            const zeit = vorhin();
            for (let i = 0; i < 11; i++) {
                g.sende({ t: 'zone', id: 'zuhause', drin: i % 2 === 0, zeit: zeit + i });
            }
            expect(await g.naechste()).to.include({ t: 'fehler', code: 'zuviel' });
            await bis(() => u.ablage.zonen_.get(appId)?.get('zuhause')?.ts === zeit + 9);
            expect(u.ablage.geschrieben.filter(e => e.startsWith(`${appId}.zonen.zuhause=`))).to.have.length(10);
            g.schliesse();
        });

        it('Vorschlag für einen Mittelpunkt: nur mit Zonen, einer je Minute, nur im Speicher, nie im Log', async () => {
            const { g, appId } = await mitZonen([]);
            const zeit = vorhin();
            geheimnisse.push('50.941303', '6.958304');
            g.sende({ t: 'vorschlag', breite: 50.941303, laenge: 6.958304, genauigkeit: 12, zeit });
            await bis(() => u.server.dienst.mittelpunktvorschlaege().length === 1);
            expect(u.server.dienst.mittelpunktvorschlaege()).to.deep.equal([
                { appId, breite: 50.941303, laenge: 6.958304, genauigkeit: 12, zeit },
            ]);
            g.sende({ t: 'vorschlag', breite: 1, laenge: 1, genauigkeit: 5, zeit: zeit + 1 });
            expect(await g.naechste()).to.include({ t: 'fehler', code: 'zuviel' });
            expect(u.server.dienst.mittelpunktvorschlaege()[0]).to.include({ breite: 50.941303 });
            expect(u.ablage.geschrieben.filter(e => e.includes('50.94') || e.includes('vorschlag'))).to.deep.equal([]);
            // Nach 15 Minuten ist er weg, ebenso mit der App
            expect(u.server.dienst.mittelpunktvorschlaege(Date.now() + 15 * 60_000 + 1)).to.deep.equal([]);
            await aendereApp(appId, { handydaten: AUS });
            await g.naechste();
            g.sende({ t: 'vorschlag', breite: 1, laenge: 1, genauigkeit: 5, zeit });
            expect(await g.naechste()).to.include({ t: 'fehler', code: 'aus' });
            g.schliesse();
            await u.server.dienst.entferne(appId);
            expect(u.server.dienst.mittelpunktvorschlaege()).to.deep.equal([]);
        });

        it('umbenannt gilt sofort; entzogen oder gelöscht verschwindet der Datenpunkt, ausgeschaltet bleibt er', async () => {
            const { g, appId } = await mitZonen(['zuhause', 'arbeit']);
            const zeit = vorhin();
            g.sende({ t: 'zonenstand', aktiv: true, drin: ['zuhause'], zeit });
            await bis(() => zonenpunkte(appId).length === 2);

            // Umbenannt: Der nächste Wechsel trägt den neuen Namen schon vor der Neuberechnung
            u.quelle.zone('zuhause', { ...ZUHAUSE, name: 'Heim' });
            g.sende({ t: 'zone', id: 'zuhause', drin: false, zeit: zeit + 1 });
            await bis(() => u.ablage.zonen_.get(appId)?.get('zuhause')?.ts === zeit + 1);
            expect(u.ablage.zonen_.get(appId)?.get('zuhause')?.name).to.equal('Heim');
            expect((await g.naechste()).zonen.map((z: { name: string }) => z.name)).to.deep.equal(['Arbeit', 'Heim']);

            // Entzogen: Ein Wechsel vor der Neuberechnung legt den Datenpunkt nicht dauerhaft wieder an
            await aendereApp(appId, { zonenwahl: ['zuhause'] });
            g.sende({ t: 'zone', id: 'arbeit', drin: true, zeit: zeit + 2 });
            expect((await g.naechste()).zonen.map((z: { id: string }) => z.id)).to.deep.equal(['zuhause']);
            expect(u.ablage.geschrieben, 'Wechsel kam vor der Neuberechnung').to.include(
                `${appId}.zonen.arbeit=true@${zeit + 2}`,
            );
            await bis(() => !zonenpunkte(appId).includes('arbeit'));

            // Ausgeschaltet: Wahl und Datenpunkt bleiben
            await aendereApp(appId, { handydaten: AUS });
            expect((await g.naechste()).zonen).to.deep.equal([]);
            await aendereApp(appId, { handydaten: { ...AUS, zonen: true } });
            expect((await g.naechste()).zonen.map((z: { id: string }) => z.id)).to.deep.equal(['zuhause']);
            expect(zonenpunkte(appId)).to.deep.equal(['zuhause']);

            // Gelöscht
            u.quelle.zone('zuhause', null);
            expect((await g.naechste()).zonen).to.deep.equal([]);
            await bis(() => zonenpunkte(appId).length === 0);
            g.sende({ t: 'zone', id: 'zuhause', drin: true, zeit: zeit + 3 });
            expect(await g.naechste()).to.include({ t: 'fehler', code: 'abgelehnt' });
            expect(zonenpunkte(appId)).to.deep.equal([]);
            g.schliesse();
        });

        // Alle Nachrichten bis einschließlich der nächsten rechte
        async function bisRechte(g: Gegenstelle): Promise<Record<string, any>[]> {
            const alle: Record<string, any>[] = [];
            while (alle.at(-1)?.t !== 'rechte') {
                alle.push(await g.naechste());
            }
            return alle;
        }

        it('Ausschalten im Admin gilt sofort: Stand und Standort danach schreiben nichts, zonen.aktiv bleibt aus', async () => {
            const { g, appId } = await mitZonen(['zuhause'], { standort: true });
            const zeit = vorhin();
            g.sende({ t: 'zonenstand', aktiv: true, drin: ['zuhause'], zeit });
            await bis(() => u.ablage.werte_.get(appId)?.['zonen.aktiv'] === true);
            // Bis zur Neuberechnung kommt noch etwas vom Handy, das die neue Freigabe nicht kennt
            await aendereApp(appId, { handydaten: AUS });
            g.sende({ t: 'zonenstand', aktiv: true, drin: [], zeit: zeit + 1 });
            g.sende({ t: 'standort', breite: 1, laenge: 1, genauigkeit: 5, zeit: zeit + 2 });
            const antworten = await bisRechte(g);
            expect(antworten.slice(0, 2).map(a => a.code)).to.deep.equal(['aus', 'aus']);
            await pause(50);
            expect(u.ablage.werte_.get(appId)).to.include({
                'zonen.aktiv': false,
                'zonen.grund': 'Im Admin ausgeschaltet',
            });
            expect(u.ablage.zonen_.get(appId)?.get('zuhause')).to.include({ drin: true, ts: zeit });
            expect(u.ablage.werte_.get(appId)).not.to.have.property('standort.json');
            g.schliesse();
        });

        it('ein Stand, der vor dem Ausschalten kam, schreibt aktiv nicht dauerhaft wieder auf true', async () => {
            const { g, appId } = await mitZonen(['zuhause']);
            const zeit = vorhin();
            g.sende({ t: 'zonenstand', aktiv: true, drin: ['zuhause'], zeit });
            await bis(() => u.ablage.werte_.get(appId)?.['zonen.aktiv'] === true);
            // Wie raeumeZonenAuf im Dialog, dann erst die Freigabe in der Sitzung
            await u.ablage.schreibe(appId, { 'zonen.aktiv': false, 'zonen.grund': 'Im Admin ausgeschaltet' });
            g.sende({ t: 'zonenstand', aktiv: true, drin: [], zeit: zeit + 1 });
            await bis(() => u.ablage.werte_.get(appId)?.['zonen.aktiv'] === true);
            await aendereApp(appId, { handydaten: AUS });
            await bisRechte(g);
            await bis(() => u.ablage.werte_.get(appId)?.['zonen.aktiv'] === false);
            expect(u.ablage.werte_.get(appId)?.['zonen.grund']).to.equal('Im Admin ausgeschaltet');
            g.schliesse();
        });

        it('Mengen je App: Eine neue Verbindung bringt keinen neuen Stoß', async () => {
            u.quelle.zone('zuhause', ZUHAUSE);
            const { g, appId, zugang } = await kopple('familie', 7);
            await aendereApp(appId, { handydaten: { ...AUS, zonen: true, standort: true }, zonenwahl: ['zuhause'] });
            await g.naechste();
            const zeit = vorhin();
            g.sende({ t: 'standort', breite: 1, laenge: 1, genauigkeit: 5, zeit });
            g.sende({ t: 'standort', breite: 1, laenge: 1, genauigkeit: 5, zeit: zeit + 1 });
            await bis(
                () =>
                    u.ablage.werte_
                        .get(appId)
                        ?.['standort.json']?.toString()
                        .includes(`${zeit + 1}`) === true,
            );
            g.schliesse();
            await bis(() => u.ablage.werte_.get(appId)?.online === false);
            const wieder = await melde(appId, zugang, undefined, 7);
            expect((await wieder.naechste()).t).to.equal('willkommen');
            wieder.sende({ t: 'standort', breite: 1, laenge: 1, genauigkeit: 5, zeit: zeit + 2 });
            expect(await wieder.naechste()).to.include({ t: 'fehler', code: 'zuviel' });
            wieder.schliesse();
        });

        it('Entfernt oder mit Protokoll 6: zonen.aktiv false mit Grund, verbunden wie getrennt', async () => {
            const zeit = vorhin();
            const melde7 = async (): Promise<{ g: Gegenstelle; appId: string; zugang: string }> => {
                const { g, appId } = await mitZonen(['zuhause']);
                g.sende({ t: 'zonenstand', aktiv: true, drin: ['zuhause'], zeit });
                await bis(() => u.ablage.werte_.get(appId)?.['zonen.aktiv'] === true);
                return { g, appId, zugang: '' };
            };
            const verbunden = await melde7();
            await u.server.dienst.entferne(verbunden.appId);
            await bis(() => u.ablage.werte_.get(verbunden.appId)?.['zonen.aktiv'] === false);
            expect(u.ablage.werte_.get(verbunden.appId)?.['zonen.grund']).to.equal('App im Admin entfernt');

            const getrennt = await melde7();
            getrennt.g.schliesse();
            await bis(() => u.ablage.werte_.get(getrennt.appId)?.online === false);
            await u.server.dienst.entferne(getrennt.appId);
            expect(u.ablage.werte_.get(getrennt.appId)).to.include({
                'zonen.aktiv': false,
                'zonen.grund': 'App im Admin entfernt',
            });

            // Eine ältere App meldet keine Zonen mehr
            u.quelle.zone('zuhause', ZUHAUSE);
            const { g, appId, zugang } = await kopple('familie', 7);
            await aendereApp(appId, { handydaten: { ...AUS, zonen: true }, zonenwahl: ['zuhause'] });
            await g.naechste();
            g.sende({ t: 'zonenstand', aktiv: true, drin: ['zuhause'], zeit });
            await bis(() => u.ablage.werte_.get(appId)?.['zonen.aktiv'] === true);
            g.schliesse();
            await bis(() => u.ablage.werte_.get(appId)?.online === false);
            const alt = await melde(appId, zugang, undefined, 6);
            expect((await alt.naechste()).t).to.equal('willkommen');
            await bis(() => u.ablage.werte_.get(appId)?.['zonen.aktiv'] === false);
            expect(u.ablage.werte_.get(appId)?.['zonen.grund']).to.equal(
                'Die App kennt keine Zonen, bitte aktualisieren',
            );
            alt.schliesse();
        });

        it('Anmeldung räumt Datenpunkte gelöschter Zonen auf; eine unbrauchbare Zone behält ihren', async () => {
            const { g, appId, zugang } = await (async () => {
                u.quelle.zone('zuhause', ZUHAUSE).zone('arbeit', ARBEIT);
                const k = await kopple('familie', 7);
                await aendereApp(k.appId, { handydaten: { ...AUS, zonen: true }, zonenwahl: ['zuhause', 'arbeit'] });
                await k.g.naechste();
                return k;
            })();
            g.sende({ t: 'zonenstand', aktiv: true, drin: ['zuhause'], zeit: vorhin() });
            await bis(() => zonenpunkte(appId).length === 2);
            // Verbunden: Ein Tippfehler im Objektbrowser macht eine Zone unbrauchbar, ihr Datenpunkt bleibt
            u.quelle.zone('zuhause', { ...ZUHAUSE, radius: 50 });
            expect((await g.naechste()).zonen.map((z: { id: string }) => z.id)).to.deep.equal(['arbeit']);
            await pause(50);
            expect(zonenpunkte(appId)).to.deep.equal(['arbeit', 'zuhause']);
            g.schliesse();
            await bis(() => u.ablage.werte_.get(appId)?.online === false);
            // Getrennt im Objektbrowser gelöscht
            u.quelle.zone('arbeit', null);
            const wieder = await melde(appId, zugang, undefined, 7);
            expect((await wieder.naechste()).t).to.equal('willkommen');
            await bis(() => zonenpunkte(appId).length === 1);
            expect(zonenpunkte(appId)).to.deep.equal(['zuhause']);
            wieder.schliesse();
        });
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
        await starte({}, { nachlaufMs: 60_000 });
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
        await ablage.schreibe('abcdefgh', { online: true, weg: 'fern', anwesend: true });
        await starte({}, { ablage });
        expect(ablage.werte_.get('abcdefgh')).to.include({ online: false, weg: '', anwesend: true });
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
        await starte({}, { hinweisFristMs: 100 });
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
        await starte({}, { ablage, hinweisFristMs: 500 });
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

    // Wie der Vermittler: ein Datenstrom zum Kern, der beim Ende der einen Seite auch die andere schließt
    function fernStrom(appId: string): Duplex {
        const [kernSeite, appSeite] = duplexPair();
        kernSeite.on('close', () => appSeite.destroy());
        u.server.nimm(kernSeite, { weg: 'fern', adresse: `fern:${appId}`, app: appId });
        return appSeite;
    }

    const fernablage = (e: Ferneinstellung): Fernablage => {
        let jetzt = { ...e };
        return {
            lies: () => Promise.resolve({ ...jetzt }),
            schreibe: n => {
                jetzt = { ...n };
                return Promise.resolve();
            },
        };
    };

    // Fernzugang an, aber kein Vermittler: Die Verbindungen kommen in diesen Tests über fernStrom
    async function mitFernzugang(aenderung: Partial<Grenzen> = {}): Promise<void> {
        const ferngeheimnis = neuesFerngeheimnis();
        geheimnisse.push(ferngeheimnis);
        await starte(aenderung, {
            fernablage: fernablage({ adresse: 'https://127.0.0.1:9', geheimnis: ferngeheimnis }),
        });
    }

    it('nimmt Verbindungen über einen beliebigen Datenstrom an, so wie der Fernweg', async () => {
        await mitFernzugang();
        const { g: erste, appId, zugang } = await kopple('familie', 6);
        erste.schliesse();
        await freigeben(appId, true);
        await erwarteFehler(await melde(appId, zugang, { strom: fernStrom(appId) }, 6), 'intern', SCHLIESSCODE.intern);
        expect(u.log.join('\n')).to.contain('keine Adresse des Adapters bekannt');
        adressen = ['192.168.1.5:8095'];
        const g = await melde(appId, zugang, { strom: fernStrom(appId) }, 6);
        expect((await g.naechste()).adressen).to.deep.equal(adressen);
        await bis(() => u.ablage.werte_.get(appId)?.weg === 'fern');
        await bis(() => u.ablage.werte_.get(appId)?.anwesend === false, 1000);
        g.schliesse();
    });

    it('über den Fernzugang einer App meldet sich keine andere an, und gekoppelt wird nur im Heimnetz', async () => {
        const a = await kopple('familie', 6);
        const b = await kopple('familie', 6);
        a.g.schliesse();
        b.g.schliesse();
        await erwarteFehler(await melde(b.appId, b.zugang, { strom: fernStrom(a.appId) }, 6), 'zugang', 4001);
        expect(u.log.join('\n')).to.contain(`App ${b.appId} über den Fernzugang einer anderen App`);

        const { geheimnis } = u.server.kopplung.starte();
        geheimnisse.push(geheimnis);
        const fremd = await verbinde({ strom: fernStrom(a.appId) });
        fremd.sende({ t: 'koppeln', v: 6, geheimnis, name: 'Fremd', geraet });
        await erwarteFehler(fremd, 'zugang', 4001);
        expect(u.log.join('\n')).to.contain('Koppeln geht nur im Heimnetz');
        // Das Einmalgeheimnis ist dadurch nicht verbraucht.
        const daheim = await verbinde();
        daheim.sende({ t: 'koppeln', v: 6, geheimnis, name: 'Daheim', geraet });
        expect((await u.server.kopplung.warte(2000))?.name).to.equal('Daheim');
        daheim.schliesse();
    });

    it('über den Vermittler nur mit Freigabe, sonst Schluss mit 4010 und kein willkommen', async () => {
        await mitFernzugang();
        adressen = ['192.168.1.5:8095'];
        const { g: erste, appId, zugang } = await kopple('familie', 6);
        erste.schliesse();
        const ohne = await melde(appId, zugang, { strom: fernStrom(appId) }, 6);
        expect((await ohne.geschlossen()).code).to.equal(SCHLIESSCODE.fernAus);
        expect(u.log.join('\n')).to.contain(`App ${appId}: Fernzugang nicht freigegeben`);
        expect(u.ablage.werte_.get(appId)?.online).to.equal(false);
    });

    it('ersetzt eine Verbindung über den Vermittler eine im Heimnetz, ist die App nach dem Nachlauf abwesend', async () => {
        await mitFernzugang();
        adressen = ['192.168.1.5:8095'];
        const daheim = await kopple('familie', 6);
        await freigeben(daheim.appId, true);
        const anwesend = (): unknown => u.ablage.werte_.get(daheim.appId)?.anwesend;
        await bis(() => anwesend() === true);
        // Die alte Verbindung im Heimnetz ist nicht getrennt, etwa halb offen nach dem Verlassen des WLAN
        const fern = await melde(daheim.appId, daheim.zugang, { strom: fernStrom(daheim.appId) }, 6);
        expect(await fern.naechste()).to.include({ t: 'willkommen' });
        expect((await daheim.g.geschlossen()).code).to.equal(SCHLIESSCODE.ersetzt);
        await bis(() => anwesend() === false, NACHLAUF_MS * 3);
        expect(u.ablage.werte_.get(daheim.appId)).to.include({ online: true, weg: 'fern' });
        // Zurück im Heimnetz wieder anwesend
        const wieder = await melde(daheim.appId, daheim.zugang, undefined, 6);
        expect(await wieder.naechste()).to.include({ t: 'willkommen' });
        await bis(() => anwesend() === true);
        wieder.schliesse();
    });

    it('über den Vermittler je App höchstens fernJeApp und insgesamt fernOhneAnmeldung ohne Anmeldung', async () => {
        await mitFernzugang({ fernJeApp: 2, fernOhneAnmeldung: 3 });
        const offen = (strom: Duplex): Promise<boolean> =>
            new Promise(r => {
                strom.once('close', () => r(false));
                setTimeout(() => r(!strom.destroyed), 200);
            });
        const a = [fernStrom('aaaaaaaa'), fernStrom('aaaaaaaa'), fernStrom('aaaaaaaa')];
        expect(await Promise.all(a.map(offen))).to.deep.equal([true, true, false]);
        const b = [fernStrom('bbbbbbbb'), fernStrom('bbbbbbbb')];
        expect(await Promise.all(b.map(offen))).to.deep.equal([true, false]);
        expect(u.log.join('\n')).to.contain('3 Verbindungen über den Vermittler ohne Anmeldung');
        // Das Heimnetz behält seine Plätze
        const daheim = await verbinde();
        daheim.sende({ t: 'hallo', v: 6, app: 'cccccccc', zugang: 'x'.repeat(43), geraet });
        expect((await daheim.naechste()).t).to.equal('fehler');
        [...a, ...b].forEach(x => x.destroy());
    });

    it('über den Fernzugang seltener Lebenszeichen und mehr Geduld bis zum Schluss', async () => {
        await mitFernzugang({ pingMs: 50, totMs: 200, fernPingMs: 300, fernTotMs: 800 });
        adressen = ['192.168.1.5:8095'];
        const daheim = await kopple('familie', 6);
        const unterwegs = await kopple('familie', 6);
        await freigeben(unterwegs.appId, true);
        unterwegs.g.schliesse();
        const fern = await melde(unterwegs.appId, unterwegs.zugang, { strom: fernStrom(unterwegs.appId) }, 6);
        // willkommen nennt pingS und totS unter den Grenzen des Schemas; das prüft die Gegenstelle, deshalb ungelesen
        await bis(() => u.ablage.werte_.get(unterwegs.appId)?.weg === 'fern');
        const beginn = Date.now();
        const daheimVorher = daheim.g.pings;
        const still = await verbinde({ autoPong: false, strom: fernStrom(unterwegs.appId) });
        await pause(400);
        const offen = (g: Gegenstelle): Promise<boolean> =>
            Promise.race([g.schluss.then(() => false), pause(0).then(() => true)]);
        expect(await offen(still), 'über fern noch offen nach totMs').to.equal(true);
        await still.geschlossen(2000);
        const dauer = Date.now() - beginn;
        expect(dauer).to.be.at.least(800);
        expect(await offen(fern), 'beantwortet Pings und bleibt').to.equal(true);
        expect(fern.pings).to.be.within(1, Math.ceil(dauer / 300) + 1);
        expect(daheim.g.pings - daheimVorher).to.be.at.least(Math.floor(dauer / 50) - 3);
        fern.schliesse();
        daheim.g.schliesse();
    });

    async function freigeben(appId: string, fern: boolean): Promise<void> {
        await u.ablage.aendere(appId, { fern });
        u.quelle.app(appId, u.ablage.apps.get(appId));
        // Wie main.ts bei jeder Änderung am Objekt einer App
        u.server.fern!.appsGeaendert();
    }

    const vermittlerArten: [string, (zeile: string, hash: string) => Promise<Vermittler | undefined>][] = [
        ['den Nachbau', (_, hash) => Vermittlernachbau.starte(hash)],
        ['den Vermittler aus Go', zeile => echterVermittler(zeile)],
    ];
    for (const [art, baue] of vermittlerArten) {
        describe(`Fernzugang über ${art} hinter TLS`, function () {
            this.timeout(20_000);
            const ferngeheimnis = neuesFerngeheimnis();
            // Nach einer Freigabe: Abgleich mit dem Vermittler nach 500 ms
            const ABGLEICH_MS = 700;
            let vermittler: Vermittler | undefined;

            before(async function () {
                this.timeout(120_000);
                const innen = await baue(
                    konfigurationszeile(adapterId, ferngeheimnis),
                    vermittlerHash(adapterSchluessel(ferngeheimnis)),
                );
                vermittler = innen && (await hinterTls(innen));
                if (!vermittler) {
                    await innen?.beende();
                    this.skip();
                }
            });
            after(() => vermittler?.beende());
            beforeEach(async () => {
                geheimnisse.push(ferngeheimnis);
                adressen = ['192.168.1.5:8095'];
                await starte(
                    {},
                    { fernablage: fernablage({ adresse: vermittler!.adresse, geheimnis: ferngeheimnis }) },
                );
                await bis(() => u.server.fern?.stand.art === 'verbunden', 5000);
            });

            const fernFuer = (appId: string, zugang: string): Record<string, unknown> => ({
                adresse: vermittler!.adresse,
                schluessel: appSchluessel(ferngeheimnis, appId, sha256(zugang).toString('hex')),
                pingS: 600,
                totS: 1500,
            });

            async function unterwegs(): Promise<{ g: Gegenstelle; appId: string; zugang: string }> {
                const { g: daheim, appId, zugang, willkommen: zuerst } = await kopple('familie', 6);
                expect(zuerst).to.not.have.property('fern');
                await freigeben(appId, true);
                const rechte = await daheim.naechste();
                expect(rechte).to.include({ t: 'rechte' }).and.have.deep.property('fern', fernFuer(appId, zugang));
                geheimnisse.push(rechte.fern.schluessel);
                daheim.schliesse();
                await pause(ABGLEICH_MS);
                const g = await melde(
                    appId,
                    zugang,
                    { strom: await alsApp(vermittler!.adresse, rechte.fern.schluessel) },
                    6,
                );
                const willkommen = await g.naechste();
                expect(willkommen).to.include({ t: 'willkommen', v: 6 });
                expect(willkommen.fern).to.deep.equal(rechte.fern);
                return { g, appId, zugang };
            }

            it('App meldet sich über den Vermittler an, TLS bis zum Adapter, und schaltet', async () => {
                const { g, appId } = await unterwegs();
                await bis(() => u.ablage.werte_.get(appId)?.weg === 'fern');
                g.sende({ t: 'setze', n: 1, id: 'zigbee.0.lampe.state', val: true });
                expect(await g.naechste()).to.deep.equal({ t: 'quittung', n: 1, ok: true });
                expect(u.quelle.zustaende_.get('zigbee.0.lampe.state')).to.include({ val: true, ack: false });
                g.beende();
            });

            it('Freigabe entzogen: Schluss mit 4010, der Vermittler lässt die App nicht mehr durch, daheim geht es', async () => {
                const { g, appId, zugang } = await unterwegs();
                await freigeben(appId, false);
                expect((await g.geschlossen()).code).to.equal(SCHLIESSCODE.fernAus);
                expect(u.log.join('\n')).to.contain(`App ${appId}: Fernzugang ausgeschaltet`);
                await pause(ABGLEICH_MS);
                const schluessel = fernFuer(appId, zugang).schluessel as string;
                expect(await abgewiesen(alsApp(vermittler!.adresse, schluessel))).to.contain('401');
                const daheim = await melde(appId, zugang, undefined, 6);
                expect(await daheim.naechste())
                    .to.include({ t: 'willkommen' })
                    .and.not.have.property('fern');
                daheim.schliesse();
            });

            it('nur Apps ab Protokoll 6 erfahren vom Fernzugang', async () => {
                const { g, appId, zugang } = await kopple('familie', 5);
                await freigeben(appId, true);
                await pause(300);
                expect(await g.alle()).to.deep.equal([]);
                g.schliesse();
                const wieder = await melde(appId, zugang, undefined, 5);
                expect(await wieder.naechste())
                    .to.include({ t: 'willkommen', v: 5 })
                    .and.not.have.property('fern');
                wieder.schliesse();
            });

            it('neues Geheimnis: Apps bekommen sofort den neuen Schlüssel, der Vermittler kennt den Adapter nicht mehr', async () => {
                const { g, appId, zugang } = await kopple('familie', 6);
                await freigeben(appId, true);
                const alt = (await g.naechste()).fern;
                await u.server.fern!.neuesGeheimnis();
                const neu = (await g.naechste()).fern;
                expect(neu.schluessel).to.not.equal(alt.schluessel);
                geheimnisse.push(alt.schluessel, neu.schluessel);
                expect(neu).to.deep.include({ adresse: alt.adresse, pingS: 600 });
                await bis(() => u.server.fern?.stand.art === 'getrennt', 5000);
                expect((u.server.fern!.stand as { grund: string }).grund).to.contain('Zeile für den Vermittler fehlt');
                expect(sha256(zugang).toString('hex')).to.equal(u.ablage.apps.get(appId)?.zugangHash);
                g.schliesse();
            });
        });
    }
});
