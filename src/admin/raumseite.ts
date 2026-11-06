import type { Katalog } from '../app/katalog';
import type { Eintragsablage } from '../app/objekte';
import {
    ETAGEN_HOECHSTENS,
    ETAGENKURZ_LAENGE,
    ETAGENNAME_LAENGE,
    type Etage,
    alsEtage,
    istKennung,
} from '../app/rechte';
import type { Protokoll } from '../basis/grenzen';
import { type Ablehnung, Eintraege, nachricht, raeumeFuerSeiten, seitenadresse } from './eintraege';

// Über sendTo von der Raumseite (admin/raeume.html), eingebettet im Reiter „Räume“ der Instanzeinstellungen
export const RAUMBEFEHLE: readonly string[] = [
    'raumseite',
    'raumstand',
    'speichereEtage',
    'loescheEtage',
    'ordneRaeume',
];

export interface Raumstand {
    sprache: string;
    // In der Reihenfolge der App, mit der Zahl ihrer Karten
    raeume: { id: string; name: string; karten: number }[];
    // Von oben nach unten; raeume nur, was es gibt, jeder Raum nur in der oberen Etage
    etagen: { id: string; name: string; kurz: string; raeume: string[] }[];
    laengen: { name: number; kurz: number };
    hoechstens: number;
}

const ohneLeerraum = (w: unknown): unknown => (typeof w === 'string' ? w.trim() : w);

/**
 * Etagen anlegen, umbenennen, löschen und die Räume ordnen (KONZEPT-KARTEN.md, Abschnitt 13). Die Seite schickt beim
 * Speichern einer Etage nur Name und Kurzname; Position und Räume behält die Instanz. Ordnen schickt die ganze Folge.
 */
export class Raumseite {
    private readonly etagen: Eintraege<Etage>;

    public constructor(
        private readonly o: {
            namespace: string;
            katalog: () => Katalog | undefined;
            ablage: Eintragsablage;
            log: Protokoll;
            jetzt?: () => number;
        },
    ) {
        this.etagen = new Eintraege<Etage>(
            {
                ordner: 'etagen',
                kennbuchstabe: 'e',
                was: 'Etage',
                pruefe: alsEtage,
                imKatalog: (katalog, id) => katalog.alleEtagen().find(([e]) => e === id)?.[1],
                anzahl: katalog => katalog.alleEtagen().length,
                hoechstens: ETAGEN_HOECHSTENS,
            },
            o,
        );
    }

    public async beantworte(befehl: string, roh: unknown): Promise<unknown> {
        if (befehl === 'raumseite') {
            return seitenadresse(this.o.namespace, 'raeume.html');
        }
        const katalog = this.o.katalog();
        if (!katalog) {
            return { fehler: 'nichtBereit' } satisfies Ablehnung;
        }
        const n = nachricht(roh);
        switch (befehl) {
            case 'raumstand':
                return this.stand(katalog);
            case 'speichereEtage':
                return this.mitStand(katalog, await this.speichereEtage(katalog, n.id, n.etage));
            case 'loescheEtage':
                return this.mitStand(katalog, await this.etagen.loesche(katalog, n.id));
            case 'ordneRaeume':
                return this.mitStand(katalog, await this.ordne(katalog, n.etagen));
            default:
                return undefined;
        }
    }

    private mitStand(katalog: Katalog, antwort: { id: string } | Ablehnung): unknown {
        return 'fehler' in antwort ? antwort : { id: antwort.id, stand: this.stand(katalog) };
    }

    // Eine neue Etage kommt nach unten und ist leer; eine bestehende behält Position und Räume.
    private speichereEtage(katalog: Katalog, id: unknown, roh: unknown): Promise<{ id: string } | Ablehnung> {
        const n = nachricht(roh);
        const alle = katalog.alleEtagen();
        const bisher = id === undefined ? undefined : alle.find(([e]) => e === id)?.[1];
        const etage = {
            name: ohneLeerraum(n.name),
            kurz: ohneLeerraum(n.kurz),
            position: bisher?.position ?? (alle.length > 0 ? Math.max(...alle.map(([, e]) => e.position)) + 1 : 0),
            raeume: bisher?.raeume ?? [],
        };
        return this.etagen.speichere(katalog, id, etage);
    }

    // Die Seite schickt die Etagen von oben nach unten, je mit ihren Räumen. Geschrieben wird nur, was sich ändert; ein
    // Raum, den es nicht gibt oder der schon weiter oben steht, fällt weg.
    private async ordne(katalog: Katalog, roh: unknown): Promise<{ id: string } | Ablehnung> {
        if (!Array.isArray(roh) || roh.length > ETAGEN_HOECHSTENS) {
            return { fehler: 'ungueltig', einzelheiten: ['etagen'] };
        }
        const bisher = new Map(katalog.alleEtagen());
        const raeume = new Set(katalog.raeume().map(r => r.id));
        const vergeben = new Set<string>();
        const folge: [string, Etage][] = [];
        for (const eintrag of roh) {
            const e = nachricht(eintrag);
            const alt = istKennung(e.id) ? bisher.get(e.id) : undefined;
            if (!alt || !Array.isArray(e.raeume) || folge.some(([id]) => id === e.id)) {
                return { fehler: 'weg' };
            }
            const eigene = e.raeume.filter(
                (r): r is string => typeof r === 'string' && raeume.has(r) && !vergeben.has(r),
            );
            eigene.forEach(r => vergeben.add(r));
            folge.push([e.id as string, { ...alt, position: folge.length, raeume: eigene }]);
        }
        // Etagen, die die Seite nicht kannte, etwa aus einem anderen Fenster, bleiben darunter.
        for (const [id, alt] of bisher) {
            if (!folge.some(([e]) => e === id)) {
                folge.push([id, { ...alt, position: folge.length, raeume: alt.raeume.filter(r => !vergeben.has(r)) }]);
            }
        }
        for (const [id, neu] of folge) {
            const alt = bisher.get(id)!;
            if (alt.position !== neu.position || alt.raeume.join('\n') !== neu.raeume.join('\n')) {
                const antwort = await this.etagen.speichere(katalog, id, neu);
                if ('fehler' in antwort) {
                    return antwort;
                }
            }
        }
        return { id: '' };
    }

    private stand(katalog: Katalog): Raumstand {
        const sprache = katalog.sprache;
        const karten = new Map<string, number>();
        for (const [, k] of katalog.karten()) {
            karten.set(k.raum, (karten.get(k.raum) ?? 0) + 1);
        }
        return {
            sprache,
            raeume: raeumeFuerSeiten(katalog).map(r => ({ ...r, karten: karten.get(r.id) ?? 0 })),
            etagen: katalog.alleEtagen().map(([id, e]) => ({
                id,
                name: e.name,
                kurz: e.kurz,
                raeume: katalog
                    .raeume()
                    .filter(r => r.etage === id)
                    .map(r => r.id),
            })),
            laengen: { name: ETAGENNAME_LAENGE, kurz: ETAGENKURZ_LAENGE },
            hoechstens: ETAGEN_HOECHSTENS,
        };
    }
}
