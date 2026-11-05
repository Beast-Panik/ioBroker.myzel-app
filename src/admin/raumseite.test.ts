import { expect } from 'chai';
import { NAMESPACE, Speicherablage, Speicherquelle } from '../../test/speicher';
import type { Etage } from '../app/rechte';
import type { Protokoll } from '../basis/grenzen';
import { type Raumstand, Raumseite } from './raumseite';

describe('Raumseite', () => {
    let quelle: Speicherquelle;
    let seite: Raumseite;
    let log: string[];
    const protokoll: Protokoll = {
        debug: () => undefined,
        info: t => log.push(t),
        warn: t => log.push(`warn ${t}`),
        error: t => log.push(`error ${t}`),
    };
    const etage = (name: string, kurz: string, position: number, raeume: string[]): Etage => ({
        name,
        kurz,
        position,
        raeume,
    });

    beforeEach(() => {
        log = [];
        quelle = new Speicherquelle()
            .raum('kueche', { de: 'Küche', en: 'Kitchen' }, [])
            .raum('flur', 'Flur', [])
            .raum('bad', 'Bad', [])
            .datenpunkt('z.0.herd.an', { type: 'boolean' })
            .karte('herd', {
                name: 'Herd',
                typ: 'schalter',
                raum: 'enum.rooms.kueche',
                teile: { schalten: 'z.0.herd.an' },
            });
        quelle.katalog.sprache = 'de';
        seite = new Raumseite({
            namespace: NAMESPACE,
            katalog: () => quelle.katalog,
            ablage: new Speicherablage(quelle),
            log: protokoll,
            jetzt: () => 1_793_870_000_000,
        });
    });

    const frage = <T>(befehl: string, nachricht: unknown = {}): Promise<T> =>
        seite.beantworte(befehl, nachricht) as Promise<T>;
    const folge = (stand: Raumstand): string[][] => stand.etagen.map(e => [e.kurz, ...e.raeume.map(r => r.slice(11))]);

    it('nennt die Adresse der Seite; vor dem Start ist sie nicht bereit', async () => {
        expect(await frage('raumseite')).to.equal('adapter/myzel-app/raeume.html?instanz=myzel-app.0');
        const frueh = new Raumseite({
            namespace: NAMESPACE,
            katalog: () => undefined,
            ablage: new Speicherablage(),
            log: protokoll,
        });
        expect(await frueh.beantworte('raumstand', null)).to.deep.equal({ fehler: 'nichtBereit' });
    });

    it('Stand: Räume in der Folge der App mit Zahl der Karten, Etagen mit ihren Räumen', async () => {
        quelle.etage('eg', etage('Erdgeschoss', 'EG', 0, ['enum.rooms.kueche', 'enum.rooms.weg']));
        const stand = await frage<Raumstand>('raumstand');
        expect(stand.raeume).to.deep.equal([
            { id: 'enum.rooms.kueche', name: 'Küche', karten: 1 },
            { id: 'enum.rooms.bad', name: 'Bad', karten: 0 },
            { id: 'enum.rooms.flur', name: 'Flur', karten: 0 },
        ]);
        expect(stand.etagen).to.deep.equal([
            { id: 'eg', name: 'Erdgeschoss', kurz: 'EG', raeume: ['enum.rooms.kueche'] },
        ]);
        expect(stand.laengen).to.deep.equal({ name: 60, kurz: 8 });
    });

    it('neue Etage kommt nach unten und ist leer; Ändern behält Position und Räume; Unsinn wird abgelehnt', async () => {
        quelle.etage('eg', etage('Erdgeschoss', 'EG', 3, ['enum.rooms.kueche']));
        const neu = await frage<{ id: string; stand: Raumstand }>('speichereEtage', {
            etage: { name: ' Keller ', kurz: 'KG' },
        });
        expect(neu.id).to.match(/^e[0-9a-z]+$/);
        expect(folge(neu.stand)).to.deep.equal([['EG', 'kueche'], ['KG']]);
        const geaendert = await frage<{ stand: Raumstand }>('speichereEtage', {
            id: 'eg',
            etage: { name: 'Parterre', kurz: 'P', position: 9, raeume: [] },
        });
        expect(geaendert.stand.etagen[0]).to.deep.equal({
            id: 'eg',
            name: 'Parterre',
            kurz: 'P',
            raeume: ['enum.rooms.kueche'],
        });
        expect(await frage('speichereEtage', { etage: { name: 'X', kurz: 'ZU_LANG_X' } })).to.have.property(
            'fehler',
            'ungueltig',
        );
        expect(await frage('speichereEtage', { id: 'gibtsnicht', etage: { name: 'X', kurz: 'X' } })).to.deep.equal({
            fehler: 'weg',
        });
    });

    it('Ordnen: Etagen und Räume in der neuen Folge, ein Raum nur einmal, unbekannte Räume fallen weg', async () => {
        quelle
            .etage('eg', etage('Erdgeschoss', 'EG', 0, ['enum.rooms.kueche']))
            .etage('og', etage('Obergeschoss', 'OG', 1, ['enum.rooms.bad']));
        const antwort = await frage<{ stand: Raumstand }>('ordneRaeume', {
            etagen: [
                { id: 'og', raeume: ['enum.rooms.flur', 'enum.rooms.bad', 'enum.rooms.weg'] },
                { id: 'eg', raeume: ['enum.rooms.bad', 'enum.rooms.kueche'] },
            ],
        });
        expect(folge(antwort.stand)).to.deep.equal([
            ['OG', 'flur', 'bad'],
            ['EG', 'kueche'],
        ]);
        expect(quelle.katalog.raeume().map(r => r.id.slice(11))).to.deep.equal(['flur', 'bad', 'kueche']);
        expect(await frage('ordneRaeume', { etagen: [{ id: 'gibtsnicht', raeume: [] }] })).to.deep.equal({
            fehler: 'weg',
        });
        expect(await frage('ordneRaeume', { etagen: 'x' })).to.have.property('fehler', 'ungueltig');
    });

    it('Ordnen ohne eine Etage, die ein anderes Fenster angelegt hat: sie bleibt darunter, ohne doppelte Räume', async () => {
        quelle
            .etage('eg', etage('Erdgeschoss', 'EG', 0, []))
            .etage('og', etage('Obergeschoss', 'OG', 1, ['enum.rooms.bad', 'enum.rooms.flur']));
        const antwort = await frage<{ stand: Raumstand }>('ordneRaeume', {
            etagen: [{ id: 'eg', raeume: ['enum.rooms.bad'] }],
        });
        expect(folge(antwort.stand)).to.deep.equal([
            ['EG', 'bad'],
            ['OG', 'flur'],
        ]);
    });

    it('Löschen: die Räume stehen danach ohne Etage', async () => {
        quelle.etage('eg', etage('Erdgeschoss', 'EG', 0, ['enum.rooms.kueche']));
        const antwort = await frage<{ stand: Raumstand }>('loescheEtage', { id: 'eg' });
        expect(antwort.stand.etagen).to.deep.equal([]);
        expect(quelle.katalog.raeume().every(r => r.etage === undefined)).to.equal(true);
        expect(log.some(z => z.includes('Etage „Erdgeschoss“ (eg) gelöscht'))).to.equal(true);
    });
});
