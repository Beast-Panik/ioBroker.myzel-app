import { type Erkannt, type Vorschlag, erkenneGeraete, verschoben, vorschlaege } from '../app/erkennung';
import type { Katalog } from '../app/katalog';
import type { Eintragsablage } from '../app/objekte';
import {
    BEZEICHNUNG_LAENGE,
    KARTENARTEN,
    KARTENTYPEN,
    KARTEN_HOECHSTENS,
    type Karte,
    type Kartenmaengel,
    type Kartentyp,
    NAME_LAENGE,
    alsKarte,
    liegtUnter,
    maengelDerKarte,
} from '../app/rechte';
import type { Protokoll } from '../basis/grenzen';
import { type Ablehnung, Eintraege, nachricht, raeumeFuerSeiten, seitenadresse } from './eintraege';

// Über sendTo von der Kartenseite (admin/karten.html), eingebettet im Reiter „Karten“ der Instanzeinstellungen
export const KARTENBEFEHLE: readonly string[] = [
    'kartenseite',
    'kartenstand',
    'datenpunkte',
    'speichereKarte',
    'loescheKarte',
    'vorschlaege',
    'legeKartenAn',
];

// Mehr hilft beim Suchen nicht; die Seite bittet dann um ein genaueres Wort.
const TREFFER = 100;

// Für die Zahl am Knopf fragt die Seite bei jedem neuen Stand, also auch nach jedem Speichern. Alle Objekte zu lesen
// kostet in einer großen Installation Zeit und Speicher; der Dialog fragt frisch.
const ERKENNUNG_GILT = 60_000;

export interface Kartenzeile extends Karte {
    id: string;
    maengel: Kartenmaengel;
}

export interface Kartenstand {
    sprache: string;
    raeume: { id: string; name: string }[];
    // Je Typ seine Teile mit passenden Datenpunkttypen, wie sie der Adapter prüft
    arten: Record<
        Kartentyp,
        { teile: { teil: string; typen: readonly string[] }[]; pflicht: readonly string[]; bezeichnungen: boolean }
    >;
    karten: Kartenzeile[];
    // Namen der Datenpunkte in den Karten, in der Systemsprache
    namen: Record<string, string>;
    hoechstens: number;
    laengen: { name: number; bezeichnung: number };
}

export interface Vorschlagstand {
    vorschlaege: Vorschlag[];
    // Namen der Datenpunkte in den Vorschlägen, in der Systemsprache
    namen: Record<string, string>;
}

export interface Anlage {
    // Je Karte in der Reihenfolge der Anfrage; raum, wenn ioBroker den gewählten Raum nicht übernommen hat
    ergebnisse: ({ id: string; raum?: 'gescheitert' } | Ablehnung)[];
    stand: Kartenstand;
}

export interface Treffer {
    id: string;
    name: string;
    typ: string;
    einheit?: string;
}

const ARTEN = Object.fromEntries(
    KARTENTYPEN.map(typ => {
        const art = KARTENARTEN[typ];
        return [
            typ,
            {
                teile: Object.entries(art.teile).map(([teil, t]) => ({ teil, typen: t.typen })),
                pflicht: art.pflicht,
                bezeichnungen: art.bezeichnungen === true,
            },
        ];
    }),
) as Kartenstand['arten'];

// Nur Texte zu bekannten Schlüsseln, ohne Leerraum an den Rändern; leere fallen weg.
function texte(roh: unknown, erlaubt: string[]): Record<string, string> {
    if (!roh || typeof roh !== 'object' || Array.isArray(roh)) {
        return {};
    }
    return Object.fromEntries(
        Object.entries(roh)
            .filter(([k, w]) => erlaubt.includes(k) && typeof w === 'string' && w.trim() !== '')
            .map(([k, w]) => [k, (w as string).trim()]),
    );
}

// Teile anderer Typen und Bezeichnungen ohne Teil fallen weg; prüfen muss danach alsKarte.
function bereinigt(roh: unknown): unknown {
    if (!roh || typeof roh !== 'object' || Array.isArray(roh)) {
        return roh;
    }
    const r = roh as Record<string, unknown>;
    const art = KARTENARTEN[r.typ as Kartentyp] as (typeof KARTENARTEN)[Kartentyp] | undefined;
    if (!art) {
        return roh;
    }
    const teile = texte(r.teile, Object.keys(art.teile));
    const bezeichnungen = art.bezeichnungen ? texte(r.bezeichnungen, Object.keys(teile)) : {};
    return {
        name: typeof r.name === 'string' ? r.name.trim() : r.name,
        typ: r.typ,
        raum: typeof r.raum === 'string' ? r.raum : '',
        teile,
        ...(Object.keys(bezeichnungen).length > 0 ? { bezeichnungen } : {}),
    };
}

// Karten im Reiter „Karten“: anzeigen mit Mängeln je Teil, Datenpunkte suchen, anlegen, ändern, löschen
export class Kartenseite {
    private readonly karten: Eintraege<Karte>;
    private erkannt?: { zeit: number; liste: Erkannt[] };
    private readonly jetzt: () => number;

    public constructor(
        private readonly o: {
            namespace: string;
            // undefined, solange der Start nicht so weit ist
            katalog: () => Katalog | undefined;
            ablage: Eintragsablage;
            log: Protokoll;
            jetzt?: () => number;
            // Datenpunkte, Kanäle, Geräte, Aufzählungen und Adapter für die Erkennung
            alleObjekte?: () => Promise<Record<string, ioBroker.Object>>;
            // Mitglieder eines Raums in ioBroker ändern; true, wenn sich etwas geändert hat
            aendereRaum?: (raum: string, aendere: (mitglieder: string[]) => string[]) => Promise<boolean>;
        },
    ) {
        this.jetzt = o.jetzt ?? Date.now;
        this.karten = new Eintraege(
            {
                ordner: 'karten',
                kennbuchstabe: 'k',
                was: 'Karte',
                pruefe: roh => alsKarte(bereinigt(roh)),
                imKatalog: (katalog, id) => katalog.karte(id),
                anzahl: katalog => katalog.karten().length,
                hoechstens: KARTEN_HOECHSTENS,
            },
            o,
        );
    }

    public async beantworte(befehl: string, roh: unknown): Promise<unknown> {
        if (befehl === 'kartenseite') {
            return seitenadresse(this.o.namespace, 'karten.html');
        }
        const katalog = this.o.katalog();
        if (!katalog) {
            return { fehler: 'nichtBereit' } satisfies Ablehnung;
        }
        const n = nachricht(roh);
        switch (befehl) {
            case 'kartenstand':
                return this.stand(katalog);
            case 'datenpunkte':
                return this.suche(katalog, n);
            case 'speichereKarte':
                return this.mitStand(katalog, await this.karten.speichere(katalog, n.id, n.karte));
            case 'loescheKarte':
                return this.mitStand(katalog, await this.karten.loesche(katalog, n.id));
            case 'vorschlaege':
                return this.vorschlaege(katalog, n.frisch === true);
            case 'legeKartenAn':
                return this.legeAn(katalog, n.karten);
            default:
                return undefined;
        }
    }

    private mitStand(katalog: Katalog, antwort: { id: string } | Ablehnung): unknown {
        return 'fehler' in antwort ? antwort : { id: antwort.id, stand: this.stand(katalog) };
    }

    private erkennung?: Promise<void>;

    private async vorschlaege(katalog: Katalog, frisch: boolean): Promise<Vorschlagstand> {
        if (!this.o.alleObjekte) {
            return { vorschlaege: [], namen: {} };
        }
        if (frisch || !this.erkannt || this.jetzt() - this.erkannt.zeit > ERKENNUNG_GILT) {
            // Gleichzeitige Anfragen, etwa zwei offene Admin-Fenster, teilen sich einen Lauf
            const alleObjekte = this.o.alleObjekte;
            this.erkennung ??= (async () => {
                try {
                    const liste = erkenneGeraete(await alleObjekte(), {
                        namespace: this.o.namespace,
                        sprache: katalog.sprache,
                    });
                    this.erkannt = { zeit: this.jetzt(), liste };
                } finally {
                    this.erkennung = undefined;
                }
            })();
            await this.erkennung;
        }
        const liste = vorschlaege(this.erkannt?.liste ?? [], {
            karten: katalog.karten().map(([, k]) => k),
            raeume: katalog.raeume(),
            datenpunkt: dp => katalog.datenpunkt(dp),
            eigeneApps: katalog.eigeneApps,
            alleIds: [...katalog.alleDatenpunkte()].map(([id]) => id),
        });
        return {
            vorschlaege: liste,
            namen: this.namen(
                katalog,
                liste.map(v => v.karte),
            ),
        };
    }

    // Jede Karte für sich, mit derselben Prüfung wie aus dem Dialog. Welche Objekte ihren Raum in ioBroker wechseln,
    // bestimmt der Vorschlag mit denselben Datenpunkten, nie die Seite.
    private async legeAn(katalog: Katalog, roh: unknown): Promise<Anlage | Ablehnung> {
        if (!Array.isArray(roh) || roh.length > KARTEN_HOECHSTENS) {
            return { fehler: 'ungueltig', einzelheiten: ['karten'] };
        }
        const datenpunkte = (k: Karte): string => Object.values(k.teile).sort().join(' ');
        const angebot = new Map(
            (await this.vorschlaege(katalog, false)).vorschlaege.map(v => [datenpunkte(v.karte), v]),
        );
        const ergebnisse: Anlage['ergebnisse'] = [];
        for (const roheKarte of roh) {
            const antwort = await this.karten.speichere(katalog, undefined, roheKarte);
            const karte = 'fehler' in antwort ? undefined : katalog.karte(antwort.id);
            const vorschlag = karte && angebot.get(datenpunkte(karte));
            ergebnisse.push(
                karte && vorschlag && !(await this.ordneZu(katalog, karte, vorschlag))
                    ? { ...antwort, raum: 'gescheitert' }
                    : antwort,
            );
        }
        return { ergebnisse, stand: this.stand(katalog) };
    }

    // Hat die Karte einen anderen Raum als den aus ioBroker, übernimmt ioBroker ihn. false, wenn das scheitert.
    private async ordneZu(katalog: Katalog, karte: Karte, vorschlag: Vorschlag): Promise<boolean> {
        const raeume = katalog.raeume();
        const aendere = this.o.aendereRaum;
        if (!aendere || karte.raum === vorschlag.karte.raum || (karte.raum && !raeume.some(r => r.id === karte.raum))) {
            return true;
        }
        const zuordnung = vorschlag.zuordnung;
        const namen = new Map(raeumeFuerSeiten(katalog).map(r => [r.id, r.name]));
        const betroffen = raeume.filter(
            r => r.id === karte.raum || r.mitglieder.some(m => zuordnung.some(z => liegtUnter(m, z))),
        );
        const geaendert: string[] = [];
        try {
            for (const r of betroffen) {
                if (await aendere(r.id, m => verschoben(m, zuordnung, r.id === karte.raum))) {
                    const name = namen.get(r.id);
                    if (r.id === karte.raum) {
                        geaendert.unshift(`jetzt in ${name}`);
                    } else {
                        geaendert.push(`nicht mehr in ${name}`);
                    }
                }
            }
        } catch (fehler) {
            this.o.log.warn(
                `Raum für „${karte.name}“ in ioBroker nicht übernommen (${zuordnung.join(', ')}): ${(fehler as Error).message}`,
            );
            return false;
        }
        if (geaendert.length > 0) {
            this.o.log.info(`„${karte.name}“ in ioBroker ${geaendert.join(', ')} (${zuordnung.join(', ')})`);
        }
        return true;
    }

    private namen(katalog: Katalog, karten: Karte[]): Record<string, string> {
        const namen: Record<string, string> = {};
        for (const dp of karten.flatMap(k => Object.values(k.teile))) {
            const name = katalog.datenpunkt(dp)?.name;
            if (typeof name === 'string' && name !== dp) {
                namen[dp] = name;
            }
        }
        return namen;
    }

    private stand(katalog: Katalog): Kartenstand {
        const sprache = katalog.sprache;
        const karten = katalog.karten().map(([id, k]) => ({
            id,
            name: k.name,
            typ: k.typ,
            raum: k.raum,
            teile: { ...k.teile },
            ...(k.bezeichnungen ? { bezeichnungen: { ...k.bezeichnungen } } : {}),
            maengel: maengelDerKarte(k, dp => katalog.datenpunkt(dp)),
        }));
        return {
            sprache,
            raeume: raeumeFuerSeiten(katalog),
            arten: ARTEN,
            karten,
            namen: this.namen(katalog, karten),
            hoechstens: KARTEN_HOECHSTENS,
            laengen: { name: NAME_LAENGE, bezeichnung: BEZEICHNUNG_LAENGE },
        };
    }

    // Jedes Wort muss in ID oder Name stehen; nur Datenpunkte, deren Typ zum Teil passt, nie unter system
    private suche(katalog: Katalog, n: Record<string, unknown>): { treffer: Treffer[]; mehr: boolean } {
        const art = KARTENARTEN[n.typ as Kartentyp]?.teile[String(n.teil)] as
            (typeof KARTENARTEN)[Kartentyp]['teile'][string] | undefined;
        if (!art) {
            return { treffer: [], mehr: false };
        }
        const woerter = (typeof n.suche === 'string' ? n.suche : '')
            .toLowerCase()
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 8);
        const treffer: Treffer[] = [];
        for (const [id, m] of katalog.alleDatenpunkte()) {
            if (!art.typen.includes(m.type as 'boolean') || liegtUnter(id, 'system')) {
                continue;
            }
            const name = typeof m.name === 'string' ? m.name : id;
            const heu = `${id}\n${name}`.toLowerCase();
            if (woerter.every(w => heu.includes(w))) {
                treffer.push({ id, name, typ: m.type!, ...(typeof m.unit === 'string' ? { einheit: m.unit } : {}) });
            }
        }
        treffer.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        return { treffer: treffer.slice(0, TREFFER), mehr: treffer.length > TREFFER };
    }
}
