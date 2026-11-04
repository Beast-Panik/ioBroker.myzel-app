import { expect } from 'chai';
import { appPruefer } from '../app/dienst';
import { nummerAus } from './schema';

describe('Nachrichtenpruefer', () => {
    const pruefer = appPruefer();
    const jetzt = 1793720000000;
    const geraet = { android: '15', appVersion: '1.0.0' };
    const lies = (nachricht: unknown): ReturnType<typeof pruefer.lies> =>
        pruefer.lies(JSON.stringify(nachricht), jetzt);

    it('liefert gültige Nachrichten', () => {
        expect(lies({ t: 'abo', ids: ['a.b'] })).to.deep.equal({
            art: 'nachricht',
            nachricht: { t: 'abo', ids: ['a.b'] },
        });
    });

    it('prüft die Version bei hallo und koppeln vor dem Schema', () => {
        expect(lies({ t: 'hallo', v: 3 })).to.deep.equal({ art: 'version', v: 3 });
        expect(lies({ t: 'koppeln', v: 3, geheimnis: 'x' })).to.deep.equal({ art: 'version', v: 3 });
        expect(lies({ t: 'hallo', v: '2' }).art).to.equal('ungueltig');
        expect(lies({ t: 'abo', ids: [], v: 2 }).art).to.equal('ungueltig');
    });

    const ungueltig: [string, string | undefined][] = [
        ['Binärframe', undefined],
        ['kein JSON', '{t:'],
        ['Liste', '[]'],
        ['null', 'null'],
        ['ohne t', '{"ids":[]}'],
        ['unbekannter Typ', '{"t":"__proto__"}'],
        ['Nachricht der Gegenrichtung', '{"t":"willkommen"}'],
        [
            'unbekanntes Feld',
            JSON.stringify({ t: 'hallo', v: 1, app: 'abcdefgh', zugang: 'A'.repeat(43), geraet, x: 1 }),
        ],
    ];
    for (const [fall, text] of ungueltig) {
        it(`lehnt ab: ${fall}`, () => {
            expect(pruefer.lies(text, jetzt).art).to.equal('ungueltig');
        });
    }

    it('lehnt Zeiten mehr als 5 Minuten in der Zukunft ab', () => {
        const akku = { t: 'akku', stand: 50, laedt: false };
        expect(lies({ ...akku, zeit: jetzt + 5 * 60_000 }).art).to.equal('nachricht');
        expect(lies({ ...akku, zeit: jetzt + 5 * 60_000 + 1 }).art).to.equal('ungueltig');
    });

    it('nennt Pfad und Regel, nicht den Wert, und behält die laufende Nummer', () => {
        const gelesen = lies({ t: 'setze', n: 7, id: 'geheim*wert', val: 1 });
        expect(gelesen).to.include({ art: 'ungueltig', n: 7 });
        expect(gelesen.art === 'ungueltig' && gelesen.grund)
            .to.contain('/id')
            .and.not.contain('geheim');
    });

    it('liest die laufende Nummer nur im erlaubten Bereich', () => {
        expect(nummerAus('{"n":5}')).to.equal(5);
        expect(nummerAus({ n: 2 ** 31 - 1 })).to.equal(2 ** 31 - 1);
        for (const n of [0, -1, 1.5, 2 ** 31, '5']) {
            expect(nummerAus({ n }), String(n)).to.equal(undefined);
        }
        expect(nummerAus('kaputt')).to.equal(undefined);
    });
});
