// Zonenseite im Reiter „Zonen“ der Instanzeinstellungen (KONZEPT-ZONEN.md, Abschnitt 16.1): Orte anlegen, ändern und
// löschen. Welche App welche Zone bekommt, steht im Reiter „Apps“ unter „Handydaten“. Prüfen und speichern tut die
// Instanz; die Seite prüft vorab nur, um gleich am Feld zu sagen, was fehlt.
import {
    $,
    ausDialog,
    frage,
    instanz,
    kachel,
    knoten,
    ladeStand,
    nimmTexte,
    oeffneDialog,
    starte,
    texte,
} from './seite.js';

const TEXTE = {
    de: {
        hinweis:
            'Zonen sind Orte wie Zuhause oder Arbeit. Freigegebene Apps melden, wenn das Handy eine Zone betritt oder ' +
            'verlässt; wo genau es ist, erfährt ioBroker dabei nicht. Jede App bekommt nur die Zonen, die ihr ' +
            'freigegeben sind, im Reiter „Apps“ unter „Handydaten“.',
        neu: 'Neue Zone',
        bearbeiten: 'Zone bearbeiten',
        titel: name => `Zone „${name}“`,
        name: 'Name',
        kennung: 'ID für Skripte',
        idNeu: 'Aus dem Namen vorgeschlagen. Kleinbuchstaben, Ziffern und _. Nach dem Anlegen fest, weil Skripte daran hängen.',
        idFest: id => `Fest, weil Skripte daran hängen, etwa an ${instanz}.apps.<App>.zonen.${id}.`,
        mitte: 'Mittelpunkt (Breite, Länge)',
        zuhause: 'Zuhause aus den Systemeinstellungen',
        mitteHinweis: 'So, wie Karten-Apps ihn beim Kopieren liefern, etwa „50.94130, 6.95830“.',
        mitteOhneZuhause:
            'So, wie Karten-Apps ihn beim Kopieren liefern. Für „Zuhause aus den Systemeinstellungen“ fehlt dort der ' +
            'Standort: Admin, Systemeinstellungen, Breite und Länge.',
        radius: 'Radius in m',
        radiusHinweis: (von, bis) =>
            `${zahl(von)} bis ${zahl(bis)} m. Für Zuhause eignen sich 200 bis 500 m, dann meldet das Handy die Zone, ` +
            `bevor es im WLAN ist. Unter ${zahl(von)} m geht nicht: Drinnen sind Handys oft nur auf 50 bis 100 m genau.`,
        kachelRadius: (radius, apps) =>
            `Radius ${zahl(radius)} m · ${apps === 0 ? 'an keine App' : apps === 1 ? 'an 1 App' : `an ${apps} Apps`}`,
        kachelId: id => `ID ${id}`,
        keineZonen: 'Noch keine Zonen.',
        vomHandy: 'Vom Handy: ',
        vorschlag: (alter, genauigkeit) => `, ${alter}, auf ${zahl(genauigkeit)} m genau`,
        alter: ms => {
            const min = Math.floor(ms / 60_000);
            return min < 1 ? 'gerade eben' : min === 1 ? 'vor 1 Minute' : `vor ${min} Minuten`;
        },
        uebernehmen: 'Übernehmen',
        nurVorschlag: 'Nur ein Vorschlag: Eine App kann eine Zone nie selbst verschieben.',
        laedt: 'Lädt …',
        behalten: 'Behalten',
        nameFehlt: 'Bitte einen Namen eingeben.',
        idFalsch:
            'Die ID beginnt mit einem Kleinbuchstaben, danach Kleinbuchstaben, Ziffern und _, höchstens 30 Zeichen. ' +
            '„letzte“, „aktiv“ und „grund“ sind belegt.',
        mitteFalsch: 'Bitte den Mittelpunkt als „Breite, Länge“ mit Dezimalpunkt eingeben, etwa „50.94130, 6.95830“.',
        radiusFalsch: (von, bis) => `Der Radius muss eine ganze Zahl von ${zahl(von)} bis ${zahl(bis)} m sein.`,
        loeschfrage: name => `Zone „${name}“ löschen? Ihre Datenpunkte verschwinden bei allen Apps.`,
        ablehnung: {
            weg: 'Diese Zone gibt es nicht mehr. Die Seite wurde neu geladen.',
            ungueltig: 'So ist die Zone nicht gültig:',
            vergeben: 'Diese ID hat schon eine Zone. Bitte eine andere wählen.',
            zuViele: n => `Mehr als ${n} Zonen gehen nicht.`,
        },
    },
    en: {
        hinweis:
            'Zones are places such as home or work. Apps with permission report when the phone enters or leaves a ' +
            'zone; ioBroker does not learn where exactly it is. Each app only gets the zones assigned to it, in the ' +
            '“Apps” tab under “Phone data”.',
        neu: 'New zone',
        bearbeiten: 'Edit zone',
        titel: name => `Zone “${name}”`,
        name: 'Name',
        kennung: 'ID for scripts',
        idNeu: 'Suggested from the name. Lowercase letters, digits and _. Fixed after creating, because scripts depend on it.',
        idFest: id => `Fixed, because scripts depend on it, for example on ${instanz}.apps.<app>.zonen.${id}.`,
        mitte: 'Centre (latitude, longitude)',
        zuhause: 'Home from the system settings',
        mitteHinweis: 'As map apps copy it, for example “50.94130, 6.95830”.',
        mitteOhneZuhause:
            'As map apps copy it. For “Home from the system settings” the location is missing there: admin, system ' +
            'settings, latitude and longitude.',
        radius: 'Radius in m',
        radiusHinweis: (von, bis) =>
            `${zahl(von)} to ${zahl(bis)} m. For home, 200 to 500 m work well; the phone then reports the zone before ` +
            `it is on the Wi-Fi. Below ${zahl(von)} m is not possible: indoors, phones are often only accurate to 50 to 100 m.`,
        kachelRadius: (radius, apps) =>
            `Radius ${zahl(radius)} m · ${apps === 0 ? 'no app' : apps === 1 ? '1 app' : `${apps} apps`}`,
        kachelId: id => `ID ${id}`,
        keineZonen: 'No zones yet.',
        vomHandy: 'From the phone: ',
        vorschlag: (alter, genauigkeit) => `, ${alter}, accurate to ${zahl(genauigkeit)} m`,
        alter: ms => {
            const min = Math.floor(ms / 60_000);
            return min < 1 ? 'just now' : min === 1 ? '1 minute ago' : `${min} minutes ago`;
        },
        uebernehmen: 'Use',
        nurVorschlag: 'Only a suggestion: an app can never move a zone itself.',
        laedt: 'Loading …',
        behalten: 'Keep',
        nameFehlt: 'Please enter a name.',
        idFalsch:
            'The ID starts with a lowercase letter, followed by lowercase letters, digits and _, at most 30 characters. ' +
            '“letzte”, “aktiv” and “grund” are taken.',
        mitteFalsch:
            'Please enter the centre as “latitude, longitude” with a decimal point, for example “50.94130, 6.95830”.',
        radiusFalsch: (von, bis) => `The radius must be a whole number from ${zahl(von)} to ${zahl(bis)} m.`,
        loeschfrage: name => `Delete zone “${name}”? Its data points disappear for all apps.`,
        ablehnung: {
            weg: 'This zone no longer exists. The page has been reloaded.',
            ungueltig: 'The zone is not valid like this:',
            vergeben: 'A zone with this ID already exists. Please choose another one.',
            zuViele: n => `More than ${n} zones are not possible.`,
        },
    },
};

// Wie src/app/zonen.ts: ID-Muster und Vorschlag aus dem Namen
const ID_MUSTER = /^(?!(letzte|aktiv|grund)$)[a-z][a-z0-9_]{0,29}$/;

let t = texte(TEXTE);
let stand;
// Die Zone im Dialog; id fehlt bei einer neuen
let entwurf;
// Hat jemand die ID beim Anlegen selbst geändert, schlägt der Name keine mehr vor.
let idVonHand = false;

function zahl(n) {
    return Number(n).toLocaleString(t?.code === 'de' ? 'de-DE' : 'en');
}

function kennungAus(name) {
    return name
        .toLowerCase()
        .replaceAll('ä', 'ae')
        .replaceAll('ö', 'oe')
        .replaceAll('ü', 'ue')
        .replaceAll('ß', 'ss')
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^[^a-z]+/, '')
        .slice(0, 30)
        .replace(/_+$/, '');
}

// Wie liesMitte in src/app/zonen.ts; die Instanz prüft noch einmal.
function liesMitte(text) {
    const teile = text
        .trim()
        .split(/\s*[,;]\s*|\s+/)
        .filter(x => x !== '');
    if (teile.length !== 2 || !teile.every(x => /^[+-]?\d{1,3}(\.\d+)?$/.test(x))) {
        return undefined;
    }
    const [breite, laenge] = teile.map(Number);
    return Math.abs(breite) > 90 || Math.abs(laenge) > 180 ? undefined : { breite, laenge };
}

const mitteText = (breite, laenge) => `${breite}, ${laenge}`;

function beschrifte() {
    $('hinweis').textContent = t.hinweis;
    $('neuText').textContent = t.neu;
    $('nameLabel').textContent = t.name;
    $('kennungLabel').textContent = t.kennung;
    $('mitteLabel').textContent = t.mitte;
    $('zuhauseText').textContent = t.zuhause;
    $('radiusLabel').textContent = t.radius;
    $('nichtLoeschen').textContent = t.behalten;
    if (stand) {
        $('radiusHinweis').textContent = t.radiusHinweis(stand.radius.von, stand.radius.bis);
        $('mitteHinweis').textContent = stand.zuhause ? t.mitteHinweis : t.mitteOhneZuhause;
        $('zuhause').disabled = !stand.zuhause;
    }
}

function uebernimm(neu) {
    stand = neu;
    t = texte(TEXTE, stand.sprache);
    nimmTexte(t);
    beschrifte();
    zeichne();
    $('neu').disabled = stand.zonen.length >= stand.hoechstens;
}

const lade = () => ladeStand('zonenstand', uebernimm);

function zeichne() {
    const liste = $('liste');
    liste.replaceChildren();
    if (stand.zonen.length === 0) {
        liste.append(knoten('p', 'leer', t.keineZonen));
        return;
    }
    const kacheln = knoten('div', 'kacheln oben');
    kacheln.append(
        ...stand.zonen.map(z =>
            kachel({
                zeichen: 'zone',
                name: z.name,
                zeilen: [
                    ['art', t.kachelRadius(z.radius, z.apps.length)],
                    ['art kennung', t.kachelId(z.id)],
                ],
                oeffne: () => oeffne(z),
                bearbeiten: t.bearbeiten,
            }),
        ),
    );
    liste.append(kacheln);
}

// Standorte, die Apps als Mittelpunkt vorgeschlagen haben (KONZEPT-ZONEN.md, Abschnitt 17.7); Übernehmen füllt nur das Feld
function zeigeVorschlaege() {
    const ort = $('vorschlaege');
    const liste = stand?.vorschlaege ?? [];
    ort.hidden = liste.length === 0;
    ort.replaceChildren(
        ...liste.map(v => {
            const zeile = knoten('div', 'vorschlag');
            const text = knoten('span', 'text', t.vomHandy);
            text.append(
                knoten('b', '', v.app),
                t.vorschlag(t.alter(Math.max(0, stand.jetzt - v.zeit)), Math.round(v.genauigkeit)),
            );
            const knopf = knoten('button', 'knopf haupt', t.uebernehmen);
            knopf.type = 'button';
            knopf.addEventListener('click', () => {
                $('mitte').value = mitteText(rund(v.breite), rund(v.laenge));
                $('mitte').removeAttribute('aria-invalid');
                $('mitte').focus();
            });
            zeile.append(text, knopf);
            return zeile;
        }),
    );
    if (liste.length > 0) {
        ort.append(knoten('p', 'erklaerung', t.nurVorschlag));
    }
}

const rund = w => Math.round(w * 1e6) / 1e6;

// Ein Vorschlag kann gerade erst gekommen sein; die Kacheln bleiben, wie sie sind.
async function frischeVorschlaege() {
    try {
        const antwort = await frage('zonenstand');
        if (!antwort.fehler && $('dialog').open) {
            stand = { ...stand, vorschlaege: antwort.vorschlaege, jetzt: antwort.jetzt };
            zeigeVorschlaege();
        }
    } catch {
        // Ohne Verbindung bleibt der bekannte Stand
    }
}

function oeffne(zone) {
    entwurf = { id: zone?.id };
    idVonHand = false;
    $('name').value = zone?.name ?? '';
    $('name').maxLength = stand.laengen.name;
    $('kennung').value = zone?.id ?? '';
    $('kennung').maxLength = stand.laengen.id;
    $('kennung').readOnly = !!zone;
    $('idHinweis').textContent = zone ? t.idFest(zone.id) : t.idNeu;
    $('mitte').value = zone ? mitteText(zone.breite, zone.laenge) : '';
    $('radius').min = String(stand.radius.von);
    $('radius').max = String(stand.radius.bis);
    $('radius').value = String(zone?.radius ?? stand.radius.vorgabe);
    for (const feld of ['name', 'kennung', 'mitte', 'radius']) {
        $(feld).removeAttribute('aria-invalid');
    }
    $('loeschen').hidden = !zone;
    zeigeVorschlaege();
    oeffneDialog(zone ? t.titel(zone.name) : t.neu);
    $('name').focus();
    void frischeVorschlaege();
}

// Das erste Feld, das nicht passt, mit seinem Text; sonst die Zone, wie sie an die Instanz geht
function pruefe() {
    const name = $('name').value.trim();
    const radius = Number($('radius').value);
    const fehler = [
        [!name, 'name', t.nameFehlt],
        [!entwurf.id && !ID_MUSTER.test($('kennung').value), 'kennung', t.idFalsch],
        [!liesMitte($('mitte').value), 'mitte', t.mitteFalsch],
        [
            !Number.isInteger(radius) || radius < stand.radius.von || radius > stand.radius.bis,
            'radius',
            t.radiusFalsch(stand.radius.von, stand.radius.bis),
        ],
    ].find(([falsch]) => falsch);
    if (fehler) {
        const [, feld, text] = fehler;
        $(feld).setAttribute('aria-invalid', 'true');
        $(feld).focus();
        $('fehler').textContent = text;
        return undefined;
    }
    return { name, mitte: $('mitte').value, radius };
}

async function speichere(ereignis) {
    ereignis.preventDefault();
    const zone = pruefe();
    if (!zone) {
        return;
    }
    const nachricht = entwurf.id ? { id: entwurf.id, zone } : { wunsch: $('kennung').value, zone };
    const antwort = await ausDialog($('speichern'), 'speichereZone', nachricht, { lade, grenze: stand.hoechstens });
    if (antwort) {
        uebernimm(antwort.stand);
        $('dialog').close();
    }
}

async function loesche() {
    const antwort = await ausDialog($('wirklichLoeschen'), 'loescheZone', { id: entwurf.id }, { lade });
    if (antwort) {
        uebernimm(antwort.stand);
        $('dialog').close();
    }
}

nimmTexte(t);
beschrifte();
$('liste').append(knoten('p', 'leer', t.laedt));
for (const feld of ['name', 'kennung', 'mitte', 'radius']) {
    $(feld).addEventListener('input', () => $(feld).removeAttribute('aria-invalid'));
}
$('name').addEventListener('input', () => {
    if (!entwurf?.id && !idVonHand) {
        $('kennung').value = kennungAus($('name').value);
    }
});
$('kennung').addEventListener('input', () => {
    idVonHand = $('kennung').value !== '';
});
$('zuhause').addEventListener('click', () => {
    if (stand?.zuhause) {
        $('mitte').value = mitteText(stand.zuhause.breite, stand.zuhause.laenge);
        $('mitte').removeAttribute('aria-invalid');
    }
});
starte({
    name: 'myzel-app.zonenseite',
    lade,
    neu: () => oeffne(undefined),
    speichere,
    loesche,
    loeschfrage: () => t.loeschfrage($('name').value.trim() || entwurf.id),
});
