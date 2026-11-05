import type { Protokoll } from '../basis/grenzen';
import type { Katalogquelle } from './katalog';
import { karteAusZeile, lies, profilAusZeile } from './konfiguration';
import type { Eintragsablage, Ordner } from './objekte';
import { KARTENARTEN, alsEtage, alsKarte, alsProfil, istKennung, liegtUnter } from './rechte';

const LAMPENTEILE = Object.keys(KARTENARTEN.lampe.teile);

export interface Umstellungsablage extends Eintragsablage {
    // Leert Karten und Profile in den Instanzeinstellungen; ioBroker startet die Instanz danach neu.
    leereEinstellungen(): Promise<void>;
    // ID ohne Namespace
    loescheObjekt(id: string): Promise<void>;
}

const BRAUCHBAR: Record<Ordner, (native: unknown) => boolean> = {
    karten: native => !Array.isArray(alsKarte(native)),
    profile: native => !Array.isArray(alsProfil(native)),
    etagen: native => !Array.isArray(alsEtage(native)),
};

/**
 * Beim Start (KONZEPT-KARTEN.md, Abschnitte 7 und 12). Karten und Profile sind Objekte unter `karten.*` und `profile.*`.
 * Was von K3 bis 0.3.x in den Instanzeinstellungen stand, wird dazu, ebenso Geräte (`geraete.*`) aus 0.1.x als
 * Lampenkarten. Profilobjekte aus 0.1.x verlieren die Freigaben und Sperren von Datenpunkten. Ein brauchbares Objekt mit
 * derselben ID gewinnt: Es ist neuer, etwa wenn eine Admin-Seite von vor dem Update alte Zeilen zurückschrieb. So schadet
 * auch ein zweiter Lauf nach einem Abbruch nicht. Erst schreiben, dann die Einstellungen leeren, dann löschen.
 */
export async function stelleUm(
    namespace: string,
    quelle: Katalogquelle,
    einstellungen: { karten?: unknown; profile?: unknown },
    ablage: Umstellungsablage,
    log: Protokoll,
): Promise<void> {
    const loeschen: string[] = [];
    let karten = 0;
    let profile = 0;
    for (const [id, karte] of lies(einstellungen.karten, 'Karte', 'wird nicht übernommen', karteAusZeile, log)) {
        karten += Number(await legeAn(ablage, 'karten', id, karte));
    }
    karten += await geraeteZuKarten(namespace, quelle, ablage, loeschen, log);
    for (const [id, profil] of lies(einstellungen.profile, 'Profil', 'wird nicht übernommen', profilAusZeile, log)) {
        profile += Number(await legeAn(ablage, 'profile', id, profil));
    }
    profile += await bereinigeProfilobjekte(namespace, quelle, ablage, log);
    const voll = (liste: unknown): boolean => Array.isArray(liste) && liste.length > 0;
    if (voll(einstellungen.karten) || voll(einstellungen.profile)) {
        await ablage.leereEinstellungen();
    }
    if (karten + profile > 0) {
        log.info(`${karten} Karten und ${profile} Profile als Objekte übernommen`);
    }
    for (const id of loeschen) {
        await ablage.loescheObjekt(id);
    }
}

// false, wenn ein brauchbares Objekt mit dieser ID schon da ist; ein unbrauchbares wird ersetzt.
async function legeAn(
    ablage: Umstellungsablage,
    ordner: Ordner,
    id: string,
    eintrag: { name: string },
): Promise<boolean> {
    const da = await ablage.liesEintrag(ordner, id);
    if (da !== undefined && BRAUCHBAR[ordner](da)) {
        return false;
    }
    await ablage.schreibeEintrag(ordner, id, eintrag.name, eintrag);
    return true;
}

async function geraeteZuKarten(
    namespace: string,
    quelle: Katalogquelle,
    ablage: Umstellungsablage,
    loeschen: string[],
    log: Protokoll,
): Promise<number> {
    const praefix = `${namespace}.geraete.`;
    const geraete = await quelle.objekte('config', praefix);
    if (geraete.length === 0) {
        return 0;
    }
    let angelegt = 0;
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
        if (await legeAn(ablage, 'karten', id, karte)) {
            angelegt++;
            log.info(`Gerät ${id} ist jetzt eine Lampenkarte`);
        } else {
            log.warn(`Gerät ${id} entfernt, eine Karte mit dieser ID gibt es schon`);
        }
        loeschen.push(`geraete.${id}`);
    }
    return angelegt;
}

function mitglieder(raum: ioBroker.Object): string[] {
    const members: unknown = raum.common?.members;
    return Array.isArray(members) ? members.filter(m => typeof m === 'string') : [];
}

// Profilobjekte aus 0.1.x haben Freigaben und Sperren von Datenpunkten, aber keine Karten. Sie werden an Ort und Stelle
// zu Profilen; ein unbrauchbares bleibt stehen, das meldet der Katalog.
async function bereinigeProfilobjekte(
    namespace: string,
    quelle: Katalogquelle,
    ablage: Umstellungsablage,
    log: Protokoll,
): Promise<number> {
    const praefix = `${namespace}.profile.`;
    let bereinigt = 0;
    for (const objekt of await quelle.objekte('config', praefix)) {
        const id = objekt._id.slice(praefix.length);
        const native = (objekt.native ?? {}) as Record<string, unknown>;
        const anzahl = (w: unknown): number => (Array.isArray(w) ? w.length : 0);
        const alt = 'freigaben' in native || 'sperren' in native;
        if (!istKennung(id) || (!alt && BRAUCHBAR.profile(native))) {
            continue;
        }
        const profil = alsProfil({
            name: native.name,
            raeume: native.raeume ?? [],
            karten: native.karten ?? [],
            gesperrt: native.gesperrt ?? [],
        });
        if (Array.isArray(profil)) {
            continue;
        }
        await ablage.schreibeEintrag('profile', id, profil.name, profil);
        bereinigt++;
        const freigaben = anzahl(native.freigaben);
        const sperren = anzahl(native.sperren);
        if (freigaben + sperren > 0) {
            log.warn(
                `Profil ${id}: ${freigaben} Freigaben und ${sperren} Sperren von Datenpunkten entfernt, bitte Karten freigeben`,
            );
        }
    }
    return bereinigt;
}
