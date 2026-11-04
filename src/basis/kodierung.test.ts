import { expect } from 'chai';
import gemeinsam from '../../protokoll/v1/gemeinsam.schema.json';
import {
    base32,
    neueAdapterId,
    neueAppId,
    neueHinweisId,
    neuerZugang,
    neuesGeheimnis,
    passtZuHash,
    sha256,
} from './kodierung';
import { erstellePruefer } from './schema';

const format = (name: string): ((daten: unknown) => string[]) =>
    erstellePruefer({ $ref: `${gemeinsam.$id}#/$defs/${name}` }, [gemeinsam]);

describe('Kodierung', () => {
    it('kodiert base32 wie die Testvektoren aus RFC 4648, in Kleinbuchstaben ohne Auffüllung', () => {
        const vektoren: [string, string][] = [
            ['', ''],
            ['f', 'my'],
            ['fo', 'mzxq'],
            ['foo', 'mzxw6'],
            ['foob', 'mzxw6yq'],
            ['fooba', 'mzxw6ytb'],
            ['foobar', 'mzxw6ytboi'],
        ];
        for (const [klar, kodiert] of vektoren) {
            expect(base32(Buffer.from(klar)), klar).to.equal(kodiert);
        }
    });

    it('erzeugt Kennungen im Format der Protokoll-Schemata', () => {
        const faelle: [string, () => string][] = [
            ['adapterId', neueAdapterId],
            ['appId', neueAppId],
            ['zugang', neuerZugang],
            ['geheimnis', neuesGeheimnis],
            ['hinweisId', neueHinweisId],
        ];
        for (const [name, erzeuge] of faelle) {
            const pruefe = format(name);
            for (let i = 0; i < 50; i++) {
                expect(pruefe(erzeuge()), name).to.deep.equal([]);
            }
        }
    });

    it('vergleicht Geheimnisse über ihren Hash', () => {
        const zugang = neuerZugang();
        expect(passtZuHash(zugang, sha256(zugang))).to.equal(true);
        expect(passtZuHash(`${zugang}x`, sha256(zugang))).to.equal(false);
        expect(passtZuHash('', sha256(zugang))).to.equal(false);
        expect(passtZuHash(zugang, Buffer.from('kaputt'))).to.equal(false);
    });
});
