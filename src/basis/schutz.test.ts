import { expect } from 'chai';
import { GRENZEN } from './grenzen';
import { Eimer, Sperrliste, Ueberlast, sperrbereich } from './schutz';

describe('Schutz', () => {
    it('Eimer: erlaubt einen Stoß, danach die Dauerrate', () => {
        const eimer = new Eimer(50, 100, 0);
        let erlaubt = 0;
        for (let i = 0; i < 150; i++) {
            erlaubt += eimer.nimm(0) ? 1 : 0;
        }
        expect(erlaubt).to.equal(100);
        expect(eimer.nimm(10)).to.equal(false);
        expect(eimer.nimm(20)).to.equal(true);
        while (eimer.nimm(1000)) {
            // leeren, damit nur die Dauerrate zählt
        }
        erlaubt = 0;
        for (let t = 1005; t <= 2000; t += 5) {
            erlaubt += eimer.nimm(t) ? 1 : 0;
        }
        expect(erlaubt).to.be.within(49, 51);
    });

    it('Überlast: trennt erst nach 10 s Ablehnungen ohne Pause', () => {
        const ueberlast = new Ueberlast();
        expect(ueberlast.abgelehnt(0)).to.equal(false);
        expect(ueberlast.abgelehnt(5_000)).to.equal(false);
        expect(ueberlast.abgelehnt(6_500)).to.equal(false);
        for (let t = 6_500; t < 16_500; t += 500) {
            expect(ueberlast.abgelehnt(t), String(t)).to.equal(false);
        }
        expect(ueberlast.abgelehnt(16_500)).to.equal(true);
    });

    it('Sperrliste: sperrt nach 5 Fehlversuchen in 5 Minuten für 15 Minuten', () => {
        const liste = new Sperrliste();
        for (let i = 0; i < 4; i++) {
            expect(liste.fehlversuch('10.0.0.5', i * 60_000)).to.equal(false);
        }
        expect(liste.gesperrt('10.0.0.5', 240_000)).to.equal(false);
        expect(liste.fehlversuch('10.0.0.5', 240_000)).to.equal(true);
        expect(liste.gesperrt('10.0.0.5', 240_000 + 15 * 60_000 - 1)).to.equal(true);
        expect(liste.gesperrt('10.0.0.6', 240_000)).to.equal(false);
        expect(liste.gesperrt('10.0.0.5', 240_000 + 15 * 60_000)).to.equal(false);
    });

    it('Sperrliste: Fehlversuche außerhalb des Fensters zählen nicht', () => {
        const liste = new Sperrliste();
        for (let i = 0; i < 10; i++) {
            expect(liste.fehlversuch('10.0.0.5', i * 76_000)).to.equal(false);
        }
    });

    it('Sperrbereich: IPv4 je Adresse, IPv6 je /64 in einer Schreibweise', () => {
        expect(sperrbereich('192.168.1.5')).to.equal('192.168.1.5');
        expect(sperrbereich('2001:DB8:0:1:aaaa::5')).to.equal('2001:db8:0:1::/64');
        expect(sperrbereich('2001:db8:0:1:bbbb:cccc:dddd:eeee')).to.equal('2001:db8:0:1::/64');
        expect(sperrbereich('2001:db8::1')).to.equal('2001:db8:0:0::/64');
        expect(sperrbereich('fe80::1%eth0')).to.equal('fe80:0:0:0::/64');
        expect(sperrbereich('::1')).to.equal('0:0:0:0::/64');
        expect(sperrbereich('64:ff9b::192.0.2.1')).to.equal('64:ff9b:0:0::/64');
        expect(sperrbereich('kein Ort')).to.equal('kein Ort');
    });

    it('Sperrliste: neue Adressen im selben IPv6-/64 sind mitgesperrt', () => {
        const liste = new Sperrliste({ ...GRENZEN, fehlversuche: 2 });
        liste.fehlversuch('2001:db8:0:1::a', 0);
        expect(liste.fehlversuch('2001:db8:0:1::b', 0)).to.equal(true);
        expect(liste.gesperrt('2001:db8:0:1:ffff::c', 1)).to.equal(true);
        expect(liste.gesperrt('2001:db8:0:2::a', 1)).to.equal(false);
    });

    it('Sperrliste: eine Flut neuer Adressen hebt bestehende Sperren nicht auf', () => {
        const liste = new Sperrliste({ ...GRENZEN, sperrlisteEintraege: 10, fehlversuche: 2 });
        liste.fehlversuch('10.0.0.1', 0);
        liste.fehlversuch('10.0.0.1', 0);
        for (let i = 0; i < 100; i++) {
            liste.fehlversuch(`10.1.${i}.1`, 1);
        }
        expect(liste.gesperrt('10.0.0.1', 2)).to.equal(true);
        expect((liste as unknown as { eintraege: Map<string, unknown> }).eintraege.size).to.equal(10);
    });

    it('Sperrliste: bleibt bei vielen Adressen begrenzt und behält aktive Sperren vorn', () => {
        const grenzen = { ...GRENZEN, sperrlisteEintraege: 10, fehlversuche: 1 };
        const liste = new Sperrliste(grenzen);
        for (let i = 0; i < 100; i++) {
            liste.fehlversuch(`10.0.${i}.1`, 0);
        }
        expect(liste.gesperrt('10.0.99.1', 0)).to.equal(true);
        expect(liste.gesperrt('10.0.0.1', 0)).to.equal(false);
        expect((liste as unknown as { eintraege: Map<string, unknown> }).eintraege.size).to.equal(10);
    });
});
