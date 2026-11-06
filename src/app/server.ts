import type { Duplex } from 'node:stream';
import { Anmeldung } from '../basis/anmeldung';
import type { Grenzen, Protokoll } from '../basis/grenzen';
import { type Herkunft, Kern } from '../basis/kern';
import { Kopplung } from '../basis/kopplung';
import { Sperrliste, sperrbereich } from '../basis/schutz';
import type { Identitaet } from '../basis/zertifikat';
import { Heimnetz } from '../zugang/heimnetz';
import { Dienst, appPruefer } from './dienst';
import { type Fernablage, Fernverwaltung } from './fernzugang';
import type { Katalog } from './katalog';
import type { Appablage } from './objekte';
import type { Zustandsquelle } from './werte';

export interface ServerOptionen {
    adapterId: string;
    namespace: string;
    identitaet: Identitaet;
    ablage: Appablage;
    port: number;
    adressen: () => string[];
    katalog: Katalog;
    zustaende: Zustandsquelle;
    log: Protokoll;
    zustand: (laeuft: boolean) => void;
    nachlaufMs: number;
    textLaenge: number;
    hinweisFristMs: number;
    grenzen?: Grenzen;
    neuberechnungMs?: number;
    // Nur für Tests: ein Adapter, der weniger Protokollversionen spricht
    versionen?: number[];
    // Ohne: kein Fernzugang
    fernablage?: Fernablage;
    fernVerbunden?: (ja: boolean) => void;
}

export interface Server {
    kopplung: Kopplung;
    dienst: Dienst;
    heimnetz: Heimnetz;
    fern?: Fernverwaltung;
    // Eingang für weitere Wege
    nimm(strom: Duplex, herkunft: Herkunft): void;
    // stateChange aus ioBroker für die Abos
    geaendert(id: string, state: ioBroker.State | null | undefined): void;
    beende(): Promise<void>;
}

export async function starteServer(o: ServerOptionen): Promise<Server> {
    const pruefer = appPruefer(o.versionen);
    const sperrliste = new Sperrliste(o.grenzen);
    const kopplung = new Kopplung(o.grenzen);
    let fern: Fernverwaltung | undefined;
    const fehlversuch = (adresse: string): void => {
        if (sperrliste.fehlversuch(adresse, Date.now())) {
            o.log.warn(`Adresse ${sperrbereich(adresse)} nach wiederholten Fehlversuchen gesperrt`);
        }
    };
    const dienst = new Dienst({
        adapterId: o.adapterId,
        namespace: o.namespace,
        ablage: o.ablage,
        pruefer,
        kopplung,
        log: o.log,
        adressen: o.adressen,
        katalog: o.katalog,
        zustaende: o.zustaende,
        nachlaufMs: o.nachlaufMs,
        textLaenge: o.textLaenge,
        hinweisFristMs: o.hinweisFristMs,
        grenzen: o.grenzen,
        neuberechnungMs: o.neuberechnungMs,
        fernzugang: () => fern?.zugang(),
    });
    await dienst.starte();
    const anmeldung = new Anmeldung({ pruefer, kopplung, fehlversuch, ziel: dienst, log: o.log });
    const kern = new Kern({
        identitaet: o.identitaet,
        log: o.log,
        gesperrt: adresse => sperrliste.gesperrt(adresse, Date.now()),
        fehlversuch,
        verbunden: v => anmeldung.begruesse(v),
        grenzen: o.grenzen,
    });
    const heimnetz = new Heimnetz({
        port: o.port,
        nimm: (strom, herkunft) => kern.nimm(strom, herkunft),
        log: o.log,
        zustand: o.zustand,
    });
    heimnetz.starte();
    if (o.fernablage) {
        fern = new Fernverwaltung({
            adapterId: o.adapterId,
            ablage: o.fernablage,
            apps: o.ablage,
            nimm: (strom, herkunft) => kern.nimm(strom, herkunft),
            log: o.log,
            verbunden: ja => o.fernVerbunden?.(ja),
            geaendert: () => dienst.fernzugangGeaendert(),
        });
        await fern.starte();
    }
    return {
        kopplung,
        dienst,
        heimnetz,
        fern,
        nimm: (strom, herkunft) => kern.nimm(strom, herkunft),
        geaendert: (id, state) => dienst.geaendert(id, state),
        async beende() {
            dienst.beende();
            kopplung.brichAb();
            fern?.beende();
            heimnetz.beende();
            await kern.beende();
        },
    };
}
