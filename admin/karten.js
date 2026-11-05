// Kartenseite im Reiter „Karten“ der Instanzeinstellungen (KONZEPT-KARTEN.md, Abschnitt 12)
import {
    $,
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
// Die Karte im Dialog: id fehlt bei einer neuen. Teile und Bezeichnungen bleiben beim Wechsel des Typs erhalten.
let entwurf;

function beschrifte() {
    $('hinweis').textContent = t.hinweis;
    $('neuText').textContent = t.neu;
    $('nameLabel').textContent = t.name;
    $('typLabel').textContent = t.typ;
    $('raumLabel').textContent = t.raum;
    $('teileLabel').textContent = t.teile;
}

function uebernimm(neu) {
    stand = neu;
    t = texte(TEXTE, stand.sprache);
    nimmTexte(t);
    beschrifte();
    zeichne();
    $('neu').disabled = false;
}

const lade = () => ladeStand('kartenstand', uebernimm);

const raumname = id => stand.raeume.find(r => r.id === id)?.name;
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

// Wie die App: nach der Folge der Räume, Karten ohne Raum oder mit einem Raum, den es nicht mehr gibt, zuletzt; im Raum
// nach Namen
function zeichne() {
    const liste = $('liste');
    liste.replaceChildren();
    if (stand.karten.length === 0) {
        liste.append(knoten('p', 'leer', t.keineKarten));
        return;
    }
    const vergleiche = vergleicher(stand.sprache);
    const gruppen = new Map();
    for (const karte of stand.karten) {
        const raum = raumname(karte.raum) === undefined ? '' : karte.raum;
        gruppen.set(raum, [...(gruppen.get(raum) ?? []), karte]);
    }
    const raeume = [...gruppen.keys()].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : raumfolge(a) - raumfolge(b)));
    for (const raum of raeume) {
        const karten = gruppen.get(raum).sort((a, b) => vergleiche(a.name, b.name) || (a.id < b.id ? -1 : 1));
        liste.append(abschnitt(raum ? raumname(raum) : t.ohneRaum, karten.map(kartenkachel)));
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
    fuelleAuswahl($('raum'), [['', t.ohneRaum], ...stand.raeume.map(r => [r.id, r.name])], karte?.raum ?? '');
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
starte({
    name: 'myzel-app.kartenseite',
    lade,
    neu: () => oeffne(undefined),
    speichere,
    loesche,
    loeschfrage: () => t.loeschfrage($('name').value.trim() || entwurf.id),
});
