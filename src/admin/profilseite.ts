import type { Katalog } from '../app/katalog';
import type { Appablage, Eintragsablage } from '../app/objekte';
import {
    type Kartentyp,
    PROFILNAME_LAENGE,
    type Profil,
    type Recht,
    alsProfil,
    istPersoenlich,
    maengelDerKarte,
    sicht,
} from '../app/rechte';
import type { Protokoll } from '../basis/grenzen';
import { type Ablehnung, Eintraege, nachricht, raeumeFuerSeiten, seitenadresse } from './eintraege';

// Über sendTo von der Profilseite (admin/profile.html), eingebettet im Reiter „Profile“ der Instanzeinstellungen
export const PROFILBEFEHLE: readonly string[] = [
    'profilseite',
    'profilstand',
    'profilvorschau',
    'speichereProfil',
    'loescheProfil',
];

// Was die Seite zu einer Karte braucht, um sie im Profil anzubieten und zu erklären, warum sie fehlt
export interface Profilkarte {
    id: string;
    name: string;
    typ: Kartentyp;
    raum: string;
    // Mit Anrufen oder Benachrichtigungen der Apps: nur einzeln freigebbar
    persoenlich: boolean;
    // Fehlt auf den Handys, weil ein Pflichtteil nicht passt
    fehlt: boolean;
}

export interface Profilzeile extends Profil {
    id: string;
    // Was eine App mit diesem Profil sieht, je Karte
    sieht: Record<string, Recht>;
    // Namen der Apps mit diesem Profil
    apps: string[];
}

export interface Profilstand {
    sprache: string;
    raeume: { id: string; name: string }[];
    karten: Profilkarte[];
    profile: Profilzeile[];
    laengen: { name: number };
}

// Nur die Felder eines Profils, ohne Leerraum am Namen; prüfen muss danach alsProfil.
function bereinigt(roh: unknown): unknown {
    if (!roh || typeof roh !== 'object' || Array.isArray(roh)) {
        return roh;
    }
    const r = roh as Record<string, unknown>;
    const nur =
        (felder: string[]) =>
        (w: unknown): unknown =>
            w && typeof w === 'object' && !Array.isArray(w)
                ? Object.fromEntries(felder.map(f => [f, (w as Record<string, unknown>)[f]]))
                : w;
    const je = (w: unknown, f: (x: unknown) => unknown): unknown => (Array.isArray(w) ? w.map(f) : w);
    return {
        name: typeof r.name === 'string' ? r.name.trim() : r.name,
        raeume: je(r.raeume, nur(['enum', 'recht'])),
        karten: je(r.karten, nur(['id', 'recht'])),
        gesperrt: je(r.gesperrt, x => x),
    };
}

const pruefe = (roh: unknown): Profil | string[] => alsProfil(bereinigt(roh));

// Profile im Reiter „Profile“: anzeigen mit dem, was eine App damit sieht, Vorschau beim Bearbeiten, anlegen, ändern,
// löschen. Welche App welches Profil hat, bleibt im Gerätemanager.
export class Profilseite {
    private readonly profile: Eintraege<Profil>;

    public constructor(
        private readonly o: {
            namespace: string;
            // undefined, solange der Start nicht so weit ist
            katalog: () => Katalog | undefined;
            ablage: Eintragsablage & Pick<Appablage, 'alle' | 'lies'>;
            log: Protokoll;
            jetzt?: () => number;
        },
    ) {
        this.profile = new Eintraege(
            {
                ordner: 'profile',
                kennbuchstabe: 'p',
                was: 'Profil',
                pruefe,
                imKatalog: (katalog, id) => katalog.profil(id),
                anzahl: katalog => katalog.alleProfile().length,
            },
            o,
        );
    }

    public async beantworte(befehl: string, roh: unknown): Promise<unknown> {
        if (befehl === 'profilseite') {
            return seitenadresse(this.o.namespace, 'profile.html');
        }
        const katalog = this.o.katalog();
        if (!katalog) {
            return { fehler: 'nichtBereit' } satisfies Ablehnung;
        }
        const n = nachricht(roh);
        switch (befehl) {
            case 'profilstand':
                return this.stand(katalog);
            case 'profilvorschau':
                return this.vorschau(katalog, n.profil);
            case 'speichereProfil':
                return this.mitStand(katalog, await this.profile.speichere(katalog, n.id, n.profil));
            case 'loescheProfil':
                return this.mitStand(katalog, await this.profile.loesche(katalog, n.id));
            default:
                return undefined;
        }
    }

    private async mitStand(katalog: Katalog, antwort: { id: string } | Ablehnung): Promise<unknown> {
        return 'fehler' in antwort ? antwort : { id: antwort.id, stand: await this.stand(katalog) };
    }

    // Der Name zählt hier nicht; ohne ihn ginge beim Anlegen keine Vorschau.
    private vorschau(katalog: Katalog, roh: unknown): { sieht: Record<string, Recht> } | Ablehnung {
        const profil = pruefe({ ...nachricht(roh), name: '-' });
        return Array.isArray(profil)
            ? { fehler: 'ungueltig', einzelheiten: profil }
            : { sieht: sicht(profil, katalog) };
    }

    private async stand(katalog: Katalog): Promise<Profilstand> {
        const sprache = katalog.sprache;
        const apps = await this.appsJeProfil();
        return {
            sprache,
            raeume: raeumeFuerSeiten(katalog),
            karten: katalog.karten().map(([id, k]) => ({
                id,
                name: k.name,
                typ: k.typ,
                raum: k.raum,
                persoenlich: istPersoenlich(k, katalog),
                fehlt: maengelDerKarte(k, dp => katalog.datenpunkt(dp)).folge === 'fehlt',
            })),
            profile: katalog.alleProfile().map(([id, p]) => ({
                id,
                ...structuredClone(p),
                sieht: sicht(p, katalog),
                apps: apps.get(id) ?? [],
            })),
            laengen: { name: PROFILNAME_LAENGE },
        };
    }

    private async appsJeProfil(): Promise<Map<string, string[]>> {
        const je = new Map<string, string[]>();
        for (const appId of await this.o.ablage.alle()) {
            const app = await this.o.ablage.lies(appId);
            if (app?.profil) {
                je.set(app.profil, [...(je.get(app.profil) ?? []), app.name]);
            }
        }
        for (const namen of je.values()) {
            namen.sort((a, b) => a.localeCompare(b));
        }
        return je;
    }
}
