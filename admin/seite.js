// Gemeinsam für die Seiten in den Reitern „Karten“, „Räume“, „Profile“ (KONZEPT-KARTEN.md, Abschnitte 12 und 13) und
// „Fernzugang“ (KONZEPT-FERNZUGANG.md, Abschnitt 12) der Instanzeinstellungen: Verbindung zur Instanz, Thema, Texte, Kacheln,
// Dialog. Die Seiten zeigen nur und fragen; prüfen und speichern tut die Instanz über sendTo (src/admin/).

export const instanz = new URLSearchParams(location.search).get('instanz');

const GEMEINSAM = {
    de: {
        speichern: 'Speichern',
        abbrechen: 'Abbrechen',
        loeschen: 'Löschen',
        ohneRaum: 'Ohne Raum',
        typen: { lampe: 'Lampe', schalter: 'Schalter', messwert: 'Messwert', thermostat: 'Thermostat' },
        ablehnung: {
            nichtBereit: 'Die Instanz ist noch nicht bereit oder ihr Start ist gescheitert. Bitte das Log ansehen.',
            gescheitert: 'Das hat nicht geklappt:',
        },
        keineVerbindung: 'Keine Verbindung zu ioBroker. Die Seite versucht es weiter.',
        keineInstanz: 'Die Seite kennt ihre Instanz nicht. Bitte über die Instanzeinstellungen öffnen.',
    },
    en: {
        speichern: 'Save',
        abbrechen: 'Cancel',
        loeschen: 'Delete',
        ohneRaum: 'No room',
        typen: { lampe: 'Lamp', schalter: 'Switch', messwert: 'Measurement', thermostat: 'Thermostat' },
        ablehnung: {
            nichtBereit: 'The instance is not ready yet or its start failed. Please check the log.',
            gescheitert: 'That did not work:',
        },
        keineVerbindung: 'No connection to ioBroker. The page keeps trying.',
        keineInstanz: 'The page does not know its instance. Please open it via the instance settings.',
    },
};

// Selbst gezeichnet, 24 × 24, nur Linien
const SYMBOLE = {
    lampe: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1.1 2V17h5v-1.2c.1-.8.5-1.5 1.1-2A6 6 0 0 0 12 3z',
    schalter: 'M12 3v8M7.1 6.3a7 7 0 1 0 9.8 0',
    messwert: 'M4.5 17a8 8 0 1 1 15 0M12 14l3.5-4.5M12 14h.01',
    thermostat: 'M10 13.5V5a2 2 0 1 1 4 0v8.5a4 4 0 1 1-4 0zM12 9v6',
    profil: 'M12 12a4 4 0 1 0 0-8a4 4 0 1 0 0 8zM4.5 21a7.5 7.5 0 0 1 15 0',
    raum: 'M4 20V10l8-6 8 6v10M4 20h16M10 20v-5h4v5',
    zahnrad:
        'M19 9.8L21.5 10.4L21.5 13.6L19 14.2L18.5 15.4L19.8 17.5L17.5 19.8L15.4 18.5L14.2 19L13.6 21.5L10.4 21.5' +
        'L9.8 19L8.6 18.5L6.5 19.8L4.2 17.5L5.5 15.4L5 14.2L2.5 13.6L2.5 10.4L5 9.8L5.5 8.6L4.2 6.5L6.5 4.2L8.6 5.5' +
        'L9.8 5L10.4 2.5L13.6 2.5L14.2 5L15.4 5.5L17.5 4.2L19.8 6.5L18.5 8.6ZM12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6z',
};

let socket;
// Die Texte der Seite; bis die Instanz die Systemsprache nennt, in der Sprache des Browsers
let t = texte({});

export const $ = id => document.getElementById(id);

// Gemeinsame und eigene Texte einer Seite in einer Sprache
export function texte(eigene, code = navigator.language) {
    const s = String(code).toLowerCase().startsWith('de') ? 'de' : 'en';
    const e = eigene[s] ?? {};
    return { ...GEMEINSAM[s], ...e, ablehnung: { ...GEMEINSAM[s].ablehnung, ...e.ablehnung }, code: s };
}

// Neue Texte, etwa in der Systemsprache; beschriftet den Dialog, wo es einen gibt
export function nimmTexte(neu) {
    t = neu;
    document.documentElement.lang = t.code;
    if (!$('dialog')) {
        return;
    }
    $('speichern').textContent = t.speichern;
    $('abbrechen').textContent = t.abbrechen;
    $('loeschen').textContent = t.loeschen;
    $('nichtLoeschen').textContent = t.abbrechen;
    $('wirklichLoeschen').textContent = t.loeschen;
}

export function knoten(tag, klasse, text) {
    const k = document.createElement(tag);
    if (klasse) {
        k.className = klasse;
    }
    if (text !== undefined) {
        k.textContent = text;
    }
    return k;
}

export function symbol(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const pfad = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    pfad.setAttribute('d', SYMBOLE[name] ?? SYMBOLE.schalter);
    svg.append(pfad);
    return svg;
}

export const vergleicher = code => new Intl.Collator(code).compare;

// Der Admin färbt nicht body, sondern einen Behälter um den Rahmen; maßgeblich ist der erste deckende Hintergrund.
function thema() {
    let dunkel = matchMedia('(prefers-color-scheme: dark)').matches;
    try {
        for (let el = window.frameElement; el; el = el.parentElement) {
            const werte = (getComputedStyle(el).backgroundColor.match(/[\d.]+/g) ?? []).map(Number);
            if (werte.length >= 3 && (werte.length < 4 || werte[3] > 0.5)) {
                dunkel = 0.2126 * werte[0] + 0.7152 * werte[1] + 0.0722 * werte[2] < 128;
                break;
            }
        }
    } catch {
        // Ohne Zugriff auf den Admin gilt die Einstellung des Systems.
    }
    document.documentElement.dataset.thema = dunkel ? 'dunkel' : 'hell';
    // Der Admin lässt dem Rahmen den Standardrand. Und nur bei gleichem Farbschema bleibt der Rahmen durchsichtig, sonst
    // malt der Browser eine eigene Fläche dahinter.
    try {
        window.frameElement.style.border = '0';
        window.frameElement.style.colorScheme = dunkel ? 'dark' : 'light';
    } catch {
        // Nicht eingebettet oder fremder Ursprung
    }
}

export function meldung(text) {
    $('meldung').textContent = text ?? '';
}

export function frage(befehl, nachricht) {
    return new Promise((ok, nein) => {
        if (!socket?.connected) {
            nein(new Error(t.keineVerbindung));
            return;
        }
        socket.emit('sendTo', instanz, befehl, nachricht ?? {}, antwort => {
            if (antwort === undefined || antwort === null || typeof antwort === 'string') {
                nein(new Error(t.keineVerbindung));
            } else if (antwort.error) {
                nein(new Error(String(antwort.error)));
            } else {
                ok(antwort);
            }
        });
    });
}

// zuViele nennt die Grenze, die die Seite kennt
export function ablehnungstext(a, grenze) {
    const satz = t.ablehnung[a.fehler];
    return [(typeof satz === 'function' ? satz(grenze) : satz) ?? a.fehler, ...(a.einzelheiten ?? [])].join(' ');
}

// Lädt den Stand der Seite; Fehler stehen oben auf der Seite.
export async function ladeStand(befehl, uebernimm) {
    try {
        const antwort = await frage(befehl);
        if (antwort.fehler) {
            meldung(ablehnungstext(antwort));
            return;
        }
        meldung('');
        uebernimm(antwort);
    } catch (fehler) {
        meldung(fehler.message);
    }
}

// Eine Kachel mit Symbol, Name, Zahnrad und Zeilen darunter; die ganze Kachel öffnet den Eintrag.
export function kachel({ zeichen, name, zeilen, oeffne, bearbeiten }) {
    const k = knoten('div', 'kachel');
    const s = knoten('span', 'symbol');
    s.append(symbol(zeichen));
    const knopf = knoten('button', 'knopf bearbeiten');
    knopf.type = 'button';
    knopf.title = bearbeiten;
    knopf.setAttribute('aria-label', `${bearbeiten}: ${name}`);
    knopf.append(symbol('zahnrad'));
    k.append(s, knoten('span', 'name', name), knopf);
    for (const [klasse, text] of zeilen) {
        k.append(knoten('span', klasse, text));
    }
    k.addEventListener('click', oeffne);
    return k;
}

// Ein Abschnitt mit Überschrift, Anzahl und Kacheln
export function abschnitt(titel, kacheln) {
    const a = knoten('section', 'raum');
    const kopf = knoten('h2', '', titel);
    kopf.append(knoten('span', 'anzahl', String(kacheln.length)));
    const gitter = knoten('div', 'kacheln');
    gitter.append(...kacheln);
    a.append(kopf, gitter);
    return a;
}

export function fuelleAuswahl(select, optionen, wert) {
    select.replaceChildren(
        ...optionen.map(([v, text]) => {
            const o = knoten('option', '', text);
            o.value = v;
            return o;
        }),
    );
    select.value = optionen.some(([v]) => v === wert) ? wert : optionen[0][0];
}

export function oeffneDialog(titel) {
    $('titel').textContent = titel;
    $('fehler').textContent = '';
    zeigeLoeschfrage();
    if (!$('dialog').open) {
        $('dialog').showModal();
    }
}

// Ohne Text ist die Rückfrage weg und der normale Fuß wieder da.
export function zeigeLoeschfrage(text) {
    const ja = text !== undefined;
    $('loeschfrage').hidden = !ja;
    $('loeschfrage').previousElementSibling.hidden = ja;
    if (ja) {
        $('loeschfrageText').textContent = text;
        $('nichtLoeschen').focus();
    }
}

// Schickt einen Befehl aus dem Dialog. Eine Ablehnung steht im Dialog, bei „weg“ lädt die Seite neu. Liefert die Antwort
// oder undefined.
export async function ausDialog(knopf, befehl, nachricht, { lade, grenze }) {
    $('fehler').textContent = '';
    knopf.disabled = true;
    try {
        const antwort = await frage(befehl, nachricht);
        if (!antwort.fehler) {
            return antwort;
        }
        zeigeLoeschfrage();
        $('fehler').textContent = ablehnungstext(antwort, grenze);
        if (antwort.fehler === 'weg') {
            await lade();
        }
    } catch (fehler) {
        zeigeLoeschfrage();
        $('fehler').textContent = fehler.message;
    } finally {
        knopf.disabled = false;
    }
    return undefined;
}

// Verbindet sich mit ioBroker und lädt bei jeder Verbindung, und wenn die Seite wieder sichtbar wird: Ein anderes
// Fenster oder ein Skript kann inzwischen etwas geändert haben, und das Thema des Admins kann umgeschaltet sein. Falsch,
// wenn die Seite ihre Instanz nicht kennt.
export function verbinde({ name, lade }) {
    thema();
    if (!instanz) {
        meldung(t.keineInstanz);
        return false;
    }
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            thema();
            if (!$('dialog')?.open) {
                void lade();
            }
        }
    });
    socket = io.connect('/', { name });
    socket.on('connect', () => void lade());
    socket.on('disconnect', () => meldung(t.keineVerbindung));
    return true;
}

// Für die Seiten mit Kacheln und Dialog
export function starte({ name, lade, neu, speichere, loesche, loeschfrage }) {
    if (!verbinde({ name, lade })) {
        return;
    }
    $('neu').addEventListener('click', neu);
    $('formular').addEventListener('submit', speichere);
    $('abbrechen').addEventListener('click', () => $('dialog').close());
    $('loeschen').addEventListener('click', () => zeigeLoeschfrage(loeschfrage()));
    $('nichtLoeschen').addEventListener('click', () => zeigeLoeschfrage());
    $('wirklichLoeschen').addEventListener('click', loesche);
}
