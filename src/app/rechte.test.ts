import { expect } from 'chai';
import { Speicherquelle } from '../../test/speicher';
import {
    type Geraet,
    type Profil,
    alsGeraet,
    alsProfil,
    berechneRechte,
    beschreibe,
    passtZuTeil,
    rechteFuer,
} from './rechte';

function welt(): Speicherquelle {
    const q = new Speicherquelle()
        .datenpunkt('zigbee.0.lampe.state', { type: 'boolean' })
        .datenpunkt('zigbee.0.lampe.info', { type: 'string', write: false })
        .datenpunkt('zigbee.0.lampe.geheim', { type: 'string' })
        .datenpunkt('zigbee.0.lampe-x.state', { type: 'boolean' })
        .datenpunkt('zigbee.0.lampe.kaputt*', { type: 'boolean' })
        .datenpunkt('hm-rpc.0.ABC:1.LEVEL', { type: 'number' })
        .datenpunkt('zigbee.0.sensor.temp', { type: 'number' })
        .datenpunkt('zigbee.0.sensor.feuchte', { type: 'number' })
        .datenpunkt('system.adapter.admin.0.alive', { type: 'boolean' })
        .raum('wohnzimmer', 'Wohnzimmer', ['zigbee.0.lampe', 'hm-rpc.0.ABC:1.LEVEL'])
        .raum('flur', 'Flur', ['zigbee.0.lampe.state'])
        .raum('keller', 'Keller', ['zigbee.0.sensor'])
        .funktion('licht', 'Licht', ['zigbee.0.lampe.state', 'zigbee.0.lampe-x']);
    return q;
}

const profil = (teil: Partial<Profil>): Profil => ({ name: 'Test', raeume: [], freigaben: [], sperren: [], ...teil });
const rechteListe = (p: Profil, q = welt()): Record<string, string> =>
    Object.fromEntries(berechneRechte(p, q.katalog).inhalt.datenpunkte.map(d => [d.id, d.recht]));

describe('Rechte aus Profilen', () => {
    it('Räume: Mitglieder zählen selbst oder mit allem darunter, Geschwister mit ähnlichem Namen nicht', () => {
        expect(rechteListe(profil({ raeume: [{ enum: 'enum.rooms.wohnzimmer', recht: 'lesen' }] }))).to.deep.equal({
            'hm-rpc.0.ABC:1.LEVEL': 'lesen',
            'zigbee.0.lampe.geheim': 'lesen',
            'zigbee.0.lampe.info': 'lesen',
            'zigbee.0.lampe.state': 'lesen',
        });
    });

    it('steht ein Datenpunkt in mehreren Räumen, gilt das höhere Recht', () => {
        const raeume = [
            { enum: 'enum.rooms.wohnzimmer', recht: 'lesen' as const },
            { enum: 'enum.rooms.flur', recht: 'schreiben' as const },
        ];
        expect(rechteListe(profil({ raeume }))).to.include({ 'zigbee.0.lampe.state': 'schreiben' });
        expect(rechteListe(profil({ raeume: [...raeume].reverse() }))).to.include({
            'zigbee.0.lampe.state': 'schreiben',
        });
    });

    it('Einzelfreigaben setzen ihr Recht, auch niedriger als der Raum, und nur für genau diese ID', () => {
        const rechte = rechteListe(
            profil({
                raeume: [{ enum: 'enum.rooms.wohnzimmer', recht: 'schreiben' }],
                freigaben: [
                    { id: 'zigbee.0.lampe.state', recht: 'lesen' },
                    { id: 'zigbee.0.sensor.temp', recht: 'schreiben' },
                    { id: 'zigbee.0.sensor', recht: 'schreiben' },
                    { id: 'gibt.es.nicht', recht: 'lesen' },
                ],
            }),
        );
        expect(rechte).to.include({ 'zigbee.0.lampe.state': 'lesen', 'zigbee.0.sensor.temp': 'schreiben' });
        expect(rechte).to.not.have.any.keys('zigbee.0.sensor.feuchte', 'gibt.es.nicht');
    });

    it('Sperren gehen vor Freigabe und Raum, auch für ganze Geräte', () => {
        const rechte = rechteListe(
            profil({
                raeume: [{ enum: 'enum.rooms.wohnzimmer', recht: 'schreiben' }],
                freigaben: [{ id: 'zigbee.0.lampe.geheim', recht: 'lesen' }],
                sperren: ['zigbee.0.lampe.geheim', 'hm-rpc.0.ABC:1'],
            }),
        );
        expect(rechte).to.not.have.any.keys('zigbee.0.lampe.geheim', 'hm-rpc.0.ABC:1.LEVEL');
        expect(rechte).to.include.keys('zigbee.0.lampe.state');
    });

    it('system.* ist immer gesperrt, IDs mit verbotenen Zeichen fallen weg', () => {
        const rechte = rechteListe(
            profil({
                freigaben: [
                    { id: 'system.adapter.admin.0.alive', recht: 'lesen' },
                    { id: 'zigbee.0.lampe.kaputt*', recht: 'lesen' },
                ],
            }),
        );
        expect(rechte).to.deep.equal({});
    });

    it('Aliase: Sperren und system.* gelten auch für ihr Ziel, beim Lesen wie beim Schreiben', () => {
        const q = welt()
            .datenpunkt('alias.0.admin', { type: 'number', alias: { id: 'system.adapter.admin.0.sigKill' } })
            .datenpunkt('alias.0.lampe', { type: 'boolean', alias: { id: 'zigbee.0.lampe.state' } })
            .datenpunkt('alias.0.geteilt', {
                type: 'number',
                alias: { id: { read: 'zigbee.0.sensor.temp', write: 'system.host.a.b' } },
            })
            .datenpunkt('alias.0.geheim', { type: 'string', alias: { id: 'zigbee.0.lampe.geheim' } })
            .raum('aliase', 'Aliase', ['alias.0']);
        const p = profil({
            raeume: [{ enum: 'enum.rooms.aliase', recht: 'schreiben' }],
            sperren: ['zigbee.0.lampe.geheim'],
        });
        expect(rechteListe(p, q)).to.deep.equal({ 'alias.0.lampe': 'schreiben' });
    });

    it('Datenpunkte der Apps nur über Einzelfreigaben, nie über einen Raum, auch nicht über einen Alias', () => {
        const q = welt()
            .datenpunkt('myzel-app.0.apps.abcdefgh.anruf.nummer', { type: 'string' })
            .datenpunkt('myzel-app.0.apps.abcdefgh.akku.stand', { type: 'number' })
            .datenpunkt('alias.0.nummer', { type: 'string', alias: { id: 'myzel-app.0.apps.abcdefgh.anruf.nummer' } })
            .raum('handy', 'Handy', ['myzel-app.0.apps.abcdefgh', 'alias.0.nummer']);
        const raeume = [{ enum: 'enum.rooms.handy', recht: 'lesen' as const }];
        expect(rechteListe(profil({ raeume }), q)).to.deep.equal({});
        const freigaben = [
            { id: 'myzel-app.0.apps.abcdefgh.akku.stand', recht: 'lesen' as const },
            { id: 'alias.0.nummer', recht: 'lesen' as const },
        ];
        expect(rechteListe(profil({ raeume, freigaben }), q)).to.deep.equal({
            'alias.0.nummer': 'lesen',
            'myzel-app.0.apps.abcdefgh.akku.stand': 'lesen',
        });
    });

    it('nicht beschreibbare Datenpunkte bekommen nur lesen', () => {
        const rechte = rechteListe(profil({ raeume: [{ enum: 'enum.rooms.wohnzimmer', recht: 'schreiben' }] }));
        expect(rechte).to.include({ 'zigbee.0.lampe.info': 'lesen', 'zigbee.0.lampe.state': 'schreiben' });
    });

    it('Räume und Funktionen gliedern nur erlaubte Datenpunkte, auch Räume außerhalb des Profils', () => {
        const { inhalt } = berechneRechte(
            profil({
                raeume: [{ enum: 'enum.rooms.flur', recht: 'lesen' }],
                freigaben: [{ id: 'zigbee.0.sensor.temp', recht: 'lesen' }],
            }),
            welt().katalog,
        );
        expect(inhalt.raeume).to.deep.equal([
            { id: 'enum.rooms.flur', name: 'Flur', mitglieder: ['zigbee.0.lampe.state'] },
            { id: 'enum.rooms.keller', name: 'Keller', mitglieder: ['zigbee.0.sensor.temp'] },
            { id: 'enum.rooms.wohnzimmer', name: 'Wohnzimmer', mitglieder: ['zigbee.0.lampe.state'] },
        ]);
        expect(inhalt.funktionen).to.deep.equal([
            { id: 'enum.functions.licht', name: 'Licht', mitglieder: ['zigbee.0.lampe.state'] },
        ]);
    });

    it('ohne Profil oder mit ungültiger Profil-ID gibt es keine Rechte', () => {
        const q = welt().profil('familie', profil({ raeume: [{ enum: 'enum.rooms.flur', recht: 'lesen' }] }));
        expect(rechteFuer('familie', q.katalog).inhalt.datenpunkte).to.have.length(1);
        for (const id of ['', 'gibtsnicht', '../familie', 'Familie']) {
            expect(rechteFuer(id, q.katalog).inhalt, id).to.deep.equal({
                profil: '',
                datenpunkte: [],
                raeume: [],
                funktionen: [],
                geraete: [],
            });
        }
    });

    it('prüft Profilobjekte', () => {
        expect(alsProfil(profil({}))).to.deep.equal(profil({}));
        expect(
            alsProfil({
                name: 'x',
                raeume: [{ enum: 'enum.functions.licht', recht: 'lesen' }],
                freigaben: [],
                sperren: [],
            }),
        ).to.be.an('array').that.is.not.empty;
        expect(alsProfil({ name: 'x', raeume: [], freigaben: [{ id: 'a.b', recht: 'alles' }], sperren: [] })).to.be.an(
            'array',
        );
        expect(alsProfil(null)).to.be.an('array');
    });
});

describe('Beschreibung eines Datenpunkts', () => {
    it('übernimmt Name in der Sprache, Typ, Rolle, Einheit, Bereich und Schritt', () => {
        const common = {
            name: { de: 'Helligkeit', en: 'Brightness' },
            type: 'number',
            role: 'level.dimmer',
            unit: '%',
            min: 0,
            max: 100,
            step: 5,
            read: true,
            write: true,
        } as ioBroker.StateCommon;
        expect(beschreibe('a.b', common, 'schreiben', 'de')).to.deep.equal({
            id: 'a.b',
            name: 'Helligkeit',
            typ: 'number',
            rolle: 'level.dimmer',
            einheit: '%',
            min: 0,
            max: 100,
            schritt: 5,
            recht: 'schreiben',
        });
        expect(beschreibe('a.b', common, 'lesen', 'fr').name).to.equal('Brightness');
    });

    it('liest Auswahlwerte als Objekt, Liste und Text', () => {
        const mit = (states: unknown): Record<string, string> | undefined =>
            beschreibe('a.b', { type: 'number', states } as unknown as ioBroker.StateCommon, 'lesen', 'de').auswahl;
        expect(mit({ 0: 'aus', 1: 'an' })).to.deep.equal({ 0: 'aus', 1: 'an' });
        expect(mit(['aus', 'an'])).to.deep.equal({ 0: 'aus', 1: 'an' });
        expect(mit('0:aus;1:an:voll')).to.deep.equal({ 0: 'aus', 1: 'an:voll' });
        expect(mit({})).to.equal(undefined);
    });

    it('hält die Grenzen des Schemas ein', () => {
        const common = {
            name: 'n'.repeat(500),
            type: 'multistate',
            role: 'r'.repeat(500),
            unit: 'u'.repeat(50),
            min: Number.NaN,
            states: Object.fromEntries(Array.from({ length: 300 }, (_, i) => [i, 't'.repeat(300)])),
        } as unknown as ioBroker.StateCommon;
        const d = beschreibe('a.b', common, 'lesen', 'de');
        expect(d.name).to.have.length(200);
        expect(d.typ).to.equal('mixed');
        expect(d.rolle).to.have.length(100);
        expect(d.einheit).to.have.length(30);
        expect(d).to.not.have.property('min');
        expect(Object.keys(d.auswahl!)).to.have.length(200);
        expect(Object.values(d.auswahl!)[0]).to.have.length(200);
    });
});

describe('Geräte aus erlaubten Datenpunkten', () => {
    const lampe = (teile: Geraet['teile'], name = 'Lampe'): Geraet => ({ name, typ: 'lampe', teile });
    const haus = (): Speicherquelle =>
        new Speicherquelle()
            .datenpunkt('z.0.l.an', { type: 'boolean' })
            .datenpunkt('z.0.l.hell', { type: 'number', min: 0, max: 100 })
            .datenpunkt('z.0.l.farbe', { type: 'string' })
            .datenpunkt('z.0.l.ct', { type: 'number', min: 153, max: 500, unit: 'mired' })
            .datenpunkt('z.0.l.ct_ohne', { type: 'number' })
            .datenpunkt('z.0.k.an', { type: 'boolean', write: false })
            .raum('wohnzimmer', 'Wohnzimmer', ['z.0.l'])
            .raum('kueche', 'Küche', ['z.0.k']);
    const geraete = (p: Profil, q: Speicherquelle): unknown =>
        berechneRechte(p, q.katalog).inhalt.geraete.map(g => [g.id, g.teile]);
    const wohnzimmer = profil({ raeume: [{ enum: 'enum.rooms.wohnzimmer', recht: 'schreiben' }] });

    it('zeigt nur erlaubte Teile, ein Gerät ohne erlaubtes Teil fehlt, nach ID sortiert', () => {
        const q = haus()
            .geraet('wohnzimmer', lampe({ schalten: 'z.0.l.an', helligkeit: 'z.0.l.hell', farbe: 'z.0.l.farbe' }))
            .geraet('flur', lampe({ farbtemperatur: 'z.0.l.ct' }))
            .geraet('kueche', lampe({ schalten: 'z.0.k.an' }));
        expect(geraete(wohnzimmer, q)).to.deep.equal([
            ['flur', { farbtemperatur: 'z.0.l.ct' }],
            ['wohnzimmer', { schalten: 'z.0.l.an', helligkeit: 'z.0.l.hell', farbe: 'z.0.l.farbe' }],
        ]);
        const beide = profil({
            raeume: [{ enum: 'enum.rooms.kueche', recht: 'lesen' }],
            freigaben: [{ id: 'z.0.l.hell', recht: 'lesen' }],
            sperren: ['z.0.l.farbe'],
        });
        expect(geraete(beide, q)).to.deep.equal([
            ['kueche', { schalten: 'z.0.k.an' }],
            ['wohnzimmer', { helligkeit: 'z.0.l.hell' }],
        ]);
    });

    it('lässt Teile mit unpassendem Datenpunkt weg, die Lichtfarbe nur mit Bereich', () => {
        const q = haus().geraet(
            'x',
            lampe({
                schalten: 'z.0.l.hell',
                helligkeit: 'z.0.l.an',
                farbe: 'z.0.l.farbe',
                farbtemperatur: 'z.0.l.ct_ohne',
            }),
        );
        expect(geraete(wohnzimmer, q)).to.deep.equal([['x', { farbe: 'z.0.l.farbe' }]]);
        expect(passtZuTeil('farbtemperatur', 'number', 2700, 6500)).to.equal(true);
        expect(passtZuTeil('farbtemperatur', 'number', 500, 153)).to.equal(false);
        expect(passtZuTeil('schalten', 'mixed', undefined, undefined)).to.equal(false);
    });

    it('ein Datenpunkt gehört zu höchstens einem Gerät, die kleinere ID gewinnt, auch ohne Recht', () => {
        const q = haus()
            .geraet('b', lampe({ schalten: 'z.0.l.an', helligkeit: 'z.0.l.hell' }))
            .geraet('a', lampe({ schalten: 'z.0.l.an' }))
            .geraet('c', lampe({ schalten: 'z.0.k.an', helligkeit: 'z.0.l.hell' }));
        expect(geraete(wohnzimmer, q)).to.deep.equal([
            ['a', { schalten: 'z.0.l.an' }],
            ['b', { helligkeit: 'z.0.l.hell' }],
        ]);
    });

    it('prüft den Aufbau gespeicherter Geräte', () => {
        expect(alsGeraet(lampe({ schalten: 'z.0.l.an' }))).to.deep.equal(lampe({ schalten: 'z.0.l.an' }));
        for (const kaputt of [
            lampe({}),
            lampe({ schalten: 'z.0.l.an' }, ''),
            { ...lampe({ schalten: 'z.0.l.an' }), typ: 'heizung' },
            lampe({ schalten: 'z.0.l.an*' }),
            { name: 'x', typ: 'lampe' },
        ]) {
            expect(alsGeraet(kaputt), JSON.stringify(kaputt)).to.be.an('array').that.is.not.empty;
        }
    });

    it('Version 1 bekommt keine Geräte', () => {
        const q = haus().geraet('a', lampe({ schalten: 'z.0.l.an' }));
        const rechte = berechneRechte(wohnzimmer, q.katalog);
        expect(rechte.inhaltFuer(1)).to.not.have.property('geraete');
        expect(rechte.inhaltFuer(2).geraete).to.have.length(1);
    });
});
