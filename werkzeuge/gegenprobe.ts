// Gegenprobe für die Android-App (KONZEPT-ANDROID.md, Abschnitt 10): Kern, Dienst und Heimnetz des Adapters mit dem
// ioBroker im Speicher. Die Kotlin-Tests schicken Befehle als JSON-Zeilen auf stdin und lesen je Befehl eine Antwortzeile
// auf stdout. Dazu prüft „pruefe“ beliebige Nachrichten mit denselben Schemata wie der Adapter.
import readline from 'node:readline';
import { adapterPruefer, appPruefer } from '../src/app/dienst';
import type { Profil } from '../src/app/rechte';
import { type Server, starteServer } from '../src/app/server';
import { GRENZEN, type Protokoll } from '../src/basis/grenzen';
import { type Kopplungsanfrage, qrInhalt } from '../src/basis/kopplung';
import { neueAdapterId } from '../src/basis/kodierung';
import { erzeugeIdentitaet, fingerabdruck } from '../src/basis/zertifikat';
import { NAMESPACE, Speicherablage, Speicherquelle } from '../test/speicher';

type Befehl = Record<string, any>;

const familie: Profil = {
    name: 'Familie',
    raeume: [{ enum: 'enum.rooms.wohnzimmer', recht: 'schreiben' }],
    karten: [],
    gesperrt: [],
};

async function main(): Promise<void> {
    const log: string[] = [];
    const protokoll: Protokoll = {
        debug: t => log.push(`debug ${t}`),
        info: t => log.push(`info ${t}`),
        warn: t => log.push(`warn ${t}`),
        error: t => log.push(`error ${t}`),
    };
    const quelle = new Speicherquelle(protokoll)
        .objekt_('system.config', { type: 'config', common: { language: 'de' } })
        .datenpunkt(
            'zigbee.0.lampe.state',
            { type: 'boolean', role: 'switch.light', name: { de: 'Lampe', en: 'Lamp' } },
            false,
        )
        .datenpunkt('zigbee.0.lampe.helligkeit', { type: 'number', min: 0, max: 100, unit: '%' }, 40)
        .datenpunkt(
            'zigbee.0.sensor.temperatur',
            { type: 'number', write: false, unit: '°C', name: { de: 'Temperatur', en: 'Temperature' } },
            21.5,
        )
        .datenpunkt('zigbee.0.tuer.offen', { type: 'boolean' }, false)
        .raum('wohnzimmer', { de: 'Wohnzimmer', en: 'Living room' }, [])
        .karte('wohnzimmerlampe', {
            name: 'Wohnzimmerlampe',
            typ: 'lampe',
            raum: 'enum.rooms.wohnzimmer',
            teile: { schalten: 'zigbee.0.lampe.state', helligkeit: 'zigbee.0.lampe.helligkeit' },
        })
        .karte('klima', {
            name: 'Klima',
            typ: 'messwert',
            raum: 'enum.rooms.wohnzimmer',
            teile: { wert1: 'zigbee.0.sensor.temperatur' },
        })
        .karte('tuer', { name: 'Tür', typ: 'schalter', raum: '', teile: { schalten: 'zigbee.0.tuer.offen' } })
        .profil('familie', familie);
    const ablage = new Speicherablage(quelle);
    const adapterId = neueAdapterId();
    const identitaet = erzeugeIdentitaet(adapterId);
    let bereit!: () => void;
    const laeuft = new Promise<void>(r => (bereit = r));
    const server: Server = await starteServer({
        adapterId,
        identitaet,
        ablage,
        port: 0,
        adressen: () => [],
        katalog: quelle.katalog,
        zustaende: quelle,
        log: protokoll,
        zustand: l => l && bereit(),
        // Häufige Pings: Jeder Test prüft so nebenbei, dass die App sie beantwortet
        grenzen: { ...GRENZEN, pingMs: 300, totMs: 2000 },
        neuberechnungMs: 50,
        nachlaufMs: 150,
        textLaenge: 1000,
        hinweisFristMs: 60_000,
        namespace: NAMESPACE,
        // Etwa GEGENPROBE_VERSIONEN=3 für einen Adapter vor Protokoll 4
        versionen: process.env.GEGENPROBE_VERSIONEN?.split(',').map(Number),
    });
    await laeuft;
    quelle.beiAenderung = (id, state) => server.geaendert(id, state);
    const port = server.heimnetz.port!;
    const zuApp = adapterPruefer();
    const zumAdapter = appPruefer();
    let anfrage: Kopplungsanfrage | undefined;

    const befehle: Record<string, (b: Befehl) => unknown> = {
        kopplung: b => {
            const { geheimnis } = server.kopplung.starte();
            const adressen: string[] = Array.isArray(b.adressen) ? b.adressen : [`127.0.0.1:${port}`];
            return {
                geheimnis,
                link: qrInhalt({ adapterId, fingerabdruck: fingerabdruck(identitaet.zertifikat), geheimnis, adressen }),
            };
        },
        warte: async b => {
            anfrage = await server.kopplung.warte(b.ms ?? 5000);
            return anfrage ? { name: anfrage.name, geraet: anfrage.geraet } : { name: null };
        },
        annehmen: async b => ({
            app: anfrage && (await server.dienst.kopplungAnnehmen(anfrage, b.profil ?? 'familie')),
        }),
        ablehnen: () => {
            if (anfrage) {
                server.kopplung.ablehnen(anfrage);
            }
            return {};
        },
        abbrechen: () => {
            server.kopplung.brichAb();
            return {};
        },
        extern: b => {
            quelle.extern(b.id, b.val, b.ack ?? true, b.ts);
            return {};
        },
        zustand: b => ({ zustand: quelle.zustaende_.get(b.id) ?? null }),
        profil: b => {
            quelle.profil(b.id, b.profil);
            return {};
        },
        karte: b => {
            quelle.karte(b.id, b.karte ?? null);
            return {};
        },
        handydaten: async b => {
            await ablage.aendere(b.app, { handydaten: b.handydaten });
            return {};
        },
        entfernen: async b => {
            await server.dienst.entferne(b.app);
            return {};
        },
        hinweis: b => {
            const state = ablage.skript(b.app, 'hinweis.senden', b.val);
            server.geaendert(`${NAMESPACE}.apps.${b.app}.hinweis.senden`, state);
            return {};
        },
        appwerte: b => ({ werte: ablage.werte_.get(b.app) ?? null, geschrieben: ablage.geschrieben }),
        ordner: b => ({ ordner: Object.fromEntries(ablage.ordner_.get(b.app) ?? []) }),
        pruefe: b => {
            let daten: unknown;
            try {
                daten = JSON.parse(b.text);
            } catch {
                return { fehler: ['kein JSON'] };
            }
            return { fehler: (b.richtung === 'an-app' ? zuApp : zumAdapter).pruefe(daten) };
        },
        pruefeAlle: b => ({
            fehler: (b.texte as string[]).map(text =>
                (b.richtung === 'an-app' ? zuApp : zumAdapter).pruefe(JSON.parse(text)),
            ),
        }),
        log: () => ({ log }),
        ende: async () => {
            await server.beende();
            return {};
        },
    };

    const aus = (o: unknown): void => {
        process.stdout.write(`${JSON.stringify(o)}\n`);
    };
    aus({ bereit: true, port, adapterId, fingerabdruck: fingerabdruck(identitaet.zertifikat), grenzen: GRENZEN });
    const zeilen = readline.createInterface({ input: process.stdin, terminal: false });
    for await (const zeile of zeilen) {
        const b = JSON.parse(zeile) as Befehl;
        try {
            const handlung = befehle[b.b];
            aus(
                handlung
                    ? { ok: true, ...((await handlung(b)) as object) }
                    : { ok: false, fehler: `unbekannt: ${b.b}` },
            );
        } catch (fehler) {
            aus({ ok: false, fehler: (fehler as Error).message });
        }
        if (b.b === 'ende') {
            process.exit(0);
        }
    }
    await server.beende();
}

void main();
