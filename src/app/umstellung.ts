import type { Protokoll } from '../basis/grenzen';
import type { Katalogquelle } from './katalog';
import { type Zeile, zeileAusKarte, zeileAusProfil } from './konfiguration';
import { KARTENARTEN, alsKarte, alsProfil, istKennung, liegtUnter } from './rechte';

const LAMPENTEILE = Object.keys(KARTENARTEN.lampe.teile);

export interface Umstellungsablage {
    // Hängt Zeilen an die Karten und Profile der Instanzeinstellungen an; ioBroker startet die Instanz danach neu.
    ergaenzeEinstellungen(karten: Zeile[], profile: Zeile[]): Promise<void>;
    // ID ohne Namespace
    loescheObjekt(id: string): Promise<void>;
}

export interface Uebernommen {
    karten: Zeile[];
    profile: Zeile[];
}

interface Stand extends Uebernommen {
    loeschen: string[];
    ids: { karten: Set<string>; profile: Set<string> };
}

/**
 * Beim Start (KONZEPT-KARTEN.md, Abschnitt 7): Was frühere Stände als Objekte abgelegt haben, kommt in die
 * Instanzeinstellungen, danach sind die Objekte weg. Aus 0.1.x werden Geräte (`geraete.*`) zu Lampenkarten, Profile
 * (`profile.*`) verlieren die Freigaben und Sperren von Datenpunkten; aus dem Entwicklungsstand von 0.2.0 kommen Karten
 * (`karten.*`) und Profile mit Karten. Eine ID, die es in den Einstellungen schon gibt, gewinnt dort; so schadet ein
 * zweiter Lauf nach einem Abbruch nicht. Liefert die übernommenen Zeilen: Der Start nimmt sie gleich dazu, statt auf den
 * Neustart durch ioBroker zu warten, der dann nichts mehr umzustellen findet.
 */
export async function stelleUm(
    namespace: string,
    quelle: Katalogquelle,
    einstellungen: { karten?: unknown; profile?: unknown },
    ablage: Umstellungsablage,
    log: Protokoll,
): Promise<Uebernommen> {
    const ids = (zeilen: unknown): Set<string> =>
        new Set(
            Array.isArray(zeilen) ? zeilen.map(z => (z as Zeile | null)?.id).filter(id => typeof id === 'string') : [],
        );
    const stand: Stand = {
        karten: [],
        profile: [],
        loeschen: [],
        ids: { karten: ids(einstellungen.karten), profile: ids(einstellungen.profile) },
    };
    await geraeteZuKarten(namespace, quelle, stand, log);
    await kartenobjekte(namespace, quelle, stand, log);
    await profilobjekte(namespace, quelle, stand, log);
    if (stand.karten.length + stand.profile.length > 0) {
        await ablage.ergaenzeEinstellungen(stand.karten, stand.profile);
        log.info(
            `${stand.karten.length} Karten und ${stand.profile.length} Profile in die Instanzeinstellungen übernommen`,
        );
    }
    // Erst nach dem Schreiben: Bricht es ab, sind die Objekte noch da.
    for (const id of stand.loeschen) {
        await ablage.loescheObjekt(id);
    }
    return { karten: stand.karten, profile: stand.profile };
}

// In jeder Liste gewinnt die erste Zeile einer ID; ein Objekt, dessen ID es gibt, ist schon übernommen.
function uebernimm(stand: Stand, liste: 'karten' | 'profile', id: string, zeile: Zeile): boolean {
    if (stand.ids[liste].has(id)) {
        return false;
    }
    stand.ids[liste].add(id);
    stand[liste].push(zeile);
    return true;
}

async function geraeteZuKarten(namespace: string, quelle: Katalogquelle, stand: Stand, log: Protokoll): Promise<void> {
    const praefix = `${namespace}.geraete.`;
    const geraete = await quelle.objekte('config', praefix);
    if (geraete.length === 0) {
        return;
    }
    const raeume = (await quelle.objekte('enum', 'enum.rooms.')).sort((a, b) => a._id.localeCompare(b._id));
    for (const objekt of geraete) {
        const id = objekt._id.slice(praefix.length);
        const native = objekt.native as { name?: unknown; teile?: Record<string, unknown> } | undefined;
        const teile = Object.fromEntries(
            LAMPENTEILE.map(teil => [teil, native?.teile?.[teil]]).filter(([, dp]) => typeof dp === 'string'),
        ) as Record<string, string>;
        // Der erste Raum, in dem eines der Teile liegt, in der Reihenfolge der Teile
        const raum =
            Object.values(teile)
                .map(dp => raeume.find(r => mitglieder(r).some(m => liegtUnter(dp, m)))?._id)
                .find(r => r !== undefined) ?? '';
        const karte = alsKarte({ name: native?.name, typ: 'lampe', raum, teile });
        if (!istKennung(id) || Array.isArray(karte)) {
            log.warn(`Gerät ${id} bleibt stehen, es lässt sich nicht in eine Karte umwandeln`);
            continue;
        }
        if (uebernimm(stand, 'karten', id, zeileAusKarte(id, karte))) {
            log.info(`Gerät ${id} ist jetzt eine Lampenkarte`);
        } else {
            log.warn(`Gerät ${id} entfernt, eine Karte mit dieser ID gibt es schon`);
        }
        stand.loeschen.push(`geraete.${id}`);
    }
}

function mitglieder(raum: ioBroker.Object): string[] {
    const members: unknown = raum.common?.members;
    return Array.isArray(members) ? members.filter(m => typeof m === 'string') : [];
}

async function kartenobjekte(namespace: string, quelle: Katalogquelle, stand: Stand, log: Protokoll): Promise<void> {
    const praefix = `${namespace}.karten.`;
    for (const objekt of await quelle.objekte('config', praefix)) {
        const id = objekt._id.slice(praefix.length);
        const karte = alsKarte(objekt.native);
        if (!istKennung(id) || Array.isArray(karte)) {
            log.warn(`Kartenobjekt ${id} bleibt stehen, es ist unbrauchbar`);
            continue;
        }
        uebernimm(stand, 'karten', id, zeileAusKarte(id, karte));
        stand.loeschen.push(`karten.${id}`);
    }
}

async function profilobjekte(namespace: string, quelle: Katalogquelle, stand: Stand, log: Protokoll): Promise<void> {
    const praefix = `${namespace}.profile.`;
    for (const objekt of await quelle.objekte('config', praefix)) {
        const id = objekt._id.slice(praefix.length);
        const native = (objekt.native ?? {}) as Record<string, unknown>;
        const profil = alsProfil({
            name: native.name,
            raeume: native.raeume ?? [],
            karten: native.karten ?? [],
            gesperrt: native.gesperrt ?? [],
        });
        if (!istKennung(id) || Array.isArray(profil)) {
            log.warn(`Profilobjekt ${id} bleibt stehen, es ist unbrauchbar und gibt keine Rechte`);
            continue;
        }
        uebernimm(stand, 'profile', id, zeileAusProfil(id, profil));
        stand.loeschen.push(`profile.${id}`);
        const anzahl = (w: unknown): number => (Array.isArray(w) ? w.length : 0);
        const freigaben = anzahl(native.freigaben);
        const sperren = anzahl(native.sperren);
        if (freigaben + sperren > 0) {
            log.warn(
                `Profil ${id}: ${freigaben} Freigaben und ${sperren} Sperren von Datenpunkten entfernt, bitte Karten freigeben`,
            );
        }
    }
}
