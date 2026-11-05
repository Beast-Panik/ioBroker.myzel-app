import { expect } from 'chai';
import { NAMESPACE, Speicherablage, Speicherquelle } from '../../test/speicher';
import type { Protokoll } from '../basis/grenzen';
import type { Zeile } from './konfiguration';
import { type Uebernommen, stelleUm } from './umstellung';

describe('Umstellung auf Karten und Profile in den Instanzeinstellungen', () => {
    let quelle: Speicherquelle;
    let ablage: Speicherablage;
    let log: string[];
    const protokoll: Protokoll = {
        debug: () => undefined,
        info: t => log.push(`info ${t}`),
        warn: t => log.push(`warn ${t}`),
        error: t => log.push(`error ${t}`),
    };
    const umstellen = (einstellungen: { karten?: Zeile[]; profile?: Zeile[] } = {}): Promise<Uebernommen> =>
        stelleUm(NAMESPACE, quelle, einstellungen, ablage, protokoll);
    const da = (id: string): boolean => quelle.get(`${NAMESPACE}.${id}`) !== undefined;

    beforeEach(() => {
        log = [];
        quelle = new Speicherquelle()
            .raum('wohnzimmer', 'Wohnzimmer', ['zigbee.0.lampe'])
            .raum('flur', 'Flur', ['zigbee.0.flur.helligkeit']);
        ablage = new Speicherablage(quelle);
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
        expect(await umstellen()).to.deep.equal(ablage.einstellungen);
        expect(ablage.einstellungen.karten).to.have.deep.members([
            {
                id: 'wohnzimmerlampe',
                name: 'Wohnzimmerlampe',
                typ: 'lampe',
                raum: 'enum.rooms.arbeitszimmer',
                schalten: 'zigbee.0.lampe.state',
                helligkeit: 'zigbee.0.flur.helligkeit',
            },
            { id: 'ohneraum', name: 'Ohne Raum', typ: 'lampe', raum: '', farbe: 'hue.0.farbe' },
        ]);
        expect(da('geraete.wohnzimmerlampe') || da('geraete.ohneraum')).to.equal(false);
        expect(log).to.include.members([
            'info Gerät wohnzimmerlampe ist jetzt eine Lampenkarte',
            'info Gerät ohneraum ist jetzt eine Lampenkarte',
            'info 2 Karten und 0 Profile in die Instanzeinstellungen übernommen',
        ]);
    });

    it('übernimmt Karten- und Profilobjekte aus dem Entwicklungsstand von 0.2.0 samt Bezeichnungen und Rechten', async () => {
        quelle
            .alt('karten.klima', {
                name: 'Klima',
                typ: 'messwert',
                raum: 'enum.rooms.flur',
                teile: { wert1: 'a.temp', wert2: 'a.feuchte' },
                bezeichnungen: { wert2: 'Feuchte' },
            })
            .alt('profile.familie', {
                name: 'Familie',
                raeume: [
                    { enum: 'enum.rooms.flur', recht: 'schreiben' },
                    { enum: 'enum.rooms.wohnzimmer', recht: 'lesen' },
                ],
                karten: [{ id: 'klima', recht: 'lesen' }],
                gesperrt: ['tuer'],
            });
        expect(await umstellen()).to.deep.equal(ablage.einstellungen);
        expect(ablage.einstellungen.karten).to.deep.equal([
            {
                id: 'klima',
                name: 'Klima',
                typ: 'messwert',
                raum: 'enum.rooms.flur',
                wert1: 'a.temp',
                wert2: 'a.feuchte',
                bezeichnung2: 'Feuchte',
            },
        ]);
        expect(ablage.einstellungen.profile).to.deep.equal([
            {
                id: 'familie',
                name: 'Familie',
                raeumeSchreiben: ['enum.rooms.flur'],
                raeumeLesen: ['enum.rooms.wohnzimmer'],
                kartenSchreiben: [],
                kartenLesen: ['klima'],
                gesperrt: ['tuer'],
            },
        ]);
        expect(da('karten.klima') || da('profile.familie')).to.equal(false);
    });

    it('nimmt Profilen von 0.1.x Freigaben und Sperren von Datenpunkten, warnt nur bei Verlust, lässt Unbrauchbares stehen', async () => {
        const raeume = [{ enum: 'enum.rooms.wohnzimmer', recht: 'schreiben' }];
        quelle
            .alt('profile.familie', {
                name: 'Familie',
                raeume,
                freigaben: [{ id: 'a.b', recht: 'lesen' }],
                sperren: ['a.c', 'a.d'],
            })
            .alt('profile.kaputt', { name: '', raeume, freigaben: [], sperren: [] })
            .alt('profile.leer', { name: 'Leer', raeume, freigaben: [], sperren: [] });
        await umstellen();
        expect(ablage.einstellungen.profile.map(p => [p.id, p.raeumeSchreiben])).to.deep.equal([
            ['familie', ['enum.rooms.wohnzimmer']],
            ['leer', ['enum.rooms.wohnzimmer']],
        ]);
        expect(da('profile.kaputt')).to.equal(true);
        expect(log).to.include(
            'warn Profil familie: 1 Freigaben und 2 Sperren von Datenpunkten entfernt, bitte Karten freigeben',
        );
        expect(log).to.include('warn Profilobjekt kaputt bleibt stehen, es ist unbrauchbar und gibt keine Rechte');
        expect(log.filter(z => z.startsWith('warn'))).to.have.length(2);
    });

    it('eine ID aus den Einstellungen gewinnt; unbrauchbare Geräte bleiben stehen', async () => {
        quelle
            .alt('geraete.lampe', { name: 'Lampe', typ: 'lampe', teile: { schalten: 'zigbee.0.lampe.state' } })
            .alt('geraete.leer', { name: 'Leer', typ: 'lampe', teile: { unbekannt: 'a.b' } })
            .alt('geraete.ohnename', { typ: 'lampe', teile: { schalten: 'a.b' } });
        expect(await umstellen({ karten: [{ id: 'lampe', name: 'Eigene', typ: 'schalter' }] })).to.deep.equal({
            karten: [],
            profile: [],
        });
        expect(ablage.einstellungen.karten).to.deep.equal([]);
        expect(da('geraete.lampe')).to.equal(false);
        expect(da('geraete.leer') && da('geraete.ohnename')).to.equal(true);
        expect(log).to.have.members([
            'warn Gerät lampe entfernt, eine Karte mit dieser ID gibt es schon',
            'warn Gerät leer bleibt stehen, es lässt sich nicht in eine Karte umwandeln',
            'warn Gerät ohnename bleibt stehen, es lässt sich nicht in eine Karte umwandeln',
        ]);
    });

    it('nach einem Abbruch zwischen Schreiben und Löschen: der zweite Lauf löscht nur noch, ohne Neustart', async () => {
        quelle
            .alt('karten.lampe', { name: 'Lampe', typ: 'schalter', raum: '', teile: { schalten: 'a.b' } })
            .alt('profile.familie', { name: 'Familie', raeume: [], karten: [], gesperrt: [] });
        expect(
            await umstellen({
                karten: [{ id: 'lampe', name: 'Lampe' }],
                profile: [{ id: 'familie', name: 'Familie' }],
            }),
        ).to.deep.equal({ karten: [], profile: [] });
        expect(ablage.einstellungen).to.deep.equal({ karten: [], profile: [] });
        expect(da('karten.lampe') || da('profile.familie')).to.equal(false);
        expect(log).to.deep.equal([]);
    });

    it('ohne alte Objekte geschieht nichts', async () => {
        expect(await umstellen()).to.deep.equal({ karten: [], profile: [] });
        expect(ablage.einstellungen).to.deep.equal({ karten: [], profile: [] });
        expect(log).to.deep.equal([]);
    });
});
