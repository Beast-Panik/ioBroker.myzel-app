import Ajv2020 from 'ajv/dist/2020';
import { expect } from 'chai';
import adapterAnApp from '../protokoll/v1/adapter-an-app.schema.json';
import appAnAdapter from '../protokoll/v1/app-an-adapter.schema.json';
import gemeinsam from '../protokoll/v1/gemeinsam.schema.json';

const ajv = new Ajv2020({ strict: true });
ajv.addSchema(gemeinsam);
const anAdapter = ajv.compile(appAnAdapter);
const anApp = ajv.compile(adapterAnApp);

const zeit = 1793720000000;
const zugang = 'A'.repeat(43);
const geraet = { android: '15', appVersion: '1.0.0' };

const gueltigAnAdapter: Record<string, unknown>[] = [
    { t: 'hallo', v: 1, app: 'abcdefgh', zugang, geraet },
    { t: 'koppeln', v: 1, geheimnis: 'b'.repeat(22), name: 'Tablet Flur', geraet },
    { t: 'abo', ids: ['zigbee.0.lampe.state', 'hm-rpc.0.ABC:1.LEVEL', 'javascript.0.Küche.Temperatur'] },
    { t: 'setze', n: 7, id: 'zigbee.0.lampe.state', val: true },
    { t: 'akku', stand: 87, laedt: false, zeit },
    { t: 'anruf', status: 'klingelt', richtung: 'eingehend', nummer: '+4930123456', name: 'Mama', zeit },
    { t: 'anruf', status: 'frei', zeit },
    {
        t: 'benachrichtigung',
        app: 'Signal',
        paket: 'org.thoughtcrime.securesms',
        titel: 'Anna',
        text: 'Bin gleich da',
        zeit,
    },
    { t: 'angezeigt', id: 'Ab3_-xY9' },
];

const ungueltigAnAdapter: [string, Record<string, unknown>][] = [
    ['unbekanntes Feld', { t: 'hallo', v: 1, app: 'abcdefgh', zugang, geraet, extra: 1 }],
    ['Version 3', { t: 'hallo', v: 3, app: 'abcdefgh', zugang, geraet }],
    ['laufende Nummer 0', { t: 'setze', n: 0, id: 'a.b', val: 1 }],
    ['verbotenes Zeichen in ID', { t: 'setze', n: 1, id: 'a.b*', val: 1 }],
    ['Objekt als Wert', { t: 'setze', n: 1, id: 'a.b', val: { x: 1 } }],
    ['Akku 101', { t: 'akku', stand: 101, laedt: false, zeit }],
    ['Leerzeichen in Rufnummer', { t: 'anruf', status: 'klingelt', nummer: '030 123', zeit }],
    ['Schrägstrich im Paketnamen', { t: 'benachrichtigung', app: 'X', paket: '../etc', zeit }],
    ['Nachricht der Gegenrichtung', { t: 'gekoppelt', app: 'abcdefgh', zugang }],
];

const gueltigAnApp: Record<string, unknown>[] = [
    {
        t: 'willkommen',
        v: 1,
        adapter: 'a'.repeat(26),
        adressen: ['192.168.1.5:8095', '[fd00::5]:8095'],
        handydaten: { akku: true, anruf: false, benachrichtigung: true },
        profil: 'Familie',
        datenpunkte: [
            { id: 'zigbee.0.lampe.state', name: 'Lampe', typ: 'boolean', rolle: 'switch.light', recht: 'schreiben' },
            {
                id: 'heizung.0.modus',
                name: 'Modus',
                typ: 'number',
                auswahl: { 0: 'Aus', 1: 'Komfort' },
                recht: 'lesen',
            },
        ],
        raeume: [{ id: 'enum.rooms.living_room', name: 'Wohnzimmer', mitglieder: ['zigbee.0.lampe.state'] }],
        funktionen: [],
    },
    {
        t: 'rechte',
        profil: 'Gast',
        datenpunkte: [],
        raeume: [],
        funktionen: [],
        handydaten: { akku: false, anruf: false, benachrichtigung: false },
    },
    { t: 'werte', werte: { 'zigbee.0.lampe.state': { val: true, ack: true, ts: zeit }, 'x.0.leer': null } },
    { t: 'quittung', n: 7, ok: false, fehler: 'rechte' },
    { t: 'hinweis', id: 'Ab3_-xY9', titel: 'Waschmaschine', text: 'Fertig', wichtigkeit: 'normal', zeit },
    { t: 'fehler', code: 'version', unterstuetzt: [1] },
];

const ungueltigAnApp: [string, Record<string, unknown>][] = [
    [
        'unbekanntes Feld bei zusammengesetzter Nachricht',
        {
            t: 'rechte',
            profil: 'Gast',
            datenpunkte: [],
            raeume: [],
            funktionen: [],
            handydaten: { akku: false, anruf: false, benachrichtigung: false },
            extra: true,
        },
    ],
    ['rechte ohne Handydaten', { t: 'rechte', profil: 'Gast', datenpunkte: [], raeume: [], funktionen: [] }],
    [
        'keine Adresse',
        {
            t: 'willkommen',
            v: 1,
            adapter: 'a'.repeat(26),
            adressen: [],
            handydaten: { akku: true, anruf: true, benachrichtigung: true },
            profil: 'x',
            datenpunkte: [],
            raeume: [],
            funktionen: [],
        },
    ],
    ['unbekannter Fehlercode', { t: 'fehler', code: 'unbekannt' }],
];

describe('Protokoll v1, Schemata', () => {
    describe('App an Adapter', () => {
        for (const nachricht of gueltigAnAdapter) {
            it(`nimmt an: ${String(nachricht.t)}`, () => {
                expect(anAdapter(nachricht), JSON.stringify(anAdapter.errors?.[0])).to.be.true;
            });
        }
        for (const [fall, nachricht] of ungueltigAnAdapter) {
            it(`lehnt ab: ${fall}`, () => {
                expect(anAdapter(nachricht)).to.be.false;
            });
        }
    });

    describe('Adapter an App', () => {
        for (const nachricht of gueltigAnApp) {
            it(`nimmt an: ${String(nachricht.t)}`, () => {
                expect(anApp(nachricht), JSON.stringify(anApp.errors?.[0])).to.be.true;
            });
        }
        for (const [fall, nachricht] of ungueltigAnApp) {
            it(`lehnt ab: ${fall}`, () => {
                expect(anApp(nachricht)).to.be.false;
            });
        }
    });
});
