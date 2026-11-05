import { expect } from 'chai';
import type { Protokoll } from '../basis/grenzen';
import { Katalog, type Katalogquelle, type Objektaenderung } from './katalog';
import type { Karte, Profil } from './rechte';

const NAMESPACE = 'myzel-app.0';

const objekt = (id: string, type: string, common: Record<string, unknown> = {}, native = {}): ioBroker.Object =>
    ({ _id: id, type, common, native }) as unknown as ioBroker.Object;
const zustand = (id: string, common: Record<string, unknown> = {}): ioBroker.Object =>
    objekt(id, 'state', { name: id, type: 'number', role: 'value', read: true, write: true, ...common });
const profil: Profil = { name: 'Familie', raeume: [], karten: [], gesperrt: [] };
const lampe: Karte = { name: 'Lampe', typ: 'lampe', raum: '', teile: { schalten: 'a.b.c' } };

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
    it('lädt Datenpunkte, Räume, Karten, Profile, Etagen und Systemsprache mit sechs Abfragen; Geräte zählen nicht', async () => {
        const abfragen: string[] = [];
        const { katalog } = umgebung(
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
                    objekt(`${NAMESPACE}.karten.lampe`, 'config', {}, lampe),
                    objekt(`${NAMESPACE}.geraete.alt`, 'config', {}, lampe),
                    objekt('system.config', 'config', { language: 'fr' }),
                ],
                abfragen,
            ),
        );
        await katalog.lade();
        expect(abfragen).to.deep.equal([
            'config system.config',
            'state ',
            'enum enum.rooms.',
            `config ${NAMESPACE}.karten.`,
            `config ${NAMESPACE}.profile.`,
            `config ${NAMESPACE}.etagen.`,
        ]);
        expect(katalog.anzahl).to.equal(3);
        expect(katalog.datenpunkt('a.b-c.d')?.type).to.equal('number');
        expect(katalog.datenpunkt('a.b.kanal')).to.equal(undefined);
        expect(katalog.raeume()).to.deep.equal([
            { id: 'enum.rooms.bad', name: 'Bad', mitglieder: [] },
            { id: 'enum.rooms.kueche', name: 'Küche', mitglieder: ['a.b'] },
        ]);
        expect(katalog.profil('familie')).to.deep.equal(profil);
        expect(katalog.karten()).to.deep.equal([['lampe', lampe]]);
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
        while (liefern.length < 3) {
            await new Promise(r => setImmediate(r));
        }
        katalog.geaendert('alt.weg', null);
        katalog.geaendert('neu.da', zustand('neu.da'));
        liefern.forEach(l => l());
        await geladen;
        expect(['alt.weg', 'alt.bleibt', 'neu.da'].map(id => katalog.datenpunkt(id) !== undefined)).to.deep.equal([
            false,
            true,
            true,
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
        expect(katalog.datenpunkt('a.lampe')?.name).to.equal('Lampe');
        objekte[0] = objekt('system.config', 'config', { language: 'en' });
        katalog.geaendert('system.config', objekte[0]);
        expect(meldungen(), 'noch nicht, sonst rechte mit gemischten Sprachen').to.equal(0);
        await katalog.lade();
        expect(meldungen()).to.equal(1);
        expect(abfragen.filter(a => a.startsWith('state'))).to.have.length(3);
        expect(katalog.datenpunkt('a.lampe')?.name).to.equal('Lamp');
        expect(katalog.datenpunkt('a.ohne')?.name).to.equal('a.ohne');
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
        [
            'Funktion',
            'enum.functions.licht',
            objekt('enum.functions.licht', 'enum', { name: 'Licht', members: [] }),
            false,
        ],
        ['Kartenobjekt', `${NAMESPACE}.karten.flur`, objekt(`${NAMESPACE}.karten.flur`, 'config', {}, lampe), true],
        [
            'Gerät aus Adapter 0.1',
            `${NAMESPACE}.geraete.flur`,
            objekt(`${NAMESPACE}.geraete.flur`, 'config', {}, lampe),
            false,
        ],
        ['Profilobjekt', `${NAMESPACE}.profile.gast`, objekt(`${NAMESPACE}.profile.gast`, 'config', {}, profil), true],
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

    it('hält je Datenpunkt nur, was die Auswertung braucht', () => {
        const { katalog } = umgebung();
        katalog.geaendert(
            'a.b',
            zustand('a.b', { unit: '%', min: 0, desc: 'lang', custom: { 'history.0': {} }, smartName: 'x' }),
        );
        expect(katalog.datenpunkt('a.b')).to.deep.equal({
            name: 'a.b',
            type: 'number',
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
        expect(katalog.raeume().map(r => [r.id, r.mitglieder])).to.deep.equal([
            ['enum.rooms.leer', []],
            ['enum.rooms.objekt', []],
            ['enum.rooms.text', []],
        ]);
        expect(warnungen).to.deep.equal(['Objekt enum.rooms.wirft nicht übernommen: kaputt']);
        expect(() => katalog.geaendert('enum.rooms.wirft', wirft)).to.not.throw();
        katalog.geaendert('enum.rooms.text', objekt('enum.rooms.text', 'enum', { name: 'Text', members: ['a.b'] }));
        expect(katalog.raeume().find(r => r.id === 'enum.rooms.text')?.mitglieder).to.deep.equal(['a.b']);
    });

    it('Karten als Objekte: nach ID sortiert, jede Änderung gemeldet, Unbrauchbares fehlt mit Warnung', () => {
        const { katalog, meldungen, warnungen } = umgebung();
        const karte = (id: string, k: unknown, typ = 'config'): void =>
            katalog.geaendert(
                `${NAMESPACE}.karten.${id}`,
                k === null ? null : objekt(`${NAMESPACE}.karten.${id}`, typ, {}, k),
            );
        karte('flur', { ...lampe, name: 'Flur' });
        karte('bad', lampe);
        expect(katalog.karten().map(([k, x]) => [k, x.name])).to.deep.equal([
            ['bad', 'Lampe'],
            ['flur', 'Flur'],
        ]);
        expect(katalog.karte('flur')?.name).to.equal('Flur');
        karte('flur', { ...lampe, name: '' });
        expect(katalog.karten().map(([k]) => k)).to.deep.equal(['bad']);
        expect(warnungen).to.have.length(1);
        expect(warnungen[0]).to.match(/^Karte flur ist unbrauchbar und fehlt auf den Handys: /);
        karte('bad', null);
        karte('Gross', lampe);
        karte('kanal', lampe, 'channel');
        katalog.geaendert(
            `${NAMESPACE}.karten.bad.unter`,
            objekt(`${NAMESPACE}.karten.bad.unter`, 'config', {}, lampe),
        );
        expect(katalog.karten()).to.deep.equal([]);
        expect(meldungen()).to.equal(4);
    });

    it('Profile als Objekte: nach Namen sortiert, jede Änderung gemeldet, Unbrauchbares fehlt mit Warnung', () => {
        const { katalog, meldungen, warnungen } = umgebung();
        const setze = (id: string, p: unknown): void =>
            katalog.geaendert(
                `${NAMESPACE}.profile.${id}`,
                p === null ? null : objekt(`${NAMESPACE}.profile.${id}`, 'config', {}, p),
            );
        setze('gast', { ...profil, name: 'Gast' });
        setze('familie', profil);
        setze('zweite', { ...profil, name: 'Familie' });
        expect(katalog.alleProfile().map(([id]) => id)).to.deep.equal(['familie', 'zweite', 'gast']);
        expect(katalog.profil('gast')?.name).to.equal('Gast');
        setze('gast', { name: 'Gast', raeume: [] });
        expect(katalog.profil('gast')).to.equal(undefined);
        expect(warnungen).to.have.length(1);
        expect(warnungen[0]).to.match(/^Profil gast ist unbrauchbar und gibt keine Rechte: /);
        setze('zweite', null);
        expect(katalog.alleProfile().map(([id]) => id)).to.deep.equal(['familie']);
        expect(meldungen()).to.equal(5);
    });
});
