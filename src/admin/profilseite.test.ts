import { expect } from 'chai';
import { NAMESPACE, Speicherablage, Speicherquelle } from '../../test/speicher';
import type { AppDaten } from '../app/objekte';
import type { Profil } from '../app/rechte';
import type { Protokoll } from '../basis/grenzen';
import type { Ablehnung } from './eintraege';
import { type Profilstand, Profilseite } from './profilseite';

describe('Profilseite', () => {
    let quelle: Speicherquelle;
    let ablage: Speicherablage;
    let seite: Profilseite;
    let zeit: number;
    let log: string[];
    const protokoll: Protokoll = {
        debug: () => undefined,
        info: t => log.push(t),
        warn: t => log.push(`warn ${t}`),
        error: t => log.push(`error ${t}`),
    };
    const familie: Profil = {
        name: 'Familie',
        raeume: [{ enum: 'enum.rooms.kueche', recht: 'schreiben' }],
        karten: [{ id: 'anruf', recht: 'lesen' }],
        gesperrt: ['flur'],
    };
    const app = (name: string, profil: string): AppDaten => ({
        name,
        zugangHash: '0'.repeat(64),
        profil,
        handydaten: { akku: false, anruf: false, benachrichtigung: false },
        gekoppeltAm: 1,
        geraet: { android: '15', appVersion: '0.4.1' },
    });

    beforeEach(async () => {
        log = [];
        zeit = 1_793_870_000_000;
        quelle = new Speicherquelle()
            .raum('kueche', { de: 'Küche', en: 'Kitchen' }, [])
            .raum('flur', 'Flur', [])
            .datenpunkt('z.0.herd.an', { type: 'boolean', name: 'Herd an' })
            .datenpunkt('z.0.fenster', { type: 'boolean', name: 'Fenster', write: false })
            .datenpunkt(`${NAMESPACE}.apps.abcdefgh.anruf.status`, { type: 'string', write: false })
            .karte('herd', {
                name: 'Herd',
                typ: 'schalter',
                raum: 'enum.rooms.kueche',
                teile: { schalten: 'z.0.herd.an' },
            })
            .karte('fenster', {
                name: 'Fenster',
                typ: 'messwert',
                raum: 'enum.rooms.kueche',
                teile: { wert1: 'z.0.fenster' },
            })
            .karte('flur', { name: 'Flur', typ: 'schalter', raum: 'enum.rooms.flur', teile: { schalten: 'z.0.weg' } })
            .karte('anruf', {
                name: 'Anruf',
                typ: 'messwert',
                raum: 'enum.rooms.kueche',
                teile: { wert1: `${NAMESPACE}.apps.abcdefgh.anruf.status` },
            });
        ablage = new Speicherablage(quelle);
        await ablage.lege('tablet', app('Tablet', 'familie'));
        await ablage.lege('handy', app('Handy', 'familie'));
        await ablage.lege('ohne', app('Ohne', ''));
        seite = new Profilseite({
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
        expect(await frage('profilseite')).to.equal('adapter/myzel-app/profile.html?instanz=myzel-app.0');
        const frueh = new Profilseite({ namespace: NAMESPACE, katalog: () => undefined, ablage, log: protokoll });
        expect(await frueh.beantworte('profilstand', null)).to.deep.equal({ fehler: 'nichtBereit' });
        expect(await frage('unbekannt')).to.equal(undefined);
    });

    it('Stand: Räume, Karten mit dem, was sie im Profil ausmacht, Profile mit Sicht und Apps', async () => {
        quelle.profil('familie', familie).profil('gast', { ...familie, name: 'Gast', karten: [], gesperrt: [] });
        quelle.katalog.sprache = 'de';
        const stand = await frage<Profilstand>('profilstand');
        expect(stand.raeume).to.deep.equal([
            { id: 'enum.rooms.flur', name: 'Flur' },
            { id: 'enum.rooms.kueche', name: 'Küche' },
        ]);
        expect(stand.karten.map(k => [k.id, k.persoenlich, k.fehlt])).to.deep.equal([
            ['anruf', true, false],
            ['fenster', false, false],
            ['flur', false, true],
            ['herd', false, false],
        ]);
        expect(stand.profile.map(p => [p.id, p.sieht, p.apps])).to.deep.equal([
            ['familie', { anruf: 'lesen', fenster: 'lesen', herd: 'schreiben' }, ['Handy', 'Tablet']],
            ['gast', { fenster: 'lesen', herd: 'schreiben' }, []],
        ]);
        expect(stand.profile[0]).to.deep.include(familie);
        expect(stand.laengen.name).to.equal(60);
    });

    it('Vorschau: was eine App mit dem Entwurf sähe, auch ohne Namen; Unsinn wird abgelehnt', async () => {
        const entwurf = { raeume: [{ enum: 'enum.rooms.kueche', recht: 'lesen' }], karten: [], gesperrt: ['fenster'] };
        expect(await frage('profilvorschau', { profil: entwurf })).to.deep.equal({ sieht: { herd: 'lesen' } });
        const kaputt = await frage<Ablehnung>('profilvorschau', { profil: { ...entwurf, raeume: 'alle' } });
        expect(kaputt.fehler).to.equal('ungueltig');
        expect(log).to.deep.equal([]);
    });

    it('neues Profil: eigene ID aus der Zeit, nur die Felder eines Profils, sofort im Katalog, Stand zurück', async () => {
        const antwort = await frage<{ id: string; stand: Profilstand }>('speichereProfil', {
            profil: {
                name: '  Gäste ',
                raeume: [{ enum: 'enum.rooms.flur', recht: 'lesen', mehr: 1 }],
                karten: [],
                gesperrt: [],
                freigaben: [{ id: 'a.b', recht: 'lesen' }],
            },
        });
        const profil = {
            name: 'Gäste',
            raeume: [{ enum: 'enum.rooms.flur', recht: 'lesen' }],
            karten: [],
            gesperrt: [],
        };
        expect(antwort.id).to.equal(`p${zeit.toString(36)}`);
        expect(ablage.profil_(antwort.id)).to.deep.equal(profil);
        expect(quelle.get(`${NAMESPACE}.profile.${antwort.id}`)?.common.name).to.equal('Gäste');
        expect(quelle.katalog.profil(antwort.id)).to.deep.equal(profil);
        expect(antwort.stand.profile.map(p => p.id)).to.deep.equal([antwort.id]);
        expect(log).to.deep.equal([`Profil „Gäste“ (${antwort.id}) gespeichert`]);
    });

    it('ändern ersetzt das Profil ganz und gilt sofort; ein unbekanntes ist weg', async () => {
        await ablage.legeProfil_('familie', familie);
        const neu = { ...familie, raeume: [], karten: [], gesperrt: [] };
        expect(await frage('speichereProfil', { id: 'familie', profil: neu })).to.have.property('id', 'familie');
        expect(ablage.profil_('familie')).to.deep.equal(neu);
        expect(quelle.katalog.profil('familie')).to.deep.equal(neu);
        expect(await frage('speichereProfil', { id: 'nichtda', profil: neu })).to.deep.equal({ fehler: 'weg' });
        expect(await frage('speichereProfil', { id: '../x', profil: neu })).to.deep.equal({ fehler: 'weg' });
        expect(ablage.profil_('nichtda')).to.equal(undefined);
    });

    it('lehnt Ungültiges mit Einzelheiten ab und schreibt nichts', async () => {
        for (const profil of [
            { ...familie, name: ' ' },
            { ...familie, name: 'x'.repeat(61) },
            { ...familie, raeume: [{ enum: 'enum.functions.licht', recht: 'lesen' }] },
            { ...familie, karten: [{ id: 'herd', recht: 'alles' }] },
            { ...familie, gesperrt: ['Gross'] },
            'kaputt',
            null,
        ]) {
            const antwort = await frage<Ablehnung>('speichereProfil', { profil });
            expect(antwort.fehler, JSON.stringify(profil)).to.equal('ungueltig');
            expect(antwort.einzelheiten).to.be.an('array').that.is.not.empty;
        }
        expect(ablage.eintraege_.profile.size).to.equal(0);
        expect(log).to.deep.equal([]);
    });

    it('löschen: Objekt und Katalog sofort, Apps behalten den Verweis und sehen nichts mehr', async () => {
        await ablage.legeProfil_('familie', familie);
        const antwort = await frage<{ stand: Profilstand }>('loescheProfil', { id: 'familie' });
        expect(antwort.stand.profile).to.deep.equal([]);
        expect(ablage.profil_('familie')).to.equal(undefined);
        expect(quelle.katalog.profil('familie')).to.equal(undefined);
        expect((await ablage.lies('tablet'))?.profil).to.equal('familie');
        expect(log).to.deep.equal(['Profil „Familie“ (familie) gelöscht']);
        expect(await frage('loescheProfil', { id: 'familie' })).to.deep.equal({ fehler: 'weg' });
        expect(await frage('loescheProfil', null)).to.deep.equal({ fehler: 'weg' });
    });
});
