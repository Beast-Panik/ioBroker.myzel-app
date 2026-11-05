import { expect } from 'chai';
import { NAMESPACE, Speicherablage, Speicherquelle } from '../../test/speicher';
import type { Protokoll } from '../basis/grenzen';
import type { Zeile } from './konfiguration';
import type { Karte, Profil } from './rechte';
import { stelleUm } from './umstellung';

describe('Umstellung auf Karten- und Profilobjekte', () => {
    let quelle: Speicherquelle;
    let ablage: Speicherablage;
    let log: string[];
    const protokoll: Protokoll = {
        debug: () => undefined,
        info: t => log.push(`info ${t}`),
        warn: t => log.push(`warn ${t}`),
        error: t => log.push(`error ${t}`),
    };
    const umstellen = (einstellungen: { karten?: unknown; profile?: Zeile[] } = {}): Promise<void> =>
        stelleUm(NAMESPACE, quelle, einstellungen, ablage, protokoll);
    const da = (id: string): boolean => quelle.get(`${NAMESPACE}.${id}`) !== undefined;
    const karten = (): Record<string, unknown> => Object.fromEntries(ablage.eintraege_.karten);
    const familie: Profil = {
        name: 'Familie',
        raeume: [
            { enum: 'enum.rooms.flur', recht: 'schreiben' },
            { enum: 'enum.rooms.wohnzimmer', recht: 'lesen' },
        ],
        karten: [{ id: 'klima', recht: 'lesen' }],
        gesperrt: ['tuer'],
    };

    beforeEach(() => {
        log = [];
        quelle = new Speicherquelle()
            .raum('wohnzimmer', 'Wohnzimmer', ['zigbee.0.lampe'])
            .raum('flur', 'Flur', ['zigbee.0.flur.helligkeit']);
        ablage = new Speicherablage(quelle);
    });

    it('Karten aus den Einstellungen von 0.3.x werden Objekte, die Einstellungen danach leer', async () => {
        await umstellen({
            karten: [
                {
                    id: 'klima',
                    name: 'Klima',
                    typ: 'messwert',
                    raum: 'enum.rooms.flur',
                    wert1: 'a.temp',
                    wert2: 'a.feuchte',
                    bezeichnung2: 'Feuchte',
                    schalten: null,
                },
                { id: 'tuer', name: 'Tür', typ: 'schalter', raum: '', schalten: 'a.tuer' },
                { id: 'kaputt', name: 'Kaputt', typ: 'schalter', raum: '' },
            ],
        });
        expect(karten()).to.deep.equal({
            klima: {
                name: 'Klima',
                typ: 'messwert',
                raum: 'enum.rooms.flur',
                teile: { wert1: 'a.temp', wert2: 'a.feuchte' },
                bezeichnungen: { wert2: 'Feuchte' },
            },
            tuer: { name: 'Tür', typ: 'schalter', raum: '', teile: { schalten: 'a.tuer' } },
        });
        expect(quelle.get(`${NAMESPACE}.karten.tuer`)?.common.name).to.equal('Tür');
        expect(quelle.katalog.karten().map(([id]) => id)).to.deep.equal(['klima', 'tuer']);
        expect(ablage.geleert).to.equal(true);
        expect(log[0]).to.match(/^warn Karte „Kaputt“ ist unbrauchbar und wird nicht übernommen: .*Zeile: /);
        expect(log.slice(1)).to.deep.equal(['info 2 Karten und 0 Profile als Objekte übernommen']);
    });

    it('Profile aus den Einstellungen von 0.3.x werden Objekte und gelten sofort', async () => {
        await umstellen({
            profile: [
                {
                    id: 'familie',
                    name: 'Familie',
                    raeumeSchreiben: ['enum.rooms.flur'],
                    raeumeLesen: ['enum.rooms.wohnzimmer'],
                    kartenSchreiben: [],
                    kartenLesen: ['klima'],
                    gesperrt: ['tuer'],
                },
                { id: 'leer', name: '' },
            ],
        });
        expect(ablage.profil_('familie')).to.deep.equal(familie);
        expect(quelle.get(`${NAMESPACE}.profile.familie`)?.common.name).to.equal('Familie');
        expect(quelle.katalog.profil('familie')).to.deep.equal(familie);
        expect(da('profile.leer')).to.equal(false);
        expect(ablage.geleert).to.equal(true);
        expect(log[0]).to.match(/^warn Profil „leer“ ist unbrauchbar und wird nicht übernommen: /);
        expect(log.slice(1)).to.deep.equal(['info 0 Karten und 1 Profile als Objekte übernommen']);
    });

    it('macht aus Geräten von 0.1.x Lampenkarten im Raum des ersten Teils und löscht die Geräte', async () => {
        quelle
            .raum('arbeitszimmer', 'Arbeitszimmer', ['zigbee.0.lampe.state'])
            .alt('geraete.wohnzimmerlampe', {
                name: 'Wohnzimmerlampe',
                typ: 'lampe',
                teile: { helligkeit: 'zigbee.0.flur.helligkeit', schalten: 'zigbee.0.lampe.state' },
            })
            .alt('geraete.ohneraum', { name: 'Ohne Raum', typ: 'lampe', teile: { farbe: 'hue.0.farbe' } });
        await umstellen();
        expect(karten()).to.deep.equal({
            ohneraum: { name: 'Ohne Raum', typ: 'lampe', raum: '', teile: { farbe: 'hue.0.farbe' } },
            wohnzimmerlampe: {
                name: 'Wohnzimmerlampe',
                typ: 'lampe',
                raum: 'enum.rooms.arbeitszimmer',
                teile: { schalten: 'zigbee.0.lampe.state', helligkeit: 'zigbee.0.flur.helligkeit' },
            },
        });
        expect(da('geraete.wohnzimmerlampe') || da('geraete.ohneraum')).to.equal(false);
        expect(ablage.geleert).to.equal(false);
        expect(log).to.include.members([
            'info Gerät wohnzimmerlampe ist jetzt eine Lampenkarte',
            'info Gerät ohneraum ist jetzt eine Lampenkarte',
            'info 2 Karten und 0 Profile als Objekte übernommen',
        ]);
    });

    it('Karten- und Profilobjekte aus dem Entwicklungsstand bleiben, wie sie sind', async () => {
        const klima: Karte = {
            name: 'Klima',
            typ: 'messwert',
            raum: 'enum.rooms.flur',
            teile: { wert1: 'a.temp', wert2: 'a.feuchte' },
            bezeichnungen: { wert2: 'Feuchte' },
        };
        quelle.alt('karten.klima', { ...klima }).alt('profile.familie', { ...familie });
        await umstellen();
        expect(ablage.eintraege_.karten.size + ablage.eintraege_.profile.size).to.equal(0);
        expect(quelle.katalog.karte('klima')).to.deep.equal(klima);
        expect(quelle.katalog.profil('familie')).to.deep.equal(familie);
        expect(ablage.geleert).to.equal(false);
        expect(log).to.deep.equal([]);
    });

    it('nimmt Profilen von 0.1.x Freigaben und Sperren von Datenpunkten, warnt nur bei Verlust, lässt Unbrauchbares stehen', async () => {
        const raeume = [{ enum: 'enum.rooms.wohnzimmer', recht: 'schreiben' }];
        const kaputt = { name: '', raeume, freigaben: [], sperren: [] };
        quelle
            .alt('profile.familie', {
                name: 'Familie',
                raeume,
                freigaben: [{ id: 'a.b', recht: 'lesen' }],
                sperren: ['a.c', 'a.d'],
            })
            .alt('profile.kaputt', kaputt)
            .alt('profile.leer', { name: 'Leer', raeume, freigaben: [], sperren: [] });
        await umstellen();
        expect(ablage.profil_('familie')).to.deep.equal({ name: 'Familie', raeume, karten: [], gesperrt: [] });
        expect(ablage.profil_('leer')).to.deep.equal({ name: 'Leer', raeume, karten: [], gesperrt: [] });
        expect(quelle.katalog.alleProfile().map(([id]) => id)).to.deep.equal(['familie', 'leer']);
        expect(ablage.profil_('kaputt')).to.deep.equal(kaputt);
        expect(log).to.deep.equal([
            'warn Profil familie: 1 Freigaben und 2 Sperren von Datenpunkten entfernt, bitte Karten freigeben',
            'info 0 Karten und 2 Profile als Objekte übernommen',
        ]);
    });

    it('ein brauchbares Objekt gewinnt gegen Zeile und Gerät, ein unbrauchbares wird ersetzt', async () => {
        const eigene: Karte = { name: 'Eigene', typ: 'schalter', raum: '', teile: { schalten: 'a.eigen' } };
        await ablage.legeKarte_('lampe', eigene);
        ablage.eintraege_.karten.clear();
        quelle
            .alt('karten.kaputt', { name: '', typ: 'schalter', raum: '', teile: {} })
            .alt('geraete.lampe', { name: 'Lampe', typ: 'lampe', teile: { schalten: 'zigbee.0.lampe.state' } })
            .alt('geraete.leer', { name: 'Leer', typ: 'lampe', teile: { unbekannt: 'a.b' } })
            .alt('geraete.ohnename', { typ: 'lampe', teile: { schalten: 'a.b' } })
            .alt('profile.familie', { ...familie, name: 'Alt' });
        await umstellen({
            karten: [
                { id: 'lampe', name: 'Zeile', typ: 'schalter', raum: '', schalten: 'a.zeile' },
                { id: 'kaputt', name: 'Repariert', typ: 'schalter', raum: '', schalten: 'a.neu' },
            ],
            profile: [{ id: 'familie', name: 'Familie' }],
        });
        expect(karten()).to.deep.equal({
            kaputt: { name: 'Repariert', typ: 'schalter', raum: '', teile: { schalten: 'a.neu' } },
        });
        expect(ablage.karte_('lampe')).to.deep.equal(eigene);
        expect(ablage.profil_('familie')?.name).to.equal('Alt');
        expect(ablage.geleert).to.equal(true);
        expect(da('geraete.lampe')).to.equal(false);
        expect(da('geraete.leer') && da('geraete.ohnename')).to.equal(true);
        expect(log).to.have.members([
            'warn Gerät lampe entfernt, eine Karte mit dieser ID gibt es schon',
            'warn Gerät leer bleibt stehen, es lässt sich nicht in eine Karte umwandeln',
            'warn Gerät ohnename bleibt stehen, es lässt sich nicht in eine Karte umwandeln',
            'info 1 Karten und 0 Profile als Objekte übernommen',
        ]);
    });

    it('nach einem Abbruch zwischen Schreiben und Leeren: der zweite Lauf leert nur noch', async () => {
        const einstellungen = {
            karten: [{ id: 'tuer', name: 'Tür', typ: 'schalter', raum: '', schalten: 'a.tuer' }],
            profile: [{ id: 'gast', name: 'Gast' }],
        };
        await umstellen(einstellungen);
        log = [];
        ablage.geleert = false;
        ablage.eintraege_.karten.clear();
        ablage.eintraege_.profile.clear();
        await umstellen(einstellungen);
        expect(ablage.geleert).to.equal(true);
        expect(ablage.eintraege_.karten.size + ablage.eintraege_.profile.size).to.equal(0);
        expect(log).to.deep.equal([]);
    });

    it('ohne Altes geschieht nichts, auch nicht mit leeren Listen in den Einstellungen', async () => {
        await umstellen();
        await umstellen({ karten: [], profile: [] });
        expect(ablage.geleert).to.equal(false);
        expect(karten()).to.deep.equal({});
        expect(log).to.deep.equal([]);
    });
});
