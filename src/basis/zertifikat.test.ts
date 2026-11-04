import { expect } from 'chai';
import { X509Certificate, createPrivateKey } from 'node:crypto';
import { neueAdapterId } from './kodierung';
import { erzeugeIdentitaet, fingerabdruck, pruefeIdentitaet } from './zertifikat';

describe('Zertifikat', () => {
    const adapterId = neueAdapterId();
    const beginn = new Date('2026-11-03T12:00:00Z');
    const identitaet = erzeugeIdentitaet(adapterId, beginn);
    const x509 = new X509Certificate(identitaet.zertifikat);

    it('ist ein selbst signiertes ECDSA-P-256-Zertifikat auf die Adapter-ID, 20 Jahre gültig', () => {
        expect(x509.subject).to.equal(`CN=myzel-app ${adapterId}`);
        expect(x509.issuer).to.equal(x509.subject);
        expect(x509.verify(x509.publicKey)).to.equal(true);
        expect(x509.publicKey.asymmetricKeyDetails?.namedCurve).to.equal('prime256v1');
        expect(new Date(x509.validFrom).toISOString()).to.equal('2026-11-03T12:00:00.000Z');
        expect(new Date(x509.validTo).toISOString()).to.equal('2046-11-03T12:00:00.000Z');
        expect(x509.checkPrivateKey(createPrivateKey(identitaet.schluessel))).to.equal(true);
    });

    it('hat als Fingerabdruck den SHA-256 über das DER, base64url', () => {
        const hex = x509.fingerprint256.replace(/:/g, '').toLowerCase();
        expect(fingerabdruck(identitaet.zertifikat)).to.equal(Buffer.from(hex, 'hex').toString('base64url'));
        expect(fingerabdruck(identitaet.zertifikat)).to.have.length(43);
    });

    it('nimmt die eigene Identität an und erkennt unbrauchbare', () => {
        expect(pruefeIdentitaet(adapterId, identitaet)).to.equal(undefined);
        const fremd = erzeugeIdentitaet(adapterId);
        expect(pruefeIdentitaet(adapterId, { ...identitaet, schluessel: fremd.schluessel })).to.contain('passt nicht');
        expect(pruefeIdentitaet(neueAdapterId(), identitaet)).to.contain('anderen Adapter-ID');
        expect(pruefeIdentitaet(adapterId, { ...identitaet, zertifikat: 'kaputt' })).to.contain('Zertifikat');
        expect(pruefeIdentitaet(adapterId, { ...identitaet, schluessel: 'kaputt' })).to.contain('Schlüssel');
    });
});
