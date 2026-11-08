// App-Simulator (Konzept 12): verhält sich wie die App. Koppelt über den Inhalt des QR-Codes, meldet sich mit dem
// gespeicherten Zugang an, abonniert, setzt, schickt Handydaten und bestätigt Hinweise.
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import readline from 'node:readline';
import gemeinsam from '../protokoll/v1/gemeinsam.schema.json';
import { NEUESTE_VERSION, PROTOKOLLVERSIONEN, appPruefer } from '../src/app/dienst';
import { LINKFORMAT } from '../src/basis/kopplung';
import { erstellePruefer } from '../src/basis/schema';
import { type Eingang, Gegenstelle } from './gegenstelle';

const HILFE = `App-Simulator für myzel-app

  npm run simulator -- koppeln "<Inhalt des QR-Codes>" [Optionen]
  npm run simulator -- verbinden [Optionen]

Optionen:
  --datei <pfad>      Kopplung speichern und lesen, Vorgabe app-simulator.local.json (enthält den Zugang)
  --adresse host:port statt der Adressen aus QR-Code und willkommen, etwa für Docker
  --name <name>       Gerätename beim Koppeln, Vorgabe "App-Simulator"
  --bestaetigen       jeden Hinweis sofort mit angezeigt bestätigen
  --dauer <s>         nach so vielen Sekunden beenden
  --version <n>       Protokollversion, Vorgabe ${NEUESTE_VERSION}

Befehle, je Zeile (Text mit Leerzeichen in "..."):
  abo <id> ...                  setze <id> <wert als JSON oder Text>
  akku <0-100> [laedt]          anruf <frei|klingelt|gespraech> [eingehend|ausgehend] [nummer] [name]
  benachrichtigung <app> <paket> [titel] [text]
  auswahl [<paket>=<app> ...]   ab Version 4: Apps, deren Benachrichtigungen hinausgehen
  zone <id> <rein|raus>         ab Version 7: Zone betreten oder verlassen
  zonenstand an [<id> ...]      zonenstand aus <grund>        ab Version 7
  standort <breite> <laenge> <genauigkeit>                    ab Version 7
  angezeigt <hinweis-id>        roh <JSON, ungeprüft>          ende`;

const QR_SCHEMA = 'myzelapp:';
const VORGABE_DATEI = 'app-simulator.local.json';
const GERAET = { android: 'Simulator', appVersion: '0.0.0' };

const pruefeFeld = (def: string): ((wert: unknown) => string[]) =>
    erstellePruefer({ $ref: `${gemeinsam.$id}#/$defs/${def}` }, [gemeinsam]);
const FELDER = {
    adapterId: pruefeFeld('adapterId'),
    fingerabdruck: pruefeFeld('fingerabdruck'),
    geheimnis: pruefeFeld('geheimnis'),
    adresse: pruefeFeld('adresse'),
};

export interface Qrinhalt {
    adapterId: string;
    fingerabdruck: string;
    geheimnis: string;
    adressen: string[];
}

// So muss die App den QR-Code lesen (Detailentwurf, Abschnitt 4): jedes Feld genau nach Format, sonst ablehnen.
export function liesQr(text: string): Qrinhalt | string[] {
    let url: URL;
    try {
        url = new URL(text);
    } catch {
        return ['kein gültiger URI'];
    }
    if (url.protocol !== QR_SCHEMA || url.host !== 'koppeln') {
        return [`kein Kopplungscode (${QR_SCHEMA}//koppeln erwartet)`];
    }
    const p = url.searchParams;
    const fehler: string[] = [];
    if (p.getAll('v').length !== 1 || p.get('v') !== String(LINKFORMAT)) {
        fehler.push(`Formatversion ${p.get('v')} nicht unterstützt`);
    }
    const einzeln = (k: string, feld: keyof typeof FELDER): string => {
        const werte = p.getAll(k);
        if (werte.length !== 1 || FELDER[feld](werte[0]).length > 0) {
            fehler.push(`${k}: ${feld} fehlt oder ungültig`);
        }
        return werte[0] ?? '';
    };
    const ergebnis = {
        adapterId: einzeln('a', 'adapterId'),
        fingerabdruck: einzeln('f', 'fingerabdruck'),
        geheimnis: einzeln('g', 'geheimnis'),
        adressen: p.getAll('h'),
    };
    if (ergebnis.adressen.length < 1 || ergebnis.adressen.length > 4) {
        fehler.push('h: eine bis vier Adressen erwartet');
    }
    ergebnis.adressen.filter(h => FELDER.adresse(h).length > 0).forEach(h => fehler.push(`h: ${h} ungültig`));
    const bekannt = new Set(['v', 'a', 'f', 'g', 'h']);
    [...new Set(p.keys())].filter(k => !bekannt.has(k)).forEach(k => fehler.push(`unbekanntes Feld ${k}`));
    return fehler.length > 0 ? fehler : ergebnis;
}

// "[fd00::5]:8095" und "192.168.1.5:8095"
export function zerlegeAdresse(adresse: string): { host: string; port: number } {
    const trenner = adresse.lastIndexOf(':');
    return { host: adresse.slice(0, trenner).replace(/^\[|\]$/g, ''), port: Number(adresse.slice(trenner + 1)) };
}

// Wörter, "Text mit Leerzeichen" als eins
export function woerter(zeile: string): string[] {
    return [...zeile.matchAll(/"([^"]*)"|(\S+)/g)].map(m => m[1] ?? m[2]);
}

interface Kopplung {
    adapterId: string;
    fingerabdruck: string;
    adressen: string[];
    app: string;
    zugang: string;
}

interface Optionen {
    datei: string;
    adresse?: string;
    name: string;
    bestaetigen: boolean;
    dauer?: number;
    version: number;
}

function liesOptionen(argumente: string[]): { befehl: string[]; o: Optionen } | string {
    const o: Optionen = { datei: VORGABE_DATEI, name: 'App-Simulator', bestaetigen: false, version: NEUESTE_VERSION };
    const befehl: string[] = [];
    for (let i = 0; i < argumente.length; i++) {
        const a = argumente[i];
        const wert = (): string => {
            if (i + 1 >= argumente.length) {
                throw new Error(`${a} braucht einen Wert`);
            }
            return argumente[++i];
        };
        if (a === '--datei') {
            o.datei = wert();
        } else if (a === '--adresse') {
            o.adresse = wert();
        } else if (a === '--name') {
            o.name = wert();
        } else if (a === '--dauer') {
            o.dauer = Number(wert());
        } else if (a === '--version') {
            o.version = Number(wert());
            if (!PROTOKOLLVERSIONEN.includes(o.version)) {
                return `--version: ${PROTOKOLLVERSIONEN.join(' oder ')}`;
            }
        } else if (a === '--bestaetigen') {
            o.bestaetigen = true;
        } else if (a.startsWith('--')) {
            return `unbekannte Option ${a}`;
        } else {
            befehl.push(a);
        }
    }
    return { befehl, o };
}

// Nur für den Eigentümer lesbar: Die Datei enthält den Zugang.
function speichere(datei: string, kopplung: Kopplung): void {
    writeFileSync(datei, `${JSON.stringify(kopplung, null, 2)}\n`, { mode: 0o600 });
    chmodSync(datei, 0o600);
}

async function verbinde(adressen: string[], fingerabdruck: string, aus: (zeile: string) => void): Promise<Gegenstelle> {
    for (const adresse of adressen) {
        const { host, port } = zerlegeAdresse(adresse);
        try {
            const g = await Gegenstelle.verbinde(port, fingerabdruck, { host });
            aus(`verbunden mit ${adresse}`);
            return g;
        } catch (fehler) {
            aus(`! ${adresse}: ${(fehler as Error).message}`);
        }
    }
    throw new Error('keine Adresse erreichbar');
}

// Eine Befehlszeile als Nachricht an den Adapter, oder ein Text für den Nutzer
function nachricht(teile: string[], n: () => number): object | string {
    const [befehl, ...a] = teile;
    const zeit = Date.now();
    switch (befehl) {
        case 'abo':
            return { t: 'abo', ids: a };
        case 'setze': {
            const text = a.slice(1).join(' ');
            let val: unknown = text;
            try {
                val = JSON.parse(text);
            } catch {
                // kein JSON, also Text
            }
            return { t: 'setze', n: n(), id: a[0], val };
        }
        case 'akku':
            return { t: 'akku', stand: Number(a[0]), laedt: a[1] === 'laedt', zeit };
        case 'anruf': {
            const [status, richtung, nummer, name] = a;
            return {
                t: 'anruf',
                status,
                ...(richtung && { richtung }),
                ...(nummer && { nummer }),
                ...(name && { name }),
                zeit,
            };
        }
        case 'benachrichtigung': {
            const [app, paket, titel, text] = a;
            return { t: 'benachrichtigung', app, paket, ...(titel && { titel }), ...(text && { text }), zeit };
        }
        case 'auswahl':
            return {
                t: 'auswahl',
                apps: a.map(eintrag => {
                    const gleich = eintrag.indexOf('=');
                    return gleich < 0
                        ? { paket: eintrag, app: eintrag }
                        : { paket: eintrag.slice(0, gleich), app: eintrag.slice(gleich + 1) };
                }),
            };
        case 'zone':
            return { t: 'zone', id: a[0], drin: a[1] === 'rein', zeit };
        case 'zonenstand':
            return a[0] === 'an'
                ? { t: 'zonenstand', aktiv: true, drin: a.slice(1), zeit }
                : { t: 'zonenstand', aktiv: false, ...(a[1] && { grund: a[1] }), drin: [], zeit };
        case 'standort':
            return { t: 'standort', breite: Number(a[0]), laenge: Number(a[1]), genauigkeit: Number(a[2]), zeit };
        case 'angezeigt':
            return { t: 'angezeigt', id: a[0] };
        default:
            return `unbekannter Befehl ${befehl}, Hilfe mit "hilfe"`;
    }
}

function sitzung(
    g: Gegenstelle,
    o: Optionen,
    ein: NodeJS.ReadableStream,
    aus: (zeile: string) => void,
    gespeichert: Omit<Kopplung, 'app' | 'zugang'> & Partial<Kopplung>,
): Promise<number> {
    const pruefer = appPruefer();
    let nummer = 0;
    const sende = (m: object): void => {
        aus(`> ${JSON.stringify(m)}`);
        g.sende(m);
    };
    g.lausche((m: Eingang) => {
        if (m instanceof Error) {
            aus(`! ${m.message}`);
            return;
        }
        if (m.t === 'gekoppelt') {
            Object.assign(gespeichert, { app: m.app, zugang: m.zugang });
            speichere(o.datei, gespeichert as Kopplung);
            aus(`< gekoppelt als App ${m.app}, Zugang gespeichert in ${o.datei}`);
            return;
        }
        aus(`< ${JSON.stringify(m)}`);
        // Wie die App: Adressen aus willkommen ersetzen die aus dem QR-Code.
        if (m.t === 'willkommen' && gespeichert.zugang) {
            gespeichert.adressen = m.adressen;
            speichere(o.datei, gespeichert as Kopplung);
        }
        if (m.t === 'hinweis' && o.bestaetigen) {
            sende({ t: 'angezeigt', id: m.id });
        }
    });
    const zeilen = readline.createInterface({ input: ein, terminal: false });
    zeilen.on('line', zeile => {
        const teile = woerter(zeile.trim());
        if (teile.length === 0) {
            return;
        }
        if (teile[0] === 'ende') {
            g.beende();
        } else if (teile[0] === 'hilfe') {
            aus(HILFE);
        } else if (teile[0] === 'roh') {
            aus(`> ${zeile.trim().slice(3).trim()}`);
            g.sendeRoh(zeile.trim().slice(3).trim());
        } else {
            const m = nachricht(teile, () => ++nummer);
            const fehler = typeof m === 'string' ? [m] : pruefer.pruefe(m);
            if (fehler.length > 0) {
                aus(`! nicht gesendet: ${fehler.join('; ')}`);
            } else {
                sende(m as object);
            }
        }
    });
    // Eingabe aus einer Datei oder Pipe: noch kurz auf Antworten warten
    zeilen.on('close', () => o.dauer === undefined && setTimeout(() => g.beende(), 1000).unref());
    const dauer = o.dauer === undefined ? undefined : setTimeout(() => g.beende(), o.dauer * 1000);
    return g.schluss.then(({ code, grund }) => {
        clearTimeout(dauer);
        zeilen.close();
        aus(`Verbindung beendet: ${code}${grund ? ` ${grund}` : ''}`);
        return code === 1000 ? 0 : 1;
    });
}

export async function simuliere(
    argumente: string[],
    ein: NodeJS.ReadableStream,
    aus: (zeile: string) => void,
): Promise<number> {
    let gelesen: ReturnType<typeof liesOptionen>;
    try {
        gelesen = liesOptionen(argumente);
    } catch (fehler) {
        gelesen = (fehler as Error).message;
    }
    if (typeof gelesen === 'string') {
        aus(`${gelesen}\n\n${HILFE}`);
        return 2;
    }
    const { befehl, o } = gelesen;
    try {
        if (befehl[0] === 'koppeln' && befehl.length === 2) {
            const qr = liesQr(befehl[1]);
            if (Array.isArray(qr)) {
                aus(`QR-Code abgelehnt: ${qr.join('; ')}`);
                return 2;
            }
            const g = await verbinde(o.adresse ? [o.adresse] : qr.adressen, qr.fingerabdruck, aus);
            const koppeln = {
                t: 'koppeln',
                v: o.version,
                geheimnis: qr.geheimnis,
                name: o.name,
                geraet: GERAET,
            };
            aus('> koppeln, warte auf die Bestätigung im Admin');
            g.sende(koppeln);
            return await sitzung(g, o, ein, aus, {
                adapterId: qr.adapterId,
                fingerabdruck: qr.fingerabdruck,
                adressen: qr.adressen,
            });
        }
        if (befehl[0] === 'verbinden' && befehl.length === 1) {
            if (!existsSync(o.datei)) {
                aus(`${o.datei} fehlt, erst koppeln`);
                return 2;
            }
            const k = JSON.parse(readFileSync(o.datei, 'utf8')) as Kopplung;
            const g = await verbinde(o.adresse ? [o.adresse] : k.adressen, k.fingerabdruck, aus);
            aus(`> hallo als App ${k.app}`);
            g.sende({ t: 'hallo', v: o.version, app: k.app, zugang: k.zugang, geraet: GERAET });
            return await sitzung(g, o, ein, aus, k);
        }
    } catch (fehler) {
        aus(`! ${(fehler as Error).message}`);
        return 1;
    }
    aus(HILFE);
    return 2;
}

if (require.main === module) {
    void simuliere(process.argv.slice(2), process.stdin, zeile => console.log(zeile)).then(code => process.exit(code));
}
