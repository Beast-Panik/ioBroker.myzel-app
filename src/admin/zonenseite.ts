import type { Katalog } from '../app/katalog';
import type { Appablage, Eintragsablage } from '../app/objekte';
import {
    RADIUS_BIS,
    RADIUS_VON,
    RADIUS_VORGABE,
    type Mittelpunktvorschlag,
    ZONENID_LAENGE,
    ZONENNAME_LAENGE,
    ZONEN_HOECHSTENS,
    type Zone,
    alsZone,
    istZonenId,
    liesMitte,
} from '../app/zonen';
import type { Protokoll } from '../basis/grenzen';
import { type Ablehnung, Eintraege, nachricht, seitenadresse } from './eintraege';

// Über sendTo von der Zonenseite (admin/zonen.html), eingebettet im Reiter „Zonen“ der Instanzeinstellungen
export const ZONENBEFEHLE: readonly string[] = ['zonenseite', 'zonenstand', 'speichereZone', 'loescheZone'];

export interface Zonenzeile extends Zone {
    id: string;
    // Namen der Apps, die die Zone bekommen: Datenart Zonen an und die Zone gewählt
    apps: string[];
}

export interface Zonenstand {
    sprache: string;
    // Nach Name
    zonen: Zonenzeile[];
    // Breite und Länge aus den Systemeinstellungen; null, wenn sie dort fehlen
    zuhause: { breite: number; laenge: number } | null;
    hoechstens: number;
    laengen: { name: number; id: number };
    radius: { von: number; bis: number; vorgabe: number };
    // Standorte vom Handy für den Mittelpunkt, der neueste zuerst; jetzt ist die Uhr des Adapters für „vor … Minuten“
    vorschlaege: { app: string; breite: number; laenge: number; genauigkeit: number; zeit: number }[];
    jetzt: number;
}

export type Zonenapps = Pick<Appablage, 'alle' | 'lies' | 'aendere' | 'zonenpunkte' | 'entferneZone' | 'benenneZone'>;

// Die Seite schickt den Mittelpunkt als ein Feld „Breite, Länge“; geprüft wird er hier wie alles andere.
function pruefe(roh: unknown): Zone | string[] {
    const r = nachricht(roh);
    const mitte = liesMitte(r.mitte);
    if (!mitte) {
        return ['/mitte erwartet Breite und Länge mit Dezimalpunkt'];
    }
    return alsZone({
        name: typeof r.name === 'string' ? r.name.trim() : r.name,
        breite: mitte.breite,
        laenge: mitte.laenge,
        radius: r.radius,
    });
}

/**
 * Zonen im Reiter „Zonen“ (KONZEPT-ZONEN.md, Abschnitt 16.1): anlegen mit einer ID für Skripte, ändern, löschen. Welche
 * App welche Zone bekommt, steht im Dialog „Handydaten“ des Gerätemanagers (Variante B). Die Apps kommen aus dem
 * laufenden Betrieb, damit Dienst und Seite dieselbe Ablage teilen.
 */
export class Zonenseite {
    private readonly zonen: Eintraege<Zone>;

    public constructor(
        private readonly o: {
            namespace: string;
            // undefined, solange der Start nicht so weit ist
            katalog: () => Katalog | undefined;
            apps: () => Zonenapps | undefined;
            // Vorschläge für Mittelpunkte vom laufenden Dienst
            vorschlaege?: () => Mittelpunktvorschlag[];
            ablage: Eintragsablage;
            log: Protokoll;
            jetzt?: () => number;
        },
    ) {
        this.zonen = new Eintraege<Zone>(
            {
                ordner: 'zonen',
                kennbuchstabe: 'z',
                was: 'Zone',
                pruefe,
                imKatalog: (katalog, id) => katalog.zone(id),
                anzahl: katalog => katalog.zonen().length,
                hoechstens: ZONEN_HOECHSTENS,
                istId: istZonenId,
            },
            o,
        );
    }

    public async beantworte(befehl: string, roh: unknown): Promise<unknown> {
        if (befehl === 'zonenseite') {
            return seitenadresse(this.o.namespace, 'zonen.html');
        }
        const katalog = this.o.katalog();
        const apps = this.o.apps();
        if (!katalog || !apps) {
            return { fehler: 'nichtBereit' } satisfies Ablehnung;
        }
        const n = nachricht(roh);
        switch (befehl) {
            case 'zonenstand':
                return this.stand(katalog, apps);
            case 'speichereZone':
                return this.mitStand(katalog, apps, await this.speichere(katalog, apps, n));
            case 'loescheZone':
                return this.mitStand(katalog, apps, await this.loesche(katalog, apps, n.id));
            default:
                return undefined;
        }
    }

    private async mitStand(katalog: Katalog, apps: Zonenapps, antwort: { id: string } | Ablehnung): Promise<unknown> {
        return 'fehler' in antwort ? antwort : { id: antwort.id, stand: await this.stand(katalog, apps) };
    }

    // Neu mit der ID aus wunsch, sonst die Zone id. Ein neuer Name gilt gleich für die Datenpunkte aller Apps.
    private async speichere(
        katalog: Katalog,
        apps: Zonenapps,
        n: Record<string, unknown>,
    ): Promise<{ id: string } | Ablehnung> {
        const vorher = istZonenId(n.id) ? katalog.zone(n.id)?.name : undefined;
        // Eine neue Zone unter einer ID, die es schon einmal gab, etwa im Objektbrowser gelöscht: Keine App bekommt sie,
        // nur weil die alte noch in ihrer Wahl stand.
        if (
            n.id === undefined &&
            istZonenId(n.wunsch) &&
            !katalog.gibtZone(n.wunsch) &&
            !(await this.o.ablage.liesEintrag('zonen', n.wunsch))
        ) {
            await this.raeumeAuf(apps, n.wunsch);
        }
        const antwort = await this.zonen.speichere(katalog, n.id, n.zone, n.id === undefined ? n.wunsch : undefined);
        const name = 'fehler' in antwort ? undefined : katalog.zone(antwort.id)?.name;
        if (!('fehler' in antwort) && vorher !== undefined && name !== undefined && name !== vorher) {
            for (const appId of await apps.alle()) {
                await apps.benenneZone(appId, antwort.id, name);
            }
        }
        return antwort;
    }

    // Erst die Zone, dann bei jeder App die Wahl und der Datenpunkt. Für verbundene Apps entfernt der Dienst ihn nach der
    // Neuberechnung noch einmal, falls ein Wechsel vom Handy dazwischenkam.
    private async loesche(katalog: Katalog, apps: Zonenapps, id: unknown): Promise<{ id: string } | Ablehnung> {
        const antwort = await this.zonen.loesche(katalog, id);
        if ('fehler' in antwort) {
            return antwort;
        }
        await this.raeumeAuf(apps, antwort.id);
        return antwort;
    }

    // Die Zone aus Wahl und Datenpunkten aller Apps. Scheitert es bei einer, geht es mit den übrigen weiter; was bleibt,
    // räumt spätestens eine neue Zone unter derselben ID auf.
    private async raeumeAuf(apps: Zonenapps, zone: string): Promise<void> {
        for (const appId of await apps.alle()) {
            try {
                const daten = await apps.lies(appId);
                if (daten?.zonenwahl?.includes(zone)) {
                    await apps.aendere(appId, { zonenwahl: daten.zonenwahl.filter(z => z !== zone) });
                }
                if ((await apps.zonenpunkte(appId)).includes(zone)) {
                    await apps.entferneZone(appId, zone);
                }
            } catch (fehler) {
                this.o.log.warn(`Zone ${zone} bei App ${appId} nicht aufgeräumt: ${(fehler as Error).message}`);
            }
        }
    }

    private async stand(katalog: Katalog, apps: Zonenapps): Promise<Zonenstand> {
        const je = new Map<string, string[]>();
        for (const appId of await apps.alle()) {
            const daten = await apps.lies(appId);
            if (daten?.handydaten.zonen === true) {
                for (const zone of daten.zonenwahl ?? []) {
                    je.set(zone, [...(je.get(zone) ?? []), daten.name]);
                }
            }
        }
        for (const namen of je.values()) {
            namen.sort((a, b) => a.localeCompare(b));
        }
        const vorschlaege: Zonenstand['vorschlaege'] = [];
        for (const { appId, ...v } of this.o.vorschlaege?.() ?? []) {
            const name = (await apps.lies(appId))?.name;
            if (name !== undefined) {
                vorschlaege.push({ app: name, ...v });
            }
        }
        return {
            sprache: katalog.sprache,
            zonen: katalog.zonen().map(([id, z]) => ({ id, ...structuredClone(z), apps: je.get(id) ?? [] })),
            zuhause: katalog.zuhause() ?? null,
            hoechstens: ZONEN_HOECHSTENS,
            laengen: { name: ZONENNAME_LAENGE, id: ZONENID_LAENGE },
            radius: { von: RADIUS_VON, bis: RADIUS_BIS, vorgabe: RADIUS_VORGABE },
            vorschlaege,
            jetzt: (this.o.jetzt ?? Date.now)(),
        };
    }
}
