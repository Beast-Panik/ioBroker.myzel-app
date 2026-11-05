import { ChannelDetector, type PatternControl, type PatternName, Types } from '@iobroker/type-detector';
import {
    type Aufzaehlung,
    type Karte,
    type Kartentyp,
    type Merkmale,
    NAME_LAENGE,
    liegtUnter,
    maengelDerKarte,
    merkmale,
    text,
} from './rechte';

// Je erkanntem Typ die Karte und je Teil die Namen der Zustände aus dem Erkenner, der erste vorhandene gilt. Messwerte
// nehmen die vorhandenen Werte der Reihe nach, höchstens vier.
interface Zuordnung {
    typ: Kartentyp;
    teile?: Record<string, string[]>;
    werte?: string[];
}

const LICHT = { schalten: ['ON'], helligkeit: ['DIMMER', 'BRIGHTNESS'], farbtemperatur: ['TEMPERATURE'] };

// KONZEPT-KARTEN.md, Abschnitt 14. Farbe nur als #RRGGBB (rgbSingle); RGBW, Farbton und getrennte Kanäle kann die Karte
// nicht, solche Lampen kommen ohne Farbe.
const ZUORDNUNG: Partial<Record<Types, Zuordnung>> = {
    [Types.light]: { typ: 'lampe', teile: { schalten: ['SET'] } },
    [Types.dimmer]: { typ: 'lampe', teile: { schalten: ['ON_SET'], helligkeit: ['SET'] } },
    [Types.ct]: { typ: 'lampe', teile: LICHT },
    [Types.rgbSingle]: { typ: 'lampe', teile: { ...LICHT, farbe: ['RGB'] } },
    [Types.rgbwSingle]: { typ: 'lampe', teile: LICHT },
    [Types.hue]: { typ: 'lampe', teile: LICHT },
    [Types.rgb]: { typ: 'lampe', teile: LICHT },
    [Types.socket]: { typ: 'schalter', teile: { schalten: ['SET'] } },
    [Types.thermostat]: { typ: 'thermostat', teile: { soll: ['SET', 'SET_HEATING'], ist: ['ACTUAL'] } },
    [Types.temperature]: { typ: 'messwert', werte: ['ACTUAL', 'SECOND'] },
    [Types.humidity]: { typ: 'messwert', werte: ['ACTUAL'] },
    [Types.illuminance]: { typ: 'messwert', werte: ['ACTUAL'] },
    [Types.pressure]: { typ: 'messwert', werte: ['PRESSURE'] },
    [Types.window]: { typ: 'messwert', werte: ['ACTUAL'] },
    [Types.windowTilt]: { typ: 'messwert', werte: ['ACTUAL'] },
    [Types.door]: { typ: 'messwert', werte: ['ACTUAL'] },
    [Types.contact]: { typ: 'messwert', werte: ['ACTUAL'] },
    [Types.motion]: { typ: 'messwert', werte: ['ACTUAL', 'SECOND'] },
    [Types.fireAlarm]: { typ: 'messwert', werte: ['ACTUAL', 'CO'] },
    [Types.floodAlarm]: { typ: 'messwert', werte: ['ACTUAL'] },
    [Types.airQuality]: { typ: 'messwert', werte: ['AQI', 'CO2', 'PM25', 'PM10', 'TVOC', 'ACTUAL', 'HUMIDITY'] },
    [Types.electricity]: { typ: 'messwert', werte: ['ELECTRIC_POWER', 'CONSUMPTION', 'CURRENT', 'VOLTAGE'] },
};
const ERKANNT = Object.keys(ZUORDNUNG) as Types[];
// Sonst zerfiele eine Lampe mit Helligkeit und Lichtfarbe in zwei.
const EIN_LICHT: PatternName[][] = [['light', 'dimmer', 'ct', 'rgbSingle', 'rgbwSingle', 'hue', 'rgb']];

// Adapter dieser Arten steuern keine Geräte. Ihre Schalter, etwa „Skript an“ oder „Sicherung starten“, sähen sonst wie
// Steckdosen aus. Arten aus io-package.json, common.type.
const OHNE_GERAETE = new Set([
    'communication',
    'date-and-time',
    'general',
    'logic',
    'messaging',
    'misc-data',
    'network',
    'notifications',
    'storage',
    'utility',
    'visualization',
    'visualization-icons',
    'visualization-widgets',
]);

// Für die Seite: was eine Karte werden könnte, mit der Stelle in ioBroker, aus der es stammt
export interface Erkannt {
    herkunft: string;
    name: string;
    typ: Kartentyp;
    teile: Record<string, string>;
}

const istGeraet = (o: ioBroker.Object | undefined): boolean => o?.type === 'device' || o?.type === 'channel';

function eltern(id: string): string[] {
    const teile = id.split('.');
    return teile.slice(1, -1).map((_, i) => teile.slice(0, teile.length - 1 - i).join('.'));
}

// Geräte in ioBroker, die eine Karte werden können, erkannt an Rollen und Aufbau mit `@iobroker/type-detector`. objekte
// sind Datenpunkte, Kanäle, Geräte, Aufzählungen und Adapter. Gegen Datenpunkte und Karten geprüft wird erst in
// vorschlaege(), damit das Ergebnis eine Weile gelten kann.
export function erkenneGeraete(
    objekte: Record<string, ioBroker.Object>,
    o: { namespace: string; sprache: string },
): Erkannt[] {
    const fremd = [
        'system',
        o.namespace,
        ...Object.values(objekte)
            .filter(a => a.type === 'adapter' && OHNE_GERAETE.has(String((a.common as { type?: unknown }).type)))
            .map(a => a._id.slice('system.adapter.'.length)),
    ];
    const nutzbar: Record<string, ioBroker.Object> = {};
    for (const [id, obj] of Object.entries(objekte)) {
        // Aufzählungen helfen dem Erkenner, etwa ein Licht mit der Rolle switch von einer Steckdose zu trennen.
        if (
            obj.type === 'enum' ||
            (['state', 'channel', 'device'].includes(obj.type) && !fremd.some(f => liegtUnter(id, f)))
        ) {
            nutzbar[id] = obj;
        }
    }
    const ids = Object.keys(nutzbar).sort();
    // Kanäle vor Geräten vor einzelnen Datenpunkten: Ein Gerät mit mehreren Kanälen, etwa zwei Relais, gibt so je Kanal
    // einen Vorschlag. Ein Datenpunkt in einem Gerät oder Kanal ist dort schon erkannt.
    const reihe = [
        ...ids.filter(id => nutzbar[id].type === 'channel'),
        ...ids.filter(id => nutzbar[id].type === 'device'),
        ...ids.filter(id => nutzbar[id].type === 'state' && !eltern(id).some(e => istGeraet(nutzbar[e]))),
    ];
    const erkenner = new ChannelDetector();
    const vergeben = new Set<string>();
    const ergebnis: Omit<Erkannt, 'name'>[] = [];
    for (const id of reihe) {
        const gefunden =
            erkenner.detect({
                objects: nutzbar,
                id,
                _keysOptional: ids,
                // Je Aufruf neu: Der Erkenner sperrt sonst auch, was er in einem Gerät gesehen, aber nicht genommen hat,
                // und ein zweiter Kanal ginge verloren. Doppeltes fängt vergeben ab.
                _usedIdsOptional: [],
                ignoreIndicators: ['UNREACH_STICKY'],
                allowedTypes: ERKANNT,
                limitTypesToOneOf: EIN_LICHT,
            }) ?? [];
        for (const steuerung of gefunden) {
            const teile = teileAus(steuerung);
            const dps = Object.values(teile);
            if (dps.length === 0 || dps.some(dp => vergeben.has(dp))) {
                continue;
            }
            dps.forEach(dp => vergeben.add(dp));
            // Liegt alles in einem Kanal, stammt der Vorschlag von dort, etwa vom zweiten Relais eines Geräts.
            const kanal = eltern(dps[0]).find(
                e => nutzbar[e]?.type === 'channel' && liegtUnter(e, id) && dps.every(dp => liegtUnter(dp, e)),
            );
            ergebnis.push({ herkunft: kanal ?? id, typ: ZUORDNUNG[steuerung.type]!.typ, teile });
        }
    }
    return benenne(ohneDoppelteAliase(ergebnis, nutzbar), nutzbar, o.sprache);
}

function teileAus(steuerung: PatternControl): Record<string, string> {
    const z = ZUORDNUNG[steuerung.type]!;
    const zustand = (namen: string[]): string | undefined =>
        namen.map(n => steuerung.states.find(s => s.name === n && s.id)?.id).find(Boolean);
    if (z.werte) {
        const werte = z.werte.map(n => zustand([n])).filter((dp): dp is string => dp !== undefined);
        return Object.fromEntries(werte.slice(0, 4).map((dp, i) => [`wert${i + 1}`, dp]));
    }
    return Object.fromEntries(
        Object.entries(z.teile!)
            .map(([teil, namen]) => [teil, zustand(namen)])
            .filter((e): e is [string, string] => e[1] !== undefined),
    );
}

// Ein Kanal heißt oft nur „Relay0“ oder wie sein Gerät mit „:1“. Kommt aus einem Gerät nur ein Vorschlag, trägt er den
// Namen des Geräts, sonst den des Kanals, mit dem Gerät davor, wo es fehlt.
function benenne(liste: Omit<Erkannt, 'name'>[], objekte: Record<string, ioBroker.Object>, sprache: string): Erkannt[] {
    const name = (id: string): string =>
        text(objekte[id]?.common.name, sprache, id.slice(id.lastIndexOf('.') + 1)).trim();
    const geraete = liste.map(e =>
        objekte[e.herkunft]?.type === 'device'
            ? e.herkunft
            : eltern(e.herkunft).find(x => objekte[x]?.type === 'device'),
    );
    return liste.map((e, i) => {
        const geraet = geraete[i];
        const eigener = name(e.herkunft);
        let gesamt = eigener;
        if (geraet && geraet !== e.herkunft) {
            const gname = name(geraet);
            gesamt =
                geraete.filter(g => g === geraet).length === 1
                    ? gname
                    : eigener.startsWith(gname)
                      ? eigener
                      : `${gname} ${eigener}`;
        }
        return { ...e, name: (gesamt || e.herkunft).slice(0, NAME_LAENGE) };
    });
}

// Ein Alias und sein Ziel sind dasselbe Gerät. Wer Aliase anlegt, will sie nutzen; das Original fällt weg.
function ohneDoppelteAliase<T extends Omit<Erkannt, 'name'>>(
    liste: T[],
    objekte: Record<string, ioBroker.Object>,
): T[] {
    const ziele = new Set(
        liste
            .filter(e => liegtUnter(e.herkunft, 'alias'))
            .flatMap(e => Object.values(e.teile))
            .flatMap(dp => merkmale(dp, objekte[dp]?.common as ioBroker.StateCommon | undefined, '').ziele ?? []),
    );
    return liste.filter(e => liegtUnter(e.herkunft, 'alias') || !Object.values(e.teile).every(dp => ziele.has(dp)));
}

export interface Vorschlag {
    herkunft: string;
    karte: Karte;
}

/**
 * Was davon die Seite anbietet: ohne Geräte, die schon in einer Karte stehen, auch über einen Alias; ohne Teile, deren
 * Datenpunkt nicht passt; ohne Karten, die auf keinem Handy erschienen. Raum ist der erste in der Folge der App, der
 * das Gerät oder einen seiner Datenpunkte enthält.
 */
export function vorschlaege(
    erkannt: Erkannt[],
    o: {
        karten: Karte[];
        raeume: Aufzaehlung[];
        datenpunkt: (id: string) => Merkmale | undefined;
        // <namespace>.apps: persönliche Daten nie über einen Vorschlag
        eigeneApps: string;
    },
): Vorschlag[] {
    const mitZielen = (dp: string): string[] => [dp, ...(o.datenpunkt(dp)?.ziele ?? [])];
    const belegt = new Set(o.karten.flatMap(k => Object.values(k.teile)).flatMap(mitZielen));
    const ergebnis: Vorschlag[] = [];
    for (const e of erkannt) {
        const alle = Object.values(e.teile).flatMap(mitZielen);
        if (alle.some(dp => belegt.has(dp) || liegtUnter(dp, o.eigeneApps))) {
            continue;
        }
        const raum = o.raeume.find(r => r.mitglieder.some(m => [e.herkunft, ...alle].some(id => liegtUnter(id, m))));
        const roh: Karte = { name: e.name, typ: e.typ, raum: raum?.id ?? '', teile: e.teile };
        const maengel = maengelDerKarte(roh, o.datenpunkt);
        if (maengel.folge === 'fehlt') {
            continue;
        }
        const passend = Object.entries(e.teile).filter(([teil]) => !maengel.teile[teil]);
        // Werte rücken nach, damit kein Messwert mit Wert 2 ohne Wert 1 entsteht.
        const teile = Object.fromEntries(
            e.typ === 'messwert' ? passend.map(([, dp], i) => [`wert${i + 1}`, dp]) : passend,
        );
        ergebnis.push({ herkunft: e.herkunft, karte: { ...roh, teile } });
    }
    return ergebnis;
}
