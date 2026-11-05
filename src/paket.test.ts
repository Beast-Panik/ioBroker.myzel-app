// Ersetzt die Paketprüfung aus @iobroker/testing: Deren Pflichtangaben (GitHub-Adresse, Lizenzdatei, Icon-URL)
// gelten für das offizielle Repository, nicht für den Eigenbetrieb.
import { expect } from 'chai';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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
    it('hält keine Schlüssel in den Instanz-Einstellungen, dafür Karten und Profile', () => {
        expect(Object.keys(ioPaket.native)).to.have.members([
            'port',
            'adressen',
            'nachlaufMin',
            'hinweisFristMin',
            'textLaenge',
            'karten',
            'profile',
        ]);
        expect(ioPaket.native.karten).to.deep.equal([]);
        expect(ioPaket.native.profile).to.deep.equal([]);
    });

    it('läuft in einem eigenen Prozess', () => {
        expect(ioPaket.common.compact).to.equal(false);
    });

    it('hat für jeden Text der Einstellungsseite eine deutsche und eine englische Übersetzung, in allen Reitern', () => {
        const schluessel = new Set<string>();
        // items steht als Liste (Akkordeon) oder als Objekt nach Namen (Reiter, Panel)
        const kinder = (w: unknown): unknown[] =>
            Array.isArray(w) ? w : w && typeof w === 'object' ? Object.values(w) : [];
        const sammle = (element: unknown): void => {
            if (element && typeof element === 'object') {
                const e = element as Record<string, unknown>;
                for (const feld of ['text', 'label', 'help', 'unit', 'validatorErrorText']) {
                    if (typeof e[feld] === 'string') {
                        schluessel.add(e[feld]);
                    }
                }
                [...kinder(e.items), ...kinder(e.options)].forEach(sammle);
            }
        };
        sammle(json('admin/jsonConfig.json'));
        for (const sprache of ['de', 'en']) {
            const texte = json(`admin/i18n/${sprache}.json`);
            for (const s of schluessel) {
                expect(texte, `${sprache}: ${s}`).to.have.property(s);
            }
            expect(Object.keys(texte).sort(), sprache).to.deep.equal([...schluessel].sort());
        }
    });
});
