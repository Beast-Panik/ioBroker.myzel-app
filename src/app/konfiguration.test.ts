import { expect } from 'chai';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Protokoll } from '../basis/grenzen';
import {
    bezeichnungsfeld,
    karteAusZeile,
    kartenoptionen,
    liesKonfiguration,
    profilAusZeile,
    raumoptionen,
    zeileAusKarte,
    zeileAusProfil,
} from './konfiguration';
import { KARTENARTEN, KARTENTYPEN, type Karte, type Profil } from './rechte';

// Wie der Admin eine neue Zeile anlegt: jedes Feld der Seite, ohne Wert null
const LEER = Object.fromEntries(
    [
        ...new Set(Object.values(KARTENARTEN).flatMap(a => Object.keys(a.teile))),
        'bezeichnung1',
        'bezeichnung2',
        'bezeichnung3',
        'bezeichnung4',
    ].map(f => [f, null]),
);

describe('Karten und Profile aus den Instanzeinstellungen', () => {
    let log: string[];
    const protokoll: Protokoll = {
        debug: () => undefined,
        info: () => undefined,
        warn: t => log.push(t),
        error: () => undefined,
    };

    beforeEach(() => (log = []));

    it('eine Zeile wird zur Karte: nur die Teile ihres Typs, leere fallen weg, Bezeichnungen nur beim Messwert', () => {
        expect(
            karteAusZeile({
                ...LEER,
                id: 'stehlampe',
                name: ' Stehlampe ',
                typ: 'lampe',
                raum: 'enum.rooms.wohnzimmer',
                schalten: 'zigbee.0.lampe.state',
                helligkeit: '',
                soll: 'heizung.0.soll',
                bezeichnung1: 'bleibt weg',
            }),
        ).to.deep.equal({
            name: 'Stehlampe',
            typ: 'lampe',
            raum: 'enum.rooms.wohnzimmer',
            teile: { schalten: 'zigbee.0.lampe.state' },
        });
        expect(
            karteAusZeile({
                ...LEER,
                name: 'Klima',
                typ: 'messwert',
                raum: '',
                wert1: 'a.temp',
                wert3: 'a.druck',
                bezeichnung3: 'Druck',
                bezeichnung2: 'ohne Wert',
            }),
        ).to.deep.equal({
            name: 'Klima',
            typ: 'messwert',
            raum: '',
            teile: { wert1: 'a.temp', wert3: 'a.druck' },
            bezeichnungen: { wert3: 'Druck' },
        });
    });

    it('unbrauchbare Karten: unbekannter Typ, ohne Teil, ohne Pflichtteil, Raum aus anderer Aufzählung, ohne Name', () => {
        const zeile = { ...LEER, name: 'X', typ: 'schalter', raum: '', schalten: 'a.b' };
        expect(karteAusZeile(zeile)).to.not.be.an('array');
        expect(karteAusZeile({ ...zeile, typ: 'rollladen' })).to.deep.equal(['Typ rollladen unbekannt']);
        expect(karteAusZeile({ ...zeile, schalten: null })).to.be.an('array');
        expect(karteAusZeile({ ...zeile, typ: 'thermostat', ist: 'a.ist' })).to.be.an('array');
        expect(karteAusZeile({ ...zeile, raum: 'enum.functions.licht' })).to.be.an('array');
        expect(karteAusZeile({ ...zeile, name: '  ' })).to.be.an('array');
        expect(karteAusZeile({ ...zeile, name: 'x'.repeat(201) })).to.be.an('array');
    });

    it('eine Zeile wird zum Profil; steht etwas in beiden Listen, gilt schreiben', () => {
        expect(
            profilAusZeile({
                id: 'familie',
                name: 'Familie',
                raeumeSchreiben: ['enum.rooms.kueche'],
                raeumeLesen: ['enum.rooms.bad', 'enum.rooms.kueche'],
                kartenSchreiben: null,
                kartenLesen: ['tuer', ''],
                gesperrt: ['garage'],
            }),
        ).to.deep.equal({
            name: 'Familie',
            raeume: [
                { enum: 'enum.rooms.kueche', recht: 'schreiben' },
                { enum: 'enum.rooms.bad', recht: 'lesen' },
            ],
            karten: [{ id: 'tuer', recht: 'lesen' }],
            gesperrt: ['garage'],
        });
        expect(profilAusZeile({ name: 'A', raeumeSchreiben: ['enum.functions.licht'] })).to.be.an('array');
        expect(profilAusZeile({ name: 'A', gesperrt: ['Gross'] })).to.be.an('array');
        expect(profilAusZeile({ name: '' })).to.be.an('array');
    });

    it('Karten und Profile hin und zurück bleiben gleich', () => {
        const karte: Karte = {
            name: 'Klima',
            typ: 'messwert',
            raum: 'enum.rooms.bad',
            teile: { wert1: 'a.t', wert2: 'a.f' },
            bezeichnungen: { wert2: 'Feuchte' },
        };
        const profil: Profil = {
            name: 'Gast',
            raeume: [{ enum: 'enum.rooms.bad', recht: 'lesen' }],
            karten: [{ id: 'klima', recht: 'schreiben' }],
            gesperrt: ['tuer'],
        };
        expect(karteAusZeile(zeileAusKarte('klima', karte))).to.deep.equal(karte);
        expect(profilAusZeile(zeileAusProfil('gast', profil))).to.deep.equal(profil);
        expect(bezeichnungsfeld('wert4')).to.equal('bezeichnung4');
    });

    it('liest alle Zeilen; ungültige oder doppelte IDs und kaputte Zeilen fallen mit Warnung weg', () => {
        const k = liesKonfiguration(
            {
                karten: [
                    { id: 'tuer', name: 'Tür', typ: 'schalter', raum: '', schalten: 'a.b' },
                    { id: 'tuer', name: 'Zweite Tür', typ: 'schalter', raum: '', schalten: 'a.c' },
                    { id: 'Gross', name: 'Groß', typ: 'schalter', raum: '', schalten: 'a.b' },
                    { id: 'leer', name: 'Leer', typ: 'schalter', raum: '' },
                    'kaputt',
                    null,
                ],
                profile: [{ id: 'familie', name: 'Familie' }, { name: 'Ohne ID' }],
            },
            protokoll,
        );
        expect([...k.karten.keys()]).to.deep.equal(['tuer']);
        expect(k.karten.get('tuer')?.name).to.equal('Tür');
        expect([...k.profile.keys()]).to.deep.equal(['familie']);
        expect(log).to.have.length(4);
        expect(log[0]).to.equal('Karte „Zweite Tür“ ist unbrauchbar und fehlt auf den Handys: ID tuer doppelt');
        expect(log[3]).to.match(/^Profil „Ohne ID“ ist unbrauchbar und gibt keine Rechte/);
        expect(liesKonfiguration({}, protokoll).karten.size).to.equal(0);
    });

    it('Auswahl für Profile: Räume und die Karten im Formular nach Namen, mit Typ und Raum je Sprache', () => {
        const raeume = [
            { id: 'enum.rooms.kueche', name: { de: 'Küche', en: 'Kitchen' }, mitglieder: [] },
            { id: 'enum.rooms.bad', name: 'Bad', mitglieder: [] },
        ];
        expect(raumoptionen(raeume)).to.deep.equal([
            { value: 'enum.rooms.bad', label: { en: 'Bad', de: 'Bad' } },
            { value: 'enum.rooms.kueche', label: { en: 'Kitchen', de: 'Küche' } },
        ]);
        expect(
            kartenoptionen(
                [
                    { id: 'tuer', name: 'Tür', typ: 'schalter', raum: '' },
                    { id: 'herd', name: 'Herd', typ: 'schalter', raum: 'enum.rooms.kueche' },
                    { id: 'neu', name: '', typ: 'lampe' },
                    { id: 'Falsch', name: 'Falsch' },
                ],
                raeume,
            ),
        ).to.deep.equal([
            { value: 'herd', label: { en: 'Herd (Switch, Kitchen)', de: 'Herd (Schalter, Küche)' } },
            { value: 'tuer', label: { en: 'Tür (Switch, no room)', de: 'Tür (Schalter, ohne Raum)' } },
        ]);
        expect(kartenoptionen(undefined, raeume)).to.deep.equal([]);
    });
});

describe('Einstellungsseite', () => {
    const seite = JSON.parse(readFileSync(join(__dirname, '../../admin/jsonConfig.json'), 'utf8'));
    const felder = (reiter: string, liste: string): Record<string, any>[] =>
        seite.items[reiter].items[liste].items as Record<string, any>[];
    const sichtbar = (feld: Record<string, any>, data: Record<string, unknown>): boolean =>
        !feld.hidden || !(new Function('data', `return ${feld.hidden}`)(data) as boolean);

    it('zeigt je Kartentyp genau seine Teile als Datenpunktauswahl, beim Messwert dazu die Bezeichnungen', () => {
        const karten = felder('_reiterKarten', 'karten');
        const teile = karten.filter(f => f.type === 'objectId');
        const bezeichnungen = karten.filter(f => /^bezeichnung\d$/.test(f.attr));
        for (const typ of KARTENTYPEN) {
            const art = KARTENARTEN[typ];
            expect(
                teile.filter(f => sichtbar(f, { typ })).map(f => f.attr),
                typ,
            ).to.deep.equal(Object.keys(art.teile));
            expect(
                bezeichnungen.filter(f => sichtbar(f, { typ })).map(f => f.attr),
                typ,
            ).to.deep.equal(art.bezeichnungen ? Object.keys(art.teile).map(bezeichnungsfeld) : []);
        }
        const typen = karten.find(f => f.attr === 'typ')?.options.map((o: { value: string }) => o.value);
        expect(typen).to.deep.equal(KARTENTYPEN);
    });

    it('neue Karten und Profile bekommen eine eigene ID, die nicht änderbar ist', () => {
        for (const [reiter, liste, praefix] of [
            ['_reiterKarten', 'karten', 'k'],
            ['_reiterProfile', 'profile', 'p'],
        ]) {
            const id = felder(reiter, liste).find(f => f.attr === 'id')!;
            expect(id.readOnly).to.equal(true);

            const neu = new Function(`return ${id.defaultFunc}`)() as string;
            expect(neu).to.match(new RegExp(`^${praefix}[a-z0-9]+$`));
        }
    });
});
