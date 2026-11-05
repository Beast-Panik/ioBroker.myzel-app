import { expect } from 'chai';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { KARTENBEFEHLE } from '../admin/kartenseite';
import { PROFILBEFEHLE } from '../admin/profilseite';
import type { Protokoll } from '../basis/grenzen';
import { bezeichnungsfeld, karteAusZeile, lies, profilAusZeile } from './konfiguration';
import { KARTENARTEN } from './rechte';

// Wie der Admin eine neue Zeile anlegt: jedes Feld der Seite, ohne Wert null
const LEER = Object.fromEntries(
    [
        ...new Set(Object.values(KARTENARTEN).flatMap(a => Object.keys(a.teile))),
        'bezeichnung1',
        'bezeichnung2',
        'bezeichnung3',
        'bezeichnung4',
    ].map(f => [f, null]),
);

describe('Zeilen aus den Instanzeinstellungen bis 0.3.x', () => {
    let log: string[];
    const protokoll: Protokoll = {
        debug: () => undefined,
        info: () => undefined,
        warn: t => log.push(t),
        error: () => undefined,
    };

    beforeEach(() => (log = []));

    it('eine Zeile wird zur Karte: nur die Teile ihres Typs, leere fallen weg, Bezeichnungen nur beim Messwert', () => {
        expect(
            karteAusZeile({
                ...LEER,
                id: 'stehlampe',
                name: ' Stehlampe ',
                typ: 'lampe',
                raum: 'enum.rooms.wohnzimmer',
                schalten: 'zigbee.0.lampe.state',
                helligkeit: '',
                soll: 'heizung.0.soll',
                bezeichnung1: 'bleibt weg',
            }),
        ).to.deep.equal({
            name: 'Stehlampe',
            typ: 'lampe',
            raum: 'enum.rooms.wohnzimmer',
            teile: { schalten: 'zigbee.0.lampe.state' },
        });
        expect(
            karteAusZeile({
                ...LEER,
                name: 'Klima',
                typ: 'messwert',
                raum: '',
                wert1: 'a.temp',
                wert3: 'a.druck',
                bezeichnung3: 'Druck',
                bezeichnung2: 'ohne Wert',
            }),
        ).to.deep.equal({
            name: 'Klima',
            typ: 'messwert',
            raum: '',
            teile: { wert1: 'a.temp', wert3: 'a.druck' },
            bezeichnungen: { wert3: 'Druck' },
        });
    });

    it('unbrauchbare Karten: unbekannter Typ, ohne Teil, ohne Pflichtteil, Raum aus anderer Aufzählung, ohne Name', () => {
        const zeile = { ...LEER, name: 'X', typ: 'schalter', raum: '', schalten: 'a.b' };
        expect(karteAusZeile(zeile)).to.not.be.an('array');
        expect(karteAusZeile({ ...zeile, typ: 'rollladen' })).to.deep.equal(['Typ rollladen unbekannt']);
        expect(karteAusZeile({ ...zeile, schalten: null })).to.be.an('array');
        expect(karteAusZeile({ ...zeile, typ: 'thermostat', ist: 'a.ist' })).to.be.an('array');
        expect(karteAusZeile({ ...zeile, raum: 'enum.functions.licht' })).to.be.an('array');
        expect(karteAusZeile({ ...zeile, name: '  ' })).to.be.an('array');
        expect(karteAusZeile({ ...zeile, name: 'x'.repeat(201) })).to.be.an('array');
    });

    it('eine Zeile wird zum Profil; steht etwas in beiden Listen, gilt schreiben', () => {
        expect(
            profilAusZeile({
                id: 'familie',
                name: 'Familie',
                raeumeSchreiben: ['enum.rooms.kueche'],
                raeumeLesen: ['enum.rooms.bad', 'enum.rooms.kueche'],
                kartenSchreiben: null,
                kartenLesen: ['tuer', ''],
                gesperrt: ['garage'],
            }),
        ).to.deep.equal({
            name: 'Familie',
            raeume: [
                { enum: 'enum.rooms.kueche', recht: 'schreiben' },
                { enum: 'enum.rooms.bad', recht: 'lesen' },
            ],
            karten: [{ id: 'tuer', recht: 'lesen' }],
            gesperrt: ['garage'],
        });
        expect(profilAusZeile({ name: 'A', raeumeSchreiben: ['enum.functions.licht'] })).to.be.an('array');
        expect(profilAusZeile({ name: 'A', gesperrt: ['Gross'] })).to.be.an('array');
        expect(profilAusZeile({ name: '' })).to.be.an('array');
    });

    it('liest alle Zeilen; ungültige oder doppelte IDs und kaputte Zeilen fallen mit Warnung weg', () => {
        const karten = lies(
            [
                { id: 'tuer', name: 'Tür', typ: 'schalter', raum: '', schalten: 'a.b' },
                { id: 'tuer', name: 'Zweite Tür', typ: 'schalter', raum: '', schalten: 'a.c' },
                { id: 'Gross', name: 'Groß', typ: 'schalter', raum: '', schalten: 'a.b' },
                { id: 'leer', name: 'Leer', typ: 'schalter', raum: '' },
                'kaputt',
                null,
            ],
            'Karte',
            'wird nicht übernommen',
            karteAusZeile,
            protokoll,
        );
        expect([...karten.keys()]).to.deep.equal(['tuer']);
        expect(karten.get('tuer')?.name).to.equal('Tür');
        const profile = lies(
            [{ id: 'familie', name: 'Familie' }, { name: 'Ohne ID' }],
            'Profil',
            'wird nicht übernommen',
            profilAusZeile,
            protokoll,
        );
        expect([...profile.keys()]).to.deep.equal(['familie']);
        expect(log).to.have.length(4);
        // Mit der ganzen Zeile, die Umstellung leert die Liste danach
        expect(log[0]).to.equal(
            'Karte „Zweite Tür“ ist unbrauchbar und wird nicht übernommen: ID tuer doppelt. Zeile: ' +
                '{"id":"tuer","name":"Zweite Tür","typ":"schalter","raum":"","schalten":"a.c"}',
        );
        expect(log[3]).to.match(
            /^Profil „Ohne ID“ ist unbrauchbar und wird nicht übernommen: .*Zeile: \{"name":"Ohne ID"\}$/,
        );
        expect(lies(undefined, 'Profil', '', profilAusZeile, protokoll).size).to.equal(0);
        expect(bezeichnungsfeld('wert4')).to.equal('bezeichnung4');
    });
});

describe('Einstellungsseite', () => {
    const seite = JSON.parse(readFileSync(join(__dirname, '../../admin/jsonConfig.json'), 'utf8'));

    for (const [reiter, befehle] of [
        ['_reiterKarten', KARTENBEFEHLE],
        ['_reiterProfile', PROFILBEFEHLE],
    ] as const) {
        it(`${reiter} bettet seine Seite ein, nur bei laufender Instanz, sonst steht ein Hinweis da`, () => {
            const items = Object.values(seite.items[reiter].items as Record<string, Record<string, any>>);
            const eingebettet = items.filter(f => f.type === 'iframeSendTo');
            expect(eingebettet).to.have.length(1);
            expect(befehle).to.include(eingebettet[0].command);
            expect(items.filter(f => f.type === 'accordion')).to.deep.equal([]);
            const hinweis = items.find(f => f.type === 'staticText' && f.hidden)!;
            expect(new Function('_alive', `return ${hinweis.hidden}`)(true)).to.equal(true);
            expect(new Function('_alive', `return ${hinweis.hidden}`)(false)).to.equal(false);
        });
    }
});
