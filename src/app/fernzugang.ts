import type { Duplex } from 'node:stream';
import gemeinsam from '../../protokoll/v1/gemeinsam.schema.json';
import {
    adapterSchluessel,
    appSchluessel,
    konfigurationszeile,
    neuesFerngeheimnis,
    vermittlerHash,
} from '../basis/fernschluessel';
import type { Protokoll } from '../basis/grenzen';
import type { Herkunft } from '../basis/kern';
import { erstellePruefer } from '../basis/schema';
import { Fern, type Fernapp, type Fernstand } from '../zugang/fern';
import type { Fernzugang } from './dienst';
import type { Appablage } from './objekte';

// adresse leer: Fernzugang aus. geheimnis im Klartext; verschlüsselt wird beim Ablegen.
export interface Ferneinstellung {
    adresse: string;
    geheimnis: string;
}

export interface Fernablage {
    // undefined, wenn es noch keine gibt oder sie unbrauchbar ist
    lies(): Promise<Ferneinstellung | undefined>;
    schreibe(einstellung: Ferneinstellung): Promise<void>;
}

export type Fernlage = { art: 'aus' } | Fernstand;

export interface FernverwaltungOptionen {
    adapterId: string;
    ablage: Fernablage;
    apps: Appablage;
    nimm: (strom: Duplex, herkunft: Herkunft) => void;
    log: Protokoll;
    // info.fernzugang
    verbunden: (ja: boolean) => void;
    // Adresse oder Geheimnis neu: Die Apps bekommen den neuen Stand.
    geaendert: () => void;
}

const pruefeVermittler = erstellePruefer({ $ref: `${gemeinsam.$id}#/$defs/vermittler` }, [gemeinsam]);
const ABGLEICH_MS = 500;

export const istVermittleradresse = (adresse: string): boolean => pruefeVermittler(adresse).length === 0;

// Hält Einstellung und Verbindung zum Vermittler; eine neue Adresse oder ein neues Geheimnis baut die Verbindung neu auf.
export class Fernverwaltung {
    private einstellung: Ferneinstellung = { adresse: '', geheimnis: '' };
    private fern?: Fern;
    private lage: Fernlage = { art: 'aus' };
    private abgleich?: NodeJS.Timeout;
    // Änderungen nacheinander, jede aus dem Stand der vorigen; sonst stellte ein gleichzeitiges Speichern der Adresse
    // das alte Geheimnis wieder her
    private aenderungen: Promise<void> = Promise.resolve();

    public constructor(private readonly o: FernverwaltungOptionen) {}

    public get stand(): Fernlage {
        return this.lage;
    }

    public get adresse(): string {
        return this.einstellung.adresse;
    }

    public get zeile(): string {
        return konfigurationszeile(this.o.adapterId, this.einstellung.geheimnis);
    }

    public async starte(): Promise<void> {
        const gelesen = await this.o.ablage.lies();
        if (gelesen) {
            this.einstellung = gelesen;
        } else {
            this.einstellung = { adresse: '', geheimnis: neuesFerngeheimnis() };
            await this.o.ablage.schreibe(this.einstellung);
            this.o.log.info('Geheimnis für den Fernzugang erzeugt');
        }
        this.verbinde();
    }

    public zugang(): Fernzugang | undefined {
        const { adresse, geheimnis } = this.einstellung;
        return adresse ? { adresse, geheimnis } : undefined;
    }

    // Fehler als Text für die Seite, leer bei Erfolg
    public async setzeAdresse(eingabe: string): Promise<string[]> {
        const adresse = eingabe.trim().replace(/\/+$/, '');
        if (adresse && pruefeVermittler(adresse).length > 0) {
            return ['Adresse ungültig: nur https:// mit Namen, ohne Abfrage und Anker'];
        }
        await this.uebernimm(alt => {
            if (adresse === alt.adresse) {
                return undefined;
            }
            this.o.log.info(adresse ? `Fernzugang über ${adresse}` : 'Fernzugang ausgeschaltet');
            return { ...alt, adresse };
        });
        return [];
    }

    public async neuesGeheimnis(): Promise<void> {
        await this.uebernimm(alt => ({ ...alt, geheimnis: neuesFerngeheimnis() }));
        this.o.log.warn(
            'Fernzugang: Schlüssel neu erzeugt. Der Vermittler braucht die neue Zeile, ' +
                'die Apps ihren neuen Schlüssel beim nächsten Verbinden im Heimnetz.',
        );
    }

    // Freigabe, Kopplung oder Entfernen einer App; gesammelt, weil ein Speichern mehrere Objektänderungen auslöst
    public appsGeaendert(): void {
        clearTimeout(this.abgleich);
        this.abgleich = setTimeout(() => {
            this.fern?.abgleich().catch((fehler: Error) => this.o.log.error(`Fernzugang, Abgleich: ${fehler.message}`));
        }, ABGLEICH_MS);
    }

    public beende(): void {
        clearTimeout(this.abgleich);
        this.fern?.beende();
        this.fern = undefined;
    }

    // neu: undefined heißt keine Änderung
    private uebernimm(neu: (alt: Ferneinstellung) => Ferneinstellung | undefined): Promise<void> {
        const lauf = this.aenderungen.then(async () => {
            const einstellung = neu(this.einstellung);
            if (!einstellung) {
                return;
            }
            await this.o.ablage.schreibe(einstellung);
            this.einstellung = einstellung;
            this.verbinde();
            this.o.geaendert();
        });
        this.aenderungen = lauf.catch(() => undefined);
        return lauf;
    }

    private verbinde(): void {
        this.fern?.beende();
        this.fern = undefined;
        const { adresse, geheimnis } = this.einstellung;
        if (!adresse) {
            this.setze({ art: 'aus' });
            return;
        }
        const fern: Fern = new Fern({
            adresse,
            adapterSchluessel: adapterSchluessel(geheimnis),
            apps: () => this.freigegebene(geheimnis),
            nimm: this.o.nimm,
            log: this.o.log,
            stand: stand => {
                if (this.fern === fern) {
                    this.setze(stand);
                }
            },
        });
        this.fern = fern;
        fern.starte();
    }

    private setze(lage: Fernlage): void {
        const vorher = this.lage.art === 'verbunden';
        this.lage = lage;
        if (vorher !== (lage.art === 'verbunden')) {
            this.o.verbunden(lage.art === 'verbunden');
        }
    }

    private async freigegebene(geheimnis: string): Promise<Fernapp[]> {
        const liste: Fernapp[] = [];
        for (const appId of await this.o.apps.alle()) {
            const daten = await this.o.apps.lies(appId);
            if (daten?.fern === true) {
                liste.push({ appId, hash: vermittlerHash(appSchluessel(geheimnis, appId, daten.zugangHash)) });
            }
        }
        return liste;
    }
}
