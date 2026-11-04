// Ersetzt die Paketprüfung aus @iobroker/testing: Deren Pflichtangaben (GitHub-Adresse, Lizenzdatei, Icon-URL)
// gelten für das offizielle Repository, nicht für den Eigenbetrieb.
import { expect } from 'chai';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SPALTEN } from './admin/geraete';

const wurzel = join(__dirname, '..');
const json = (datei: string): any => JSON.parse(readFileSync(join(wurzel, datei), 'utf8'));
const paket = json('package.json');
const ioPaket = json('io-package.json');

describe('Paket', () => {
    it('hat in package.json und io-package.json dieselbe Version, mit Eintrag in news', () => {
        expect(ioPaket.common.version).to.equal(paket.version);
        expect(ioPaket.common.news).to.have.property(paket.version);
    });

    it('lässt sich nicht versehentlich auf npm veröffentlichen', () => {
        expect(paket.private).to.equal(true);
        expect(paket.license).to.equal('UNLICENSED');
    });

    it('pinnt Laufzeit-Abhängigkeiten auf genaue Versionen', () => {
        for (const [name, version] of Object.entries<string>(paket.dependencies)) {
            expect(version, name).to.match(/^\d+\.\d+\.\d+$/);
        }
    });

    it('packt Build, Protokoll-Schemata und io-package.json ein', () => {
        expect(paket.files).to.include.members(['build/', 'protokoll/', 'io-package.json']);
    });

    // Der Schlüssel liegt im Objekt identitaet: Eine veraltete Admin-Seite würde ihn in den Einstellungen überschreiben.
    it('hält keine Schlüssel in den Instanz-Einstellungen', () => {
        expect(Object.keys(ioPaket.native)).to.have.members([
            'port',
            'adressen',
            'nachlaufMin',
            'hinweisFristMin',
            'textLaenge',
        ]);
    });

    it('läuft in einem eigenen Prozess', () => {
        expect(ioPaket.common.compact).to.equal(false);
    });

    it('hat für jeden Text der Einstellungsseite und jeden Spaltentitel im Gerätemanager eine deutsche und eine englische Übersetzung', () => {
        const seite = json('admin/jsonConfig.json');
        const schluessel = new Set<string>();
        for (const element of Object.values<Record<string, unknown>>(seite.items)) {
            for (const feld of ['text', 'label', 'help', 'unit']) {
                if (typeof element[feld] === 'string') {
                    schluessel.add(element[feld]);
                }
            }
        }
        Object.values(SPALTEN).forEach(s => schluessel.add(s));
        for (const sprache of ['de', 'en']) {
            const texte = json(`admin/i18n/${sprache}.json`);
            for (const s of schluessel) {
                expect(texte, `${sprache}: ${s}`).to.have.property(s);
            }
            expect(Object.keys(texte).sort(), sprache).to.deep.equal([...schluessel].sort());
        }
    });
});
