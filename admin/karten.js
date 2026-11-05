// Kartenseite im Reiter „Karten“ der Instanzeinstellungen (KONZEPT-KARTEN.md, Abschnitte 12 und 14)
import {
    $,
    ablehnungstext,
    abschnitt,
    ausDialog,
    fuelleAuswahl,
    frage,
    kachel,
    knoten,
    ladeStand,
    nimmTexte,
    oeffneDialog,
    starte,
    symbol,
    texte,
    vergleicher,
} from './seite.js';

const TEXTE = {
    de: {
        hinweis:
            'Nur Karten erreichen die Handys, nie einzelne Datenpunkte. Profile geben sie über ihren Raum oder einzeln frei. ' +
            'Änderungen gelten sofort, ohne Speichern und ohne Neustart; verbundene Handys sehen sie nach wenigen Sekunden.',
        neu: 'Neue Karte',
        bearbeiten: 'Karte bearbeiten',
        name: 'Name',
        typ: 'Typ',
        raum: 'Raum',
        teile: 'Datenpunkte',
        bezeichnung: 'Bezeichnung',
        bezeichnungLeer: 'leer: Name des Datenpunkts',
        suchen: 'Datenpunkt suchen: Wörter aus ID oder Name',
        mehrTreffer: 'Mehr als 100 Treffer, bitte genauer suchen',
        keineTreffer: 'Kein passender Datenpunkt',
        loeschfrage: name => `„${name}“ löschen? Profile, die die Karte nennen, verlieren sie.`,
        keineKarten: 'Noch keine Karten. „Neue Karte“ legt eine an.',
        laedt: 'Lade Karten …',
        vorschlaege: 'Vorschläge',
        erkanntZahl: n => (n === 1 ? '1 erkannt' : `${n} erkannt`),
        erkanntErklaerung:
            'Erkannt an den Geräten in ioBroker, nach ihren Rollen; Teile mit gleichem Namen sind zu einer Karte ' +
            'zusammengefasst. Geräte, deren Datenpunkte schon in einer Karte stehen, fehlen hier. Den Raum wählst du ' +
            'je Vorschlag, ioBroker übernimmt ihn beim Anlegen.',
        raumFuer: name => `Raum für ${name}`,
        // bleibt: [Raum, Objekt], wo der Vorschlag über ein Objekt darüber bleibt, das nicht mitwandert
        verschiebt: (von, nach, bleibt) => {
            const vonBleibt = bleibt.some(([raum]) => raum === von);
            const haupt = nach
                ? vonBleibt
                    ? `zusätzlich in ${nach}`
                    : von
                      ? `von ${von} nach ${nach}`
                      : `neu in ${nach}`
                : von && !vonBleibt
                  ? `nicht mehr in ${von}`
                  : '';
            const rest = bleibt.map(([raum, ueber]) =>
                haupt ? `in ${raum} bleibt es über ${ueber}` : `bleibt es in ${raum} über ${ueber}`,
            );
            return `In ioBroker ${[haupt, ...rest].filter(Boolean).join('; ')}`;
        },
        raumNichtUebernommen: namen =>
            `Den Raum hat ioBroker nicht übernommen für: ${namen.join(', ')}. Die Karten haben ihn trotzdem; den Grund nennt das Log.`,
        sucht: 'Suche Geräte …',
        keineVorschlaege:
            'Keine Vorschläge. Entweder steht schon alles in einer Karte, oder ioBroker hat keine Geräte mit passenden ' +
            'Rollen.',
        alleWaehlen: 'Alle wählen',
        keineWaehlen: 'Keine wählen',
        anlegen: n => (n === 1 ? '1 Karte anlegen' : `${n === 0 ? '' : `${n} `}Karten anlegen`),
        nichtAngelegt: (n, gruende) =>
            `${n === 1 ? '1 Karte angelegt' : `${n} Karten angelegt`}. Nicht angelegt: ${gruende.join('; ')}`,
        teilkurz: {
            schalten: 'An',
            helligkeit: 'Helligkeit',
            farbe: 'Farbe',
            farbtemperatur: 'Lichtfarbe',
            soll: 'Soll',
            ist: 'Ist',
        },
        teilnamen: {
            schalten: 'An und aus (true oder false)',
            helligkeit: 'Helligkeit (Zahl)',
            farbe: 'Farbe RGB (Text #RRGGBB)',
            farbtemperatur: 'Lichtfarbe (Zahl mit min und max, K oder mired)',
            wert1: 'Wert 1',
            wert2: 'Wert 2',
            wert3: 'Wert 3',
            wert4: 'Wert 4',
            soll: 'Solltemperatur (Zahl)',
            ist: 'Isttemperatur (Zahl)',
        },
        anzahlTeile: n => (n === 1 ? '1 Datenpunkt' : `${n} Datenpunkte`),
        folge: { fehlt: 'fehlt auf den Handys', teilweise: 'zeigt nicht alle Teile' },
        mangel: {
            id: 'ID ungültig',
            fehlt: 'Datenpunkt gibt es nicht',
            system: 'unter system, wird nie freigegeben',
            typ: (ist, erwartet) => `Typ ${ist} statt ${erwartet.join(' oder ')}`,
            bereich: 'min und max fehlen oder passen nicht',
        },
        nameFehlt: 'Bitte einen Namen eingeben.',
        teilFehlt: 'Bitte mindestens einen Datenpunkt wählen.',
        pflichtFehlt: teil => `Bitte einen Datenpunkt für „${teil}“ wählen.`,
        gespeichertMitMangel: folge => `Gespeichert, die Karte ${folge}. Unten steht, welcher Datenpunkt nicht passt.`,
        ablehnung: {
            zuViele: n => `Mehr als ${n} Karten gehen nicht.`,
            weg: 'Diese Karte gibt es nicht mehr. Die Liste ist neu geladen.',
            ungueltig: 'So ist die Karte nicht gültig:',
        },
    },
    en: {
        hinweis:
            'Only cards reach the phones, never single data points. Profiles release them via their room or individually. ' +
            'Changes apply at once, without saving and without a restart; connected phones see them within seconds.',
        neu: 'New card',
        bearbeiten: 'Edit card',
        name: 'Name',
        typ: 'Type',
        raum: 'Room',
        teile: 'Data points',
        bezeichnung: 'Label',
        bezeichnungLeer: 'empty: name of the data point',
        suchen: 'Search data point: words from ID or name',
        mehrTreffer: 'More than 100 matches, please search more precisely',
        keineTreffer: 'No matching data point',
        loeschfrage: name => `Delete “${name}”? Profiles naming the card lose it.`,
        keineKarten: 'No cards yet. “New card” creates one.',
        laedt: 'Loading cards …',
        vorschlaege: 'Suggestions',
        erkanntZahl: n => `${n} detected`,
        erkanntErklaerung:
            'Detected from the devices in ioBroker by their roles; parts with the same name are combined into one ' +
            'card. Devices whose data points are already in a card are not listed. Choose the room for each ' +
            'suggestion, ioBroker takes it over when the card is created.',
        raumFuer: name => `Room for ${name}`,
        verschiebt: (von, nach, bleibt) => {
            const vonBleibt = bleibt.some(([raum]) => raum === von);
            const haupt = nach
                ? vonBleibt
                    ? `additionally in ${nach}`
                    : von
                      ? `from ${von} to ${nach}`
                      : `newly in ${nach}`
                : von && !vonBleibt
                  ? `no longer in ${von}`
                  : '';
            const rest = bleibt.map(([raum, ueber]) => `it stays in ${raum} via ${ueber}`);
            return `In ioBroker ${[haupt, ...rest].filter(Boolean).join('; ')}`;
        },
        raumNichtUebernommen: namen =>
            `ioBroker did not take over the room for: ${namen.join(', ')}. The cards have it anyway; the log gives the reason.`,
        sucht: 'Looking for devices …',
        keineVorschlaege:
            'No suggestions. Either everything is already in a card, or ioBroker has no devices with suitable roles.',
        alleWaehlen: 'Select all',
        keineWaehlen: 'Select none',
        anlegen: n => (n === 1 ? 'Create 1 card' : `Create ${n === 0 ? '' : `${n} `}cards`),
        nichtAngelegt: (n, gruende) =>
            `${n === 1 ? '1 card created' : `${n} cards created`}. Not created: ${gruende.join('; ')}`,
        teilkurz: {
            schalten: 'On',
            helligkeit: 'Brightness',
            farbe: 'Color',
            farbtemperatur: 'Color temperature',
            soll: 'Target',
            ist: 'Actual',
        },
        teilnamen: {
            schalten: 'On and off (true or false)',
            helligkeit: 'Brightness (number)',
            farbe: 'Colour RGB (text #RRGGBB)',
            farbtemperatur: 'Colour temperature (number with min and max, K or mired)',
            wert1: 'Value 1',
            wert2: 'Value 2',
            wert3: 'Value 3',
            wert4: 'Value 4',
            soll: 'Target temperature (number)',
            ist: 'Current temperature (number)',
        },
        anzahlTeile: n => (n === 1 ? '1 data point' : `${n} data points`),
        folge: { fehlt: 'is missing on the phones', teilweise: 'does not show all parts' },
        mangel: {
            id: 'invalid ID',
            fehlt: 'data point does not exist',
            system: 'below system, never released',
            typ: (ist, erwartet) => `type ${ist} instead of ${erwartet.join(' or ')}`,
            bereich: 'min and max missing or invalid',
        },
        nameFehlt: 'Please enter a name.',
        teilFehlt: 'Please choose at least one data point.',
        pflichtFehlt: teil => `Please choose a data point for “${teil}”.`,
        gespeichertMitMangel: folge => `Saved, the card ${folge}. See below which data point does not fit.`,
        ablehnung: {
            zuViele: n => `More than ${n} cards are not possible.`,
            weg: 'This card no longer exists. The list has been reloaded.',
            ungueltig: 'The card is not valid like this:',
        },
    },
};

let t = texte(TEXTE);
let stand;
// Vorschläge aus der Erkennung, wie zuletzt geladen, mit den Namen ihrer Datenpunkte, und was davon angehakt ist
let erkannt = [];
let erkanntNamen = {};
const gewaehlt = new Set();
// Nur Räume, die anders gewählt sind als in ioBroker
const raumWahl = new Map();
// Ein Datenpunkt steht nur in einem Vorschlag.
const schluessel = v => Object.values(v.karte.teile)[0];
const gewaehlterRaum = v => raumWahl.get(schluessel(v)) ?? v.karte.raum;
// Die Karte im Dialog: id fehlt bei einer neuen. Teile und Bezeichnungen bleiben beim Wechsel des Typs erhalten.
let entwurf;

function beschrifte() {
    $('hinweis').textContent = t.hinweis;
    $('neuText').textContent = t.neu;
    $('nameLabel').textContent = t.name;
    $('typLabel').textContent = t.typ;
    $('raumLabel').textContent = t.raum;
    $('teileLabel').textContent = t.teile;
    $('erkennenText').textContent = t.vorschlaege;
    $('erkanntTitel').textContent = t.vorschlaege;
    $('erkanntErklaerung').textContent = t.erkanntErklaerung;
    $('erkanntAbbrechen').textContent = t.abbrechen;
}

function uebernimm(neu) {
    stand = neu;
    t = texte(TEXTE, stand.sprache);
    nimmTexte(t);
    beschrifte();
    zeichne();
    $('neu').disabled = false;
    $('erkennen').disabled = false;
    // Jede Änderung an den Karten ändert, was noch vorzuschlagen ist
    void zaehle();
}

const lade = () => ladeStand('kartenstand', uebernimm);

const raumname = id => stand.raeume.find(r => r.id === id)?.name;
const raumOptionen = () => [['', t.ohneRaum], ...stand.raeume.map(r => [r.id, r.name])];
// Wie in der App: nach Etagen und der Folge aus dem Reiter „Räume“, Räume ohne Etage nach Namen
const raumfolge = id => stand.raeume.findIndex(r => r.id === id);

function mangeltext(m) {
    return m.art === 'typ' ? t.mangel.typ(m.ist, m.erwartet) : t.mangel[m.art];
}

function kartenkachel(karte) {
    const zeilen = [['art', `${t.typen[karte.typ] ?? karte.typ} · ${t.anzahlTeile(Object.keys(karte.teile).length)}`]];
    const folge = karte.maengel?.folge;
    if (folge) {
        const teile = Object.values(karte.maengel.teile).map(mangeltext);
        zeilen.push([`mangel ${folge}`, `${t.folge[folge]}: ${teile.join(', ')}`]);
    }
    return kachel({
        zeichen: karte.typ,
        name: karte.name,
        zeilen,
        oeffne: () => oeffne(karte),
        bearbeiten: t.bearbeiten,
    });
}

// Wie die App: nach der Folge der Räume, ohne Raum oder mit einem Raum, den es nicht mehr gibt, zuletzt; im Raum nach
// Namen. Liefert [Überschrift, Einträge] je Raum.
function nachRaeumen(eintraege, raumVon, sortiert) {
    const gruppen = new Map();
    for (const e of eintraege) {
        const raum = raumname(raumVon(e)) === undefined ? '' : raumVon(e);
        gruppen.set(raum, [...(gruppen.get(raum) ?? []), e]);
    }
    return [...gruppen.keys()]
        .sort((a, b) => (a === '' ? 1 : b === '' ? -1 : raumfolge(a) - raumfolge(b)))
        .map(raum => [raum ? raumname(raum) : t.ohneRaum, gruppen.get(raum).sort(sortiert)]);
}

function zeichne() {
    const liste = $('liste');
    liste.replaceChildren();
    if (stand.karten.length === 0) {
        liste.append(knoten('p', 'leer', t.keineKarten));
        return;
    }
    const vergleiche = vergleicher(stand.sprache);
    const nachName = (a, b) => vergleiche(a.name, b.name) || (a.id < b.id ? -1 : 1);
    for (const [titel, karten] of nachRaeumen(stand.karten, k => k.raum, nachName)) {
        liste.append(abschnitt(titel, karten.map(kartenkachel)));
    }
}

function zeigeZahl(n) {
    $('erkanntZahl').hidden = n === 0;
    $('erkanntZahl').textContent = String(n);
    $('erkennen').setAttribute('aria-label', n === 0 ? t.vorschlaege : `${t.vorschlaege}, ${t.erkanntZahl(n)}`);
}

// Nur für die Zahl am Knopf. Scheitert es, fehlt nur die Zahl; der Dialog fragt selbst.
async function zaehle() {
    try {
        const antwort = await frage('vorschlaege');
        zeigeZahl(antwort.fehler ? 0 : antwort.vorschlaege.length);
    } catch {
        zeigeZahl(0);
    }
}

function teiltext(karte) {
    return Object.entries(karte.teile)
        .map(([teil, dp]) => (karte.typ === 'messwert' ? (erkanntNamen[dp] ?? dp) : (t.teilkurz[teil] ?? teil)))
        .join(', ');
}

// Zusammengefasste Teile aus einem Ordner kurz: „a.b.an, .hell, .farbe“
function herkunftText(ids) {
    const eltern = id => id.slice(0, id.lastIndexOf('.'));
    if (ids.length > 1 && ids.every(id => eltern(id) === eltern(ids[0]))) {
        return [ids[0], ...ids.slice(1).map(id => id.slice(eltern(id).length))].join(', ');
    }
    return ids.join(', ');
}

function erkanntZeile(v) {
    const zeile = knoten('label', 'wahlzeile');
    const box = knoten('input');
    box.type = 'checkbox';
    box.dataset.schluessel = schluessel(v);
    box.checked = gewaehlt.has(box.dataset.schluessel);
    box.addEventListener('change', () => {
        if (box.checked) {
            gewaehlt.add(box.dataset.schluessel);
        } else {
            gewaehlt.delete(box.dataset.schluessel);
        }
        zeigeWahl();
    });
    const s = knoten('span', 'symbol klein');
    s.append(symbol(v.karte.typ));
    const text = knoten('span', '', v.karte.name);
    text.append(knoten('span', 'leise', `${t.typen[v.karte.typ] ?? v.karte.typ} · ${teiltext(v.karte)}`));
    const name = knoten('span', 'wahlname mit-symbol');
    name.append(s, text);
    const wahl = knoten('select', 'raumwahl');
    wahl.setAttribute('aria-label', t.raumFuer(v.karte.name));
    fuelleAuswahl(wahl, raumOptionen(), gewaehlterRaum(v));
    const verschiebt = knoten('span', 'verschiebt');
    const zeigeRaum = () => {
        const anders = wahl.value !== v.karte.raum;
        wahl.classList.toggle('geaendert', anders);
        verschiebt.hidden = !anders;
        const bleibt = v.bleibt.filter(b => b.raum !== wahl.value).map(b => [raumname(b.raum), b.ueber]);
        verschiebt.textContent = anders ? t.verschiebt(raumname(v.karte.raum), raumname(wahl.value), bleibt) : '';
    };
    // Wer den Raum ändert, will die Karte.
    wahl.addEventListener('change', () => {
        if (wahl.value === v.karte.raum) {
            raumWahl.delete(box.dataset.schluessel);
        } else {
            raumWahl.set(box.dataset.schluessel, wahl.value);
        }
        box.checked = true;
        gewaehlt.add(box.dataset.schluessel);
        zeigeRaum();
        zeigeWahl();
    });
    zeigeRaum();
    zeile.append(box, name, wahl, knoten('span', 'ziel', herkunftText(v.herkunft)), verschiebt);
    return zeile;
}

function zeigeWahl() {
    const n = gewaehlt.size;
    $('anlegen').textContent = t.anlegen(n);
    $('anlegen').disabled = n === 0;
    $('alleWaehlen').textContent = n > 0 && n === erkannt.length ? t.keineWaehlen : t.alleWaehlen;
    $('alleWaehlen').disabled = erkannt.length === 0;
}

// leer: was ohne Vorschläge dasteht, etwa „Suche Geräte …“
function zeichneErkannt(leer) {
    const liste = $('erkanntListe');
    liste.replaceChildren();
    if (erkannt.length === 0 && leer) {
        liste.append(knoten('p', 'leer', leer));
    }
    const vergleiche = vergleicher(stand.sprache);
    const nachName = (a, b) => vergleiche(a.karte.name, b.karte.name);
    for (const [titel, vorschlaege] of nachRaeumen(erkannt, v => v.karte.raum, nachName)) {
        liste.append(knoten('div', 'gruppe', titel), ...vorschlaege.map(erkanntZeile));
    }
    zeigeWahl();
}

async function oeffneErkannt() {
    erkannt = [];
    gewaehlt.clear();
    raumWahl.clear();
    $('erkanntFehler').textContent = '';
    zeichneErkannt(t.sucht);
    $('erkanntDialog').showModal();
    try {
        const antwort = await frage('vorschlaege', { frisch: true });
        if (antwort.fehler) {
            $('erkanntFehler').textContent = ablehnungstext(antwort);
            zeichneErkannt('');
            return;
        }
        erkannt = antwort.vorschlaege;
        erkanntNamen = antwort.namen;
        zeigeZahl(erkannt.length);
        zeichneErkannt(t.keineVorschlaege);
    } catch (fehler) {
        $('erkanntFehler').textContent = fehler.message;
        zeichneErkannt('');
    }
}

function waehleAlle() {
    const alle = gewaehlt.size === erkannt.length;
    gewaehlt.clear();
    if (!alle) {
        erkannt.forEach(v => gewaehlt.add(schluessel(v)));
    }
    document.querySelectorAll('#erkanntListe input[type="checkbox"]').forEach(box => {
        box.checked = gewaehlt.has(box.dataset.schluessel);
    });
    zeigeWahl();
}

// Angelegte fallen aus der Liste; was abgelehnt wurde, bleibt angehakt stehen, mit Grund.
async function legeAn(ereignis) {
    ereignis.preventDefault();
    const auswahl = erkannt.filter(v => gewaehlt.has(schluessel(v)));
    $('erkanntFehler').textContent = '';
    $('anlegen').disabled = true;
    try {
        const antwort = await frage('legeKartenAn', {
            karten: auswahl.map(v => ({ ...v.karte, raum: gewaehlterRaum(v) })),
        });
        if (antwort.fehler) {
            $('erkanntFehler').textContent = ablehnungstext(antwort, stand.hoechstens);
            return;
        }
        uebernimm(antwort.stand);
        const gruende = [];
        const ohneRaum = [];
        antwort.ergebnisse.forEach((e, i) => {
            if (e.fehler) {
                gruende.push(`${auswahl[i].karte.name}: ${ablehnungstext(e, stand.hoechstens)}`);
                return;
            }
            if (e.raum === 'gescheitert') {
                ohneRaum.push(auswahl[i].karte.name);
            }
            gewaehlt.delete(schluessel(auswahl[i]));
            raumWahl.delete(schluessel(auswahl[i]));
            erkannt = erkannt.filter(v => v !== auswahl[i]);
        });
        if (gruende.length === 0 && ohneRaum.length === 0) {
            $('erkanntDialog').close();
            return;
        }
        zeichneErkannt(t.keineVorschlaege);
        $('erkanntFehler').textContent = [
            gruende.length > 0 ? t.nichtAngelegt(auswahl.length - gruende.length, gruende) : '',
            ohneRaum.length > 0 ? t.raumNichtUebernommen(ohneRaum) : '',
        ]
            .filter(Boolean)
            .join(' ');
    } catch (fehler) {
        $('erkanntFehler').textContent = fehler.message;
    } finally {
        zeigeWahl();
    }
}

function info(teil) {
    const zeile = document.querySelector(`.teil[data-teil="${teil}"] .info`);
    if (!zeile) {
        return;
    }
    const dp = entwurf.teile[teil]?.trim();
    const mangel = dp && dp === entwurf.gespeichert[teil] ? entwurf.maengel[teil] : undefined;
    zeile.classList.toggle('mangel', mangel !== undefined);
    zeile.textContent = mangel ? mangeltext(mangel) : (dp && (entwurf.namen[dp] ?? stand.namen[dp])) || '';
}

// Eigene Vorschlagsliste statt datalist: Der Browser filtert eine datalist noch einmal selbst und verwirft dabei Treffer
// der Instanz, die jedes Wort in ID oder Name sucht; und Enter wählt dort nicht verlässlich.
function auswahlfeld(teil, dp, liste) {
    let treffer = [];
    let aktiv = -1;
    let zeit;
    let nummer = 0;
    const markiere = i => {
        aktiv = i;
        [...liste.children].forEach((li, j) => li.classList.toggle('aktiv', j === i));
        if (i >= 0) {
            dp.setAttribute('aria-activedescendant', liste.children[i].id);
            liste.children[i].scrollIntoView({ block: 'nearest' });
        } else {
            dp.removeAttribute('aria-activedescendant');
        }
    };
    const schliesse = () => {
        clearTimeout(zeit);
        nummer++;
        liste.hidden = true;
        dp.setAttribute('aria-expanded', 'false');
        markiere(-1);
    };
    const waehle = i => {
        const tr = treffer[i];
        if (!tr) {
            return;
        }
        dp.value = tr.id;
        entwurf.teile[teil] = tr.id;
        entwurf.namen[tr.id] = tr.name;
        dp.removeAttribute('aria-invalid');
        schliesse();
        info(teil);
    };
    const zeige = antwort => {
        treffer = antwort.treffer;
        const eintraege = treffer.map((tr, i) => {
            const li = knoten('li');
            li.id = `vorschlag-${teil}-${i}`;
            li.setAttribute('role', 'option');
            li.dataset.i = String(i);
            li.append(
                knoten('span', 'vname', tr.einheit ? `${tr.name} (${tr.einheit})` : tr.name),
                knoten('span', 'vid', tr.id),
            );
            return li;
        });
        if (antwort.mehr || treffer.length === 0) {
            eintraege.push(knoten('li', 'vhinweis', antwort.mehr ? t.mehrTreffer : t.keineTreffer));
        }
        liste.replaceChildren(...eintraege);
        liste.hidden = false;
        dp.setAttribute('aria-expanded', 'true');
        markiere(treffer.length > 0 ? 0 : -1);
    };
    const suche = () => {
        clearTimeout(zeit);
        zeit = setTimeout(async () => {
            const meine = ++nummer;
            try {
                const antwort = await frage('datenpunkte', { typ: $('typ').value, teil, suche: dp.value });
                if (meine === nummer && !antwort.fehler && document.activeElement === dp) {
                    zeige(antwort);
                }
            } catch (fehler) {
                $('fehler').textContent = fehler.message;
            }
        }, 200);
    };
    dp.setAttribute('role', 'combobox');
    dp.setAttribute('aria-autocomplete', 'list');
    dp.setAttribute('aria-controls', liste.id);
    dp.setAttribute('aria-expanded', 'false');
    dp.addEventListener('focus', suche);
    dp.addEventListener('blur', schliesse);
    dp.addEventListener('input', () => {
        entwurf.teile[teil] = dp.value;
        dp.removeAttribute('aria-invalid');
        info(teil);
        suche();
    });
    dp.addEventListener('keydown', e => {
        if (liste.hidden) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                suche();
            }
            return;
        }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            const schritt = e.key === 'ArrowDown' ? 1 : -1;
            markiere(Math.min(Math.max(aktiv + schritt, 0), treffer.length - 1));
        } else if (e.key === 'Enter' && aktiv >= 0) {
            e.preventDefault();
            waehle(aktiv);
        } else if (e.key === 'Escape') {
            // Schließt nur die Liste, nicht den Dialog
            e.preventDefault();
            e.stopPropagation();
            schliesse();
        }
    });
    // Ein Klick in die Liste nimmt dem Feld nicht den Fokus, sonst schlösse blur sie vor der Wahl.
    liste.addEventListener('mousedown', e => e.preventDefault());
    liste.addEventListener('click', e => {
        const li = e.target.closest('li[data-i]');
        if (li) {
            waehle(Number(li.dataset.i));
        }
    });
}

function zeichneTeile() {
    const art = stand.arten[$('typ').value];
    $('teile').replaceChildren(
        ...art.teile.map(({ teil }) => {
            const block = knoten('div', 'teil');
            block.dataset.teil = teil;
            const zeile = knoten('div', 'zeile');
            const feld = knoten('label', 'feld');
            const pflicht = art.pflicht.includes(teil) ? ' *' : '';
            feld.append(knoten('span', '', `${t.teilnamen[teil] ?? teil}${pflicht}`));
            const dp = knoten('input');
            dp.dataset.dp = '';
            dp.autocomplete = 'off';
            dp.spellcheck = false;
            dp.placeholder = t.suchen;
            dp.value = entwurf.teile[teil] ?? '';
            const liste = knoten('ul', 'vorschlaege');
            liste.id = `vorschlaege-${teil}`;
            liste.setAttribute('role', 'listbox');
            liste.hidden = true;
            const wahl = knoten('div', 'wahl');
            wahl.append(dp, liste);
            auswahlfeld(teil, dp, liste);
            feld.append(wahl);
            zeile.append(feld);
            if (art.bezeichnungen) {
                const bfeld = knoten('label', 'feld');
                bfeld.append(knoten('span', '', t.bezeichnung));
                const b = knoten('input');
                b.maxLength = stand.laengen.bezeichnung;
                b.placeholder = t.bezeichnungLeer;
                b.value = entwurf.bezeichnungen[teil] ?? '';
                b.addEventListener('input', () => (entwurf.bezeichnungen[teil] = b.value));
                bfeld.append(b);
                zeile.append(bfeld);
            }
            block.append(zeile, knoten('div', 'info'));
            return block;
        }),
    );
    art.teile.forEach(({ teil }) => info(teil));
}

function oeffne(karte) {
    entwurf = {
        id: karte?.id,
        teile: { ...karte?.teile },
        bezeichnungen: { ...karte?.bezeichnungen },
        gespeichert: { ...karte?.teile },
        maengel: { ...karte?.maengel?.teile },
        namen: {},
    };
    $('name').value = karte?.name ?? '';
    $('name').maxLength = stand.laengen.name;
    $('name').removeAttribute('aria-invalid');
    fuelleAuswahl(
        $('typ'),
        Object.keys(stand.arten).map(typ => [typ, t.typen[typ] ?? typ]),
        karte?.typ ?? 'schalter',
    );
    fuelleAuswahl($('raum'), raumOptionen(), karte?.raum ?? '');
    zeichneTeile();
    $('loeschen').hidden = !karte;
    oeffneDialog(karte ? t.bearbeiten : t.neu);
    $('name').focus();
}

// Was schon hier auffällt, braucht keinen Weg zur Instanz; entscheiden tut sie.
function entwurfAlsKarte() {
    const typ = $('typ').value;
    const art = stand.arten[typ];
    const name = $('name').value.trim();
    const teile = Object.fromEntries(
        art.teile.map(({ teil }) => [teil, (entwurf.teile[teil] ?? '').trim()]).filter(([, dp]) => dp !== ''),
    );
    if (!name) {
        $('name').setAttribute('aria-invalid', 'true');
        $('name').focus();
        return t.nameFehlt;
    }
    const fehlt = art.pflicht.find(teil => !teile[teil]);
    if (fehlt) {
        document.querySelector(`.teil[data-teil="${fehlt}"] input[data-dp]`).setAttribute('aria-invalid', 'true');
        return t.pflichtFehlt(t.teilnamen[fehlt] ?? fehlt);
    }
    if (Object.keys(teile).length === 0) {
        return t.teilFehlt;
    }
    const bezeichnungen = art.bezeichnungen
        ? Object.fromEntries(
              Object.keys(teile)
                  .map(teil => [teil, (entwurf.bezeichnungen[teil] ?? '').trim()])
                  .filter(([, b]) => b !== ''),
          )
        : {};
    return { name, typ, raum: $('raum').value, teile, bezeichnungen };
}

async function speichere(ereignis) {
    ereignis.preventDefault();
    const karte = entwurfAlsKarte();
    if (typeof karte === 'string') {
        $('fehler').textContent = karte;
        return;
    }
    const nachricht = entwurf.id ? { id: entwurf.id, karte } : { karte };
    const antwort = await ausDialog($('speichern'), 'speichereKarte', nachricht, { lade, grenze: stand.hoechstens });
    if (!antwort) {
        return;
    }
    uebernimm(antwort.stand);
    const gespeichert = stand.karten.find(k => k.id === antwort.id);
    if (!gespeichert?.maengel?.folge) {
        $('dialog').close();
        return;
    }
    // Bleibt offen, damit der unpassende Datenpunkt gleich zu sehen und zu ändern ist
    oeffne(gespeichert);
    $('fehler').textContent = t.gespeichertMitMangel(t.folge[gespeichert.maengel.folge]);
}

async function loesche() {
    const antwort = await ausDialog($('wirklichLoeschen'), 'loescheKarte', { id: entwurf.id }, { lade });
    if (antwort) {
        uebernimm(antwort.stand);
        $('dialog').close();
    }
}

nimmTexte(t);
beschrifte();
$('liste').append(knoten('p', 'leer', t.laedt));
$('typ').addEventListener('change', zeichneTeile);
$('erkennen').addEventListener('click', () => void oeffneErkannt());
$('alleWaehlen').addEventListener('click', waehleAlle);
$('erkanntAbbrechen').addEventListener('click', () => $('erkanntDialog').close());
$('erkanntFormular').addEventListener('submit', ereignis => void legeAn(ereignis));
starte({
    name: 'myzel-app.kartenseite',
    lade,
    neu: () => oeffne(undefined),
    speichere,
    loesche,
    loeschfrage: () => t.loeschfrage($('name').value.trim() || entwurf.id),
});
