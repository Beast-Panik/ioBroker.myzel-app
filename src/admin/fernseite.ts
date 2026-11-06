import gemeinsam from '../../protokoll/v1/gemeinsam.schema.json';
import type { Fernlage, Fernverwaltung } from '../app/fernzugang';
import type { Appablage } from '../app/objekte';
import type { Weg } from '../basis/kern';
import { erstellePruefer } from '../basis/schema';
import { type Ablehnung, nachricht, seitenadresse } from './eintraege';

// Über sendTo von der Seite des Fernzugangs (admin/fern.html), eingebettet im Reiter „Fernzugang“
export const FERNBEFEHLE: readonly string[] = [
    'fernseite',
    'fernstand',
    'fernAdresse',
    'fernFreigabe',
    'fernSchluessel',
];

export interface Fernstandseite {
    sprache: string;
    adresse: string;
    lage: Fernlage;
    // Uhr des Adapters: Die Seite rechnet „neuer Versuch in“ damit, nicht mit der Uhr des Browsers.
    jetzt: number;
    // Für MYZEL_ADAPTER auf dem Vermittler; nur ein Prüfwert
    zeile: string;
    // Nach Name
    apps: { id: string; name: string; gekoppeltAm: number; fern: boolean; verbunden?: Weg }[];
}

export interface Fernbetrieb {
    fern: Fernverwaltung;
    ablage: Appablage;
    verbindungen: () => ReadonlyMap<string, Weg>;
    sprache: string;
}

const pruefeAppId = erstellePruefer({ $ref: `${gemeinsam.$id}#/$defs/appId` }, [gemeinsam]);

/**
 * Adresse des Vermittlers, Freigabe je App und neues Geheimnis (KONZEPT-FERNZUGANG.md, Abschnitt 12). Die Freigabe
 * landet im Objekt der App; Rechte, Trennen und Abgleich mit dem Vermittler folgen aus dessen Änderung.
 */
export class Fernseite {
    public constructor(
        private readonly o: { namespace: string; betrieb: () => Fernbetrieb | undefined; jetzt?: () => number },
    ) {}

    public async beantworte(befehl: string, roh: unknown): Promise<unknown> {
        if (befehl === 'fernseite') {
            return seitenadresse(this.o.namespace, 'fern.html');
        }
        const b = this.o.betrieb();
        if (!b) {
            return { fehler: 'nichtBereit' } satisfies Ablehnung;
        }
        const n = nachricht(roh);
        switch (befehl) {
            case 'fernstand':
                return this.stand(b);
            case 'fernAdresse': {
                if (typeof n.adresse !== 'string') {
                    return { fehler: 'ungueltig', einzelheiten: ['adresse'] } satisfies Ablehnung;
                }
                const fehler = await b.fern.setzeAdresse(n.adresse);
                return fehler.length > 0
                    ? ({ fehler: 'ungueltig', einzelheiten: fehler } satisfies Ablehnung)
                    : this.stand(b);
            }
            case 'fernFreigabe': {
                if (typeof n.app !== 'string' || pruefeAppId(n.app).length > 0 || typeof n.fern !== 'boolean') {
                    return { fehler: 'ungueltig', einzelheiten: ['app', 'fern'] } satisfies Ablehnung;
                }
                if (!(await b.ablage.lies(n.app))) {
                    return { fehler: 'weg' } satisfies Ablehnung;
                }
                await b.ablage.aendere(n.app, { fern: n.fern });
                return this.stand(b);
            }
            case 'fernSchluessel':
                await b.fern.neuesGeheimnis();
                return this.stand(b);
            default:
                return undefined;
        }
    }

    private async stand(b: Fernbetrieb): Promise<Fernstandseite> {
        const verbindungen = b.verbindungen();
        const apps: Fernstandseite['apps'] = [];
        for (const id of await b.ablage.alle()) {
            const daten = await b.ablage.lies(id);
            if (daten) {
                const verbunden = verbindungen.get(id);
                apps.push({
                    id,
                    name: daten.name,
                    gekoppeltAm: daten.gekoppeltAm,
                    fern: daten.fern === true,
                    ...(verbunden && { verbunden }),
                });
            }
        }
        apps.sort((x, y) => x.name.localeCompare(y.name, 'de') || x.id.localeCompare(y.id));
        return {
            sprache: b.sprache,
            adresse: b.fern.adresse,
            lage: b.fern.stand,
            jetzt: (this.o.jetzt ?? Date.now)(),
            zeile: b.fern.zeile,
            apps,
        };
    }
}
