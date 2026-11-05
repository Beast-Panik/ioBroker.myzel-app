import { expect } from 'chai';
import { type Erkannt, type Vorschlag, erkenneGeraete, verschoben, vorschlaege } from './erkennung';
import { type Aufzaehlung, type Karte, type Merkmale, merkmale } from './rechte';

type Common = Record<string, unknown>;

const obj = (id: string, type: string, common: Common): [string, ioBroker.Object] => [
    id,
    { _id: id, type, common, native: {} } as unknown as ioBroker.Object,
];
const geraet = (id: string, name: Common['name']): [string, ioBroker.Object] => obj(id, 'device', { name });
const kanal = (id: string, name: Common['name']): [string, ioBroker.Object] => obj(id, 'channel', { name });
const zustand = (id: string, role: string, type: string, mehr: Common = {}): [string, ioBroker.Object] =>
    obj(id, 'state', { name: id.slice(id.lastIndexOf('.') + 1), role, type, read: true, write: false, ...mehr });
const adapter = (name: string, art: string): [string, ioBroker.Object] =>
    obj(`system.adapter.${name}`, 'adapter', { name, type: art });

// Wie sie Hue, Zigbee, Shelly und Homematic IP anlegen, dazu Adapter ohne Geräte und ein Alias
const OBJEKTE: Record<string, ioBroker.Object> = Object.fromEntries([
    adapter('hue', 'lighting'),
    adapter('zigbee', 'hardware'),
    adapter('javascript', 'logic'),
    adapter('backitup', 'general'),
    geraet('hue.0.Deckenlampe', { de: 'Deckenlampe', en: 'Ceiling light' }),
    zustand('hue.0.Deckenlampe.on', 'switch.light', 'boolean', { write: true }),
    zustand('hue.0.Deckenlampe.level', 'level.dimmer', 'number', { write: true, min: 0, max: 100 }),
    zustand('hue.0.Deckenlampe.ct', 'level.color.temperature', 'number', { write: true, min: 2200, max: 6500 }),
    geraet('zigbee.0.0017880104a1b2c3', 'Stehlampe'),
    zustand('zigbee.0.0017880104a1b2c3.state', 'switch', 'boolean', { write: true }),
    zustand('zigbee.0.0017880104a1b2c3.brightness', 'level.dimmer', 'number', { write: true, min: 0, max: 100 }),
    zustand('zigbee.0.0017880104a1b2c3.color', 'level.color.rgb', 'string', { write: true }),
    zustand('zigbee.0.0017880104a1b2c3.available', 'indicator.reachable', 'boolean'),
    geraet('zigbee.0.00158d0004c3d2e1', 'Klima Schlafzimmer'),
    zustand('zigbee.0.00158d0004c3d2e1.temperature', 'value.temperature', 'number', { unit: '°C' }),
    zustand('zigbee.0.00158d0004c3d2e1.humidity', 'value.humidity', 'number', { unit: '%' }),
    geraet('zigbee.0.00158d000aa11bb2', 'Fensterkontakt'),
    zustand('zigbee.0.00158d000aa11bb2.opened', 'sensor.window', 'boolean'),
    geraet('shelly.0.SHPLG-S#A1B2C3#1', 'Shelly Plug S'),
    kanal('shelly.0.SHPLG-S#A1B2C3#1.Relay0', 'Relay0'),
    zustand('shelly.0.SHPLG-S#A1B2C3#1.Relay0.Switch', 'switch', 'boolean', { write: true }),
    geraet('hmip.0.devices.3014F7', 'Heizkörper Flur'),
    kanal('hmip.0.devices.3014F7.channels.1', 'Heizkörper Flur:1'),
    zustand('hmip.0.devices.3014F7.channels.1.setPointTemperature', 'level.temperature', 'number', {
        write: true,
        min: 5,
        max: 30,
        unit: '°C',
    }),
    zustand('hmip.0.devices.3014F7.channels.1.actualTemperature', 'value.temperature', 'number', { unit: '°C' }),
    kanal('backitup.0.oneClick', 'oneClick'),
    zustand('backitup.0.oneClick.iobroker', 'switch', 'boolean', { write: true }),
    zustand('javascript.0.scriptEnabled.common.Licht', 'switch', 'boolean', { write: true }),
    zustand('system.adapter.admin.0.alive', 'indicator.state', 'boolean'),
    kanal('myzel-app.0.apps.abc.anruf', 'Anruf'),
    zustand('myzel-app.0.apps.abc.anruf.aktiv', 'switch', 'boolean', { write: true }),
]);

const erkenne = (objekte: Record<string, ioBroker.Object> = OBJEKTE): Erkannt[] =>
    erkenneGeraete(objekte, { namespace: 'myzel-app.0', sprache: 'de' });

describe('Erkennung von Geräten', () => {
    it('macht aus Geräten Lampen, Schalter, Thermostate und Messwerte mit Namen in der Systemsprache', () => {
        const e = erkenne().sort((a, b) => (a.herkunft < b.herkunft ? -1 : 1));
        expect(e.map(x => [x.herkunft, x.name, x.typ, x.teile])).to.deep.equal([
            [
                'hmip.0.devices.3014F7.channels.1',
                'Heizkörper Flur',
                'thermostat',
                {
                    soll: 'hmip.0.devices.3014F7.channels.1.setPointTemperature',
                    ist: 'hmip.0.devices.3014F7.channels.1.actualTemperature',
                },
            ],
            [
                'hue.0.Deckenlampe',
                'Deckenlampe',
                'lampe',
                {
                    schalten: 'hue.0.Deckenlampe.on',
                    helligkeit: 'hue.0.Deckenlampe.level',
                    farbtemperatur: 'hue.0.Deckenlampe.ct',
                },
            ],
            [
                'shelly.0.SHPLG-S#A1B2C3#1.Relay0',
                'Shelly Plug S',
                'schalter',
                { schalten: 'shelly.0.SHPLG-S#A1B2C3#1.Relay0.Switch' },
            ],
            [
                'zigbee.0.00158d0004c3d2e1',
                'Klima Schlafzimmer',
                'messwert',
                {
                    wert1: 'zigbee.0.00158d0004c3d2e1.temperature',
                    wert2: 'zigbee.0.00158d0004c3d2e1.humidity',
                },
            ],
            ['zigbee.0.00158d000aa11bb2', 'Fensterkontakt', 'messwert', { wert1: 'zigbee.0.00158d000aa11bb2.opened' }],
            [
                'zigbee.0.0017880104a1b2c3',
                'Stehlampe',
                'lampe',
                {
                    schalten: 'zigbee.0.0017880104a1b2c3.state',
                    helligkeit: 'zigbee.0.0017880104a1b2c3.brightness',
                    farbe: 'zigbee.0.0017880104a1b2c3.color',
                },
            ],
        ]);
    });

    it('lässt Adapter ohne Geräte, system und die eigene Instanz aus', () => {
        const ids = erkenne().flatMap(x => Object.values(x.teile));
        for (const praefix of ['backitup.', 'javascript.', 'system.', 'myzel-app.']) {
            expect(
                ids.some(id => id.startsWith(praefix)),
                praefix,
            ).to.equal(false);
        }
    });

    it('nennt bei mehreren Vorschlägen aus einem Gerät den Kanal, mit dem Gerät davor, wo es fehlt', () => {
        const objekte = {
            ...OBJEKTE,
            ...Object.fromEntries([
                zustand('shelly.0.SHPLG-S#A1B2C3#1.Relay1.Switch', 'switch', 'boolean', { write: true }),
                kanal('shelly.0.SHPLG-S#A1B2C3#1.Relay1', 'Relay1'),
            ]),
        };
        const shelly = erkenne(objekte).filter(x => x.herkunft.startsWith('shelly.'));
        expect(shelly.map(x => [x.herkunft, x.name]).sort()).to.deep.equal([
            ['shelly.0.SHPLG-S#A1B2C3#1.Relay0', 'Shelly Plug S Relay0'],
            ['shelly.0.SHPLG-S#A1B2C3#1.Relay1', 'Shelly Plug S Relay1'],
        ]);
        const zwei = {
            ...OBJEKTE,
            ...Object.fromEntries([
                kanal('hmip.0.devices.3014F7.channels.2', 'Heizkörper Flur:2'),
                zustand('hmip.0.devices.3014F7.channels.2.actualTemperature', 'value.temperature', 'number'),
            ]),
        };
        const hmip = erkenne(zwei).filter(x => x.herkunft.startsWith('hmip.'));
        expect(hmip.map(x => x.name).sort()).to.deep.equal(['Heizkörper Flur:1', 'Heizkörper Flur:2']);
    });

    it('nimmt einen Alias statt seines Ziels', () => {
        const objekte = {
            ...OBJEKTE,
            ...Object.fromEntries([
                geraet('alias.0.Fenster', 'Fenster Schlafzimmer'),
                zustand('alias.0.Fenster.offen', 'sensor.window', 'boolean', {
                    alias: { id: 'zigbee.0.00158d000aa11bb2.opened' },
                }),
            ]),
        };
        const e = erkenne(objekte);
        expect(e.some(x => x.herkunft === 'zigbee.0.00158d000aa11bb2')).to.equal(false);
        expect(e.find(x => x.herkunft === 'alias.0.Fenster')?.teile).to.deep.equal({ wert1: 'alias.0.Fenster.offen' });
    });
});

describe('Vorschläge aus der Erkennung', () => {
    const merkmaleAus =
        (objekte: Record<string, ioBroker.Object>) =>
        (id: string): Merkmale | undefined =>
            objekte[id]?.type === 'state' ? merkmale(id, objekte[id].common as ioBroker.StateCommon, 'de') : undefined;
    const raum = (id: string, mitglieder: string[]): Aufzaehlung => ({ id: `enum.rooms.${id}`, name: id, mitglieder });

    const vorschlagFuer = (karten: Karte[] = [], raeume: Aufzaehlung[] = [], objekte = OBJEKTE): Vorschlag[] =>
        vorschlaege(erkenne(objekte), {
            karten,
            raeume,
            datenpunkt: merkmaleAus(objekte),
            eigeneApps: 'myzel-app.0.apps',
        });

    it('lässt Geräte aus, deren Datenpunkte schon in einer Karte stehen, auch über einen Alias', () => {
        const objekte = {
            ...OBJEKTE,
            ...Object.fromEntries([
                zustand('alias.0.Steckdose.an', 'switch', 'boolean', {
                    write: true,
                    alias: { id: 'shelly.0.SHPLG-S#A1B2C3#1.Relay0.Switch' },
                }),
            ]),
        };
        const karten: Karte[] = [
            { name: 'Licht', typ: 'lampe', raum: '', teile: { schalten: 'hue.0.Deckenlampe.on' } },
            { name: 'Steckdose', typ: 'schalter', raum: '', teile: { schalten: 'alias.0.Steckdose.an' } },
        ];
        const herkunft = vorschlagFuer(karten, [], objekte).flatMap(v => v.herkunft);
        expect(herkunft).to.not.include('hue.0.Deckenlampe');
        expect(herkunft).to.not.include('shelly.0.SHPLG-S#A1B2C3#1');
        expect(herkunft).to.include('zigbee.0.0017880104a1b2c3');
    });

    it('gibt den ersten Raum in der Folge der App, der das Gerät oder einen seiner Datenpunkte enthält', () => {
        const raeume = [
            raum('flur', ['hmip.0.devices.3014F7.channels.1.setPointTemperature']),
            raum('wohnzimmer', ['hue.0.Deckenlampe', 'zigbee.0.0017880104a1b2c3']),
            raum('auch', ['hue.0']),
        ];
        const raumVon = (h: string): string | undefined =>
            vorschlagFuer([], raeume).find(v => v.herkunft.includes(h))?.karte.raum;
        expect(raumVon('hmip.0.devices.3014F7.channels.1')).to.equal('enum.rooms.flur');
        expect(raumVon('hue.0.Deckenlampe')).to.equal('enum.rooms.wohnzimmer');
        expect(raumVon('zigbee.0.00158d000aa11bb2')).to.equal('');
    });

    describe('was in ioBroker den Raum wechselt', () => {
        const SHELLY = 'shelly.0.SHPLG-S#A1B2C3#1';
        const zweitesRelais = {
            ...OBJEKTE,
            ...Object.fromEntries([
                kanal(`${SHELLY}.Relay1`, 'Relay1'),
                zustand(`${SHELLY}.Relay1.Switch`, 'switch', 'boolean', { write: true }),
            ]),
        };
        const raeume = [raum('kueche', [SHELLY]), raum('auch', ['hue.0'])];
        const relais0 = (karten: Karte[] = [], objekte = OBJEKTE): Pick<Vorschlag, 'zuordnung' | 'bleibt'> => {
            const v = vorschlagFuer(karten, raeume, objekte).find(x => x.herkunft.includes(`${SHELLY}.Relay0`))!;
            return { zuordnung: v.zuordnung, bleibt: v.bleibt };
        };

        it('nimmt das ganze Gerät mit, wenn nur dieser Vorschlag daraus kommt', () => {
            expect(relais0()).to.deep.equal({ zuordnung: [SHELLY], bleibt: [] });
        });

        it('lässt das Gerät stehen, wenn ein zweiter Vorschlag daraus kommt, auch einer, der schon eine Karte ist', () => {
            const erwartet = {
                zuordnung: [`${SHELLY}.Relay0`],
                bleibt: [{ raum: 'enum.rooms.kueche', ueber: SHELLY }],
            };
            expect(relais0([], zweitesRelais)).to.deep.equal(erwartet);
            const karte: Karte = {
                name: 'R1',
                typ: 'schalter',
                raum: '',
                teile: { schalten: `${SHELLY}.Relay1.Switch` },
            };
            expect(relais0([karte], zweitesRelais)).to.deep.equal(erwartet);
        });

        it('nimmt nie eine ganze Instanz mit', () => {
            const hue = vorschlagFuer([], raeume).find(x => x.herkunft.includes('hue.0.Deckenlampe'))!;
            expect([hue.zuordnung, hue.bleibt]).to.deep.equal([
                ['hue.0.Deckenlampe'],
                [{ raum: 'enum.rooms.auch', ueber: 'hue.0' }],
            ]);
        });
    });

    it('lässt Teile mit unpassendem Datenpunkt weg, Werte rücken nach; eine Karte, die fehlen würde, kommt nicht', () => {
        const objekte = {
            ...OBJEKTE,
            ...Object.fromEntries([
                // Lichtfarbe ohne min und max: Niemand weiß, wo warm und wo kalt liegt.
                zustand('hue.0.Deckenlampe.ct', 'level.color.temperature', 'number', { write: true }),
                // Ein Messwert als Objekt passt nicht, die Feuchte rückt auf Wert 1.
                zustand('zigbee.0.00158d0004c3d2e1.temperature', 'value.temperature', 'number', { type: 'object' }),
                // Ein Thermostat, dessen Sollwert keinen brauchbaren Bereich hat, fehlte auf den Handys.
                zustand('hmip.0.devices.3014F7.channels.1.setPointTemperature', 'level.temperature', 'number', {
                    write: true,
                    min: 30,
                    max: 5,
                }),
            ]),
        };
        const v = vorschlagFuer([], [], objekte);
        expect(v.find(x => x.herkunft.includes('hue.0.Deckenlampe'))?.karte.teile).to.deep.equal({
            schalten: 'hue.0.Deckenlampe.on',
            helligkeit: 'hue.0.Deckenlampe.level',
        });
        expect(v.find(x => x.herkunft.includes('zigbee.0.00158d0004c3d2e1'))?.karte.teile).to.deep.equal({
            wert1: 'zigbee.0.00158d0004c3d2e1.humidity',
        });
        expect(v.some(x => x.herkunft.some(h => h.startsWith('hmip.')))).to.equal(false);
    });

    describe('gleichnamige Teile ohne Gerät', () => {
        const ordner = (id: string): [string, ioBroker.Object] => obj(id, 'folder', { name: id });
        // Einzelne Datenpunkte in Ordnern, wie sie Skripte oder Gruppenadressen anlegen
        const TEILE: Record<string, ioBroker.Object> = Object.fromEntries([
            ordner('0_userdata.0.flur'),
            zustand('0_userdata.0.flur.farbe', 'level.color.rgb', 'string', { write: true, name: 'Flurlampe' }),
            zustand('0_userdata.0.flur.an', 'switch', 'boolean', { write: true, name: 'Flurlampe' }),
            zustand('0_userdata.0.flur.hell', 'level.dimmer', 'number', {
                write: true,
                min: 0,
                max: 100,
                name: ' flurlampe',
            }),
            ordner('knx.0.soll'),
            ordner('knx.0.ist'),
            zustand('knx.0.soll.bad', 'level.temperature', 'number', {
                write: true,
                min: 5,
                max: 30,
                name: 'Heizung Bad',
            }),
            zustand('knx.0.ist.bad', 'value.temperature', 'number', { name: 'Heizung Bad' }),
        ]);
        const nur = (v: Vorschlag[], praefix: string): Vorschlag[] =>
            v.filter(x => x.herkunft.some(h => h.startsWith(praefix)));

        it('fasst An, Helligkeit und Farbe zu einer Lampe zusammen, die Teile in der Folge der Karte', () => {
            const [lampe, ...mehr] = nur(vorschlagFuer([], [], TEILE), '0_userdata.');
            expect(mehr).to.deep.equal([]);
            expect(lampe.herkunft.sort()).to.deep.equal([
                '0_userdata.0.flur.an',
                '0_userdata.0.flur.farbe',
                '0_userdata.0.flur.hell',
            ]);
            expect(lampe.karte.typ).to.equal('lampe');
            expect(Object.entries(lampe.karte.teile)).to.deep.equal([
                ['schalten', '0_userdata.0.flur.an'],
                ['helligkeit', '0_userdata.0.flur.hell'],
                ['farbe', '0_userdata.0.flur.farbe'],
            ]);
        });

        it('nimmt einen Temperaturfühler mit dem Namen eines Thermostats als Isttemperatur', () => {
            expect(nur(vorschlagFuer([], [], TEILE), 'knx.').map(v => v.karte)).to.deep.equal([
                {
                    name: 'Heizung Bad',
                    typ: 'thermostat',
                    raum: '',
                    teile: { soll: 'knx.0.soll.bad', ist: 'knx.0.ist.bad' },
                },
            ]);
        });

        it('lässt getrennt, was in zwei Räumen steht, aus zwei Instanzen kommt oder sich nicht ergänzt', () => {
            const objekte = {
                ...TEILE,
                ...Object.fromEntries([
                    zustand('knx.0.soll.kueche', 'switch.light', 'boolean', { write: true, name: 'Deckenlampe' }),
                    zustand('knx.0.ist.bad2', 'level.dimmer', 'number', { write: true, name: 'Deckenlampe' }),
                    zustand('knx.1.soll.spiegel', 'switch.light', 'boolean', { write: true, name: 'Spiegel' }),
                    zustand('knx.0.ist.spiegel', 'level.dimmer', 'number', { write: true, name: 'Spiegel' }),
                    zustand('knx.0.soll.dose1', 'switch', 'boolean', { write: true, name: 'Dose' }),
                    zustand('knx.0.ist.dose2', 'switch', 'boolean', { write: true, name: 'Dose' }),
                ]),
            };
            const raeume = [raum('kueche', ['knx.0.soll.kueche']), raum('bad', ['knx.0.ist.bad2'])];
            const getrennt = nur(vorschlagFuer([], raeume, objekte), 'knx.')
                .filter(v => v.karte.name !== 'Heizung Bad')
                .map(v => [v.karte.name, ...v.herkunft]);
            expect(getrennt.sort()).to.deep.equal([
                ['Deckenlampe', 'knx.0.ist.bad2'],
                ['Deckenlampe', 'knx.0.soll.kueche'],
                ['Dose', 'knx.0.ist.dose2'],
                ['Dose', 'knx.0.soll.dose1'],
                ['Spiegel', 'knx.0.ist.spiegel'],
                ['Spiegel', 'knx.1.soll.spiegel'],
            ]);
        });

        it('lässt die ganze Lampe aus, wenn eines ihrer Teile schon in einer Karte steht', () => {
            const karten: Karte[] = [
                { name: 'Flur', typ: 'schalter', raum: '', teile: { schalten: '0_userdata.0.flur.an' } },
            ];
            expect(nur(vorschlagFuer(karten, [], TEILE), '0_userdata.')).to.deep.equal([]);
        });
    });

    it('schlägt nie etwas vor, das auf Handydaten zeigt, auch nicht über einen Alias', () => {
        const objekte = {
            ...OBJEKTE,
            ...Object.fromEntries([
                zustand('alias.0.Handy.anruf', 'switch', 'boolean', {
                    write: true,
                    alias: { id: 'myzel-app.0.apps.abc.anruf.aktiv' },
                }),
            ]),
        };
        expect(vorschlagFuer([], [], objekte).some(v => v.herkunft.some(h => h.startsWith('alias.')))).to.equal(false);
    });
});

describe('Raum in ioBroker verschieben', () => {
    const zuordnung = ['z.0.lampe.an', 'z.0.lampe.hell'];

    it('nimmt in den neuen Raum, was dort nicht schon selbst oder über ein Objekt darüber steht', () => {
        expect(verschoben(['a.0'], zuordnung, true)).to.deep.equal(['a.0', ...zuordnung]);
        expect(verschoben(['z.0.lampe.an'], zuordnung, true)).to.deep.equal(['z.0.lampe.an', 'z.0.lampe.hell']);
        expect(verschoben(['z.0.lampe'], zuordnung, true)).to.deep.equal(['z.0.lampe']);
    });

    it('nimmt sie samt allem darunter aus anderen Räumen; ein Objekt darüber bleibt', () => {
        expect(verschoben(['z.0.lampe.an', 'z.0.lampe.hell.x', 'z.0.lampen', 'a.0'], zuordnung, false)).to.deep.equal([
            'z.0.lampen',
            'a.0',
        ]);
        expect(verschoben(['z.0.lampe'], zuordnung, false)).to.deep.equal(['z.0.lampe']);
    });
});
