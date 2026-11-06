import { expect } from 'chai';
import gemeinsam from '../../protokoll/v1/gemeinsam.schema.json';
import {
    adapterSchluessel,
    appSchluessel,
    konfigurationszeile,
    neuesFerngeheimnis,
    vermittlerHash,
} from './fernschluessel';
import { neueAdapterId, sha256 } from './kodierung';
import { erstellePruefer } from './schema';

const pruefeSchluessel = erstellePruefer({ $ref: `${gemeinsam.$id}#/$defs/vermittlerschluessel` }, [gemeinsam]);
const GEHEIMNIS = Buffer.from([...Array(32).keys()]).toString('base64url');
const ZUGANG = '0'.repeat(64);

describe('Schlüssel für den Fernzugang', () => {
    // Ändert sich die Ableitung, passt keine Zeile auf einem Vermittler mehr: Diese Werte dürfen sich nie ändern.
    it('leitet feste Werte ab', () => {
        expect(adapterSchluessel(GEHEIMNIS)).to.equal('HCOhd_3hfrOTsGlZqzSBkC7KTlyc0uTlx-1hj-x-adc');
        expect(appSchluessel(GEHEIMNIS, 'abcdefgh', ZUGANG)).to.equal('kDUxjJAm0H3pl_QMOsXdwnu5bnuJetpk_fDGbE3GAgk');
        expect(konfigurationszeile('a1b2c3d4', GEHEIMNIS)).to.equal(
            'adapter a1b2c3d4 56d47bef7932d50a680b21a32d257fecbedd9d63236984af349e1be29eb62614',
        );
    });

    it('jedes Geheimnis ist neu, 32 Byte, und jeder Schlüssel passt zum Schema', () => {
        const geheimnisse = new Set(Array.from({ length: 50 }, neuesFerngeheimnis));
        expect(geheimnisse.size).to.equal(50);
        for (const g of geheimnisse) {
            expect(Buffer.from(g, 'base64url')).to.have.length(32);
            expect(pruefeSchluessel(adapterSchluessel(g))).to.deep.equal([]);
            expect(pruefeSchluessel(appSchluessel(g, 'abcdefgh', ZUGANG))).to.deep.equal([]);
        }
    });

    it('trennt Adapter, Apps und Zugänge: anderer Zweck, andere App, neu gekoppelt oder neues Geheimnis', () => {
        const schluessel = [
            adapterSchluessel(GEHEIMNIS),
            appSchluessel(GEHEIMNIS, 'abcdefgh', ZUGANG),
            appSchluessel(GEHEIMNIS, 'abcdefgi', ZUGANG),
            appSchluessel(GEHEIMNIS, 'abcdefgh', '1'.repeat(64)),
            appSchluessel(neuesFerngeheimnis(), 'abcdefgh', ZUGANG),
            adapterSchluessel(neuesFerngeheimnis()),
        ];
        expect(new Set(schluessel).size).to.equal(schluessel.length);
    });

    it('der Vermittler bekommt nur den SHA-256 als hex, die Zeile hat das Format, das er erwartet', () => {
        const s = adapterSchluessel(GEHEIMNIS);
        expect(vermittlerHash(s)).to.equal(sha256(s).toString('hex'));
        const id = neueAdapterId();
        const zeile = konfigurationszeile(id, GEHEIMNIS);
        expect(zeile).to.match(/^adapter [a-z2-7]+ [0-9a-f]{64}$/);
        expect(zeile).to.equal(`adapter ${id} ${vermittlerHash(s)}`);
        expect(zeile).to.not.contain(s).and.not.contain(GEHEIMNIS);
    });
});
