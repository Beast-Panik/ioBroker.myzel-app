import { ChannelDetector, type PatternControl, type PatternName, Types } from '@iobroker/type-detector';
import {
    type Aufzaehlung,
    KARTENARTEN,
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
const WERTE_HOECHSTENS = Object.keys(KARTENARTEN.messwert.teile).length;
const alsWerte = (dps: string[]): Record<string, string> =>
    Object.fromEntries(dps.map((dp, i) => [`wert${i + 1}`, dp]));
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
    art: Types;
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
            ergebnis.push({ herkunft: kanal ?? id, typ: ZUORDNUNG[steuerung.type]!.typ, teile, art: steuerung.type });
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
        return alsWerte(werte.slice(0, WERTE_HOECHSTENS));
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
    // Ein Gerät, Kanal oder Datenpunkt; mehrere, wenn Teile zusammengefasst sind
    herkunft: string[];
    // Was in ioBroker den Raum wechselt, wenn er im Dialog geändert wird: die Herkunft oder ein Objekt darüber
    zuordnung: string[];
    // Räume, in denen der Vorschlag über ein Objekt darüber bleibt, das nicht mitwandert
    bleibt: { raum: string; ueber: string }[];
    karte: Karte;
}

interface Gruppe {
    herkunft: string[];
    name: string;
    typ: Kartentyp;
    teile: Record<string, string>;
    arten: Types[];
    raum: string;
}

// Wie die Teile in einer Karte des Typs stehen, undefined, wenn sie dort nicht hingehören
function teileAls(g: Gruppe, typ: Kartentyp): Record<string, string> | undefined {
    if (g.typ === typ || (typ === 'lampe' && g.typ === 'schalter')) {
        return g.teile;
    }
    const werte = Object.values(g.teile);
    if (typ === 'thermostat' && werte.length === 1 && g.arten.every(a => a === Types.temperature)) {
        return { ist: werte[0] };
    }
    return undefined;
}

// Ein Schalter mit dem Namen einer Lampe ist ihr An, ein Temperaturfühler mit dem Namen eines Thermostats seine
// Isttemperatur. Jedes Teil nur einmal, höchstens vier Werte, nie aus zwei verschiedenen Räumen.
function vereint(a: Gruppe, b: Gruppe): Gruppe | undefined {
    if (a.raum && b.raum && a.raum !== b.raum) {
        return undefined;
    }
    const typ = a.typ === b.typ ? a.typ : (['lampe', 'thermostat'] as const).find(t => a.typ === t || b.typ === t);
    const ta = typ && teileAls(a, typ);
    const tb = typ && teileAls(b, typ);
    if (!typ || !ta || !tb) {
        return undefined;
    }
    let teile: Record<string, string>;
    if (typ === 'messwert') {
        const werte = [...Object.values(ta), ...Object.values(tb)];
        if (werte.length > WERTE_HOECHSTENS) {
            return undefined;
        }
        teile = alsWerte(werte);
    } else {
        if (Object.keys(ta).some(t => t in tb)) {
            return undefined;
        }
        teile = Object.fromEntries(
            Object.keys(KARTENARTEN[typ].teile)
                .filter(t => ta[t] ?? tb[t])
                .map(t => [t, ta[t] ?? tb[t]]),
        );
    }
    return {
        herkunft: [...a.herkunft, ...b.herkunft],
        name: a.name,
        typ,
        teile,
        arten: [...a.arten, ...b.arten],
        raum: a.raum || b.raum,
    };
}

// Ein Gerät, das ioBroker nicht als eines kennt, kommt in Teilen, etwa An, Helligkeit und Farbe einer Lampe als
// einzelne Datenpunkte mit demselben Namen. Teile derselben Instanz mit gleichem Namen werden eins, wo sie sich ergänzen.
function zusammengefasst(gruppen: Gruppe[]): Gruppe[] {
    const ergebnis: Gruppe[] = [];
    const offen = new Map<string, number[]>();
    for (const g of gruppen) {
        const instanz = g.herkunft[0].split('.').slice(0, 2).join('.');
        const schluessel = `${instanz} ${g.name.trim().replace(/\s+/g, ' ').toLocaleLowerCase()}`;
        const stellen = offen.get(schluessel) ?? [];
        const stelle = stellen.find(i => vereint(ergebnis[i], g));
        if (stelle === undefined) {
            offen.set(schluessel, [...stellen, ergebnis.push(g) - 1]);
        } else {
            ergebnis[stelle] = vereint(ergebnis[stelle], g)!;
        }
    }
    return ergebnis;
}

/**
 * Was davon die Seite anbietet: gleichnamige Teile zusammengefasst; ohne Geräte, die schon in einer Karte stehen, auch
 * über einen Alias; ohne Teile, deren Datenpunkt nicht passt; ohne Karten, die auf keinem Handy erschienen. Raum ist der
 * erste in der Folge der App, der das Gerät oder einen seiner Datenpunkte enthält.
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
    const gruppen = erkannt.map(e => ({
        herkunft: [e.herkunft],
        name: e.name,
        typ: e.typ,
        teile: e.teile,
        arten: [e.art],
        raum: raumVon([e.herkunft, ...Object.values(e.teile).flatMap(mitZielen)], o.raeume),
    }));
    const ergebnis: Vorschlag[] = [];
    const alleGruppen = zusammengefasst(gruppen);
    for (const g of alleGruppen) {
        const alle = Object.values(g.teile).flatMap(mitZielen);
        if (alle.some(dp => belegt.has(dp) || liegtUnter(dp, o.eigeneApps))) {
            continue;
        }
        const roh: Karte = { name: g.name, typ: g.typ, raum: g.raum, teile: g.teile };
        const maengel = maengelDerKarte(roh, o.datenpunkt);
        if (maengel.folge === 'fehlt') {
            continue;
        }
        const passend = Object.entries(g.teile).filter(([teil]) => !maengel.teile[teil]);
        // Werte rücken nach, damit kein Messwert mit Wert 2 ohne Wert 1 entsteht.
        const teile = g.typ === 'messwert' ? alsWerte(passend.map(([, dp]) => dp)) : Object.fromEntries(passend);
        ergebnis.push({ herkunft: g.herkunft, ...zuordnungVon(g, alleGruppen, o.raeume), karte: { ...roh, teile } });
    }
    return ergebnis;
}

// Steht die Herkunft über ein Objekt darüber in einem Raum, etwa das ganze Gerät, wandert das äußerste davon mit, wenn
// kein anderer Vorschlag darunter liegt; auch einer, der schon eine Karte ist. Sonst bliebe es im alten Raum, der Raum
// wäre nicht korrigiert. Liegen andere darunter, etwa ein zweites Relais für einen anderen Raum, bleibt es, wo es ist.
// Eine ganze Instanz wandert nie.
function zuordnungVon(g: Gruppe, alle: Gruppe[], raeume: Aufzaehlung[]): Pick<Vorschlag, 'zuordnung' | 'bleibt'> {
    const andere = alle.filter(x => x !== g).flatMap(x => [...x.herkunft, ...Object.values(x.teile)]);
    const zuordnung = new Set<string>();
    const bleibt = new Map<string, { raum: string; ueber: string }>();
    for (const h of g.herkunft) {
        const halter = raeume.flatMap(r =>
            r.mitglieder.filter(m => m !== h && liegtUnter(h, m)).map(m => ({ raum: r.id, ueber: m })),
        );
        const aeusserstes = halter
            .map(x => x.ueber)
            .filter(m => m.split('.').length > 2 && !andere.some(id => liegtUnter(id, m)))
            .sort((a, b) => a.length - b.length)[0];
        zuordnung.add(aeusserstes ?? h);
        for (const x of halter.filter(x => !aeusserstes || !liegtUnter(x.ueber, aeusserstes))) {
            bleibt.set(`${x.raum} ${x.ueber}`, x);
        }
    }
    return { zuordnung: [...zuordnung], bleibt: [...bleibt.values()] };
}

// Der erste Raum in der Folge der App, der eines der Objekte enthält, selbst oder über ein Objekt darüber
function raumVon(ids: string[], raeume: Aufzaehlung[]): string {
    return raeume.find(r => r.mitglieder.some(m => ids.some(id => liegtUnter(id, m))))?.id ?? '';
}

// Die Mitglieder eines Raums, wenn die Zuordnung eines Vorschlags in einen anderen Raum zieht: Im neuen Raum kommt
// dazu, was dort nicht schon selbst oder über ein Objekt darüber steht; aus jedem anderen fällt sie samt allem darunter.
// Ein Objekt darüber bleibt, wo es ist (siehe zuordnungVon).
export function verschoben(mitglieder: string[], zuordnung: string[], imNeuen: boolean): string[] {
    if (imNeuen) {
        return [...mitglieder, ...zuordnung.filter(z => !mitglieder.some(m => liegtUnter(z, m)))];
    }
    return mitglieder.filter(m => !zuordnung.some(z => liegtUnter(m, z)));
}
