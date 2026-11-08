import { expect } from 'chai';
import appAnAdapter from '../../protokoll/v1/app-an-adapter.schema.json';
import type { AppDaten } from './objekte';
import {
    GRUENDE,
    type Zone,
    grundText,
    handydatenFuer,
    istZonenId,
    liesMitte,
    zonenDerApp,
    zonenFuer,
    zonenIdAus,
} from './zonen';

describe('Zonen', () => {
    it('liest den Mittelpunkt, wie Karten-Apps ihn kopieren, und rundet auf sechs Stellen', () => {
        expect(liesMitte('50.94130, 6.95830')).to.deep.equal({ breite: 50.9413, laenge: 6.9583 });
        expect(liesMitte(' 50.9413016;6.9583049 ')).to.deep.equal({ breite: 50.941302, laenge: 6.958305 });
        expect(liesMitte('-33.8688 151.2093')).to.deep.equal({ breite: -33.8688, laenge: 151.2093 });
        expect(liesMitte('+90, -180')).to.deep.equal({ breite: 90, laenge: -180 });
        for (const falsch of [
            '50,9413, 6,9583',
            '50.94',
            '50.9 6.9 1',
            '90.1, 0',
            '0, 180.5',
            '1e1, 2',
            'a, b',
            '',
            50,
        ]) {
            expect(liesMitte(falsch), String(falsch)).to.equal(undefined);
        }
    });

    it('schlägt die ID aus dem Namen vor; nur gültige IDs zählen', () => {
        expect(zonenIdAus('Zuhause')).to.equal('zuhause');
        expect(zonenIdAus('Büro Köln-Süd')).to.equal('buero_koeln_sued');
        expect(zonenIdAus('Straße 12')).to.equal('strasse_12');
        expect(zonenIdAus('Café Crème')).to.equal('cafe_creme');
        expect(zonenIdAus('1. Etage')).to.equal('etage');
        expect(zonenIdAus(`${'x'.repeat(29)} y`)).to.equal('x'.repeat(29));
        expect(zonenIdAus('!!!')).to.equal('');
        for (const id of ['zuhause', 'a', 'arbeit_2', 'letzter', 'a'.repeat(30)]) {
            expect(istZonenId(id), id).to.equal(true);
        }
        for (const id of ['', 'Zuhause', '1a', '_a', 'letzte', 'aktiv', 'grund', 'a-b', 'a.b', 'a'.repeat(31), 7]) {
            expect(istZonenId(id), String(id)).to.equal(false);
        }
    });

    it('vor Protokoll 7 nur die drei alten Datenarten, ab 7 immer alle fünf', () => {
        const h = { akku: true, anruf: false, benachrichtigung: true, zonen: true };
        expect(handydatenFuer(h, 6)).to.deep.equal({ akku: true, anruf: false, benachrichtigung: true });
        expect(handydatenFuer(h, 7)).to.deep.equal({ ...h, standort: false });
    });

    it('eine App bekommt nur gewählte Zonen, die es gibt, und nur mit der Datenart Zonen', () => {
        const alle: [string, Zone][] = [
            ['arbeit', { name: 'Arbeit', breite: 1, laenge: 2, radius: 200 }],
            ['zuhause', { name: 'Zuhause', breite: 3, laenge: 4, radius: 300 }],
        ];
        const daten = {
            handydaten: { akku: false, anruf: false, benachrichtigung: false, zonen: true },
            zonenwahl: ['zuhause', 'weg'],
        } as AppDaten;
        expect(zonenDerApp(daten, alle)).to.deep.equal([{ id: 'zuhause', ...alle[1][1] }]);
        expect(zonenFuer(daten, alle, 6)).to.deep.equal({});
        expect(zonenFuer({ ...daten, handydaten: { ...daten.handydaten, zonen: false } }, alle, 7)).to.deep.equal({
            zonen: [],
        });
        expect(zonenDerApp({ ...daten, zonenwahl: undefined }, alle)).to.deep.equal([]);
    });

    it('höchstens 20 Zonen je App, auch wenn ein Skript mehr angelegt hat', () => {
        const viele: [string, Zone][] = Array.from({ length: 25 }, (_, i) => [
            `z${String(i).padStart(2, '0')}`,
            { name: `Zone ${String(i).padStart(2, '0')}`, breite: 1, laenge: 1, radius: 200 },
        ]);
        const daten = {
            handydaten: { akku: false, anruf: false, benachrichtigung: false, zonen: true },
            zonenwahl: viele.map(([id]) => id),
        } as AppDaten;
        expect(zonenDerApp(daten, viele).map(z => z.id)).to.deep.equal(viele.slice(0, 20).map(([id]) => id));
    });

    it('kennt jeden Grund des Protokolls und dazu die des Adapters', () => {
        expect(Object.keys(GRUENDE)).to.deep.equal([
            ...appAnAdapter.$defs.zonenstand.properties.grund.enum,
            'admin',
            'entfernt',
            'veraltet',
        ]);
    });

    it('Grund in der Systemsprache, sonst Englisch', () => {
        expect(grundText('ungefaehr', 'de')).to.equal('Nur ungefährer Standort erlaubt');
        expect(grundText('admin', 'fr')).to.equal('Switched off in the admin');
    });
});
