import { expect } from 'chai';
import { NAMESPACE, Speicherablage, Speicherquelle } from '../../test/speicher';
import { KARTENARTEN, KARTENTYPEN, KARTEN_HOECHSTENS, type Karte } from '../app/rechte';
import type { Protokoll } from '../basis/grenzen';
import type { Ablehnung } from './eintraege';
import type { Vorschlag } from '../app/erkennung';
import { type Anlage, type Kartenstand, Kartenseite, type Treffer, type Vorschlagstand } from './kartenseite';

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

    describe('Vorschläge aus der Erkennung', () => {
        let gelesen: number;
        const lampe = (id: string, rolle: string, typ: string, mehr: object = {}): [string, ioBroker.Object] => [
            id,
            {
                _id: id,
                type: 'state',
                common: {
                    name: id.slice(id.lastIndexOf('.') + 1),
                    role: rolle,
                    type: typ,
                    read: true,
                    write: true,
                    ...mehr,
                },
                native: {},
            } as unknown as ioBroker.Object,
        ];
        const objekte = (): Record<string, ioBroker.Object> => ({
            'z.0.lampe': {
                _id: 'z.0.lampe',
                type: 'device',
                common: { name: 'Stehlampe' },
                native: {},
            },
            ...Object.fromEntries([
                lampe('z.0.lampe.an', 'switch.light', 'boolean'),
                lampe('z.0.lampe.hell', 'level.dimmer', 'number', { min: 0, max: 100 }),
            ]),
        });
        const mitErkennung = (): Kartenseite =>
            new Kartenseite({
                namespace: NAMESPACE,
                katalog: () => quelle.katalog,
                ablage,
                log: protokoll,
                jetzt: () => zeit,
                alleObjekte: () => {
                    gelesen++;
                    return Promise.resolve(objekte());
                },
            });
        const stehlampe: Vorschlag = {
            herkunft: ['z.0.lampe'],
            zuordnung: ['z.0.lampe'],
            bleibt: [],
            karte: {
                name: 'Stehlampe',
                typ: 'lampe',
                raum: 'enum.rooms.kueche',
                teile: { schalten: 'z.0.lampe.an', helligkeit: 'z.0.lampe.hell' },
            },
        };

        beforeEach(() => {
            gelesen = 0;
            quelle
                .raum('kueche', { de: 'Küche', en: 'Kitchen' }, ['z.0.lampe'])
                .datenpunkt('z.0.lampe.an', { type: 'boolean', name: 'An' })
                .datenpunkt('z.0.lampe.hell', { type: 'number', name: 'Helligkeit', min: 0, max: 100 });
        });

        it('erkennt erst auf Anfrage, gilt 60 s, frisch auf Wunsch; ohne Zugang zu den Objekten keine', async () => {
            const s = mitErkennung();
            const erste = (await s.beantworte('vorschlaege', {})) as Vorschlagstand;
            expect(erste).to.deep.equal({
                vorschlaege: [stehlampe],
                namen: { 'z.0.lampe.an': 'An', 'z.0.lampe.hell': 'Helligkeit' },
            });
            await s.beantworte('vorschlaege', {});
            expect(gelesen).to.equal(1);
            await s.beantworte('vorschlaege', { frisch: true });
            expect(gelesen).to.equal(2);
            zeit += 60_001;
            await s.beantworte('vorschlaege', null);
            expect(gelesen).to.equal(3);
            expect(await frage('vorschlaege')).to.deep.equal({ vorschlaege: [], namen: {} });
        });

        it('legt jede Karte für sich an, Ergebnisse in der Reihenfolge der Anfrage; danach kein Vorschlag mehr', async () => {
            const s = mitErkennung();
            const ohneName = { ...stehlampe.karte, name: ' ' };
            const antwort = (await s.beantworte('legeKartenAn', {
                karten: [stehlampe.karte, ohneName],
            })) as Anlage;
            const id = `k${zeit.toString(36)}`;
            expect(antwort.ergebnisse[0]).to.deep.equal({ id });
            expect((antwort.ergebnisse[1] as Ablehnung).fehler).to.equal('ungueltig');
            expect(antwort.stand.karten.map(k => k.name)).to.deep.equal(['Stehlampe']);
            expect(ablage.karte_(id)).to.deep.equal(stehlampe.karte);
            expect(log).to.deep.equal([`Karte „Stehlampe“ (${id}) gespeichert`]);
            const danach = (await s.beantworte('vorschlaege', {})) as Vorschlagstand;
            expect(danach.vorschlaege).to.deep.equal([]);
        });

        describe('Raum in ioBroker', () => {
            let aufrufe: string[];
            let scheitert: boolean;
            // Wie ioBroker: Der Katalog sieht die neuen Mitglieder gleich
            const mitRaeumen = (): Kartenseite =>
                new Kartenseite({
                    namespace: NAMESPACE,
                    katalog: () => quelle.katalog,
                    ablage,
                    log: protokoll,
                    jetzt: () => zeit,
                    alleObjekte: () => Promise.resolve(objekte()),
                    aendereRaum: (raum, aendere) => {
                        aufrufe.push(raum);
                        if (scheitert) {
                            return Promise.reject(new Error('kein Zugriff'));
                        }
                        const r = quelle.katalog.raeume().find(x => x.id === raum)!;
                        const neu = aendere(r.mitglieder);
                        quelle.raum(raum.slice('enum.rooms.'.length), r.name, neu);
                        return Promise.resolve(neu.join() !== r.mitglieder.join());
                    },
                });
            const mitglieder = (): Record<string, string[]> =>
                Object.fromEntries(quelle.katalog.raeume().map(r => [r.id.slice('enum.rooms.'.length), r.mitglieder]));
            const lege = async (raum: string): Promise<Anlage['ergebnisse'][number]> =>
                ((await mitRaeumen().beantworte('legeKartenAn', { karten: [{ ...stehlampe.karte, raum }] })) as Anlage)
                    .ergebnisse[0];

            beforeEach(() => {
                aufrufe = [];
                scheitert = false;
                quelle.raum('bad', 'Bad', ['z.0.lampe.an', 'y.0']).raum('flur', 'Flur', ['x.0']);
            });

            it('verschiebt die Herkunft des Vorschlags: in den neuen Raum, samt allem darunter aus den anderen', async () => {
                expect(await lege('enum.rooms.flur')).to.deep.equal({ id: `k${zeit.toString(36)}` });
                expect(mitglieder()).to.deep.equal({ kueche: [], bad: ['y.0'], flur: ['x.0', 'z.0.lampe'] });
                expect(log[1]).to.equal(
                    '„Stehlampe“ in ioBroker jetzt in Flur, nicht mehr in Bad, nicht mehr in Kitchen (z.0.lampe)',
                );
            });

            it('nimmt sie mit „Ohne Raum“ aus allen Räumen', async () => {
                await lege('');
                expect(mitglieder()).to.deep.equal({ kueche: [], bad: ['y.0'], flur: ['x.0'] });
            });

            it('schreibt nichts beim Raum aus ioBroker oder einem Raum, den es nicht gibt', async () => {
                // Bad steht in der Folge vor Küche und enthält einen Datenpunkt der Lampe
                await lege('enum.rooms.bad');
                zeit += 1;
                await lege('enum.rooms.keller');
                expect(aufrufe).to.deep.equal([]);
                expect(mitglieder().kueche).to.deep.equal(['z.0.lampe']);
            });

            it('legt die Karte auch an, wenn ioBroker den Raum nicht übernimmt, und sagt es', async () => {
                scheitert = true;
                expect(await lege('enum.rooms.flur')).to.deep.equal({
                    id: `k${zeit.toString(36)}`,
                    raum: 'gescheitert',
                });
                expect(ablage.karte_(`k${zeit.toString(36)}`)?.raum).to.equal('enum.rooms.flur');
                expect(log[1]).to.equal(
                    'warn Raum für „Stehlampe“ in ioBroker nicht übernommen (z.0.lampe): kein Zugriff',
                );
            });
        });

        it('lehnt anderes als eine Liste ab, auch eine zu lange', async () => {
            const s = mitErkennung();
            for (const karten of [undefined, 'x', { a: 1 }, new Array(KARTEN_HOECHSTENS + 1).fill(schalter)]) {
                expect(await s.beantworte('legeKartenAn', { karten })).to.deep.equal({
                    fehler: 'ungueltig',
                    einzelheiten: ['karten'],
                });
            }
            expect(ablage.eintraege_.karten.size).to.equal(0);
        });
    });
});
