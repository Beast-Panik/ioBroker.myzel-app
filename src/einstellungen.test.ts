import { expect } from 'chai';
import { native } from '../io-package.json';
import { pruefeEinstellungen } from './einstellungen';

describe('pruefeEinstellungen', () => {
    it('nimmt die Vorgaben aus io-package.json an', () => {
        expect(pruefeEinstellungen(native)).to.deep.equal([]);
    });

    it('nimmt IPv4, IPv6 und Namen als Adressen an', () => {
        const config = { ...native, adressen: ['192.168.1.5:8095', '[fd00::5]:8095', 'iobroker.fritz.box:8095'] };
        expect(pruefeEinstellungen(config)).to.deep.equal([]);
    });

    const ungueltig: [string, Record<string, unknown>][] = [
        ['Port unter 1024', { port: 80 }],
        ['Port als Text', { port: '8095' }],
        ['fünf Adressen', { adressen: ['a:1', 'b:2', 'c:3', 'd:4', 'e:5'] }],
        ['Adresse ohne Port', { adressen: ['192.168.1.5'] }],
        ['Adresse mit Pfad', { adressen: ['192.168.1.5:8095/x'] }],
        ['doppelte Adresse', { adressen: ['a:1', 'a:1'] }],
        ['Nachlauf 0', { nachlaufMin: 0 }],
        ['Frist über einem Tag', { hinweisFristMin: 1441 }],
        ['Textlänge mit Komma', { textLaenge: 500.5 }],
    ];
    for (const [fall, aenderung] of ungueltig) {
        it(`lehnt ab: ${fall}`, () => {
            expect(pruefeEinstellungen({ ...native, ...aenderung })).to.not.be.empty;
        });
    }

    it('nennt im Fehler das Feld, nicht den Wert', () => {
        const fehler = pruefeEinstellungen({ ...native, adressen: ['geheim-wert'] });
        expect(fehler.join(' ')).to.contain('/adressen/0').and.not.contain('geheim-wert');
    });
});
