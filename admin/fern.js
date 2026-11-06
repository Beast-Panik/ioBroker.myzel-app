// Seite im Reiter „Fernzugang“ der Instanzeinstellungen (KONZEPT-FERNZUGANG.md, Abschnitt 12). Verbindung, Freigaben und
// Schlüssel hält die Instanz. Die Seite fragt alle paar Sekunden nach dem Stand, weil er sich ohne ihr Zutun ändert:
// Der Vermittler fällt aus, eine App verbindet sich.
import { $, ablehnungstext, frage, knoten, meldung, nimmTexte, texte, verbinde } from './seite.js';

const TEXTE = {
    de: {
        hinweis:
            'Über einen eigenen Vermittler erreichen freigegebene Apps den Adapter auch unterwegs. Er reicht nur ' +
            'verschlüsselte Daten weiter und kann nichts mitlesen; die Verschlüsselung endet erst hier im Adapter.',
        vermittler: 'Vermittler',
        adresse: 'Adresse',
        verbunden: (seit, ms) => `Verbunden seit ${seit}${ms === undefined ? '' : ` · Verzögerung ${ms} ms`}`,
        getrennt: (grund, s) => `Getrennt: ${grund}. ${s > 0 ? `Neuer Versuch in ${s} s` : 'Neuer Versuch läuft'}`,
        aus: 'Aus: Ohne Adresse gibt es keinen Fernzugang.',
        einrichtung: 'Einrichtung auf dem Vermittler',
        // Davor und danach steht der Name der Umgebungsvariable.
        einrichtungHinweis: [
            'Diese Zeile gehört in die Umgebungsvariable ',
            ' des Vermittlers. Sie enthält nur einen Prüfwert, kein Geheimnis.',
        ],
        kopieren: 'Kopieren',
        kopiert: 'Kopiert',
        nichtKopiert: 'Kopieren geht hier nicht. Die Zeile ist markiert, Strg+C kopiert sie.',
        apps: 'Apps',
        appsHinweis:
            'Freigegebene Apps bekommen Adresse und Schlüssel beim nächsten Verbinden. Ausschalten trennt eine ' +
            'Verbindung von unterwegs sofort.',
        gekoppelt: datum => `gekoppelt am ${datum}`,
        weg: { fern: 'unterwegs verbunden', lokal: 'im Heimnetz verbunden', keiner: 'nicht verbunden' },
        freigabe: name => `Fernzugang für ${name}`,
        keineApps: 'Noch keine App gekoppelt. Gekoppelt wird im Reiter „Apps“.',
        schluessel: 'Schlüssel',
        schluesselHinweis:
            'Wenn ein Schlüssel in falsche Hände geraten sein könnte. Danach braucht der Vermittler die neue Zeile. ' +
            'Verbundene Apps bekommen ihren neuen Schlüssel sofort, alle anderen erst, wenn sie sich wieder im ' +
            'Heimnetz verbinden.',
        neuerSchluessel: 'Schlüssel neu erzeugen',
        schluesselfrage:
            'Neuen Schlüssel erzeugen? Bis die neue Zeile auf dem Vermittler steht, verbindet sich keine App von ' +
            'unterwegs.',
        erzeugen: 'Neu erzeugen',
        datum: d => `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()}`,
        ablehnung: {
            weg: 'Diese App gibt es nicht mehr. Die Liste ist neu geladen.',
            ungueltig: 'Das geht so nicht:',
        },
    },
    en: {
        hinweis:
            'Through your own relay, released apps reach the adapter on the go as well. It only passes on encrypted ' +
            'data and cannot read anything; the encryption ends only here in the adapter.',
        vermittler: 'Relay',
        adresse: 'Address',
        verbunden: (seit, ms) => `Connected since ${seit}${ms === undefined ? '' : ` · latency ${ms} ms`}`,
        getrennt: (grund, s) => `Disconnected: ${grund}. ${s > 0 ? `Next attempt in ${s} s` : 'Next attempt running'}`,
        aus: 'Off: without an address there is no remote access.',
        einrichtung: 'Setup on the relay',
        einrichtungHinweis: [
            'This line belongs in the environment variable ',
            ' of the relay. It contains only a check value, no secret.',
        ],
        kopieren: 'Copy',
        kopiert: 'Copied',
        nichtKopiert: 'Copying does not work here. The line is selected, Ctrl+C copies it.',
        apps: 'Apps',
        appsHinweis:
            'Released apps get address and key the next time they connect. Switching off ends a connection from on ' +
            'the go at once.',
        gekoppelt: datum => `paired on ${datum}`,
        weg: { fern: 'connected on the go', lokal: 'connected at home', keiner: 'not connected' },
        freigabe: name => `Remote access for ${name}`,
        keineApps: 'No app paired yet. Apps are paired in the Apps tab.',
        schluessel: 'Key',
        schluesselHinweis:
            'In case a key may have fallen into the wrong hands. The relay then needs the new line. Connected apps ' +
            'get their new key at once, all others only when they connect at home again.',
        neuerSchluessel: 'Create new key',
        schluesselfrage: 'Create a new key? Until the new line is on the relay, no app connects on the go.',
        erzeugen: 'Create new',
        datum: d => new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(d),
        ablehnung: {
            weg: 'This app no longer exists. The list has been reloaded.',
            ungueltig: 'That does not work like this:',
        },
    },
};

const ABFRAGE_MS = 5000;
// Nach Speichern oder neuem Schlüssel baut die Instanz die Verbindung neu auf; ihr Ergebnis steht kurz danach fest.
const NACHFRAGE_MS = 1500;
const KOPIERT_MS = 2000;
// Eine gestoppte Instanz antwortet nie; ohne Frist bliebe die Seite beim Laden oder Speichern hängen.
const FRIST_MS = 10_000;

let t = texte(TEXTE);
let stand;
// Uhr der Instanz minus Uhr des Browsers, für „neuer Versuch in“
let versatz = 0;
// Die Adresse, wie die Instanz sie zuletzt nannte; was jemand gerade eintippt, überschreibt die Abfrage nicht.
let gespeicherteAdresse;
let gezeichneteApps;
let gezeichneterStand;
// Solange etwas gespeichert wird, wartet die Abfrage; ihr Stand wäre womöglich älter als die Antwort.
let beschaeftigt = 0;
let laedt = false;
// Ein Fehler beim Bedienen bleibt stehen, bis wieder etwas bedient wird. Fehler beim Laden räumt das nächste Laden weg.
let fehlerBeimBedienen = false;
let kopiertZeit;

function beschrifte() {
    $('hinweis').textContent = t.hinweis;
    $('vermittlerTitel').textContent = t.vermittler;
    $('adresseLabel').textContent = t.adresse;
    $('adresseSpeichern').textContent = t.speichern;
    $('einrichtungTitel').textContent = t.einrichtung;
    const [vor, nach] = t.einrichtungHinweis;
    $('einrichtungHinweis').replaceChildren(vor, knoten('code', '', 'MYZEL_ADAPTER'), nach);
    $('kopierenText').textContent = t.kopieren;
    $('appsHinweis').textContent = t.appsHinweis;
    $('schluesselTitel').textContent = t.schluessel;
    $('schluesselHinweis').textContent = t.schluesselHinweis;
    $('neuerSchluessel').textContent = t.neuerSchluessel;
    $('schluesselfrageText').textContent = t.schluesselfrage;
    $('nichtErzeugen').textContent = t.abbrechen;
    $('wirklichErzeugen').textContent = t.erzeugen;
}

function uebernimm(neu) {
    const vorher = t.code;
    stand = neu;
    versatz = neu.jetzt - Date.now();
    t = texte(TEXTE, neu.sprache);
    if (t.code !== vorher) {
        nimmTexte(t);
        beschrifte();
    }
    if (gespeicherteAdresse === undefined || $('adresse').value === gespeicherteAdresse) {
        $('adresse').value = neu.adresse;
    }
    gespeicherteAdresse = neu.adresse;
    $('zeile').textContent = neu.zeile;
    zeigeStand();
    zeichneApps();
    if (beschaeftigt === 0) {
        for (const knopf of ['adresseSpeichern', 'kopieren', 'neuerSchluessel']) {
            $(knopf).disabled = false;
        }
    }
}

function fragMitFrist(befehl, nachricht) {
    let zeit;
    const frist = new Promise((_, nein) => {
        zeit = setTimeout(() => nein(new Error(t.ablehnung.nichtBereit)), FRIST_MS);
    });
    return Promise.race([frage(befehl, nachricht), frist]).finally(() => clearTimeout(zeit));
}

async function lade() {
    if (laedt || beschaeftigt > 0) {
        return;
    }
    laedt = true;
    try {
        const antwort = await fragMitFrist('fernstand');
        if (antwort.fehler) {
            meldung(ablehnungstext(antwort));
            fehlerBeimBedienen = false;
            return;
        }
        if (!fehlerBeimBedienen) {
            meldung('');
        }
        uebernimm(antwort);
    } catch (fehler) {
        meldung(fehler.message);
        fehlerBeimBedienen = false;
    } finally {
        laedt = false;
    }
}

function bedienfehler(text) {
    meldung(text);
    fehlerBeimBedienen = true;
}

// Schickt einen Befehl, der mit dem neuen Stand antwortet. Liefert bei Erfolg nichts, sonst den Grund der Ablehnung
// oder „verbindung“.
async function bediene(knopf, befehl, nachricht) {
    fehlerBeimBedienen = false;
    meldung('');
    knopf.disabled = true;
    beschaeftigt++;
    let fehler;
    try {
        const antwort = await fragMitFrist(befehl, nachricht);
        if (antwort.fehler) {
            bedienfehler(ablehnungstext(antwort));
            fehler = antwort.fehler;
        } else {
            uebernimm(antwort);
        }
    } catch (ausnahme) {
        bedienfehler(ausnahme.message);
        fehler = 'verbindung';
    } finally {
        beschaeftigt--;
        knopf.disabled = false;
    }
    if (fehler === 'weg') {
        void lade();
    }
    return fehler;
}

function nachfragenBald() {
    setTimeout(() => void lade(), NACHFRAGE_MS);
}

function zeitpunkt(ms) {
    const d = new Date(ms);
    const zeit = new Intl.DateTimeFormat(t.code, { hour: '2-digit', minute: '2-digit' }).format(d);
    return d.toDateString() === new Date().toDateString() ? zeit : `${t.datum(d)} ${zeit}`;
}

// Jede Sekunde, damit „neuer Versuch in“ herunterzählt
function zeigeStand() {
    if (!stand) {
        return;
    }
    const lage = stand.lage;
    let farbe = '';
    let text = t.aus;
    if (lage.art === 'verbunden') {
        farbe = ' gut';
        text = t.verbunden(zeitpunkt(lage.seit), lage.verzoegerungMs);
    } else if (lage.art === 'getrennt') {
        farbe = ' schlecht';
        text = t.getrennt(lage.grund, Math.ceil((lage.naechsterVersuch - Date.now() - versatz) / 1000));
    }
    if (farbe + text !== gezeichneterStand) {
        gezeichneterStand = farbe + text;
        $('stand').replaceChildren(knoten('span', `punkt${farbe}`), text);
    }
}

function appzeile(app) {
    const zeile = knoten('label', 'wahlzeile');
    const name = knoten('span', 'wahlname');
    name.append(knoten('span', '', app.name), knoten('span', 'leise', t.gekoppelt(t.datum(new Date(app.gekoppeltAm)))));
    const weg = t.weg[app.verbunden] ? app.verbunden : 'keiner';
    const wahl = knoten('input');
    wahl.type = 'checkbox';
    wahl.checked = app.fern;
    wahl.dataset.app = app.id;
    wahl.setAttribute('aria-label', t.freigabe(app.name));
    wahl.addEventListener('change', async () => {
        // Gesperrt verliert das Kästchen den Fokus; neu gezeichnet ist es ein anderes.
        const fokus = document.activeElement === wahl;
        if (await bediene(wahl, 'fernFreigabe', { app: app.id, fern: wahl.checked })) {
            wahl.checked = !wahl.checked;
        }
        if (fokus) {
            fokussiere(app.id);
        }
    });
    const rechts = knoten('span', 'rechts');
    rechts.append(knoten('span', weg === 'fern' ? 'appstand unterwegs' : 'appstand', t.weg[weg]), wahl);
    zeile.append(name, rechts);
    return zeile;
}

function fokussiere(appId) {
    $('apps')
        .querySelector(`input[data-app="${CSS.escape(appId)}"]`)
        ?.focus();
}

// Nur bei Änderungen neu, sonst verlöre ein Kästchen alle fünf Sekunden den Fokus
function zeichneApps() {
    const schluessel = JSON.stringify([t.code, stand.apps]);
    if (schluessel === gezeichneteApps) {
        return;
    }
    gezeichneteApps = schluessel;
    const fokus = document.activeElement?.dataset?.app;
    $('appsTitel').replaceChildren(t.apps, knoten('span', 'anzahl', String(stand.apps.length)));
    $('apps').replaceChildren(
        ...(stand.apps.length === 0 ? [knoten('p', 'erklaerung', t.keineApps)] : stand.apps.map(appzeile)),
    );
    if (fokus) {
        fokussiere(fokus);
    }
}

async function speichereAdresse(ereignis) {
    ereignis.preventDefault();
    const fehler = await bediene($('adresseSpeichern'), 'fernAdresse', { adresse: $('adresse').value });
    $('adresse').setAttribute('aria-invalid', String(fehler === 'ungueltig'));
    if (!fehler) {
        $('adresse').value = stand.adresse;
        nachfragenBald();
    }
}

// Ohne sicheren Ursprung, etwa beim Admin über http im Heimnetz, gibt es keine Zwischenablage für Skripte.
async function kopiere() {
    try {
        await navigator.clipboard.writeText(stand.zeile);
    } catch {
        const bereich = document.createRange();
        bereich.selectNodeContents($('zeile'));
        const auswahl = getSelection();
        auswahl.removeAllRanges();
        auswahl.addRange(bereich);
        if (!document.execCommand('copy')) {
            bedienfehler(t.nichtKopiert);
            return;
        }
        auswahl.removeAllRanges();
    }
    const knopf = $('kopieren');
    // Das kürzere oder längere Wort soll die Zeile daneben nicht verschieben.
    knopf.style.minWidth = `${knopf.offsetWidth}px`;
    $('kopierenText').textContent = t.kopiert;
    clearTimeout(kopiertZeit);
    kopiertZeit = setTimeout(() => ($('kopierenText').textContent = t.kopieren), KOPIERT_MS);
}

// Statt des Knopfs die Rückfrage, wie beim Löschen auf den anderen Seiten
function zeigeSchluesselfrage(ja) {
    $('schluesselfrage').hidden = !ja;
    $('schluesselknopf').hidden = ja;
    $(ja ? 'nichtErzeugen' : 'neuerSchluessel').focus();
}

async function erzeugeSchluessel() {
    if (!(await bediene($('wirklichErzeugen'), 'fernSchluessel'))) {
        nachfragenBald();
    }
    zeigeSchluesselfrage(false);
}

nimmTexte(t);
beschrifte();
$('adresse').addEventListener('input', () => $('adresse').removeAttribute('aria-invalid'));
$('adressformular').addEventListener('submit', speichereAdresse);
$('kopieren').addEventListener('click', () => void kopiere());
$('neuerSchluessel').addEventListener('click', () => zeigeSchluesselfrage(true));
$('nichtErzeugen').addEventListener('click', () => zeigeSchluesselfrage(false));
$('wirklichErzeugen').addEventListener('click', () => void erzeugeSchluessel());
if (verbinde({ name: 'myzel-app.fernseite', lade })) {
    setInterval(() => {
        if (document.visibilityState === 'visible') {
            void lade();
        }
    }, ABFRAGE_MS);
    setInterval(zeigeStand, 1000);
}
