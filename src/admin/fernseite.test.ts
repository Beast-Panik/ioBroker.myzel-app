import { expect } from 'chai';
import { NAMESPACE, Speicherablage } from '../../test/speicher';
import { type Ferneinstellung, Fernverwaltung } from '../app/fernzugang';
import type { AppDaten } from '../app/objekte';
import type { Protokoll } from '../basis/grenzen';
import type { Weg } from '../basis/kern';
import { type Fernstandseite, Fernseite } from './fernseite';

const app = (name: string, fern?: boolean): AppDaten => ({
    name,
    zugangHash: '0'.repeat(64),
    profil: 'familie',
    gekoppeltAm: 1_700_000_000_000,
    geraet: { android: '15', appVersion: '1.0.0' },
    handydaten: { akku: false, anruf: false, benachrichtigung: false },
    ...(fern !== undefined && { fern }),
});

describe('Seite des Fernzugangs', () => {
    const still: Protokoll = {
        debug: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
    };
    let ablage: Speicherablage;
    let fern: Fernverwaltung;
    let gespeichert: Ferneinstellung | undefined;
    let verbindungen: Map<string, Weg>;
    let bereit: boolean;
    let seite: Fernseite;

    beforeEach(async () => {
        ablage = new Speicherablage();
        await ablage.lege('bbbbbbbb', app('Tablet Flur'));
        await ablage.lege('aaaaaaaa', app('OnePlus', true));
        await ablage.lege('cccccccc', app('Pixel', false));
        gespeichert = undefined;
        fern = new Fernverwaltung({
            adapterId: 'a'.repeat(26),
            ablage: {
                lies: () => Promise.resolve(gespeichert),
                schreibe: e => {
                    gespeichert = { ...e };
                    return Promise.resolve();
                },
            },
            apps: ablage,
            nimm: () => undefined,
            log: still,
            verbunden: () => undefined,
            geaendert: () => undefined,
        });
        await fern.starte();
        verbindungen = new Map([
            ['aaaaaaaa', 'fern'],
            ['bbbbbbbb', 'lokal'],
        ]);
        bereit = true;
        seite = new Fernseite({
            namespace: NAMESPACE,
            betrieb: () => (bereit ? { fern, ablage, verbindungen: () => verbindungen, sprache: 'de' } : undefined),
            jetzt: () => 42,
        });
    });
    afterEach(() => fern.beende());

    const stand = async (befehl: string, nachricht?: unknown): Promise<Fernstandseite> =>
        (await seite.beantworte(befehl, nachricht)) as Fernstandseite;

    it('nennt ihre Adresse auch, solange der Server nicht läuft; alles andere wartet auf ihn', async () => {
        bereit = false;
        expect(await seite.beantworte('fernseite', undefined)).to.equal(
            `adapter/myzel-app/fern.html?instanz=${encodeURIComponent(NAMESPACE)}`,
        );
        expect(await seite.beantworte('fernstand', undefined)).to.deep.equal({ fehler: 'nichtBereit' });
    });

    it('Stand: Sprache, Adresse, Lage, Zeile und die Apps nach Name, mit Freigabe und Weg', async () => {
        expect(await stand('fernstand')).to.deep.equal({
            sprache: 'de',
            adresse: '',
            lage: { art: 'aus' },
            jetzt: 42,
            zeile: fern.zeile,
            apps: [
                { id: 'aaaaaaaa', name: 'OnePlus', gekoppeltAm: 1_700_000_000_000, fern: true, verbunden: 'fern' },
                { id: 'cccccccc', name: 'Pixel', gekoppeltAm: 1_700_000_000_000, fern: false },
                {
                    id: 'bbbbbbbb',
                    name: 'Tablet Flur',
                    gekoppeltAm: 1_700_000_000_000,
                    fern: false,
                    verbunden: 'lokal',
                },
            ],
        });
    });

    it('Adresse: Fehler als Text, sonst neuer Stand', async () => {
        expect(await seite.beantworte('fernAdresse', { adresse: 'http://vermittler.example.org' })).to.deep.equal({
            fehler: 'ungueltig',
            einzelheiten: ['Adresse ungültig: nur https:// mit Namen, ohne Abfrage und Anker'],
        });
        expect(await seite.beantworte('fernAdresse', { adresse: 5 })).to.include({ fehler: 'ungueltig' });
        expect(gespeichert?.adresse).to.equal('');
        expect((await stand('fernAdresse', { adresse: 'https://127.0.0.1:2' })).adresse).to.equal(
            'https://127.0.0.1:2',
        );
        expect(gespeichert?.adresse).to.equal('https://127.0.0.1:2');
    });

    it('Freigabe: nur gültige IDs und bekannte Apps, landet im Objekt der App', async () => {
        expect(await seite.beantworte('fernFreigabe', { app: '../x', fern: true })).to.include({ fehler: 'ungueltig' });
        expect(await seite.beantworte('fernFreigabe', { app: 'cccccccc', fern: 'ja' })).to.include({
            fehler: 'ungueltig',
        });
        expect(await seite.beantworte('fernFreigabe', { app: 'dddddddd', fern: true })).to.deep.equal({
            fehler: 'weg',
        });
        const neu = await stand('fernFreigabe', { app: 'cccccccc', fern: true });
        expect(ablage.apps.get('cccccccc')?.fern).to.equal(true);
        expect(neu.apps.find(a => a.id === 'cccccccc')?.fern).to.equal(true);
        await stand('fernFreigabe', { app: 'aaaaaaaa', fern: false });
        expect(ablage.apps.get('aaaaaaaa')?.fern).to.equal(false);
    });

    it('neuer Schlüssel: neue Zeile', async () => {
        const vorher = fern.zeile;
        expect((await stand('fernSchluessel')).zeile).to.not.equal(vorher);
    });
});
