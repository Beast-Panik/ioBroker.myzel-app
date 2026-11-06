import { expect } from 'chai';
import { Speicherquelle } from '../../test/speicher';
import { adapterPruefer } from './dienst';
import {
    KARTENARTEN,
    KARTENTYPEN,
    type Etage,
    type Karte,
    type Karteneintrag,
    type Profil,
    alsEtage,
    alsKarte,
    alsProfil,
    bereich,
    berechneRechte,
    inhaltFuer,
    istPersoenlich,
    kartenmaengel,
    Rechtestand,
    rechteFuer,
} from './rechte';

const lampe = (teile: Record<string, string>, raum = 'enum.rooms.wohnzimmer'): Karte => ({
    name: 'Lampe',
    typ: 'lampe',
    raum,
    teile,
});

function welt(): Speicherquelle {
    return new Speicherquelle()
        .datenpunkt('z.0.l.an', { type: 'boolean' })
        .datenpunkt('z.0.l.hell', { type: 'number', unit: '%' })
        .datenpunkt('z.0.l.farbe', { type: 'string' })
        .datenpunkt('z.0.l.ct', { type: 'number', min: 153, max: 500, unit: 'mired' })
        .datenpunkt('z.0.l.ct_ohne', { type: 'number' })
        .datenpunkt('z.0.l.info', { type: 'boolean', write: false })
        .datenpunkt('z.0.l.kaputt*', { type: 'boolean' })
        .datenpunkt('z.0.s.temp', { type: 'number', unit: '°C', name: { de: 'Temperatur', en: 'Temperature' } })
        .datenpunkt('z.0.s.fenster', { type: 'boolean', states: { true: 'offen', false: 'zu' } })
        .datenpunkt('h.0.soll', { type: 'number', unit: '°C' })
        .datenpunkt('system.adapter.admin.0.alive', { type: 'boolean' })
        .raum('wohnzimmer', 'Wohnzimmer', [])
        .raum('flur', { de: 'Flur', en: 'Hall' }, [])
        .karte('wohnzimmer', lampe({ schalten: 'z.0.l.an', helligkeit: 'z.0.l.hell' }))
        .karte('flur', lampe({ schalten: 'z.0.l.an' }, 'enum.rooms.flur'))
        .karte('ohne', lampe({ farbe: 'z.0.l.farbe' }, ''));
}

const profil = (teil: Partial<Profil>): Profil => ({ name: 'Test', raeume: [], karten: [], gesperrt: [], ...teil });
const karten = (p: Profil, q = welt()): Karteneintrag[] => berechneRechte(p, q.katalog).inhalt.karten;
const ids = (p: Profil, q = welt()): string[] => karten(p, q).map(k => k.id);
const rechteJeTeil = (k: Karteneintrag | undefined): Record<string, string> =>
    Object.fromEntries(Object.entries(k?.teile ?? {}).map(([t, d]) => [t, d.recht]));
const wohnzimmer = (recht: 'lesen' | 'schreiben' = 'schreiben'): Profil['raeume'] => [
    { enum: 'enum.rooms.wohnzimmer', recht },
];

describe('Rechte aus Profilen', () => {
    it('Räume geben ihre Karten mit dem Recht des Raums frei, Karten ohne Raum nicht', () => {
        const [k] = karten(profil({ raeume: wohnzimmer('lesen') }));
        expect(k).to.deep.equal({
            id: 'wohnzimmer',
            name: 'Lampe',
            typ: 'lampe',
            raum: 'enum.rooms.wohnzimmer',
            teile: {
                schalten: { id: 'z.0.l.an', typ: 'boolean', recht: 'lesen' },
                helligkeit: {
                    id: 'z.0.l.hell',
                    typ: 'number',
                    einheit: '%',
                    min: 0,
                    max: 100,
                    schritt: 1,
                    recht: 'lesen',
                },
            },
        });
        expect(ids(profil({ raeume: wohnzimmer() }))).to.deep.equal(['wohnzimmer']);
    });

    it('steht ein Raum mehrfach im Profil, gilt das höhere Recht', () => {
        const raeume = [...wohnzimmer('schreiben'), ...wohnzimmer('lesen')];
        expect(rechteJeTeil(karten(profil({ raeume }))[0])).to.deep.equal({
            schalten: 'schreiben',
            helligkeit: 'schreiben',
        });
        expect(rechteJeTeil(karten(profil({ raeume: [...raeume].reverse() }))[0]).schalten).to.equal('schreiben');
    });

    it('Einzelfreigaben setzen ihr Recht, auch ohne Raum und niedriger als der Raum', () => {
        const p = profil({
            raeume: wohnzimmer('schreiben'),
            karten: [
                { id: 'wohnzimmer', recht: 'lesen' },
                { id: 'ohne', recht: 'schreiben' },
                { id: 'gibtsnicht', recht: 'lesen' },
            ],
        });
        const liste = karten(p);
        expect(liste.map(k => k.id)).to.deep.equal(['ohne', 'wohnzimmer']);
        expect(rechteJeTeil(liste[1])).to.deep.equal({ schalten: 'lesen', helligkeit: 'lesen' });
        expect(liste[0]).to.not.have.property('raum');
    });

    it('gesperrte Karten fehlen, auch mit Raum oder Einzelfreigabe', () => {
        const p = profil({
            raeume: wohnzimmer(),
            karten: [{ id: 'flur', recht: 'lesen' }],
            gesperrt: ['wohnzimmer', 'flur'],
        });
        expect(ids(p)).to.deep.equal([]);
    });

    it('bedienbar nur mit Recht schreiben, bedienbarem Teil und beschreibbarem Datenpunkt', () => {
        const q = welt()
            .karte('info', lampe({ schalten: 'z.0.l.info', helligkeit: 'z.0.l.hell' }))
            .karte('heizung', {
                name: 'Heizung',
                typ: 'thermostat',
                raum: 'enum.rooms.wohnzimmer',
                teile: { soll: 'h.0.soll', ist: 'z.0.s.temp' },
            });
        const liste = karten(profil({ raeume: wohnzimmer() }), q);
        expect(rechteJeTeil(liste.find(k => k.id === 'info'))).to.deep.equal({
            schalten: 'lesen',
            helligkeit: 'schreiben',
        });
        expect(rechteJeTeil(liste.find(k => k.id === 'heizung'))).to.deep.equal({ soll: 'schreiben', ist: 'lesen' });
    });

    it('Teile ohne passenden Datenpunkt fallen weg, ohne Pflichtteil oder ohne Teil fehlt die Karte', () => {
        const q = welt()
            .karte(
                'a',
                lampe({
                    schalten: 'z.0.l.hell',
                    helligkeit: 'z.0.l.an',
                    farbe: 'z.0.l.farbe',
                    farbtemperatur: 'z.0.l.ct_ohne',
                }),
            )
            .karte('b', lampe({ schalten: 'gibt.es.nicht' }))
            .karte('c', {
                name: 'S',
                typ: 'schalter',
                raum: 'enum.rooms.wohnzimmer',
                teile: { schalten: 'z.0.l.hell' },
            })
            .karte('d', {
                name: 'T',
                typ: 'thermostat',
                raum: 'enum.rooms.wohnzimmer',
                teile: { soll: 'z.0.l.an', ist: 'z.0.s.temp' },
            });
        const liste = karten(profil({ raeume: wohnzimmer() }), q);
        expect(liste.map(k => k.id)).to.deep.equal(['a', 'wohnzimmer']);
        expect(Object.keys(liste[0].teile)).to.deep.equal(['farbe']);
    });

    it('system.* und IDs mit verbotenen Zeichen fallen weg, auch als Ziel eines Alias', () => {
        const q = welt()
            .datenpunkt('alias.0.admin', { type: 'boolean', alias: { id: 'system.adapter.admin.0.alive' } })
            .datenpunkt('alias.0.geteilt', {
                type: 'boolean',
                alias: { id: { read: 'z.0.l.an', write: 'system.host.a.b' } },
            })
            .datenpunkt('alias.0.lampe', { type: 'boolean', alias: { id: 'z.0.l.an' } })
            .karte('a', lampe({ schalten: 'system.adapter.admin.0.alive' }))
            .karte('b', lampe({ schalten: 'z.0.l.kaputt*' }))
            .karte('c', lampe({ schalten: 'alias.0.admin' }))
            .karte('d', lampe({ schalten: 'alias.0.geteilt' }))
            .karte('e', lampe({ schalten: 'alias.0.lampe' }));
        expect(ids(profil({ raeume: wohnzimmer() }), q)).to.deep.equal(['e', 'wohnzimmer']);
    });

    it('Karten mit Daten der Apps nur über Einzelfreigaben, nie über einen Raum, auch nicht über einen Alias', () => {
        const q = welt()
            .datenpunkt('myzel-app.0.apps.abcdefgh.anruf.nummer', { type: 'string' })
            .datenpunkt('myzel-app.0.apps.abcdefgh.akku.stand', { type: 'number' })
            .datenpunkt('alias.0.nummer', { type: 'string', alias: { id: 'myzel-app.0.apps.abcdefgh.anruf.nummer' } })
            .karte('akku', {
                name: 'Akku',
                typ: 'messwert',
                raum: 'enum.rooms.wohnzimmer',
                teile: { wert1: 'myzel-app.0.apps.abcdefgh.akku.stand' },
            })
            .karte('nummer', {
                name: 'Nummer',
                typ: 'messwert',
                raum: 'enum.rooms.wohnzimmer',
                teile: { wert1: 'z.0.s.temp', wert2: 'alias.0.nummer' },
            });
        expect(ids(profil({ raeume: wohnzimmer() }), q)).to.deep.equal(['wohnzimmer']);
        const einzeln = [
            { id: 'akku', recht: 'lesen' as const },
            { id: 'nummer', recht: 'lesen' as const },
        ];
        expect(ids(profil({ raeume: wohnzimmer(), karten: einzeln }), q)).to.deep.equal([
            'akku',
            'nummer',
            'wohnzimmer',
        ]);
    });

    it('Messwerte tragen ihre Bezeichnung, sonst den Namen des Datenpunkts in der Systemsprache, und die Auswahl', () => {
        const q = new Speicherquelle();
        q.objekt_('system.config', { type: 'config', common: { language: 'de' } });
        q.datenpunkt('z.0.s.temp', { type: 'number', unit: '°C', name: { de: 'Temperatur', en: 'Temperature' } })
            .datenpunkt('z.0.s.fenster', { type: 'boolean', states: { true: 'offen', false: 'zu' } })
            .datenpunkt('z.0.s.feuchte', { type: 'number', unit: '%', min: 0, max: 100 })
            .karte('fuehler', {
                name: 'Fühler',
                typ: 'messwert',
                raum: '',
                teile: { wert1: 'z.0.s.temp', wert2: 'z.0.s.fenster', wert3: 'z.0.s.feuchte' },
                bezeichnungen: { wert3: 'Feuchte' },
            });
        const [k] = karten(profil({ karten: [{ id: 'fuehler', recht: 'schreiben' }] }), q);
        expect(k.teile).to.deep.equal({
            wert1: { id: 'z.0.s.temp', typ: 'number', einheit: '°C', recht: 'lesen', name: 'Temperatur' },
            wert2: {
                id: 'z.0.s.fenster',
                typ: 'boolean',
                auswahl: { true: 'offen', false: 'zu' },
                recht: 'lesen',
                name: 'z.0.s.fenster',
            },
            wert3: { id: 'z.0.s.feuchte', typ: 'number', einheit: '%', recht: 'lesen', name: 'Feuchte' },
        });
    });

    it('Räume nur mit sichtbaren Karten, Namen in der Systemsprache; ein unbekannter Raum zählt als keiner', () => {
        const q = welt().karte('weg', lampe({ schalten: 'z.0.l.an' }, 'enum.rooms.gibtsnicht'));
        const p = profil({
            raeume: [
                { enum: 'enum.rooms.flur', recht: 'lesen' },
                { enum: 'enum.rooms.gibtsnicht', recht: 'lesen' },
            ],
            karten: [{ id: 'weg', recht: 'lesen' }],
        });
        const { inhalt } = berechneRechte(p, q.katalog);
        expect(inhalt.raeume).to.deep.equal([{ id: 'enum.rooms.flur', name: 'Hall' }]);
        expect(inhalt.karten.find(k => k.id === 'weg')).to.not.have.property('raum');
    });

    describe('Etagen', () => {
        const etage = (name: string, kurz: string, position: number, raeume: string[]): Etage => ({
            name,
            kurz,
            position,
            raeume,
        });
        const haus = (): ReturnType<typeof welt> =>
            welt()
                .raum('kueche', 'Küche', [])
                .raum('bad', 'Bad', [])
                .karte('kueche', lampe({ schalten: 'z.0.l.an' }, 'enum.rooms.kueche'))
                .karte('bad', lampe({ schalten: 'z.0.l.an' }, 'enum.rooms.bad'));
        const alle = profil({
            raeume: ['wohnzimmer', 'flur', 'kueche', 'bad'].map(r => ({
                enum: `enum.rooms.${r}`,
                recht: 'lesen' as const,
            })),
        });

        it('Räume nach Etagen und deren Folge, ein Raum in zwei Etagen bei der oberen, die übrigen nach Namen', () => {
            const q = haus()
                .etage('og', etage('Obergeschoss', 'OG', 0, ['enum.rooms.bad', 'enum.rooms.kueche']))
                .etage('eg', etage('Erdgeschoss', 'EG', 1, ['enum.rooms.kueche', 'enum.rooms.flur', 'enum.rooms.weg']));
            const { inhalt } = berechneRechte(alle, q.katalog);
            expect(inhalt.raeume).to.deep.equal([
                { id: 'enum.rooms.bad', name: 'Bad', etage: 'og' },
                { id: 'enum.rooms.kueche', name: 'Küche', etage: 'og' },
                { id: 'enum.rooms.flur', name: 'Hall', etage: 'eg' },
                { id: 'enum.rooms.wohnzimmer', name: 'Wohnzimmer' },
            ]);
            expect(inhalt.etagen).to.deep.equal([
                { id: 'og', name: 'Obergeschoss', kurz: 'OG' },
                { id: 'eg', name: 'Erdgeschoss', kurz: 'EG' },
            ]);
        });

        it('nur Etagen mit sichtbaren Räumen; ohne Etagen alle Räume nach Namen', () => {
            const ohne = berechneRechte(alle, haus().katalog).inhalt;
            expect(ohne.raeume.map(r => r.name)).to.deep.equal(['Bad', 'Hall', 'Küche', 'Wohnzimmer']);
            expect(ohne.etagen).to.deep.equal([]);
            const q = haus()
                .etage('eg', etage('Erdgeschoss', 'EG', 0, ['enum.rooms.flur']))
                .etage('keller', etage('Keller', 'KG', 1, ['enum.rooms.gibtsnicht']));
            expect(berechneRechte(profil({ raeume: wohnzimmer() }), q.katalog).inhalt.etagen).to.deep.equal([]);
            expect(berechneRechte(alle, q.katalog).inhalt.etagen?.map(e => e.id)).to.deep.equal(['eg']);
        });

        it('Apps vor Protokoll 5 bekommen weder Etagen noch Etage am Raum', () => {
            const q = haus().etage('eg', etage('Erdgeschoss', 'EG', 0, ['enum.rooms.flur']));
            const { inhalt } = berechneRechte(alle, q.katalog);
            for (const v of [3, 4]) {
                const alt = inhaltFuer(inhalt, v);
                expect(alt).to.not.have.property('etagen');
                expect(alt.raeume.every(r => !('etage' in r))).to.equal(true);
                expect(alt.karten).to.equal(inhalt.karten);
            }
            expect(inhaltFuer(inhalt, 5)).to.equal(inhalt);
        });

        it('unbrauchbare Etagen fehlen', () => {
            for (const falsch of [
                {},
                etage('', 'EG', 0, []),
                etage('  ', 'EG', 0, []),
                etage('Erdgeschoss', 'ERDGESCHO', 0, []),
                etage('Erdgeschoss', 'EG', -1, []),
                etage('Erdgeschoss', 'EG', 0.5, []),
                etage('Erdgeschoss', 'EG', 0, ['enum.functions.licht']),
                etage('Erdgeschoss', 'EG', 0, ['enum.rooms.a', 'enum.rooms.a']),
            ]) {
                expect(Array.isArray(alsEtage(falsch)), JSON.stringify(falsch)).to.equal(true);
            }
            expect(alsEtage(etage('Erdgeschoss', 'EG', 0, ['enum.rooms.a']))).to.not.be.an('array');
            const q = haus().etage('kaputt', {
                name: '',
                kurz: 'X',
                position: 0,
                raeume: ['enum.rooms.flur'],
            });
            expect(berechneRechte(alle, q.katalog).inhalt.etagen).to.deep.equal([]);
        });
    });

    it('ohne Profil oder mit ungültiger Profil-ID gibt es keine Rechte', () => {
        const q = welt().profil('familie', profil({ raeume: wohnzimmer() }));
        expect(rechteFuer('familie', q.katalog).inhalt.karten).to.have.length(1);
        for (const id of ['', 'gibtsnicht', '../familie', 'Familie']) {
            expect(rechteFuer(id, q.katalog).inhalt, id).to.deep.equal({
                profil: '',
                raeume: [],
                etagen: [],
                karten: [],
            });
        }
    });

    it('steht ein Datenpunkt in mehreren Karten, gilt beim Setzen das höchste Recht', () => {
        const q = welt().karte('anzeige', { name: 'A', typ: 'messwert', raum: '', teile: { wert1: 'z.0.l.an' } });
        const rechte = berechneRechte(
            profil({ raeume: wohnzimmer(), karten: [{ id: 'anzeige', recht: 'schreiben' }] }),
            q.katalog,
        );
        expect(rechte.recht('z.0.l.an')).to.equal('schreiben');
        expect(rechte.recht('z.0.l.farbe')).to.equal(undefined);
        const nurAnzeige = berechneRechte(profil({ karten: [{ id: 'anzeige', recht: 'schreiben' }] }), q.katalog);
        expect(nurAnzeige.recht('z.0.l.an')).to.equal('lesen');
    });

    it('hält die Grenzen des Schemas ein', () => {
        const q = new Speicherquelle()
            .datenpunkt('a.b', {
                type: 'number',
                name: 'n'.repeat(500),
                unit: 'u'.repeat(50),
                states: Object.fromEntries(Array.from({ length: 300 }, (_, i) => [i, 't'.repeat(300)])),
            })
            .karte('k', { name: 'k'.repeat(200), typ: 'messwert', raum: '', teile: { wert1: 'a.b' } });
        const t = karten(profil({ karten: [{ id: 'k', recht: 'lesen' }] }), q)[0].teile.wert1;
        expect(t.name).to.have.length(200);
        expect(t.einheit).to.have.length(30);
        expect(Object.keys(t.auswahl!)).to.have.length(200);
        expect(Object.values(t.auswahl!)[0]).to.have.length(200);
    });

    it('liest Auswahlwerte als Objekt, Liste und Text', () => {
        const mit = (states: unknown): Record<string, string> | undefined => {
            const q = new Speicherquelle()
                .datenpunkt('a.b', { type: 'number', states } as Partial<ioBroker.StateCommon>)
                .karte('k', { name: 'k', typ: 'messwert', raum: '', teile: { wert1: 'a.b' } });
            return karten(profil({ karten: [{ id: 'k', recht: 'lesen' }] }), q)[0].teile.wert1.auswahl;
        };
        expect(mit({ 0: 'aus', 1: 'an' })).to.deep.equal({ 0: 'aus', 1: 'an' });
        expect(mit(['aus', 'an'])).to.deep.equal({ 0: 'aus', 1: 'an' });
        expect(mit('0:aus;1:an:voll')).to.deep.equal({ 0: 'aus', 1: 'an:voll' });
        expect(mit({})).to.equal(undefined);
    });
});

describe('Bereich und Schritt für Regler', () => {
    const { helligkeit, farbtemperatur } = KARTENARTEN.lampe.teile;
    const { soll } = KARTENARTEN.thermostat.teile;

    it('nimmt den Bereich des Datenpunkts, sonst die Vorgabe des Teils', () => {
        expect(bereich(helligkeit, {})).to.deep.equal({ min: 0, max: 100, schritt: 1 });
        expect(bereich(helligkeit, { min: 1, max: 254 })).to.deep.equal({ min: 1, max: 254, schritt: 1 });
        expect(bereich(soll, {})).to.deep.equal({ min: 5, max: 30, schritt: 0.5 });
        expect(bereich(soll, { min: 10, max: 25, step: 1 })).to.deep.equal({ min: 10, max: 25, schritt: 1 });
        expect(bereich(KARTENARTEN.lampe.teile.schalten, {})).to.equal(undefined);
    });

    it('ganze Schritte ab einem Bereich von 10, darunter stufenlos; ein Schritt bis 0 zählt nicht', () => {
        expect(bereich(farbtemperatur, { min: 2700, max: 6500 })).to.deep.equal({ min: 2700, max: 6500, schritt: 1 });
        expect(bereich(helligkeit, { min: 0, max: 1 })).to.deep.equal({ min: 0, max: 1 });
        expect(bereich(helligkeit, { min: 0, max: 100, step: 0 })).to.deep.equal({ min: 0, max: 100, schritt: 1 });
        expect(bereich(helligkeit, { min: 0, max: 100, step: 5 })).to.deep.equal({ min: 0, max: 100, schritt: 5 });
    });

    it('ohne Bereich bei der Lichtfarbe, mit unsinnigem Bereich überall: kein Regler', () => {
        expect(bereich(farbtemperatur, {})).to.equal(undefined);
        expect(bereich(farbtemperatur, { max: 500 })).to.equal(undefined);
        expect(bereich(helligkeit, { min: 100, max: 0 })).to.equal(undefined);
        expect(bereich(soll, { min: 20, max: 20 })).to.equal(undefined);
        expect(bereich(helligkeit, { min: Number.NaN })).to.deep.equal({ min: 0, max: 100, schritt: 1 });
    });
});

describe('Was die App setzen darf', () => {
    const stand = new Rechtestand({
        profil: 'p',
        raeume: [],
        karten: [
            {
                id: 'k1',
                name: 'Heizung',
                typ: 'thermostat',
                teile: { soll: { id: 'h.0.soll', typ: 'number', min: 5, max: 30, recht: 'schreiben' } },
            },
            {
                id: 'k2',
                name: 'Lampe',
                typ: 'lampe',
                teile: {
                    helligkeit: { id: 'l.0.hell', typ: 'number', min: 0, max: 100, recht: 'schreiben' },
                    farbe: { id: 'l.0.farbe', typ: 'string', recht: 'schreiben' },
                },
            },
            // Derselbe Datenpunkt in einer zweiten Karte mit eigenem Bereich: einer reicht
            {
                id: 'k3',
                name: 'Heizung gesperrt',
                typ: 'thermostat',
                teile: { soll: { id: 'h.0.soll', typ: 'number', min: 40, max: 50, recht: 'lesen' } },
            },
        ],
    });

    it('nur im Bereich der Karte, Farbe nur als #RRGGBB, ohne bedienbare Karte nichts', () => {
        expect(stand.passt('h.0.soll', 21.5)).to.equal(true);
        expect(stand.passt('h.0.soll', 95)).to.equal(false);
        expect(stand.passt('h.0.soll', 45)).to.equal(false);
        expect(stand.passt('l.0.hell', -1e9)).to.equal(false);
        expect(stand.passt('l.0.farbe', '#ff8800')).to.equal(true);
        expect(stand.passt('l.0.farbe', 'x'.repeat(60_000))).to.equal(false);
        expect(stand.passt('a.0.anderes', true)).to.equal(false);
    });
});

describe('Persönliche Daten', () => {
    const quelle = { eigeneApps: 'myzel-app.0.apps', datenpunkt: () => undefined };
    const karte = (id: string): Karte => ({ name: 'x', typ: 'messwert', raum: '', teile: { wert1: id } });

    it('Handydaten jeder Instanz sind persönlich, anderes nicht', () => {
        expect(istPersoenlich(karte('myzel-app.0.apps.abcdefgh.akku.stand'), quelle)).to.equal(true);
        expect(istPersoenlich(karte('myzel-app.1.apps.abcdefgh.anruf.nummer'), quelle)).to.equal(true);
        expect(istPersoenlich(karte('myzel-app.1.info.connection'), quelle)).to.equal(false);
        expect(istPersoenlich(karte('hue.0.apps.licht'), quelle)).to.equal(false);
    });
});

describe('Mängel der Karten für das Log', () => {
    it('nennt je Karte die Teile, die nicht passen, und ob die ganze Karte fehlt', () => {
        const q = welt()
            .karte('teils', lampe({ schalten: 'z.0.l.an', farbtemperatur: 'z.0.l.ct_ohne' }))
            .karte('kaputt', { name: 'Kaputt', typ: 'schalter', raum: '', teile: { schalten: 'z.0.l.hell' } })
            .karte('weg', { name: 'Weg', typ: 'thermostat', raum: '', teile: { soll: 'h.0.weg', ist: 'z.0.s.temp' } })
            .karte('sys', { name: 'Sys', typ: 'messwert', raum: '', teile: { wert1: 'system.adapter.admin.0.alive' } });
        expect(kartenmaengel(q.katalog)).to.deep.equal([
            'Karte „Kaputt“ (kaputt) fehlt auf den Handys: schalten z.0.l.hell: Typ number statt boolean',
            'Karte „Sys“ (sys) fehlt auf den Handys: wert1 system.adapter.admin.0.alive: unter system, nie freigegeben',
            'Karte „Lampe“ (teils) zeigt nicht alle Teile: farbtemperatur z.0.l.ct_ohne: min und max fehlen oder passen nicht',
            'Karte „Weg“ (weg) fehlt auf den Handys: soll h.0.weg: Datenpunkt fehlt',
        ]);
        expect(kartenmaengel(welt().katalog)).to.deep.equal([]);
    });
});

describe('Gespeicherte Profile und Karten', () => {
    it('prüft Profilobjekte', () => {
        expect(alsProfil(profil({}))).to.deep.equal(profil({}));
        for (const kaputt of [
            profil({ raeume: [{ enum: 'enum.functions.licht', recht: 'lesen' }] }),
            profil({ karten: [{ id: 'Lampe', recht: 'lesen' }] }),
            profil({ karten: [{ id: 'lampe', recht: 'alles' as 'lesen' }] }),
            profil({ gesperrt: ['zigbee.0.lampe'] }),
            { name: 'alt', raeume: [], freigaben: [], sperren: [] },
            null,
        ]) {
            expect(alsProfil(kaputt), JSON.stringify(kaputt)).to.be.an('array').that.is.not.empty;
        }
    });

    it('prüft Kartenobjekte je Typ', () => {
        const gut: Karte[] = [
            lampe({ schalten: 'z.0.l.an' }),
            lampe({ farbe: 'z.0.l.farbe' }, ''),
            { name: 'S', typ: 'schalter', raum: '', teile: { schalten: 'a.b' } },
            { name: 'M', typ: 'messwert', raum: '', teile: { wert2: 'a.b' }, bezeichnungen: { wert2: 'Feuchte' } },
            { name: 'T', typ: 'thermostat', raum: '', teile: { soll: 'a.b' } },
        ];
        gut.forEach(k => expect(alsKarte(k), k.typ).to.deep.equal(k));
        for (const kaputt of [
            lampe({}),
            { ...lampe({ schalten: 'a.b' }), name: '' },
            { ...lampe({ schalten: 'a.b' }), typ: 'rollladen' },
            lampe({ schalten: 'a.b*' }),
            lampe({ soll: 'a.b' }),
            lampe({ schalten: 'a.b' }, 'enum.functions.licht'),
            { ...lampe({ schalten: 'a.b' }), bezeichnungen: { schalten: 'An' } },
            { name: 'S', typ: 'schalter', raum: '', teile: {} },
            { name: 'T', typ: 'thermostat', raum: '', teile: { ist: 'a.b' } },
            { name: 'M', typ: 'messwert', raum: '', teile: { wert1: 'a.b' }, bezeichnungen: { wert1: 'x'.repeat(61) } },
            { name: 'M', typ: 'messwert', raum: '', teile: { wert1: 'a.b' }, bezeichnungen: { wert5: 'x' } },
            { name: 'x', typ: 'lampe', teile: { schalten: 'a.b' } },
        ]) {
            expect(alsKarte(kaputt), JSON.stringify(kaputt)).to.be.an('array').that.is.not.empty;
        }
    });
});

describe('Karten und Schema', () => {
    // Je Typ eine Karte mit allen Teilen, wie der Adapter sie baut; das Schema der App muss sie annehmen.
    it('jede Kartenart aus KARTENARTEN erfüllt das Schema, mit und ohne Recht schreiben', () => {
        const q = new Speicherquelle()
            .datenpunkt('d.zahl', { type: 'number', min: 100, max: 500 })
            .datenpunkt('d.text', { type: 'string', name: 'Text' })
            .datenpunkt('d.an', { type: 'boolean' });
        const fuer = { boolean: 'd.an', number: 'd.zahl', string: 'd.text' } as const;
        for (const typ of KARTENTYPEN) {
            const teile = Object.fromEntries(
                Object.entries(KARTENARTEN[typ].teile).map(([t, a]) => [t, fuer[a.typen[0]]]),
            );
            q.karte(typ, { name: typ, typ, raum: '', teile });
        }
        for (const recht of ['lesen', 'schreiben'] as const) {
            const { inhalt } = berechneRechte(profil({ karten: KARTENTYPEN.map(id => ({ id, recht })) }), q.katalog);
            expect(inhalt.karten.map(k => [k.id, Object.keys(k.teile).length])).to.deep.equal(
                [...KARTENTYPEN].sort().map(t => [t, Object.keys(KARTENARTEN[t].teile).length]),
            );
            const nachricht = {
                t: 'rechte',
                ...inhalt,
                handydaten: { akku: false, anruf: false, benachrichtigung: false },
            };
            expect(adapterPruefer().pruefe(nachricht), recht).to.deep.equal([]);
        }
    });
});
