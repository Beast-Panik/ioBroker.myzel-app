import { expect } from 'chai';
import { NAMESPACE, Speicherablage, Speicherquelle } from '../../test/speicher';
import { KARTENARTEN, KARTENTYPEN, KARTEN_HOECHSTENS, type Karte } from '../app/rechte';
import type { Protokoll } from '../basis/grenzen';
import type { Ablehnung } from './eintraege';
import { type Kartenstand, Kartenseite, type Treffer } from './kartenseite';

describe('Kartenseite', () => {
    let quelle: Speicherquelle;
    let ablage: Speicherablage;
    let seite: Kartenseite;
    let zeit: number;
    let log: string[];
    const protokoll: Protokoll = {
        debug: () => undefined,
        info: t => log.push(t),
        warn: t => log.push(`warn ${t}`),
        error: t => log.push(`error ${t}`),
    };
    const schalter: Karte = {
        name: 'Herd',
        typ: 'schalter',
        raum: 'enum.rooms.kueche',
        teile: { schalten: 'z.0.herd.an' },
    };

    beforeEach(() => {
        log = [];
        zeit = 1_793_870_000_000;
        quelle = new Speicherquelle()
            .raum('kueche', { de: 'Küche', en: 'Kitchen' }, [])
            .raum('bad', 'Bad', [])
            .datenpunkt('z.0.herd.an', { type: 'boolean', name: { de: 'Herd an', en: 'Stove on' } })
            .datenpunkt('z.0.herd.leistung', { type: 'number', name: 'Leistung', unit: 'W' })
            .datenpunkt('z.0.flur.an', { type: 'boolean', name: 'Flurlicht' })
            .datenpunkt('system.adapter.admin.0.alive', { type: 'boolean', name: 'alive' });
        ablage = new Speicherablage(quelle);
        seite = new Kartenseite({
            namespace: NAMESPACE,
            katalog: () => quelle.katalog,
            ablage,
            log: protokoll,
            jetzt: () => zeit,
        });
    });

    const frage = <T>(befehl: string, nachricht: unknown = {}): Promise<T> =>
        seite.beantworte(befehl, nachricht) as Promise<T>;

    it('nennt dem Admin die Adresse der Seite mit der Instanz; vor dem Start ist sie nicht bereit', async () => {
        expect(await frage('kartenseite')).to.equal('adapter/myzel-app/karten.html?instanz=myzel-app.0');
        const frueh = new Kartenseite({ namespace: NAMESPACE, katalog: () => undefined, ablage, log: protokoll });
        expect(await frueh.beantworte('kartenseite', null)).to.equal(
            'adapter/myzel-app/karten.html?instanz=myzel-app.0',
        );
        expect(await frueh.beantworte('kartenstand', null)).to.deep.equal({ fehler: 'nichtBereit' });
        expect(await frage('unbekannt')).to.equal(undefined);
    });

    it('Stand: Räume in der Systemsprache, Karten mit Mängeln je Teil, Arten wie im Adapter, Namen der Datenpunkte', async () => {
        await ablage.legeKarte_('herd', schalter);
        await ablage.legeKarte_('flur', {
            name: 'Flur',
            typ: 'lampe',
            raum: '',
            teile: { schalten: 'z.0.flur.an', helligkeit: 'z.0.herd.an' },
        });
        await ablage.legeKarte_('weg', { name: 'Weg', typ: 'schalter', raum: '', teile: { schalten: 'z.0.weg' } });
        quelle.katalog.sprache = 'de';
        const stand = await frage<Kartenstand>('kartenstand');
        expect(stand.sprache).to.equal('de');
        expect(stand.raeume).to.deep.equal([
            { id: 'enum.rooms.bad', name: 'Bad' },
            { id: 'enum.rooms.kueche', name: 'Küche' },
        ]);
        expect(stand.karten.map(k => [k.id, k.maengel])).to.deep.equal([
            [
                'flur',
                { teile: { helligkeit: { art: 'typ', ist: 'boolean', erwartet: ['number'] } }, folge: 'teilweise' },
            ],
            ['herd', { teile: {} }],
            ['weg', { teile: { schalten: { art: 'fehlt' } }, folge: 'fehlt' }],
        ]);
        expect(stand.karten[1]).to.deep.include({ ...schalter, id: 'herd' });
        expect(stand.namen).to.deep.equal({ 'z.0.flur.an': 'Flurlicht', 'z.0.herd.an': 'Stove on' });
        expect(Object.keys(stand.arten)).to.deep.equal(KARTENTYPEN);
        expect(stand.arten.messwert.bezeichnungen).to.equal(true);
        expect(stand.arten.thermostat.pflicht).to.deep.equal(['soll']);
        expect(stand.arten.lampe.teile.map(t => t.teil)).to.deep.equal(Object.keys(KARTENARTEN.lampe.teile));
        expect(stand.hoechstens).to.equal(KARTEN_HOECHSTENS);
    });

    it('Datenpunkte suchen: passender Typ, jedes Wort in ID oder Name, nie unter system, nach ID', async () => {
        const suche = (n: object): Promise<{ treffer: Treffer[]; mehr: boolean }> => frage('datenpunkte', n);
        const ids = async (n: object): Promise<string[]> => (await suche(n)).treffer.map(t => t.id);
        expect(await ids({ typ: 'schalter', teil: 'schalten', suche: '' })).to.deep.equal([
            'z.0.flur.an',
            'z.0.herd.an',
        ]);
        expect(await ids({ typ: 'schalter', teil: 'schalten', suche: 'HERD  z.0' })).to.deep.equal(['z.0.herd.an']);
        expect(await ids({ typ: 'schalter', teil: 'schalten', suche: 'flurlicht' })).to.deep.equal(['z.0.flur.an']);
        expect(await ids({ typ: 'schalter', teil: 'schalten', suche: 'alive' })).to.deep.equal([]);
        expect(await suche({ typ: 'thermostat', teil: 'ist', suche: 'leistung' })).to.deep.equal({
            treffer: [{ id: 'z.0.herd.leistung', name: 'Leistung', typ: 'number', einheit: 'W' }],
            mehr: false,
        });
        expect(await ids({ typ: 'schalter', teil: 'helligkeit' })).to.deep.equal([]);
        expect(await ids({ typ: 'rollladen', teil: 'schalten' })).to.deep.equal([]);
        for (let i = 0; i < 120; i++) {
            quelle.datenpunkt(`viele.0.n${String(i).padStart(3, '0')}`, { type: 'boolean' });
        }
        const viele = await suche({ typ: 'schalter', teil: 'schalten', suche: 'viele' });
        expect(viele.treffer).to.have.length(100);
        expect(viele.treffer[0].id).to.equal('viele.0.n000');
        expect(viele.mehr).to.equal(true);
    });

    it('neue Karte: eigene ID aus der Zeit, bereinigt, sofort im Katalog, Stand zurück', async () => {
        const antwort = await frage<{ id: string; stand: Kartenstand }>('speichereKarte', {
            karte: {
                name: '  Klima ',
                typ: 'messwert',
                raum: 'enum.rooms.bad',
                teile: { wert1: 'z.0.herd.leistung', wert2: ' ', wert3: 'a.feuchte', schalten: 'z.0.herd.an' },
                bezeichnungen: { wert1: ' Leistung ', wert2: 'ohne Teil', wert3: '' },
            },
        });
        const karte = {
            name: 'Klima',
            typ: 'messwert',
            raum: 'enum.rooms.bad',
            teile: { wert1: 'z.0.herd.leistung', wert3: 'a.feuchte' },
            bezeichnungen: { wert1: 'Leistung' },
        };
        expect(antwort.id).to.equal(`k${zeit.toString(36)}`);
        expect(ablage.karte_(antwort.id)).to.deep.equal(karte);
        expect(quelle.katalog.karte(antwort.id)).to.deep.equal(karte);
        expect(antwort.stand.karten.map(k => k.id)).to.deep.equal([antwort.id]);
        expect(log).to.deep.equal([`Karte „Klima“ (${antwort.id}) gespeichert`]);
        const zweite = await frage<{ id: string }>('speichereKarte', { karte: schalter });
        expect(zweite.id).to.equal(`k${(zeit + 1).toString(36)}`);
    });

    it('ändern: ersetzt die Karte ganz, auch beim Typwechsel; eine gelöschte Karte ist weg', async () => {
        await ablage.legeKarte_('herd', schalter);
        const lampe = { name: 'Herdlicht', typ: 'lampe', raum: '', teile: { helligkeit: 'z.0.herd.leistung' } };
        expect(await frage('speichereKarte', { id: 'herd', karte: lampe })).to.have.property('id', 'herd');
        expect(ablage.karte_('herd')).to.deep.equal(lampe);
        expect(quelle.katalog.karte('herd')).to.deep.equal(lampe);
        expect(await frage('speichereKarte', { id: 'nichtda', karte: lampe })).to.deep.equal({ fehler: 'weg' });
        expect(await frage('speichereKarte', { id: 'Gross', karte: lampe })).to.deep.equal({ fehler: 'weg' });
        expect(ablage.karte_('nichtda')).to.equal(undefined);
    });

    it('lehnt Ungültiges mit Einzelheiten ab und schreibt nichts', async () => {
        for (const karte of [
            { ...schalter, name: '   ' },
            { ...schalter, typ: 'rollladen' },
            { ...schalter, teile: {} },
            { ...schalter, raum: 'enum.functions.licht' },
            { name: 'Heizung', typ: 'thermostat', raum: '', teile: { ist: 'z.0.herd.leistung' } },
            'kaputt',
            null,
        ]) {
            const antwort = await frage<Ablehnung>('speichereKarte', { karte });
            expect(antwort.fehler, JSON.stringify(karte)).to.equal('ungueltig');
            expect(antwort.einzelheiten).to.be.an('array').that.is.not.empty;
        }
        expect(ablage.eintraege_.karten.size).to.equal(0);
        expect(log).to.deep.equal([]);
    });

    it('höchstens so viele Karten wie die App annimmt; vorhandene lassen sich weiter ändern', async () => {
        for (let i = 0; i < KARTEN_HOECHSTENS; i++) {
            quelle.karte(`k${i}`, schalter);
        }
        await ablage.legeKarte_('k0', schalter);
        expect(await frage('speichereKarte', { karte: schalter })).to.deep.equal({ fehler: 'zuViele' });
        expect(await frage('speichereKarte', { id: 'k0', karte: { ...schalter, name: 'Neu' } })).to.have.property(
            'id',
            'k0',
        );
    });

    it('eine ID, die es schon gibt, wird nicht noch einmal vergeben', async () => {
        await ablage.legeKarte_(`k${zeit.toString(36)}`, schalter);
        quelle.karte(`k${(zeit + 1).toString(36)}`, schalter);
        expect(await frage('speichereKarte', { karte: schalter })).to.have.property(
            'id',
            `k${(zeit + 2).toString(36)}`,
        );
    });

    it('löschen: Objekt und Katalog sofort, Unbekanntes ist weg', async () => {
        await ablage.legeKarte_('herd', schalter);
        const antwort = await frage<{ stand: Kartenstand }>('loescheKarte', { id: 'herd' });
        expect(antwort.stand.karten).to.deep.equal([]);
        expect(ablage.karte_('herd')).to.equal(undefined);
        expect(quelle.katalog.karte('herd')).to.equal(undefined);
        expect(log).to.deep.equal(['Karte „Herd“ (herd) gelöscht']);
        expect(await frage('loescheKarte', { id: 'herd' })).to.deep.equal({ fehler: 'weg' });
        expect(await frage('loescheKarte', { id: '../x' })).to.deep.equal({ fehler: 'weg' });
        expect(await frage('loescheKarte', null)).to.deep.equal({ fehler: 'weg' });
    });
});
