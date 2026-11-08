import { expect } from 'chai';
import { NAMESPACE, Speicherablage, Speicherquelle } from '../../test/speicher';
import type { AppDaten } from '../app/objekte';
import type { Mittelpunktvorschlag } from '../app/zonen';
import type { Protokoll } from '../basis/grenzen';
import type { Ablehnung } from './eintraege';
import { type Zonenstand, Zonenseite } from './zonenseite';

describe('Zonenseite', () => {
    let quelle: Speicherquelle;
    let ablage: Speicherablage;
    let seite: Zonenseite;
    let laeuft: boolean;
    let vorschlaege: Mittelpunktvorschlag[];
    let log: string[];
    const protokoll: Protokoll = {
        debug: t => log.push(`debug ${t}`),
        info: t => log.push(t),
        warn: t => log.push(`warn ${t}`),
        error: t => log.push(`error ${t}`),
    };
    const app = (name: string, zonen: boolean, zonenwahl: string[]): AppDaten => ({
        name,
        zugangHash: '0'.repeat(64),
        profil: '',
        handydaten: { akku: false, anruf: false, benachrichtigung: false, zonen, standort: false },
        zonenwahl,
        gekoppeltAm: 1,
        geraet: { android: '15', appVersion: '0.8.0' },
    });
    const zuhause = { name: 'Zuhause', mitte: '50.941303, 6.958304', radius: 300 };

    beforeEach(async () => {
        log = [];
        laeuft = true;
        vorschlaege = [];
        quelle = new Speicherquelle().objekt_('system.config', {
            type: 'config',
            common: { language: 'de', latitude: '50.9413', longitude: 6.9583 },
        });
        ablage = new Speicherablage(quelle);
        await ablage.lege('fold', app('Fold', true, []));
        await ablage.lege('pixel', app('Pixel', true, []));
        await ablage.lege('tablet', app('Tablet', false, []));
        seite = new Zonenseite({
            namespace: NAMESPACE,
            katalog: () => quelle.katalog,
            apps: () => (laeuft ? ablage : undefined),
            vorschlaege: () => vorschlaege,
            ablage,
            log: protokoll,
            jetzt: () => 1_793_870_000_000,
        });
    });

    // Wie im Dialog „Handydaten“, nachdem es die Zonen gibt
    async function waehle(): Promise<void> {
        await ablage.aendere('fold', { zonenwahl: ['zuhause', 'arbeit'] });
        await ablage.aendere('pixel', { zonenwahl: ['zuhause'] });
        await ablage.aendere('tablet', { zonenwahl: ['zuhause'] });
    }

    const frage = <T>(befehl: string, nachricht: unknown = {}): Promise<T> =>
        seite.beantworte(befehl, nachricht) as Promise<T>;
    const speichere = (nachricht: unknown): Promise<{ id: string; stand: Zonenstand } & Partial<Ablehnung>> =>
        frage('speichereZone', nachricht);

    it('nennt die Adresse der Seite; ohne laufenden Betrieb ist sie nicht bereit', async () => {
        expect(await frage('zonenseite')).to.equal('adapter/myzel-app/zonen.html?instanz=myzel-app.0');
        laeuft = false;
        expect(await frage('zonenstand')).to.deep.equal({ fehler: 'nichtBereit' });
    });

    it('Stand: Zonen nach Namen mit den Apps, die sie bekommen; Zuhause aus den Systemeinstellungen; Grenzen', async () => {
        await speichere({ wunsch: 'zuhause', zone: zuhause });
        await speichere({ wunsch: 'arbeit', zone: { name: 'Arbeit', mitte: '50.9375 6.9603', radius: 200 } });
        await waehle();
        const stand = await frage<Zonenstand>('zonenstand');
        expect(stand).to.deep.equal({
            sprache: 'de',
            zonen: [
                { id: 'arbeit', name: 'Arbeit', breite: 50.9375, laenge: 6.9603, radius: 200, apps: ['Fold'] },
                // Das Tablet hat die Zone gewählt, Zonen aber aus
                {
                    id: 'zuhause',
                    name: 'Zuhause',
                    breite: 50.941303,
                    laenge: 6.958304,
                    radius: 300,
                    apps: ['Fold', 'Pixel'],
                },
            ],
            zuhause: { breite: 50.9413, laenge: 6.9583 },
            hoechstens: 20,
            laengen: { name: 40, id: 30 },
            radius: { von: 100, bis: 10_000, vorgabe: 300 },
            vorschlaege: [],
            jetzt: 1_793_870_000_000,
        });
        quelle.objekt_('system.config', { type: 'config', common: { language: 'de', latitude: 0, longitude: 0 } });
        expect((await frage<Zonenstand>('zonenstand')).zuhause).to.equal(null);
    });

    it('Vorschläge vom Handy mit dem Namen der App; eine entfernte App fällt weg', async () => {
        vorschlaege = [
            { appId: 'pixel', breite: 50.94, laenge: 6.95, genauigkeit: 12, zeit: 2 },
            { appId: 'weg', breite: 1, laenge: 2, genauigkeit: 5, zeit: 1 },
        ];
        expect((await frage<Zonenstand>('zonenstand')).vorschlaege).to.deep.equal([
            { app: 'Pixel', breite: 50.94, laenge: 6.95, genauigkeit: 12, zeit: 2 },
        ]);
    });

    it('neue Zone unter der gewünschten ID, sofort im Katalog, ohne Koordinaten im Log', async () => {
        const antwort = await speichere({ wunsch: 'zuhause', zone: { ...zuhause, name: '  Zuhause ' } });
        expect(antwort.id).to.equal('zuhause');
        expect(quelle.katalog.zone('zuhause')).to.deep.equal({
            name: 'Zuhause',
            breite: 50.941303,
            laenge: 6.958304,
            radius: 300,
        });
        expect(antwort.stand.zonen.map(z => z.id)).to.deep.equal(['zuhause']);
        expect(log).to.deep.equal(['Zone „Zuhause“ (zuhause) gespeichert']);
        // Ohne Wunsch eine ID aus der Zeit
        expect((await speichere({ zone: { ...zuhause, name: 'Ohne' } })).id).to.match(/^z[a-z0-9]+$/);
    });

    it('lehnt ab: vergebene, ungültige und belegte IDs, falscher Mittelpunkt, Radius außerhalb, mehr als 20', async () => {
        await speichere({ wunsch: 'zuhause', zone: zuhause });
        expect(await speichere({ wunsch: 'zuhause', zone: zuhause })).to.deep.equal({ fehler: 'vergeben' });
        for (const wunsch of ['Zuhause', '1zuhause', 'letzte', 'aktiv', 'grund', 'a'.repeat(31), 7]) {
            expect(await speichere({ wunsch, zone: zuhause }), String(wunsch)).to.deep.equal({
                fehler: 'ungueltig',
                einzelheiten: ['id'],
            });
        }
        for (const mitte of ['50,94 6,95', '50.94', '91.0, 6.9', '50.9, 181', 'Köln', 50.9]) {
            expect((await speichere({ wunsch: 'b', zone: { ...zuhause, mitte } })).fehler, String(mitte)).to.equal(
                'ungueltig',
            );
        }
        for (const radius of [99, 10_001, 300.5, '300']) {
            expect((await speichere({ wunsch: 'b', zone: { ...zuhause, radius } })).fehler, String(radius)).to.equal(
                'ungueltig',
            );
        }
        expect((await speichere({ wunsch: 'b', zone: { ...zuhause, name: ' ' } })).fehler).to.equal('ungueltig');
        expect((await speichere({ wunsch: 'b', zone: { ...zuhause, name: 'x'.repeat(41) } })).fehler).to.equal(
            'ungueltig',
        );
        expect(quelle.katalog.zonen().map(([id]) => id)).to.deep.equal(['zuhause']);
        for (let i = 1; i < 20; i++) {
            expect((await speichere({ wunsch: `z${i}`, zone: zuhause })).id).to.equal(`z${i}`);
        }
        expect(await speichere({ wunsch: 'z20', zone: zuhause })).to.deep.equal({ fehler: 'zuViele' });
        // Vorhandene lassen sich weiter ändern
        expect((await speichere({ id: 'z1', zone: { ...zuhause, radius: 500 } })).id).to.equal('z1');
    });

    it('ändern ersetzt die Zone, die ID bleibt; ein neuer Name gilt gleich für die Datenpunkte aller Apps', async () => {
        await speichere({ wunsch: 'zuhause', zone: zuhause });
        await ablage.schreibeZone('fold', 'zuhause', 'Zuhause', true, 1);
        await ablage.schreibeZone('pixel', 'zuhause', 'Zuhause', false, 1);
        const antwort = await speichere({
            id: 'zuhause',
            wunsch: 'heim',
            zone: { ...zuhause, name: 'Heim', radius: 400 },
        });
        expect(antwort.id).to.equal('zuhause');
        expect(quelle.katalog.zone('zuhause')).to.include({ name: 'Heim', radius: 400 });
        expect(ablage.zonen_.get('fold')?.get('zuhause')).to.include({ name: 'Heim', drin: true });
        expect(ablage.zonen_.get('pixel')?.get('zuhause')).to.include({ name: 'Heim', drin: false });
        expect(await speichere({ id: 'gibtsnicht', zone: zuhause })).to.deep.equal({ fehler: 'weg' });
    });

    it('löschen: Zone weg, bei jeder App aus der Wahl und ihr Datenpunkt weg; andere Zonen bleiben', async () => {
        await speichere({ wunsch: 'zuhause', zone: zuhause });
        await speichere({ wunsch: 'arbeit', zone: { ...zuhause, name: 'Arbeit' } });
        await waehle();
        await ablage.schreibeZone('fold', 'zuhause', 'Zuhause', true, 1);
        await ablage.schreibeZone('fold', 'arbeit', 'Arbeit', false, 1);
        await ablage.schreibeZone('tablet', 'zuhause', 'Zuhause', false, 1);
        const antwort = await frage<{ id: string; stand: Zonenstand }>('loescheZone', { id: 'zuhause' });
        expect(antwort.id).to.equal('zuhause');
        expect(antwort.stand.zonen.map(z => z.id)).to.deep.equal(['arbeit']);
        expect(quelle.katalog.zone('zuhause')).to.equal(undefined);
        expect(ablage.apps.get('fold')?.zonenwahl).to.deep.equal(['arbeit']);
        expect(ablage.apps.get('pixel')?.zonenwahl).to.deep.equal([]);
        expect(ablage.apps.get('tablet')?.zonenwahl).to.deep.equal([]);
        expect([...ablage.zonen_.get('fold')!.keys()]).to.deep.equal(['arbeit']);
        expect([...ablage.zonen_.get('tablet')!.keys()]).to.deep.equal([]);
        expect(await frage('loescheZone', { id: 'zuhause' })).to.deep.equal({ fehler: 'weg' });
        expect(await frage('loescheZone', { id: '../x' })).to.deep.equal({ fehler: 'weg' });
    });

    it('eine neue Zone unter einer alten ID bekommt keine App, nur weil die gelöschte noch in ihrer Wahl stand', async () => {
        // Im Objektbrowser gelöscht: Wahl und Datenpunkt blieben stehen
        await speichere({ wunsch: 'arbeit', zone: { ...zuhause, name: 'Arbeit' } });
        await waehle();
        await ablage.schreibeZone('fold', 'arbeit', 'Arbeit', true, 1);
        quelle.zone('arbeit', null);
        expect(ablage.apps.get('fold')?.zonenwahl).to.deep.equal(['zuhause', 'arbeit']);
        expect((await speichere({ wunsch: 'arbeit', zone: { ...zuhause, name: 'Büro' } })).id).to.equal('arbeit');
        expect(ablage.apps.get('fold')?.zonenwahl).to.deep.equal(['zuhause']);
        expect([...ablage.zonen_.get('fold')!.keys()]).to.deep.equal([]);
        expect((await frage<Zonenstand>('zonenstand')).zonen).to.deep.include({
            id: 'arbeit',
            name: 'Büro',
            breite: 50.941303,
            laenge: 6.958304,
            radius: 300,
            apps: [],
        });
        // Eine unbrauchbare Zone gibt es noch: Ihre ID ist vergeben, die Wahl bleibt
        await speichere({ wunsch: 'zuhause', zone: zuhause });
        await ablage.aendere('fold', { zonenwahl: ['zuhause'] });
        quelle.zone('zuhause', { ...zuhause, radius: 5 } as never);
        expect(await speichere({ wunsch: 'zuhause', zone: zuhause })).to.deep.equal({ fehler: 'vergeben' });
        expect(ablage.apps.get('fold')?.zonenwahl).to.deep.equal(['zuhause']);
    });

    it('löschen räumt bei den übrigen Apps weiter auf, wenn es bei einer scheitert', async () => {
        await speichere({ wunsch: 'zuhause', zone: zuhause });
        await waehle();
        const aendere = ablage.aendere.bind(ablage);
        ablage.aendere = (appId, daten) =>
            appId === 'fold' ? Promise.reject(new Error('Datenbank weg')) : aendere(appId, daten);
        expect((await frage<{ id: string }>('loescheZone', { id: 'zuhause' })).id).to.equal('zuhause');
        expect(ablage.apps.get('pixel')?.zonenwahl).to.deep.equal([]);
        expect(ablage.apps.get('tablet')?.zonenwahl).to.deep.equal([]);
        expect(log.filter(z => z.startsWith('warn Zone zuhause bei App fold'))).to.have.length(1);
    });
});
