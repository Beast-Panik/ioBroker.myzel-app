import { expect } from 'chai';
import { Speicherquelle } from '../../test/speicher';
import type { Verbindung } from '../basis/kern';
import { type Recht, Rechtestand } from './rechte';
import {
    Abostelle,
    type Empfaenger,
    Werteversand,
    type Zustand,
    alsWert,
    alsZustand,
    inTeilen,
    pruefeSetzen,
} from './werte';

describe('Werte', () => {
    it('übernimmt Werte, die das Schema erlaubt, und macht andere zu null', () => {
        expect(alsWert(true)).to.equal(true);
        expect(alsWert(21.5)).to.equal(21.5);
        expect(alsWert('text')).to.equal('text');
        expect(alsWert(null)).to.equal(null);
        expect(alsWert(undefined)).to.equal(null);
        expect(alsWert(Number.NaN)).to.equal(null);
        expect(alsWert({ a: 1 })).to.equal('{"a":1}');
        expect(alsWert('x'.repeat(65536))).to.have.length(65536);
        expect(alsWert('x'.repeat(65537))).to.equal(null);
    });

    it('macht aus einem Zustand val, ack und ts, auch bei fehlenden Angaben', () => {
        expect(alsZustand({ val: 1, ack: true, ts: 1793720000000.4, lc: 0, from: 'x' })).to.deep.equal({
            val: 1,
            ack: true,
            ts: 1793720000000,
        });
        expect(alsZustand({ val: 1, ts: 0 } as ioBroker.State)).to.deep.equal({ val: 1, ack: false, ts: 0 });
        expect(alsZustand(null)).to.equal(null);
        expect(alsZustand(undefined)).to.equal(null);
    });

    const common = (teil: Partial<ioBroker.StateCommon>): ioBroker.StateCommon => ({
        name: 'x',
        role: 'state',
        read: true,
        write: true,
        type: 'mixed',
        ...teil,
    });

    const faelle: [string, Partial<ioBroker.StateCommon>, ioBroker.StateValue, string | undefined][] = [
        ['Zahl im Bereich', { type: 'number', min: 0, max: 100 }, 50, undefined],
        ['Zahl an der Grenze', { type: 'number', min: 0, max: 100 }, 100, undefined],
        ['Zahl unter min', { type: 'number', min: 0 }, -1, 'ungueltig'],
        ['Text statt Zahl', { type: 'number' }, '5', 'ungueltig'],
        ['null für Zahl', { type: 'number' }, null, 'ungueltig'],
        ['Wahrheitswert', { type: 'boolean' }, false, undefined],
        ['Zahl statt Wahrheitswert', { type: 'boolean' }, 0, 'ungueltig'],
        ['Text', { type: 'string' }, '', undefined],
        ['JSON', { type: 'json' as ioBroker.CommonType }, '{"a":1}', undefined],
        ['kaputtes JSON', { type: 'json' as ioBroker.CommonType }, '{a', 'ungueltig'],
        ['Liste als JSON-Text', { type: 'array' }, '[1,2]', undefined],
        ['gemischt mit null', { type: 'mixed' }, null, undefined],
        ['ohne Typ', { type: undefined }, 7, undefined],
        ['Datei', { type: 'file' as ioBroker.CommonType }, 'x', 'ungueltig'],
        ['nicht beschreibbar', { type: 'boolean', write: false }, true, 'rechte'],
    ];
    for (const [fall, teil, val, erwartet] of faelle) {
        it(`setze prüft: ${fall}`, () => {
            expect(pruefeSetzen(common(teil), val)?.code).to.equal(erwartet);
        });
    }

    it('teilt nach Bytes, nicht nach Zeichen; jede ID in genau einem Teil, ein zu großer Wert allein', () => {
        const z = (val: string | number): Zustand => ({ val, ack: true, ts: 1 });
        const werte: [string, Zustand | null][] = [
            ['a', z('ü'.repeat(25))],
            ['b', z(1)],
            ['c', null],
            ['d', z('x'.repeat(300))],
            ['e', z(2)],
        ];
        const teile = inTeilen(werte, 100);
        expect(teile.map(t => Object.keys(t))).to.deep.equal([['a'], ['b', 'c'], ['d'], ['e']]);
        expect(teile[0].a?.val).to.equal('ü'.repeat(25));
        expect(inTeilen([], 100)).to.deep.equal([{}]);
        const proto: [string, Zustand | null][] = [['__proto__', z(1)]];
        expect(Object.keys(inTeilen(proto, 100)[0])).to.deep.equal(['__proto__']);
    });
});

describe('Abostelle', () => {
    const empfaenger = (): Empfaenger & { erhalten: string[] } => {
        const erhalten: string[] = [];
        return { erhalten, geaendert: id => erhalten.push(id) };
    };

    it('abonniert jede ID einmal und kündigt mit dem letzten Empfänger', async () => {
        const quelle = new Speicherquelle();
        const stelle = new Abostelle(quelle);
        const a = empfaenger();
        const b = empfaenger();
        await stelle.ersetze(a, new Set(), new Set(['x', 'y']));
        await stelle.ersetze(b, new Set(), new Set(['y', 'z']));
        expect(quelle.aufrufe).to.deep.equal(['abonniere x,y', 'abonniere z']);
        stelle.geaendert('y', null);
        expect([a.erhalten, b.erhalten]).to.deep.equal([['y'], ['y']]);
        await stelle.ersetze(a, new Set(['x', 'y']), new Set(['y']));
        await stelle.ersetze(b, new Set(['y', 'z']), new Set());
        expect(quelle.aufrufe.slice(2)).to.deep.equal(['kuendige x', 'kuendige z']);
        expect(stelle.abonniert).to.equal(1);
        await stelle.ersetze(a, new Set(['y']), new Set());
        expect(quelle.aufrufe.slice(4)).to.deep.equal(['kuendige y']);
        expect(stelle.abonniert).to.equal(0);
    });
});

describe('Werteversand', () => {
    const rechteFuer = (ids: string[], recht: Recht = 'lesen'): Rechtestand =>
        new Rechtestand({
            profil: 'x',
            raeume: [],
            karten: [
                {
                    id: 'werte',
                    name: 'Werte',
                    typ: 'messwert',
                    teile: Object.fromEntries(
                        ids.map((id, i) => [`wert${i + 1}`, { id, typ: 'number', recht, name: id }]),
                    ),
                },
            ],
        });
    const still = { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined };
    const versand = (
        quelle: Speicherquelle,
        rechte: Rechtestand,
    ): { werte: Werteversand; stelle: Abostelle; gesendet: Record<string, any>[] } => {
        const gesendet: Record<string, any>[] = [];
        const verbindung = {
            sende: (n: Record<string, any>) => gesendet.push(n),
            sendeUndWarte: (n: Record<string, any>) => Promise.resolve(void gesendet.push(n)),
            sendeFehler: (code: string) => gesendet.push({ t: 'fehler', code }),
        } as unknown as Verbindung;
        const stelle = new Abostelle(quelle);
        return {
            werte: new Werteversand({ appId: 'x', verbindung, stelle, quelle, rechte, log: still, teilBytes: 200 }),
            stelle,
            gesendet,
        };
    };

    it('schickt nach neuen Rechten nichts mehr für entfallene IDs, auch solange ein Abo die Reihe aufhält', async () => {
        const quelle = new Speicherquelle().datenpunkt('a.b', {}, 1).datenpunkt('a.c', {}, 2);
        const { werte, gesendet } = versand(quelle, rechteFuer(['a.b', 'a.c']));
        await werte.abo(['a.b', 'a.c']);
        let lesen!: () => void;
        const lies = quelle.lies.bind(quelle);
        quelle.lies = ids =>
            new Promise(r => (lesen = () => r(lies(ids)))).then(w => w as Awaited<ReturnType<typeof lies>>);
        const zweitesAbo = werte.abo(['a.b', 'a.c']);
        await new Promise(r => setImmediate(r));
        werte.geaendert('a.c', { val: 3, ack: true, ts: Date.now(), lc: 0, from: 'x' });
        const bereinigt = werte.neueRechte(rechteFuer(['a.b']));
        werte.geaendert('a.c', { val: 4, ack: true, ts: Date.now(), lc: 0, from: 'x' });
        await new Promise(r => setTimeout(r, 150));
        lesen();
        await zweitesAbo;
        await bereinigt;
        const ohneErstes = gesendet.slice(1);
        expect(ohneErstes.map(n => n.t)).to.deep.equal(['werte']);
        expect(Object.keys(ohneErstes[0].werte)).to.deep.equal(['a.b']);
        expect(quelle.abonniert).to.deep.equal(new Set(['a.b']));
    });

    // Hält das erste Lesen an, bis der Test es freigibt
    function halteLesen(quelle: Speicherquelle): { gelesen: string[][]; lesen: () => void } {
        const lies = quelle.lies.bind(quelle);
        const r = { gelesen: [] as string[][], lesen: () => undefined as void };
        quelle.lies = ids => {
            r.gelesen.push(ids);
            return r.gelesen.length > 1 ? lies(ids) : new Promise(weiter => (r.lesen = () => weiter(lies(ids))));
        };
        return r;
    }
    const naechsterTakt = (): Promise<void> => new Promise(r => setImmediate(r));

    it('ein wartendes Abo wird vom nächsten ersetzt, nicht eingereiht', async () => {
        const quelle = new Speicherquelle().datenpunkt('a.b', {}, 1).datenpunkt('a.c', {}, 2).datenpunkt('a.d', {}, 3);
        const { werte, gesendet } = versand(quelle, rechteFuer(['a.b', 'a.c', 'a.d']));
        const halt = halteLesen(quelle);
        const erstes = werte.abo(['a.b']);
        await naechsterTakt();
        const zweites = werte.abo(['a.c']);
        const drittes = werte.abo(['a.d']);
        halt.lesen();
        await Promise.all([erstes, zweites, drittes]);
        expect(halt.gelesen).to.deep.equal([['a.b'], ['a.d']]);
        expect(gesendet.map(n => Object.keys(n.werte))).to.deep.equal([['a.b'], ['a.d']]);
        expect(quelle.abonniert).to.deep.equal(new Set(['a.d']));
    });

    it('eine Änderung während des Lesens kommt nach den werte, nicht davor', async () => {
        const quelle = new Speicherquelle().datenpunkt('a.b', {}, 1);
        const { werte, gesendet } = versand(quelle, rechteFuer(['a.b']));
        const halt = halteLesen(quelle);
        const abo = werte.abo(['a.b']);
        await naechsterTakt();
        werte.geaendert('a.b', { val: 2, ack: true, ts: 1793720001000, lc: 0, from: 'x' });
        await new Promise(r => setTimeout(r, 150));
        expect(gesendet).to.deep.equal([]);
        halt.lesen();
        await abo;
        await new Promise(r => setTimeout(r, 20));
        expect(gesendet.map(n => [n.t, n.werte['a.b'].val])).to.deep.equal([
            ['werte', 1],
            ['aenderung', 2],
        ]);
    });

    it('große werte und aenderung gehen in Teilen hinaus', async () => {
        const quelle = new Speicherquelle()
            .datenpunkt('a.b', {}, 'x'.repeat(150))
            .datenpunkt('a.c', {}, 'y'.repeat(150));
        const { werte, gesendet } = versand(quelle, rechteFuer(['a.b', 'a.c']));
        await werte.abo(['a.b', 'a.c']);
        werte.geaendert('a.b', { val: 'z'.repeat(150), ack: true, ts: 1793720001000, lc: 0, from: 'x' });
        werte.geaendert('a.c', { val: 'z'.repeat(150), ack: true, ts: 1793720001000, lc: 0, from: 'x' });
        await new Promise(r => setTimeout(r, 150));
        expect(gesendet.map(n => [n.t, Object.keys(n.werte)])).to.deep.equal([
            ['werte', ['a.b']],
            ['werte', ['a.c']],
            ['aenderung', ['a.b']],
            ['aenderung', ['a.c']],
        ]);
    });

    it('setze: entfällt das Recht während des Lesens des Objekts, wird nichts geschrieben', async () => {
        const quelle = new Speicherquelle().datenpunkt('a.b', {}, 1);
        const { werte, gesendet } = versand(quelle, rechteFuer(['a.b'], 'schreiben'));
        const objekt = quelle.objekt.bind(quelle);
        quelle.objekt = async id => {
            const common = await objekt(id);
            await werte.neueRechte(Rechtestand.leer());
            return common;
        };
        await werte.setze(1, 'a.b', 5);
        expect(gesendet).to.deep.equal([{ t: 'quittung', n: 1, ok: false, fehler: 'rechte' }]);
        expect(quelle.zustaende_.get('a.b')?.val).to.equal(1);
    });

    it('gibt beim Beenden alle Abos frei, auch wenn ein Abo vorher scheiterte', async () => {
        const quelle = new Speicherquelle().datenpunkt('a.b', {}, 1);
        quelle.abonniere = () => Promise.reject(new Error('Datenbank weg'));
        const { werte, stelle } = versand(quelle, rechteFuer(['a.b']));
        const fehler = await werte.abo(['a.b']).then(
            () => '',
            (f: Error) => f.message,
        );
        expect(fehler).to.equal('Datenbank weg');
        expect(stelle.abonniert).to.equal(1);
        await werte.beende();
        expect(stelle.abonniert).to.equal(0);
        expect(quelle.aufrufe).to.deep.equal(['kuendige a.b']);
    });
});
