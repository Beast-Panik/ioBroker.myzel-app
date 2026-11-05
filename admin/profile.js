// Profilseite im Reiter „Profile“ der Instanzeinstellungen (KONZEPT-KARTEN.md, Abschnitt 12). Was eine App mit dem
// Profil sieht, rechnet die Instanz; die Seite zeigt es nur.
import {
    $,
    ausDialog,
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
            'Ein Profil bestimmt, welche Karten eine App sieht und bedienen darf: ganze Räume, dazu einzelne Karten. ' +
            'Welches Profil ein Handy hat, steht im Reiter „Apps“. Änderungen gelten sofort, ohne Neustart.',
        neu: 'Neues Profil',
        bearbeiten: 'Profil bearbeiten',
        name: 'Name',
        raeume: 'Räume',
        raeumeHinweis: 'Ein Raum gibt alle seine Karten frei, auch später angelegte.',
        karten: 'Einzelne Karten',
        kartenHinweis:
            'Nur nötig, wo eine Karte anders sein soll als ihr Raum. Gesperrt ist sie nie sichtbar. Karten mit Anrufen ' +
            'oder Benachrichtigungen der Apps gibt nur eine Einzelfreigabe frei.',
        stufenRaum: [
            ['', 'Nein'],
            ['lesen', 'Ansehen'],
            ['schreiben', 'Bedienen'],
        ],
        stufenKarte: [
            ['', 'Wie Raum'],
            ['lesen', 'Ansehen'],
            ['schreiben', 'Bedienen'],
            ['gesperrt', 'Gesperrt'],
        ],
        sieht: (n, m) =>
            n === 0 ? 'sieht keine Karte' : `sieht ${n} ${n === 1 ? 'Karte' : 'Karten'}, ${m} davon bedienbar`,
        vorschau: text => `Eine App mit diesem Profil ${text}.`,
        apps: namen =>
            namen.length === 0
                ? 'keiner App zugeordnet'
                : `${namen.length === 1 ? 'App' : 'Apps'}: ${namen.join(', ')}`,
        anzahlKarten: n => (n === 1 ? '1 Karte' : `${n} Karten`),
        zustand: {
            schreiben: 'bedienbar',
            lesen: 'nur ansehen',
            aus: 'nicht sichtbar',
            gesperrt: 'gesperrt',
            fehlt: 'fehlt, ein Datenpunkt passt nicht',
            persoenlich: 'nicht sichtbar, nur einzeln freizugeben',
        },
        keineRaeume: 'In ioBroker gibt es noch keine Räume.',
        keineKarten: 'Noch keine Karten. Sie entstehen im Reiter „Karten“.',
        keineProfile: 'Noch keine Profile. „Neues Profil“ legt eines an.',
        laedt: 'Lade Profile …',
        loeschfrage: (name, apps) =>
            apps.length === 0
                ? `„${name}“ löschen?`
                : `„${name}“ löschen? ${apps.length === 1 ? 'Die App' : 'Die Apps'} ${apps.join(', ')} ` +
                  `${apps.length === 1 ? 'sieht' : 'sehen'} danach nichts, bis im Reiter „Apps“ ein anderes Profil ` +
                  'gewählt ist.',
        nameFehlt: 'Bitte einen Namen eingeben.',
        ablehnung: {
            weg: 'Dieses Profil gibt es nicht mehr. Die Liste ist neu geladen.',
            ungueltig: 'So ist das Profil nicht gültig:',
        },
    },
    en: {
        hinweis:
            'A profile decides which cards an app sees and may operate: whole rooms, plus single cards. Which profile ' +
            'a phone has is set in the Apps tab. Changes apply at once, without a restart.',
        neu: 'New profile',
        bearbeiten: 'Edit profile',
        name: 'Name',
        raeume: 'Rooms',
        raeumeHinweis: 'A room releases all its cards, including ones added later.',
        karten: 'Single cards',
        kartenHinweis:
            'Only needed where a card should differ from its room. A blocked card is never visible. Cards with calls ' +
            'or notifications of the apps are released by a single release only.',
        stufenRaum: [
            ['', 'No'],
            ['lesen', 'View'],
            ['schreiben', 'Operate'],
        ],
        stufenKarte: [
            ['', 'As room'],
            ['lesen', 'View'],
            ['schreiben', 'Operate'],
            ['gesperrt', 'Blocked'],
        ],
        sieht: (n, m) => (n === 0 ? 'sees no card' : `sees ${n} card${n === 1 ? '' : 's'}, ${m} of them operable`),
        vorschau: text => `An app with this profile ${text}.`,
        apps: namen =>
            namen.length === 0
                ? 'not assigned to an app'
                : `${namen.length === 1 ? 'App' : 'Apps'}: ${namen.join(', ')}`,
        anzahlKarten: n => (n === 1 ? '1 card' : `${n} cards`),
        zustand: {
            schreiben: 'operable',
            lesen: 'view only',
            aus: 'not visible',
            gesperrt: 'blocked',
            fehlt: 'missing, a data point does not fit',
            persoenlich: 'not visible, release individually only',
        },
        keineRaeume: 'There are no rooms in ioBroker yet.',
        keineKarten: 'No cards yet. They are created in the Cards tab.',
        keineProfile: 'No profiles yet. “New profile” creates one.',
        laedt: 'Loading profiles …',
        loeschfrage: (name, apps) =>
            apps.length === 0
                ? `Delete “${name}”?`
                : `Delete “${name}”? ${apps.length === 1 ? 'The app' : 'The apps'} ${apps.join(', ')} ` +
                  `${apps.length === 1 ? 'sees' : 'see'} nothing afterwards until another profile is chosen in the ` +
                  'Apps tab.',
        nameFehlt: 'Please enter a name.',
        ablehnung: {
            weg: 'This profile no longer exists. The list has been reloaded.',
            ungueltig: 'The profile is not valid like this:',
        },
    },
};

let t = texte(TEXTE);
let stand;
// Das Profil im Dialog: id fehlt bei einem neuen. Je Raum und je Karte die Wahl; was die Seite nicht zeigt, etwa ein
// gelöschter Raum, bleibt darin und geht beim Speichern unverändert zurück.
let entwurf;
let vorschauZeit;
let vorschauNummer = 0;

function beschrifte() {
    $('hinweis').textContent = t.hinweis;
    $('neuText').textContent = t.neu;
    $('nameLabel').textContent = t.name;
    $('raeumeLabel').textContent = t.raeume;
    $('raeumeHinweis').textContent = t.raeumeHinweis;
    $('kartenLabel').textContent = t.karten;
    $('kartenHinweis').textContent = t.kartenHinweis;
}

function uebernimm(neu) {
    stand = neu;
    t = texte(TEXTE, stand.sprache);
    nimmTexte(t);
    beschrifte();
    zeichne();
    $('neu').disabled = false;
}

const lade = () => ladeStand('profilstand', uebernimm);

const raumname = id => stand.raeume.find(r => r.id === id)?.name;
// Wie in der App: nach Etagen und der Folge aus dem Reiter „Räume“, Räume ohne Etage nach Namen
const raumfolge = id => stand.raeume.findIndex(r => r.id === id);

function umfang(sieht) {
    const rechte = Object.values(sieht);
    return t.sieht(rechte.length, rechte.filter(r => r === 'schreiben').length);
}

function zeichne() {
    const liste = $('liste');
    liste.replaceChildren();
    if (stand.profile.length === 0) {
        liste.append(knoten('p', 'leer', t.keineProfile));
        return;
    }
    const vergleiche = vergleicher(stand.sprache);
    const kacheln = knoten('div', 'kacheln oben');
    kacheln.append(
        ...[...stand.profile]
            .sort((a, b) => vergleiche(a.name, b.name) || (a.id < b.id ? -1 : 1))
            .map(p =>
                kachel({
                    zeichen: 'profil',
                    name: p.name,
                    zeilen: [
                        ['art', umfang(p.sieht)],
                        ['art', t.apps(p.apps)],
                    ],
                    oeffne: () => oeffne(p),
                    bearbeiten: t.bearbeiten,
                }),
            ),
    );
    liste.append(kacheln);
}

// Eine Reihe gleich breiter Knöpfe, von denen genau einer gilt
function stufen(name, optionen, wert, beschriftung, beiWahl) {
    const gruppe = knoten('span', 'stufen');
    gruppe.setAttribute('role', 'radiogroup');
    gruppe.setAttribute('aria-label', beschriftung);
    for (const [v, text] of optionen) {
        const stufe = knoten('label', `stufe ${v}`);
        const knopf = knoten('input');
        knopf.type = 'radio';
        knopf.name = name;
        knopf.value = v;
        knopf.checked = v === wert;
        knopf.addEventListener('change', () => beiWahl(v));
        stufe.append(knopf, knoten('span', '', text));
        gruppe.append(stufe);
    }
    return gruppe;
}

function waehle(liste, id, wert) {
    if (wert === '') {
        liste.delete(id);
    } else {
        liste.set(id, wert);
    }
    vorschau();
}

function zeichneRaeume() {
    const raeume = stand.raeume;
    if (raeume.length === 0) {
        $('raeume').replaceChildren(knoten('p', 'erklaerung', t.keineRaeume));
        return;
    }
    $('raeume').replaceChildren(
        ...raeume.map((raum, i) => {
            const zeile = knoten('div', 'wahlzeile');
            const text = knoten('span', 'wahlname', raum.name);
            const anzahl = stand.karten.filter(k => k.raum === raum.id).length;
            text.append(knoten('span', 'leise', t.anzahlKarten(anzahl)));
            const wahl = stufen(`raum${i}`, t.stufenRaum, entwurf.raeume.get(raum.id) ?? '', raum.name, w =>
                waehle(entwurf.raeume, raum.id, w),
            );
            zeile.append(text, wahl);
            return zeile;
        }),
    );
}

// Wie auf der Kartenseite nach Räumen; eine Karte, deren Raum es nicht mehr gibt, gilt als ohne Raum.
function zeichneKarten() {
    if (stand.karten.length === 0) {
        $('karten').replaceChildren(knoten('p', 'erklaerung', t.keineKarten));
        return;
    }
    const vergleiche = vergleicher(stand.sprache);
    const gruppen = new Map();
    for (const karte of stand.karten) {
        const raum = raumname(karte.raum) === undefined ? '' : karte.raum;
        gruppen.set(raum, [...(gruppen.get(raum) ?? []), karte]);
    }
    const raeume = [...gruppen.keys()].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : raumfolge(a) - raumfolge(b)));
    const inhalt = [];
    let i = 0;
    for (const raum of raeume) {
        inhalt.push(knoten('h3', 'gruppe', raum ? raumname(raum) : t.ohneRaum));
        for (const karte of gruppen.get(raum).sort((a, b) => vergleiche(a.name, b.name) || (a.id < b.id ? -1 : 1))) {
            const zeile = knoten('div', 'wahlzeile');
            const links = knoten('span', 'wahlname mit-symbol');
            const zeichen = knoten('span', 'symbol klein');
            zeichen.append(symbol(karte.typ));
            const text = knoten('span', '', karte.name);
            const zustand = knoten('span', 'leise zustand');
            zustand.dataset.karte = karte.id;
            text.append(zustand);
            links.append(zeichen, text);
            const wahl = stufen(`karte${i++}`, t.stufenKarte, entwurf.karten.get(karte.id) ?? '', karte.name, w =>
                waehle(entwurf.karten, karte.id, w),
            );
            zeile.append(links, wahl);
            inhalt.push(zeile);
        }
    }
    $('karten').replaceChildren(...inhalt);
}

// Warum eine Karte fehlt, soweit die Seite es weiß; ob sie sichtbar ist, sagt die Instanz.
function zustand(karte) {
    const recht = entwurf.sieht[karte.id];
    if (recht) {
        return [recht, t.zustand[recht]];
    }
    const wahl = entwurf.karten.get(karte.id) ?? '';
    if (wahl === 'gesperrt') {
        return ['aus', t.zustand.gesperrt];
    }
    const ueberRaum = wahl === '' && raumname(karte.raum) !== undefined && entwurf.raeume.has(karte.raum);
    if ((wahl !== '' || ueberRaum) && karte.fehlt) {
        return ['aus', t.zustand.fehlt];
    }
    return ['aus', ueberRaum && karte.persoenlich ? t.zustand.persoenlich : t.zustand.aus];
}

function zeigeSicht() {
    $('vorschau').textContent = t.vorschau(umfang(entwurf.sieht));
    for (const karte of stand.karten) {
        const feld = document.querySelector(`.zustand[data-karte="${karte.id}"]`);
        if (feld) {
            const [art, text] = zustand(karte);
            feld.textContent = text;
            feld.dataset.art = art;
        }
    }
}

function entwurfAlsProfil() {
    const karten = [...entwurf.karten];
    return {
        name: $('name').value.trim(),
        raeume: [...entwurf.raeume].map(([id, recht]) => ({ enum: id, recht })),
        karten: karten.filter(([, w]) => w !== 'gesperrt').map(([id, recht]) => ({ id, recht })),
        gesperrt: karten.filter(([, w]) => w === 'gesperrt').map(([id]) => id),
    };
}

// Nach jeder Wahl, gebündelt; eine ältere Antwort zählt nicht mehr.
function vorschau() {
    clearTimeout(vorschauZeit);
    vorschauZeit = setTimeout(async () => {
        const meine = ++vorschauNummer;
        try {
            const antwort = await frage('profilvorschau', { profil: entwurfAlsProfil() });
            if (meine !== vorschauNummer) {
                return;
            }
            if (antwort.fehler) {
                $('fehler').textContent = antwort.einzelheiten?.join(' ') ?? antwort.fehler;
                return;
            }
            entwurf.sieht = antwort.sieht;
            zeigeSicht();
        } catch (fehler) {
            $('fehler').textContent = fehler.message;
        }
    }, 150);
}

const hoeher = (a, b) => (a === 'schreiben' || b === 'schreiben' ? 'schreiben' : 'lesen');

function oeffne(profil) {
    entwurf = { id: profil?.id, apps: profil?.apps ?? [], raeume: new Map(), karten: new Map(), sieht: {} };
    for (const r of profil?.raeume ?? []) {
        entwurf.raeume.set(r.enum, hoeher(entwurf.raeume.get(r.enum), r.recht));
    }
    for (const k of profil?.karten ?? []) {
        entwurf.karten.set(k.id, hoeher(entwurf.karten.get(k.id), k.recht));
    }
    for (const id of profil?.gesperrt ?? []) {
        entwurf.karten.set(id, 'gesperrt');
    }
    entwurf.sieht = { ...profil?.sieht };
    $('name').value = profil?.name ?? '';
    $('name').maxLength = stand.laengen.name;
    $('name').removeAttribute('aria-invalid');
    zeichneRaeume();
    zeichneKarten();
    zeigeSicht();
    $('loeschen').hidden = !profil;
    oeffneDialog(profil ? t.bearbeiten : t.neu);
    $('name').focus();
}

async function speichere(ereignis) {
    ereignis.preventDefault();
    const profil = entwurfAlsProfil();
    if (!profil.name) {
        $('name').setAttribute('aria-invalid', 'true');
        $('name').focus();
        $('fehler').textContent = t.nameFehlt;
        return;
    }
    const nachricht = entwurf.id ? { id: entwurf.id, profil } : { profil };
    const antwort = await ausDialog($('speichern'), 'speichereProfil', nachricht, { lade });
    if (antwort) {
        uebernimm(antwort.stand);
        $('dialog').close();
    }
}

async function loesche() {
    const antwort = await ausDialog($('wirklichLoeschen'), 'loescheProfil', { id: entwurf.id }, { lade });
    if (antwort) {
        uebernimm(antwort.stand);
        $('dialog').close();
    }
}

nimmTexte(t);
beschrifte();
$('liste').append(knoten('p', 'leer', t.laedt));
$('name').addEventListener('input', () => $('name').removeAttribute('aria-invalid'));
// Eine Vorschau, die erst nach dem Schließen ankommt, gehört zu keinem Dialog mehr.
$('dialog').addEventListener('close', () => {
    clearTimeout(vorschauZeit);
    vorschauNummer++;
});
starte({
    name: 'myzel-app.profilseite',
    lade,
    neu: () => oeffne(undefined),
    speichere,
    loesche,
    loeschfrage: () => t.loeschfrage($('name').value.trim() || entwurf.id, entwurf.apps),
});
