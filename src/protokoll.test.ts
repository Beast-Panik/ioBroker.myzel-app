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
    { t: 'hallo', v: 3, app: 'abcdefgh', zugang, geraet },
    { t: 'hallo', v: 4, app: 'abcdefgh', zugang, geraet },
    { t: 'koppeln', v: 3, geheimnis: 'b'.repeat(22), name: 'Tablet Flur', geraet },
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
    { t: 'auswahl', apps: [{ paket: 'org.thoughtcrime.securesms', app: 'Signal' }] },
    { t: 'auswahl', apps: [] },
    { t: 'angezeigt', id: 'Ab3_-xY9' },
];

const ungueltigAnAdapter: [string, Record<string, unknown>][] = [
    ['unbekanntes Feld', { t: 'hallo', v: 3, app: 'abcdefgh', zugang, geraet, extra: 1 }],
    ['Version 2', { t: 'hallo', v: 2, app: 'abcdefgh', zugang, geraet }],
    ['laufende Nummer 0', { t: 'setze', n: 0, id: 'a.b', val: 1 }],
    ['verbotenes Zeichen in ID', { t: 'setze', n: 1, id: 'a.b*', val: 1 }],
    ['Objekt als Wert', { t: 'setze', n: 1, id: 'a.b', val: { x: 1 } }],
    ['Akku 101', { t: 'akku', stand: 101, laedt: false, zeit }],
    ['Leerzeichen in Rufnummer', { t: 'anruf', status: 'klingelt', nummer: '030 123', zeit }],
    ['Schrägstrich im Paketnamen', { t: 'benachrichtigung', app: 'X', paket: '../etc', zeit }],
    ['Version 5', { t: 'hallo', v: 5, app: 'abcdefgh', zugang, geraet }],
    ['Auswahl mit Schrägstrich im Paketnamen', { t: 'auswahl', apps: [{ paket: '../etc', app: 'X' }] }],
    ['Auswahl ohne Namen', { t: 'auswahl', apps: [{ paket: 'org.signal' }] }],
    ['Auswahl mit leerem Namen', { t: 'auswahl', apps: [{ paket: 'org.signal', app: '' }] }],
    [
        'Auswahl mit 101 Apps',
        { t: 'auswahl', apps: Array.from({ length: 101 }, (_, i) => ({ paket: `a.b${i}`, app: 'X' })) },
    ],
    ['Nachricht der Gegenrichtung', { t: 'gekoppelt', app: 'abcdefgh', zugang }],
];

const handydaten = { akku: true, anruf: false, benachrichtigung: true };
const an = { id: 'zigbee.0.lampe.state', typ: 'boolean', recht: 'schreiben' };
const hell = {
    id: 'zigbee.0.lampe.hell',
    typ: 'number',
    einheit: '%',
    min: 0,
    max: 100,
    schritt: 1,
    recht: 'schreiben',
};
const soll = { id: 'heizung.0.soll', typ: 'number', einheit: '°C', min: 5, max: 30, schritt: 0.5, recht: 'schreiben' };
const temp = { id: 'zigbee.0.sensor.temp', typ: 'number', einheit: '°C', recht: 'lesen', name: 'Temperatur' };
const ohne = (o: Record<string, unknown>, feld: string): Record<string, unknown> =>
    Object.fromEntries(Object.entries(o).filter(([k]) => k !== feld));
const karte = (typ: string, teile: Record<string, unknown>): Record<string, unknown> => ({
    id: 'k',
    name: 'Karte',
    typ,
    raum: 'enum.rooms.living_room',
    teile,
});
const rechte = (karten: unknown[]): Record<string, unknown> => ({
    t: 'rechte',
    profil: 'Gast',
    raeume: [],
    karten,
    handydaten,
});

const gueltigAnApp: Record<string, unknown>[] = [
    {
        t: 'willkommen',
        v: 3,
        adapter: 'a'.repeat(26),
        adressen: ['192.168.1.5:8095', '[fd00::5]:8095'],
        handydaten,
        profil: 'Familie',
        raeume: [{ id: 'enum.rooms.living_room', name: 'Wohnzimmer' }],
        karten: [
            karte('lampe', {
                schalten: an,
                helligkeit: hell,
                farbe: { id: 'z.0.l.farbe', typ: 'string', recht: 'lesen' },
                farbtemperatur: { id: 'z.0.l.ct', typ: 'number', min: 153, max: 500, recht: 'schreiben' },
            }),
            { id: 'steckdose', name: 'Steckdose', typ: 'schalter', teile: { schalten: { ...an, recht: 'lesen' } } },
            karte('messwert', {
                wert1: temp,
                wert2: {
                    id: 'z.0.fenster',
                    typ: 'boolean',
                    recht: 'lesen',
                    name: 'Fenster',
                    auswahl: { true: 'offen' },
                },
                wert4: { id: 'z.0.text', typ: 'string', recht: 'lesen', name: '' },
            }),
            karte('thermostat', { soll, ist: ohne(temp, 'name') }),
        ],
    },
    rechte([]),
    { t: 'werte', werte: { 'zigbee.0.lampe.state': { val: true, ack: true, ts: zeit }, 'x.0.leer': null } },
    { t: 'quittung', n: 7, ok: false, fehler: 'rechte' },
    { t: 'hinweis', id: 'Ab3_-xY9', titel: 'Waschmaschine', text: 'Fertig', wichtigkeit: 'normal', zeit },
    { t: 'fehler', code: 'version', unterstuetzt: [3, 4] },
];

const ungueltigAnApp: [string, Record<string, unknown>][] = [
    ['unbekanntes Feld bei zusammengesetzter Nachricht', { ...rechte([]), extra: true }],
    ['rechte ohne Handydaten', { t: 'rechte', profil: 'Gast', raeume: [], karten: [] }],
    ['einzelne Datenpunkte', { ...rechte([]), datenpunkte: [] }],
    [
        'keine Adresse',
        {
            t: 'willkommen',
            v: 3,
            adapter: 'a'.repeat(26),
            adressen: [],
            handydaten,
            profil: 'x',
            raeume: [],
            karten: [],
        },
    ],
    ['unbekannter Fehlercode', { t: 'fehler', code: 'unbekannt' }],
    ['unbekannter Kartentyp', rechte([karte('rollladen', { schalten: an })])],
    ['Karte ohne Teil', rechte([karte('lampe', {})])],
    ['Teil eines anderen Typs', rechte([karte('lampe', { soll })])],
    ['Schalter ohne schalten', rechte([karte('schalter', {})])],
    ['Thermostat ohne Soll', rechte([karte('thermostat', { ist: { ...soll, recht: 'lesen' } })])],
    ['Schalter als Zahl', rechte([karte('schalter', { schalten: { ...an, typ: 'number' } })])],
    ['Helligkeit ohne Bereich', rechte([karte('lampe', { helligkeit: { ...an, typ: 'number' } })])],
    ['Solltemperatur ohne Schritt', rechte([karte('thermostat', { soll: ohne(soll, 'schritt') })])],
    ['Schritt 0', rechte([karte('lampe', { helligkeit: { ...hell, schritt: 0 } })])],
    ['Isttemperatur bedienbar', rechte([karte('thermostat', { soll, ist: { ...soll } })])],
    ['Messwert ohne Bezeichnung', rechte([karte('messwert', { wert1: ohne(temp, 'name') })])],
    ['Messwert bedienbar', rechte([karte('messwert', { wert1: { ...temp, recht: 'schreiben' } })])],
    ['Bezeichnung außerhalb des Messwerts', rechte([karte('schalter', { schalten: { ...an, name: 'An' } })])],
    ['Messwert mit wert5', rechte([karte('messwert', { wert5: temp })])],
    ['Kartenkennung mit Großbuchstaben', rechte([{ ...karte('schalter', { schalten: an }), id: 'Lampe' }])],
    ['Raum mit verbotenem Zeichen', rechte([{ ...karte('schalter', { schalten: an }), raum: 'enum.rooms.a*' }])],
];

describe('Protokoll 3, Schemata', () => {
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
