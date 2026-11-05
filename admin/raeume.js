// Raumseite im Reiter „Räume“ der Instanzeinstellungen (KONZEPT-KARTEN.md, Abschnitt 13): Etagen anlegen und die Räume
// hineinziehen. Prüfen und speichern tut die Instanz; die Seite zeigt eine neue Folge sofort und lädt bei einer Ablehnung
// neu.
import {
    $,
    ablehnungstext,
    ausDialog,
    frage,
    fuelleAuswahl,
    knoten,
    ladeStand,
    meldung,
    nimmTexte,
    oeffneDialog,
    starte,
    symbol,
    texte,
} from './seite.js';

const TEXTE = {
    de: {
        hinweis:
            'Etagen gliedern die Raumleiste der Apps mit kleinen Überschriften. Ohne Etagen, etwa in einer Wohnung, ' +
            'stehen die Räume nach Namen und die Leiste zeigt keine Überschriften. Räume in eine Etage ziehen und dort ' +
            'ordnen; mit der Tastatur Alt und Pfeiltasten.',
        neu: 'Neue Etage',
        bearbeiten: 'Etage bearbeiten',
        name: 'Name',
        kurz: 'Kurzname',
        namenHinweis:
            'Der Name steht im Kopf der App über dem Raum, etwa „Erdgeschoss“, der Kurzname in der Raumleiste, etwa „EG“.',
        position: 'Position',
        positionen: (i, n) =>
            i === 1 ? `ganz oben (1 von ${n})` : i === n ? `ganz unten (${n} von ${n})` : `${i} von ${n}`,
        raeume: 'Räume',
        ohneEtage: 'Ohne Etage',
        hierher: 'Räume hierher ziehen',
        karten: n => (n === 1 ? '1 Karte' : `${n} Karten`),
        keineRaeume: 'In ioBroker gibt es noch keine Räume. Räume legt der Admin unter „Aufzählungen“ an.',
        laedt: 'Lädt …',
        nameFehlt: 'Bitte einen Namen eingeben.',
        kurzFehlt: 'Bitte einen Kurznamen eingeben.',
        loeschfrage: (name, n) =>
            n === 0
                ? `„${name}“ löschen?`
                : `„${name}“ löschen? ${n === 1 ? 'Der Raum steht' : `Die ${n} Räume stehen`} danach ohne Etage.`,
        ablehnung: {
            weg: 'Diese Etage gibt es nicht mehr. Die Seite wurde neu geladen.',
            ungueltig: 'So ist die Etage nicht gültig:',
            zuViele: n => `Mehr als ${n} Etagen gehen nicht.`,
        },
    },
    en: {
        hinweis:
            'Floors structure the room bar of the apps with small headings. Without floors, for example in a flat, the ' +
            'rooms are sorted by name and the bar shows no headings. Drag rooms into a floor and order them there; with ' +
            'the keyboard use Alt and the arrow keys.',
        neu: 'New floor',
        bearbeiten: 'Edit floor',
        name: 'Name',
        kurz: 'Short name',
        namenHinweis:
            'The name is shown above the room in the header of the app, such as “Ground floor”, the short name in the room bar, such as “GF”.',
        position: 'Position',
        positionen: (i, n) => (i === 1 ? `top (1 of ${n})` : i === n ? `bottom (${n} of ${n})` : `${i} of ${n}`),
        raeume: 'Rooms',
        ohneEtage: 'No floor',
        hierher: 'Drag rooms here',
        karten: n => (n === 1 ? '1 card' : `${n} cards`),
        keineRaeume: 'There are no rooms in ioBroker yet. Rooms are created in the admin under “Enumerations”.',
        laedt: 'Loading …',
        nameFehlt: 'Please enter a name.',
        kurzFehlt: 'Please enter a short name.',
        loeschfrage: (name, n) =>
            n === 0
                ? `Delete “${name}”?`
                : `Delete “${name}”? ${n === 1 ? 'The room has' : `The ${n} rooms have`} no floor afterwards.`,
        ablehnung: {
            weg: 'This floor no longer exists. The page has been reloaded.',
            ungueltig: 'The floor is not valid like this:',
            zuViele: n => `More than ${n} floors are not possible.`,
        },
    },
};

let t = texte(TEXTE);
let stand;
// Die Etage im Dialog; id fehlt bei einer neuen
let entwurf;
// Der Raum, der gerade gezogen wird
let gezogen;

function beschrifte() {
    $('hinweis').textContent = t.hinweis;
    $('neuText').textContent = t.neu;
    $('nameLabel').textContent = t.name;
    $('kurzLabel').textContent = t.kurz;
    $('namenHinweis').textContent = t.namenHinweis;
    $('positionLabel').textContent = t.position;
}

function uebernimm(neu) {
    stand = neu;
    t = texte(TEXTE, stand.sprache);
    nimmTexte(t);
    beschrifte();
    zeichne();
    $('neu').disabled = stand.etagen.length >= stand.hoechstens;
}

const lade = () => ladeStand('raumstand', uebernimm);

// Die Gruppen in der Reihenfolge der Seite: die Etagen, dann die Räume ohne Etage; etage ist null für diese.
function gruppen() {
    const vergeben = new Set(stand.etagen.flatMap(e => e.raeume));
    return [
        ...stand.etagen.map(e => ({ etage: e, raeume: e.raeume })),
        { etage: null, raeume: stand.raeume.filter(r => !vergeben.has(r.id)).map(r => r.id) },
    ];
}

// Neu gezeichnet wird auch nach jeder Antwort der Instanz; der Fokus bleibt auf dem Raum, sonst bricht die Tastatur ab.
function zeichne() {
    const liste = $('liste');
    const fokus = document.activeElement?.closest('.raumkachel')?.dataset.id;
    liste.replaceChildren();
    if (stand.raeume.length === 0) {
        liste.append(knoten('p', 'leer', t.keineRaeume));
        return;
    }
    // Ohne Etagen gibt es nichts, wohin ein Raum gezogen werden könnte.
    const ziehbar = stand.etagen.length > 0;
    for (const g of gruppen()) {
        liste.append(gruppe(g, ziehbar));
    }
    [...liste.querySelectorAll('.raumkachel')].find(k => k.dataset.id === fokus)?.focus();
}

function gruppe({ etage, raeume }, ziehbar) {
    const a = knoten('section', 'raum etage');
    const kopf = knoten('h2');
    kopf.append(knoten('span', '', etage ? etage.name : stand.etagen.length > 0 ? t.ohneEtage : t.raeume));
    if (etage) {
        kopf.append(knoten('span', 'kurz', etage.kurz));
    }
    kopf.append(knoten('span', 'anzahl', String(raeume.length)));
    if (etage) {
        const knopf = knoten('button', 'knopf bearbeiten');
        knopf.type = 'button';
        knopf.title = t.bearbeiten;
        knopf.setAttribute('aria-label', `${t.bearbeiten}: ${etage.name}`);
        knopf.append(symbol('zahnrad'));
        knopf.addEventListener('click', () => oeffne(etage));
        kopf.append(knopf);
    }
    const gitter = knoten('div', 'kacheln raeume');
    gitter.append(...raeume.map(id => raumkachel(id, ziehbar)));
    if (ziehbar && raeume.length === 0) {
        gitter.append(knoten('p', 'platzhalter', t.hierher));
    }
    if (ziehbar) {
        nimmAuf(gitter, etage?.id ?? null);
    }
    a.append(kopf, gitter);
    return a;
}

function raumkachel(id, ziehbar) {
    const r = stand.raeume.find(x => x.id === id);
    const k = knoten('div', 'kachel raumkachel');
    k.dataset.id = id;
    const s = knoten('span', 'symbol');
    s.append(symbol('raum'));
    k.append(s, knoten('span', 'name', r?.name ?? id), knoten('span', 'art', t.karten(r?.karten ?? 0)));
    if (ziehbar) {
        k.draggable = true;
        k.tabIndex = 0;
        k.addEventListener('dragstart', e => {
            gezogen = id;
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', id);
            k.classList.add('zieht');
        });
        k.addEventListener('dragend', () => {
            gezogen = undefined;
            k.classList.remove('zieht');
            markiere();
        });
        k.addEventListener('keydown', e => mitTasten(e, id));
    }
    return k;
}

// Wohin ein Raum im Gitter käme: vor die Kachel unter dem Zeiger oder dahinter, wenn er in ihrer hinteren Hälfte steht
function stelle(gitter, e) {
    const kacheln = [...gitter.querySelectorAll('.raumkachel')].filter(k => k.dataset.id !== gezogen);
    for (const [i, k] of kacheln.entries()) {
        const b = k.getBoundingClientRect();
        const unter = e.clientY < b.top || (e.clientY <= b.bottom && e.clientX < b.left + b.width / 2);
        if (unter) {
            return { index: i, vor: k };
        }
    }
    return { index: kacheln.length, vor: null };
}

function markiere(gitter, vor) {
    for (const k of document.querySelectorAll('.ziel, .davor')) {
        k.classList.remove('ziel', 'davor');
    }
    gitter?.classList.add('ziel');
    vor?.classList.add('davor');
}

function nimmAuf(gitter, etageId) {
    gitter.addEventListener('dragover', e => {
        if (!gezogen) {
            return;
        }
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        markiere(gitter, stelle(gitter, e).vor);
    });
    gitter.addEventListener('dragleave', e => {
        if (!gitter.contains(e.relatedTarget)) {
            markiere();
        }
    });
    gitter.addEventListener('drop', e => {
        if (!gezogen) {
            return;
        }
        e.preventDefault();
        const id = gezogen;
        markiere();
        verschiebe(id, etageId, stelle(gitter, e).index);
    });
}

// Alt mit Pfeil: einen Platz vor oder zurück; Alt mit Bild auf oder ab: in die Gruppe darüber oder darunter
function mitTasten(e, id) {
    if (!e.altKey) {
        return;
    }
    const alle = gruppen();
    const g = alle.findIndex(x => x.raeume.includes(id));
    const i = alle[g].raeume.indexOf(id);
    const ziel =
        { ArrowUp: [g, i - 1], ArrowLeft: [g, i - 1], ArrowDown: [g, i + 1], ArrowRight: [g, i + 1] }[e.key] ??
        (e.key === 'PageUp' && g > 0 ? [g - 1, alle[g - 1].raeume.length] : undefined) ??
        (e.key === 'PageDown' && g < alle.length - 1 ? [g + 1, 0] : undefined);
    if (!ziel || ziel[1] < 0 || (ziel[0] === g && ziel[1] >= alle[g].raeume.length)) {
        return;
    }
    e.preventDefault();
    verschiebe(id, alle[ziel[0]].etage?.id ?? null, ziel[1]);
}

// index zählt ohne den Raum selbst. Ohne Etage stehen die Räume nach Namen; dort zählt nur, dass er keine hat.
function verschiebe(id, etageId, index) {
    const folge = stand.etagen.map(e => ({ ...e, raeume: e.raeume.filter(r => r !== id) }));
    const ziel = folge.find(e => e.id === etageId);
    ziel?.raeume.splice(index, 0, id);
    if (folge.every((e, i) => e.raeume.join('\n') === stand.etagen[i].raeume.join('\n'))) {
        return;
    }
    stand = { ...stand, etagen: folge };
    zeichne();
    void ordne(folge);
}

async function ordne(folge) {
    try {
        const antwort = await frage('ordneRaeume', { etagen: folge.map(e => ({ id: e.id, raeume: e.raeume })) });
        if (antwort.fehler) {
            meldung(ablehnungstext(antwort));
            await lade();
            return;
        }
        meldung('');
        uebernimm(antwort.stand);
    } catch (fehler) {
        meldung(fehler.message);
        await lade();
    }
}

function oeffne(etage) {
    entwurf = { id: etage?.id, raeume: etage?.raeume.length ?? 0 };
    const n = stand.etagen.length + (etage ? 0 : 1);
    const jetzt = etage ? stand.etagen.findIndex(e => e.id === etage.id) : n - 1;
    fuelleAuswahl(
        $('position'),
        Array.from({ length: n }, (_, i) => [String(i), t.positionen(i + 1, n)]),
        String(jetzt),
    );
    $('position').disabled = n < 2;
    for (const [feld, wert, laenge] of [
        ['name', etage?.name, stand.laengen.name],
        ['kurz', etage?.kurz, stand.laengen.kurz],
    ]) {
        $(feld).value = wert ?? '';
        $(feld).maxLength = laenge;
        $(feld).removeAttribute('aria-invalid');
    }
    $('loeschen').hidden = !etage;
    oeffneDialog(etage ? t.bearbeiten : t.neu);
    $('name').focus();
}

async function speichere(ereignis) {
    ereignis.preventDefault();
    const etage = { name: $('name').value.trim(), kurz: $('kurz').value.trim() };
    for (const [feld, text] of [
        ['name', t.nameFehlt],
        ['kurz', t.kurzFehlt],
    ]) {
        if (!etage[feld]) {
            $(feld).setAttribute('aria-invalid', 'true');
            $(feld).focus();
            $('fehler').textContent = text;
            return;
        }
    }
    const nachricht = entwurf.id ? { id: entwurf.id, etage } : { etage };
    const antwort = await ausDialog($('speichern'), 'speichereEtage', nachricht, {
        lade,
        grenze: stand.hoechstens,
    });
    if (!antwort) {
        return;
    }
    uebernimm(antwort.stand);
    $('dialog').close();
    // Die Position gilt über das Ordnen, das auch die übrigen Etagen nachrückt.
    const id = antwort.id;
    const folge = [...stand.etagen];
    const von = folge.findIndex(e => e.id === id);
    const nach = Number($('position').value);
    if (von >= 0 && nach !== von) {
        folge.splice(nach, 0, ...folge.splice(von, 1));
        stand = { ...stand, etagen: folge };
        zeichne();
        await ordne(folge);
    }
}

async function loesche() {
    const antwort = await ausDialog($('wirklichLoeschen'), 'loescheEtage', { id: entwurf.id }, { lade });
    if (antwort) {
        uebernimm(antwort.stand);
        $('dialog').close();
    }
}

nimmTexte(t);
beschrifte();
$('liste').append(knoten('p', 'leer', t.laedt));
for (const feld of ['name', 'kurz']) {
    $(feld).addEventListener('input', () => $(feld).removeAttribute('aria-invalid'));
}
starte({
    name: 'myzel-app.raumseite',
    lade,
    neu: () => oeffne(undefined),
    speichere,
    loesche,
    loeschfrage: () => t.loeschfrage($('name').value.trim() || entwurf.id, entwurf.raeume),
});
