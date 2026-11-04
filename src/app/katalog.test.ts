import { expect } from 'chai';
import type { Protokoll } from '../basis/grenzen';
import { Katalog, type Katalogquelle, type Objektaenderung } from './katalog';

const NAMESPACE = 'myzel-app.0';

const objekt = (id: string, type: string, common: Record<string, unknown> = {}, native = {}): ioBroker.Object =>
    ({ _id: id, type, common, native }) as unknown as ioBroker.Object;
const zustand = (id: string, common: Record<string, unknown> = {}): ioBroker.Object =>
    objekt(id, 'state', { name: id, type: 'number', role: 'value', read: true, write: true, ...common });
const profil = { name: 'Familie', raeume: [], freigaben: [], sperren: [] };
const lampe = { name: 'Lampe', typ: 'lampe', teile: { schalten: 'a.b.c' } };

const quelleAus = (objekte: ioBroker.Object[], abfragen: string[] = []): Katalogquelle => ({
    objekte(typ, praefix) {
        abfragen.push(`${typ} ${praefix}`);
        return Promise.resolve(objekte.filter(o => o.type === typ && o._id.startsWith(praefix)));
    },
});

function umgebung(quelle: Katalogquelle = quelleAus([])): {
    katalog: Katalog;
    warnungen: string[];
    meldungen: () => number;
} {
    const warnungen: string[] = [];
    const log: Protokoll = {
        debug: () => undefined,
        info: () => undefined,
        warn: t => warnungen.push(t),
        error: () => undefined,
    };
    const katalog = new Katalog(NAMESPACE, log, quelle);
    let n = 0;
    katalog.beiAenderung(() => n++);
    return { katalog, warnungen, meldungen: () => n };
}

describe('Katalog', () => {
    it('lädt Datenpunkte, Räume, Funktionen, Profile, Geräte und Systemsprache mit fünf Abfragen', async () => {
        const abfragen: string[] = [];
        const { katalog, warnungen } = umgebung(
            quelleAus(
                [
                    zustand('a.b'),
                    zustand('a.b.c'),
                    zustand('a.b-c.d'),
                    objekt('a.b.kanal', 'channel'),
                    objekt('enum.rooms.kueche', 'enum', { name: 'Küche', members: ['a.b', 7] }),
                    objekt('enum.rooms.bad', 'enum', { name: 'Bad', members: [] }),
                    objekt('enum.functions.licht', 'enum', { name: 'Licht', members: ['a.b.c'] }),
                    objekt('enum.members.x', 'enum', { name: 'x', members: ['a.b'] }),
                    objekt(`${NAMESPACE}.profile.familie`, 'config', {}, profil),
                    objekt(`${NAMESPACE}.profile.kaputt`, 'config', {}, { name: 'x' }),
                    objekt(`${NAMESPACE}.geraete.lampe`, 'config', {}, lampe),
                    objekt(`${NAMESPACE}.geraete.leer`, 'config', {}, { ...lampe, teile: {} }),
                    objekt(`${NAMESPACE}.geraete.Gross`, 'config', {}, lampe),
                    objekt('system.config', 'config', { language: 'fr' }),
                ],
                abfragen,
            ),
        );
        await katalog.lade();
        expect(abfragen).to.deep.equal([
            'config system.config',
            'state ',
            'enum enum.',
            `config ${NAMESPACE}.profile.`,
            `config ${NAMESPACE}.geraete.`,
        ]);
        expect(katalog.anzahl).to.equal(3);
        expect([...katalog.zustaende('a.b').keys()]).to.deep.equal(['a.b', 'a.b.c']);
        expect([...katalog.zustaende('a').keys()]).to.deep.equal(['a.b', 'a.b-c.d', 'a.b.c']);
        expect(katalog.aufzaehlungen('rooms')).to.deep.equal([
            { id: 'enum.rooms.bad', name: 'Bad', mitglieder: [] },
            { id: 'enum.rooms.kueche', name: 'Küche', mitglieder: ['a.b'] },
        ]);
        expect(katalog.aufzaehlungen('functions').map(f => f.id)).to.deep.equal(['enum.functions.licht']);
        expect(katalog.profil('familie')).to.deep.equal(profil);
        expect(katalog.profil('kaputt')).to.equal(undefined);
        expect(warnungen.join('\n')).to.contain('Profil kaputt ist unbrauchbar');
        expect(katalog.geraete()).to.deep.equal([['lampe', lampe]]);
        expect(warnungen.join('\n')).to.contain('Gerät leer ist unbrauchbar');
        expect(warnungen.join('\n')).to.contain('Gerät Gross ist unbrauchbar');
        expect(katalog.sprache).to.equal('fr');
    });

    it('verliert keine Änderung, die während des Ladens kommt', async () => {
        const liefern: (() => void)[] = [];
        const { katalog, meldungen } = umgebung({
            objekte: (typ, praefix) =>
                new Promise(r => {
                    const stand = [zustand('alt.weg'), zustand('alt.bleibt')];
                    liefern.push(() => r(typ === 'state' && praefix === '' ? stand : []));
                }),
        });
        const geladen = katalog.lade();
        while (liefern.length < 5) {
            await new Promise(r => setImmediate(r));
        }
        katalog.geaendert('alt.weg', null);
        katalog.geaendert('neu.da', zustand('neu.da'));
        liefern.forEach(l => l());
        await geladen;
        expect([...katalog.zustaende('alt').keys(), ...katalog.zustaende('neu').keys()]).to.deep.equal([
            'alt.bleibt',
            'neu.da',
        ]);
        expect(meldungen()).to.equal(0);
        katalog.geaendert('neu.da', null);
        expect(meldungen(), 'nach dem Laden wirkt jede Änderung sofort').to.equal(1);
    });

    it('hält Namen nur in der Systemsprache und lädt bei einer neuen neu, gemeldet erst danach', async () => {
        const objekte = [
            objekt('system.config', 'config', { language: 'de' }),
            zustand('a.lampe', { name: { de: 'Lampe', en: 'Lamp', fr: 'Lampe FR' } }),
            zustand('a.ohne'),
        ];
        const abfragen: string[] = [];
        const { katalog, meldungen } = umgebung(quelleAus(objekte, abfragen));
        await katalog.lade();
        expect(katalog.zustaende('a.lampe').get('a.lampe')?.name).to.equal('Lampe');
        objekte[0] = objekt('system.config', 'config', { language: 'en' });
        katalog.geaendert('system.config', objekte[0]);
        expect(meldungen(), 'noch nicht, sonst rechte mit gemischten Sprachen').to.equal(0);
        await katalog.lade();
        expect(meldungen()).to.equal(1);
        expect(abfragen.filter(a => a.startsWith('state'))).to.have.length(3);
        expect(katalog.zustaende('a').get('a.lampe')?.name).to.equal('Lamp');
        expect(katalog.zustaende('a').get('a.ohne')?.name).to.equal('a.ohne');
    });

    it('lädt beim Start nicht doppelt, wenn system.config die Sprache setzt', async () => {
        const abfragen: string[] = [];
        const { katalog } = umgebung(
            quelleAus([objekt('system.config', 'config', { language: 'de' }), zustand('a.b')], abfragen),
        );
        await katalog.lade();
        await katalog.lade();
        expect(abfragen.filter(a => a.startsWith('state'))).to.have.length(2);
    });

    const faelle: [string, string, Objektaenderung, boolean][] = [
        ['neuer Datenpunkt', 'x.0.neu', zustand('x.0.neu'), true],
        ['geänderter Datenpunkt', 'x.0.da', zustand('x.0.da', { write: false }), true],
        ['gelöschter Datenpunkt', 'x.0.da', null, true],
        ['Datenpunkt wird Kanal', 'x.0.da', objekt('x.0.da', 'channel'), true],
        ['unbekanntes Objekt gelöscht', 'x.0.nie', null, false],
        ['Kanal', 'x.0.kanal', objekt('x.0.kanal', 'channel'), false],
        ['Raum', 'enum.rooms.neu', objekt('enum.rooms.neu', 'enum', { name: 'Neu', members: [] }), true],
        ['unbekannter Raum gelöscht', 'enum.rooms.nie', null, false],
        ['andere Aufzählung', 'enum.members.x', objekt('enum.members.x', 'enum'), false],
        ['Profil', `${NAMESPACE}.profile.gast`, objekt(`${NAMESPACE}.profile.gast`, 'config', {}, profil), true],
        ['Objekt einer App', `${NAMESPACE}.apps.abcdefgh`, objekt(`${NAMESPACE}.apps.abcdefgh`, 'device'), true],
        ['gleiche Systemsprache', 'system.config', objekt('system.config', 'config', { language: 'en' }), false],
        ['leere Systemsprache wie Admin', 'system.config', objekt('system.config', 'config', { language: '' }), false],
        [
            'andere Systemsprache, erst nach dem Neuladen',
            'system.config',
            objekt('system.config', 'config', { language: 'fr' }),
            false,
        ],
    ];
    for (const [fall, id, neu, gemeldet] of faelle) {
        it(`meldet nur, was Rechte betreffen kann: ${fall}`, () => {
            const { katalog, meldungen } = umgebung();
            katalog.geaendert('x.0.da', zustand('x.0.da'));
            katalog.geaendert(id, neu);
            expect(meldungen()).to.equal(gemeldet ? 2 : 1);
        });
    }

    it('findet neue Datenpunkte nach einer Abfrage und vergisst gelöschte', () => {
        const { katalog } = umgebung();
        katalog.geaendert('a.b.z', zustand('a.b.z'));
        expect([...katalog.zustaende('a.b').keys()]).to.deep.equal(['a.b.z']);
        katalog.geaendert('a.b.a', zustand('a.b.a'));
        katalog.geaendert('a.b.z', null);
        expect([...katalog.zustaende('a.b').keys()]).to.deep.equal(['a.b.a']);
    });

    it('hält je Datenpunkt nur, was die Auswertung braucht', () => {
        const { katalog } = umgebung();
        katalog.geaendert(
            'a.b',
            zustand('a.b', { unit: '%', min: 0, desc: 'lang', custom: { 'history.0': {} }, smartName: 'x' }),
        );
        expect(katalog.zustaende('a.b').get('a.b')).to.deep.equal({
            name: 'a.b',
            type: 'number',
            role: 'value',
            write: true,
            unit: '%',
            min: 0,
        });
    });

    it('übersteht kaputte Aufzählungen beim Laden und bei objectChange', async () => {
        const wirft = objekt('enum.rooms.wirft', 'enum', { name: 'Wirft' });
        Object.defineProperty(wirft.common, 'members', {
            get: () => {
                throw new Error('kaputt');
            },
        });
        const { katalog, warnungen } = umgebung(
            quelleAus([
                zustand('a.b'),
                objekt('enum.rooms.text', 'enum', { name: 'Text', members: 'a.b' }),
                objekt('enum.rooms.objekt', 'enum', { name: 'Objekt', members: { 0: 'a.b' } }),
                { _id: 'enum.rooms.leer', type: 'enum' } as unknown as ioBroker.Object,
                wirft,
            ]),
        );
        await katalog.lade();
        expect(katalog.aufzaehlungen('rooms').map(r => [r.id, r.mitglieder])).to.deep.equal([
            ['enum.rooms.leer', []],
            ['enum.rooms.objekt', []],
            ['enum.rooms.text', []],
        ]);
        expect(warnungen).to.deep.equal(['Objekt enum.rooms.wirft nicht übernommen: kaputt']);
        expect(() => katalog.geaendert('enum.rooms.wirft', wirft)).to.not.throw();
        katalog.geaendert('enum.rooms.text', objekt('enum.rooms.text', 'enum', { name: 'Text', members: ['a.b'] }));
        expect(katalog.aufzaehlungen('rooms').find(r => r.id === 'enum.rooms.text')?.mitglieder).to.deep.equal(['a.b']);
    });

    it('verwirft unbrauchbare Profile mit Warnung, auch wenn ein gültiges unbrauchbar wird', () => {
        const { katalog, warnungen } = umgebung();
        katalog.geaendert(`${NAMESPACE}.profile.Gross`, objekt(`${NAMESPACE}.profile.Gross`, 'config', {}, profil));
        expect(katalog.profil('Gross')).to.equal(undefined);
        katalog.geaendert(`${NAMESPACE}.profile.gast`, objekt(`${NAMESPACE}.profile.gast`, 'config', {}, profil));
        expect(katalog.profil('gast')).to.deep.equal(profil);
        katalog.geaendert(`${NAMESPACE}.profile.gast`, objekt(`${NAMESPACE}.profile.gast`, 'config', {}, {}));
        expect(katalog.profil('gast')).to.equal(undefined);
        expect(warnungen).to.have.length(2);
        katalog.geaendert(`${NAMESPACE}.profile.gast`, objekt(`${NAMESPACE}.profile.gast`, 'config', {}, profil));
        katalog.geaendert(`${NAMESPACE}.profile.gast`, null);
        expect(katalog.profil('gast')).to.equal(undefined);
    });

    it('führt Geräte nach, meldet jede Änderung und verwirft unbrauchbare', () => {
        const { katalog, warnungen, meldungen } = umgebung();
        const id = (g: string): string => `${NAMESPACE}.geraete.${g}`;
        katalog.geaendert(id('flur'), objekt(id('flur'), 'config', {}, { ...lampe, name: 'Flur' }));
        katalog.geaendert(id('bad'), objekt(id('bad'), 'config', {}, lampe));
        expect(katalog.geraete().map(([g]) => g)).to.deep.equal(['bad', 'flur']);
        expect(katalog.geraet('flur')?.name).to.equal('Flur');
        katalog.geaendert(id('bad'), objekt(id('bad'), 'config', {}, { ...lampe, typ: 'heizung' }));
        katalog.geaendert(id('flur'), objekt(id('flur'), 'config', {}, { ...lampe, teile: { tuer: 'a.b' } }));
        expect(katalog.geraete()).to.deep.equal([]);
        expect(warnungen).to.have.length(2);
        katalog.geaendert(id('flur'), objekt(id('flur'), 'config', {}, lampe));
        katalog.geaendert(id('flur'), null);
        expect(katalog.geraete()).to.deep.equal([]);
        expect(meldungen()).to.equal(6);
    });
});
