import type { AdapterInstance } from '@iobroker/adapter-core';
import {
    type ActionContext,
    type ConfigItemAny,
    type DeviceInfo,
    type DeviceLoadContext,
    DeviceManagement,
    type DeviceRefreshResponse,
    type InstanceDetails,
    type InstanceRefreshResponse,
    type JsonFormData,
    type JsonFormSchema,
} from '@iobroker/dm-utils';
import type { Dienst } from '../app/dienst';
import type { Katalog } from '../app/katalog';
import type { AppDaten, Appablage, Geraeteablage, Handydaten, Profilablage } from '../app/objekte';
import {
    GERAETE_HOECHSTENS,
    type Geraet,
    type Objektquelle,
    type Profil,
    type Recht,
    TEILE,
    type Teil,
    alsGeraet,
    alsProfil,
    berechneRechte,
    passtZuTeil,
    text,
} from '../app/rechte';
import { GRENZEN, type Protokoll } from '../basis/grenzen';
import { type Kopplung, type Kopplungsanfrage, qrInhalt } from '../basis/kopplung';

type Text = ioBroker.Translated;

/** Was der Gerätemanager vom laufenden Adapter braucht; fehlt, solange der Server nicht läuft. */
export interface Betrieb {
    adapterId: string;
    fingerabdruck: string;
    adressen: () => string[];
    kopplung: Kopplung;
    dienst: Dienst;
    katalog: Katalog;
    ablage: Appablage & Profilablage & Geraeteablage;
    // Admin-Instanzen, die ohne Anmeldung laufen
    adminOhneAnmeldung: () => Promise<string[]>;
}

export interface VerwaltungOptionen {
    namespace: string;
    log: Protokoll;
    betrieb: () => Betrieb | undefined;
    warteMs?: number;
}

const T = {
    koppeln: { en: 'Pair app', de: 'App koppeln' },
    profile: { en: 'Profiles', de: 'Profile' },
    profilWaehlen: { en: 'Choose profile', de: 'Profil wählen' },
    handydaten: { en: 'Phone data', de: 'Handydaten' },
    entfernen: { en: 'Remove', de: 'Entfernen' },
    profil: { en: 'Profile', de: 'Profil' },
    keinProfil: { en: 'No profile (sees nothing)', de: 'Kein Profil (sieht nichts)' },
    neuesProfil: { en: 'New profile', de: 'Neues Profil' },
    weiter: { en: 'Next', de: 'Weiter' },
    bearbeiten: { en: 'Edit', de: 'Bearbeiten' },
    speichern: { en: 'Save', de: 'Speichern' },
    scannen: {
        en: `Scan the QR code with the app, then press Next. The code is valid for ${GRENZEN.einmalMs / 60_000} minutes and once only.`,
        de: `Den QR-Code mit der App scannen, dann auf Weiter drücken. Der Code gilt ${GRENZEN.einmalMs / 60_000} Minuten und nur einmal.`,
    },
    warte: { en: 'Waiting for the app', de: 'Warte auf die App' },
    name: { en: 'Name', de: 'Name' },
    raeume: { en: 'Rooms', de: 'Räume' },
    raeumeHilfe: {
        en: 'All data points of these rooms, also devices added later',
        de: 'Alle Datenpunkte dieser Räume, auch später hinzugefügte Geräte',
    },
    freigaben: { en: 'Single data points', de: 'Einzelne Datenpunkte' },
    freigabenHilfe: {
        en: 'In addition to the rooms, also with a lower right than the room',
        de: 'Zusätzlich zu den Räumen, auch mit geringerem Recht als im Raum',
    },
    sperren: { en: 'Blocked', de: 'Gesperrt' },
    sperrenHilfe: {
        en: 'Never visible, even if a room contains them. A device blocks everything below it.',
        de: 'Nie sichtbar, auch wenn ein Raum sie enthält. Ein Gerät sperrt alles darunter.',
    },
    loeschen: { en: 'Delete this profile', de: 'Dieses Profil löschen' },
    lesen: { en: 'read', de: 'lesen' },
    schreiben: { en: 'read and write', de: 'lesen und schreiben' },
    akku: { en: 'Battery', de: 'Akku' },
    anruf: { en: 'Calls', de: 'Anrufe' },
    benachrichtigung: { en: 'Notifications', de: 'Benachrichtigungen' },
    handydatenHinweis: {
        en: 'Each data type must also be switched on in the app. Switched off types are rejected and not written.',
        de: 'Jede Datenart muss auch in der App eingeschaltet sein. Was hier aus ist, lehnt der Adapter ab und schreibt nichts.',
    },
    persoenlich: {
        en: 'Calls and notifications contain personal data: phone numbers, contact names, message texts. Every adapter and script can read them. A history adapter on these data points stores them permanently.',
        de: 'Anrufe und Benachrichtigungen enthalten persönliche Daten: Rufnummern, Kontaktnamen, Nachrichtentexte. Jeder Adapter und jedes Skript kann sie lesen. Ein History-Adapter auf diesen Datenpunkten speichert sie dauerhaft.',
    },
    laeuftNicht: {
        en: 'The adapter is not running. The cause is in the log.',
        de: 'Der Adapter läuft nicht. Die Ursache steht im Log.',
    },
    fehler: {
        en: 'That did not work. The cause is in the log.',
        de: 'Das hat nicht geklappt. Die Ursache steht im Log.',
    },
    keineAdresse: {
        en: 'No address of the adapter is known. Please enter it in the settings.',
        de: 'Keine Adresse des Adapters bekannt. Bitte in den Einstellungen eintragen.',
    },
    abgelaufen: {
        en: 'No app has responded. The QR code is no longer valid.',
        de: 'Keine App hat sich gemeldet. Der QR-Code gilt nicht mehr.',
    },
    getrennt: {
        en: 'The app has disconnected. Please pair again.',
        de: 'Die App hat die Verbindung getrennt. Bitte neu koppeln.',
    },
    appWeg: { en: 'This app no longer exists.', de: 'Diese App gibt es nicht mehr.' },
    profilWeg: { en: 'This profile no longer exists.', de: 'Dieses Profil gibt es nicht mehr.' },
    nameFehlt: { en: 'Please enter a name.', de: 'Bitte einen Namen eingeben.' },
    geraete: { en: 'Devices', de: 'Geräte' },
    geraet: { en: 'Device', de: 'Gerät' },
    neuesGeraet: { en: 'New device', de: 'Neues Gerät' },
    typ: { en: 'Type', de: 'Typ' },
    lampe: { en: 'Lamp', de: 'Lampe' },
    geraeteHinweis: {
        en: 'The phone shows the device as one tile. A part only appears if it is linked and the profile of the app releases its data point.',
        de: 'Das Handy zeigt das Gerät als eine Kachel. Ein Teil erscheint nur, wenn er verknüpft ist und das Profil der App seinen Datenpunkt freigibt.',
    },
    geraetLoeschen: { en: 'Delete this device', de: 'Dieses Gerät löschen' },
    geraetWeg: { en: 'This device no longer exists.', de: 'Dieses Gerät gibt es nicht mehr.' },
    keinTeil: { en: 'Please link at least one data point.', de: 'Bitte mindestens einen Datenpunkt verknüpfen.' },
    zuViele: {
        en: `At most ${GERAETE_HOECHSTENS} devices are possible.`,
        de: `Mehr als ${GERAETE_HOECHSTENS} Geräte gehen nicht.`,
    },
} satisfies Record<string, Text>;

// Mit dem erwarteten Datenpunkt, damit die Auswahl im Formular gleich passt (KONZEPT-GERAETE.md, Abschnitt 2)
const TEILNAMEN: Record<Teil, Text> = {
    schalten: { en: 'On and off (true or false)', de: 'An und aus (true oder false)' },
    helligkeit: { en: 'Brightness (number)', de: 'Helligkeit (Zahl)' },
    farbe: { en: 'Colour RGB (text #RRGGBB)', de: 'Farbe RGB (Text #RRGGBB)' },
    farbtemperatur: {
        en: 'Colour temperature (number with min and max, K or mired)',
        de: 'Lichtfarbe (Zahl mit min und max, K oder Mired)',
    },
};

const nameLang = (n: number): Text => ({
    en: `The name has at most ${n} characters.`,
    de: `Der Name hat höchstens ${n} Zeichen.`,
});

const vorschau = (n: number, m: number): Text => ({
    en: `sees ${n} data point${n === 1 ? '' : 's'}, ${m} of them writable`,
    de: `sieht ${n} ${n === 1 ? 'Datenpunkt' : 'Datenpunkte'}, ${m} davon schreibbar`,
});
const mitName = (name: string, t: Text): Text => ({ en: `${name}: ${t.en}`, de: `${name}: ${t.de}` });

// Spaltentitel der Tabellen nimmt der Admin nur als Schlüssel für admin/i18n, nicht als Text je Sprache.
export const SPALTEN = {
    raum: 'Room',
    recht: 'Right',
    datenpunkt: 'Data point',
    sperre: 'Data point or device',
} as const;

const HANDY = `data:image/svg+xml;base64,${Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round">' +
        '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M10 18h4"/></svg>',
).toString('base64')}`;

// Konzept 5: Wer den Admin bedienen kann, kann koppeln. Ohne Anmeldung also jeder, der ihn im Netz erreicht.
export const adminOffen = (instanzen: string[]): { en: string; de: string } => ({
    en: `Caution: ${instanzen.join(', ')} runs without login. Anyone who can reach the admin can pair apps and change profiles.`,
    de: `Achtung: ${instanzen.join(', ')} läuft ohne Anmeldung. Wer den Admin erreicht, kann Apps koppeln und Profile ändern.`,
});

const KEINE: InstanceRefreshResponse = { refresh: false };
const GERAETE: DeviceRefreshResponse<string> = { refresh: 'devices' };

const RECHTE: { label: Text; value: Recht }[] = [
    { label: T.lesen, value: 'lesen' },
    { label: T.schreiben, value: 'schreiben' },
];

// Für Profile und Geräte: Kleinbuchstaben, Ziffern und _ bis 40 Zeichen (Abschnitt 3 des Detailentwurfs), Umlaute
// ausgeschrieben
export function neueKennung(name: string, vergeben: (id: string) => boolean, ersatz: string): string {
    const basis =
        name
            .toLowerCase()
            .replace(/ä/g, 'ae')
            .replace(/ö/g, 'oe')
            .replace(/ü/g, 'ue')
            .replace(/ß/g, 'ss')
            .normalize('NFKD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, '_')
            .slice(0, 36)
            .replace(/^_+|_+$/g, '') || ersatz;
    for (let n = 1; ; n++) {
        const id = n === 1 ? basis : `${basis}_${n}`;
        if (!vergeben(id)) {
            return id;
        }
    }
}

const zeilen = (wert: unknown): Record<string, unknown>[] =>
    Array.isArray(wert) ? wert.filter(z => z && typeof z === 'object') : [];
const eintrag = (wert: unknown): string => (typeof wert === 'string' ? wert.trim() : '');
const recht = (wert: unknown): Recht => (wert === 'schreiben' ? 'schreiben' : 'lesen');

// Leere Zeilen fallen weg; ohne gewähltes Recht gilt das geringere.
export function profilAus(daten: JsonFormData): Profil | Text {
    const name = eintrag(daten.name);
    if (!name) {
        return T.nameFehlt;
    }
    if (name.length > 60) {
        return nameLang(60);
    }
    const profil = alsProfil({
        name,
        raeume: zeilen(daten.raeume)
            .filter(z => eintrag(z.enum))
            .map(z => ({ enum: eintrag(z.enum), recht: recht(z.recht) })),
        freigaben: zeilen(daten.freigaben)
            .filter(z => eintrag(z.id))
            .map(z => ({ id: eintrag(z.id), recht: recht(z.recht) })),
        sperren: zeilen(daten.sperren)
            .map(z => eintrag(z.id))
            .filter(Boolean),
    });
    return Array.isArray(profil)
        ? { en: `Profile not valid: ${profil.join('; ')}`, de: `Profil ungültig: ${profil.join('; ')}` }
        : profil;
}

// Vollständig geprüft, anders als beim Lesen im Katalog: Hier stehen alle Datenpunkte fest.
export function geraetAus(daten: JsonFormData, quelle: Objektquelle, geraetId: string): Geraet | Text {
    const name = eintrag(daten.name);
    if (!name) {
        return T.nameFehlt;
    }
    if (name.length > 200) {
        return nameLang(200);
    }
    const teile: Geraet['teile'] = Object.fromEntries(
        TEILE.map(teil => [teil, eintrag(daten[teil])]).filter(([, id]) => id),
    );
    if (Object.keys(teile).length === 0) {
        return T.keinTeil;
    }
    const geraet = alsGeraet({ name, typ: eintrag(daten.typ) || 'lampe', teile });
    if (Array.isArray(geraet)) {
        return { en: `Device not valid: ${geraet.join('; ')}`, de: `Gerät ungültig: ${geraet.join('; ')}` };
    }
    const vergeben = new Map<string, string>();
    for (const [id, anderes] of quelle.geraete()) {
        if (id !== geraetId) {
            Object.values(anderes.teile).forEach(dp => vergeben.set(dp, anderes.name));
        }
    }
    const hier = new Set<string>();
    for (const teil of TEILE) {
        const dp = teile[teil];
        if (!dp) {
            continue;
        }
        const was = TEILNAMEN[teil];
        const m = quelle.zustaende(dp).get(dp);
        if (!m) {
            return {
                en: `${was.en}: data point ${dp} does not exist.`,
                de: `${was.de}: Datenpunkt ${dp} gibt es nicht.`,
            };
        }
        if (!passtZuTeil(teil, m.type, m.min, m.max)) {
            return { en: `${was.en}: ${dp} does not fit.`, de: `${was.de}: ${dp} passt nicht.` };
        }
        const anderes = vergeben.get(dp);
        if (anderes !== undefined || hier.has(dp)) {
            const wo = anderes ?? name;
            return {
                en: `${was.en}: ${dp} already belongs to "${wo}".`,
                de: `${was.de}: ${dp} gehört schon zu „${wo}“.`,
            };
        }
        hier.add(dp);
    }
    return geraet;
}

const alsFormulardaten = (p: Profil | undefined): JsonFormData => ({
    name: p?.name ?? '',
    raeume: p?.raeume.map(r => ({ ...r })) ?? [],
    freigaben: p?.freigaben.map(f => ({ ...f })) ?? [],
    sperren: p?.sperren.map(id => ({ id })) ?? [],
    loeschen: false,
});

const panel = (items: Record<string, ConfigItemAny>): JsonFormSchema => ({ type: 'panel', items });

/** Abläufe des Gerätemanagers, ohne ioBroker testbar (Abschnitt 10.2 des Detailentwurfs). */
export class Verwaltung {
    private readonly warteMs: number;

    public constructor(private readonly o: VerwaltungOptionen) {
        this.warteMs = o.warteMs ?? GRENZEN.kopplungWartenMs;
    }

    public async geraete(): Promise<DeviceInfo<string>[]> {
        const b = this.o.betrieb();
        if (!b) {
            return [];
        }
        const liste: DeviceInfo<string>[] = [];
        for (const appId of await b.ablage.alle()) {
            const daten = await b.ablage.lies(appId);
            if (daten) {
                liste.push(this.karte(appId, daten));
            }
        }
        return liste;
    }

    public koppeln(ctx: ActionContext): Promise<InstanceRefreshResponse> {
        return this.sicher(ctx, 'App koppeln', KEINE, async b => {
            const adressen = b.adressen();
            if (adressen.length === 0) {
                await ctx.showMessage(T.keineAdresse);
                return KEINE;
            }
            const offen = await b.adminOhneAnmeldung().catch(() => []);
            const { geheimnis, gueltigBis } = b.kopplung.starte();
            const qr = qrInhalt({ adapterId: b.adapterId, fingerabdruck: b.fingerabdruck, geheimnis, adressen });
            const antwort = await ctx.showForm(
                panel({
                    ...(offen.length > 0 ? { offen: { type: 'staticText', text: adminOffen(offen), xs: 12 } } : {}),
                    hinweis: { type: 'staticText', text: T.scannen, xs: 12 },
                    qr: { type: 'qrCode', data: qr, size: 280, level: 'M', xs: 12 },
                    profil: this.profilauswahl(b),
                }),
                {
                    title: T.koppeln,
                    data: { profil: '' },
                    buttons: ['cancel', { type: 'apply', label: T.weiter }],
                    ignoreApplyDisabled: true,
                },
            );
            if (!antwort || Date.now() > gueltigBis) {
                b.kopplung.brichAb();
                if (antwort) {
                    await ctx.showMessage(T.abgelaufen);
                }
                return KEINE;
            }
            const profilId = this.profilId(b, antwort.profil);
            const fortschritt = await ctx.openProgress(T.warte, { indeterminate: true });
            const anfrage = await b.kopplung.warte(this.warteMs).finally(() => fortschritt.close());
            if (!anfrage) {
                b.kopplung.brichAb();
                await ctx.showMessage(T.abgelaufen);
                return KEINE;
            }
            if (!(await ctx.showConfirmation(this.koppelnFrage(b, anfrage, profilId)))) {
                b.kopplung.ablehnen(anfrage);
                return KEINE;
            }
            if (!(await b.dienst.kopplungAnnehmen(anfrage, profilId))) {
                await ctx.showMessage(T.getrennt);
                return KEINE;
            }
            return { refresh: true };
        });
    }

    public profile(ctx: ActionContext): Promise<InstanceRefreshResponse> {
        return this.sicher(ctx, 'Profile', KEINE, async b => {
            const wahl = await ctx.showForm(
                panel({
                    profil: {
                        type: 'select',
                        label: T.profil,
                        options: [{ label: T.neuesProfil, value: '' }, ...this.profiloptionen(b)],
                        noTranslation: true,
                        xs: 12,
                    },
                }),
                {
                    title: T.profile,
                    data: { profil: '' },
                    buttons: ['cancel', { type: 'apply', label: T.bearbeiten }],
                    ignoreApplyDisabled: true,
                },
            );
            if (!wahl) {
                return KEINE;
            }
            const profilId = eintrag(wahl.profil);
            const bisher = profilId ? b.katalog.profil(profilId) : undefined;
            if (profilId && !bisher) {
                await ctx.showMessage(T.profilWeg);
                return KEINE;
            }
            let daten = alsFormulardaten(bisher);
            for (;;) {
                const antwort = await ctx.showForm(this.profilformular(b, !!bisher), {
                    title: bisher ? { en: `Profile "${bisher.name}"`, de: `Profil „${bisher.name}“` } : T.neuesProfil,
                    data: daten,
                    buttons: ['cancel', { type: 'apply', label: T.speichern }],
                });
                if (!antwort) {
                    return KEINE;
                }
                daten = antwort;
                if (bisher && antwort.loeschen === true) {
                    if (await this.loescheProfil(ctx, b, profilId, bisher)) {
                        return { refresh: true };
                    }
                    continue;
                }
                const profil = profilAus(antwort);
                if (!('raeume' in profil)) {
                    await ctx.showMessage(profil);
                    continue;
                }
                const { n, m } = this.zaehle(b, profil);
                const frage = mitName(profil.name, vorschau(n, m));
                if (!(await ctx.showConfirmation({ en: `${frage.en}. Save?`, de: `${frage.de}. Speichern?` }))) {
                    continue;
                }
                const id = profilId || neueKennung(profil.name, i => b.katalog.profil(i) !== undefined, 'profil');
                await b.ablage.legeProfil(id, profil);
                return { refresh: true };
            }
        });
    }

    public geraeteVerwalten(ctx: ActionContext): Promise<InstanceRefreshResponse> {
        return this.sicher(ctx, 'Geräte', KEINE, async b => {
            const optionen = [...b.katalog.geraete()]
                .sort(([, x], [, y]) => x.name.localeCompare(y.name))
                .map(([id, g]) => ({
                    label: { en: `${g.name} (${T[g.typ].en})`, de: `${g.name} (${T[g.typ].de})` },
                    value: id,
                }));
            const wahl = await ctx.showForm(
                panel({
                    geraet: {
                        type: 'select',
                        label: T.geraet,
                        options: [{ label: T.neuesGeraet, value: '' }, ...optionen],
                        noTranslation: true,
                        xs: 12,
                    },
                }),
                {
                    title: T.geraete,
                    data: { geraet: '' },
                    buttons: ['cancel', { type: 'apply', label: T.bearbeiten }],
                    ignoreApplyDisabled: true,
                },
            );
            if (!wahl) {
                return KEINE;
            }
            const geraetId = eintrag(wahl.geraet);
            const bisher = geraetId ? b.katalog.geraet(geraetId) : undefined;
            if (geraetId && !bisher) {
                await ctx.showMessage(T.geraetWeg);
                return KEINE;
            }
            if (!bisher && b.katalog.geraete().length >= GERAETE_HOECHSTENS) {
                await ctx.showMessage(T.zuViele);
                return KEINE;
            }
            let daten: JsonFormData = {
                name: bisher?.name ?? '',
                typ: bisher?.typ ?? 'lampe',
                ...bisher?.teile,
                loeschen: false,
            };
            for (;;) {
                const antwort = await ctx.showForm(this.geraeteformular(!!bisher), {
                    title: bisher ? { en: `Device "${bisher.name}"`, de: `Gerät „${bisher.name}“` } : T.neuesGeraet,
                    data: daten,
                    buttons: ['cancel', { type: 'apply', label: T.speichern }],
                });
                if (!antwort) {
                    return KEINE;
                }
                daten = antwort;
                if (bisher && antwort.loeschen === true) {
                    const frage = {
                        en: `Delete device "${bisher.name}"? Its data points remain and appear on the phones as single tiles again.`,
                        de: `Gerät „${bisher.name}“ löschen? Seine Datenpunkte bleiben und erscheinen auf den Handys wieder als einzelne Kacheln.`,
                    };
                    if (await ctx.showConfirmation(frage)) {
                        await b.ablage.loescheGeraet(geraetId);
                        return { refresh: true };
                    }
                    continue;
                }
                const geraet = geraetAus(antwort, b.katalog, geraetId);
                if (!('teile' in geraet)) {
                    await ctx.showMessage(geraet);
                    continue;
                }
                const id = geraetId || neueKennung(geraet.name, i => b.katalog.geraet(i) !== undefined, 'geraet');
                await b.ablage.legeGeraet(id, geraet);
                return { refresh: true };
            }
        });
    }

    public profilWaehlen(appId: string, ctx: ActionContext): Promise<DeviceRefreshResponse<string>> {
        return this.sicherFuerApp(appId, ctx, 'Profil wählen', async (b, daten) => {
            const antwort = await ctx.showForm(panel({ profil: this.profilauswahl(b) }), {
                title: mitName(daten.name, T.profilWaehlen),
                data: { profil: daten.profil },
                buttons: ['cancel', 'apply'],
            });
            if (antwort) {
                const profil = this.profilId(b, antwort.profil);
                if (profil !== daten.profil) {
                    await b.ablage.aendere(appId, { profil });
                }
            }
            return GERAETE;
        });
    }

    public handydaten(appId: string, ctx: ActionContext): Promise<DeviceRefreshResponse<string>> {
        return this.sicherFuerApp(appId, ctx, 'Handydaten', async (b, daten) => {
            const antwort = await ctx.showForm(
                panel({
                    hinweis: { type: 'staticText', text: T.handydatenHinweis, xs: 12 },
                    akku: { type: 'checkbox', label: T.akku, xs: 12, newLine: true },
                    anruf: { type: 'checkbox', label: T.anruf, xs: 12, newLine: true },
                    benachrichtigung: { type: 'checkbox', label: T.benachrichtigung, xs: 12, newLine: true },
                    persoenlich: { type: 'staticText', text: T.persoenlich, xs: 12, newLine: true },
                }),
                {
                    title: mitName(daten.name, T.handydaten),
                    data: { ...daten.handydaten },
                    buttons: ['cancel', 'apply'],
                },
            );
            if (antwort) {
                const handydaten: Handydaten = {
                    akku: antwort.akku === true,
                    anruf: antwort.anruf === true,
                    benachrichtigung: antwort.benachrichtigung === true,
                };
                if (JSON.stringify(handydaten) !== JSON.stringify(daten.handydaten)) {
                    await b.ablage.aendere(appId, { handydaten });
                }
            }
            return GERAETE;
        });
    }

    public entferne(appId: string, ctx: ActionContext): Promise<DeviceRefreshResponse<string>> {
        return this.sicherFuerApp(appId, ctx, 'Entfernen', async (b, daten) => {
            const frage = {
                en: `Remove app "${daten.name}"? Its access is deleted and an existing connection is closed. The data points of the app remain.`,
                de: `App „${daten.name}“ entfernen? Ihr Zugang wird gelöscht und eine bestehende Verbindung getrennt. Die Datenpunkte der App bleiben stehen.`,
            };
            if (await ctx.showConfirmation(frage)) {
                await b.dienst.entferne(appId);
            }
            return GERAETE;
        });
    }

    // Ohne customInfo: Der Admin übernimmt dessen Inhalt nur beim ersten Anzeigen der Karte.
    private karte(appId: string, daten: AppDaten): DeviceInfo<string> {
        const praefix = `${this.o.namespace}.apps.${appId}`;
        return {
            id: appId,
            identifier: appId,
            name: daten.name,
            icon: HANDY,
            model: `Android ${daten.geraet.android}, App ${daten.geraet.appVersion}`,
            status: {
                connection: { stateId: `${praefix}.online`, mapping: { true: 'connected', false: 'disconnected' } },
                ...(daten.handydaten.akku ? { battery: { stateId: `${praefix}.akku.stand` } } : {}),
            },
            actions: [
                {
                    id: 'profil',
                    icon: 'users',
                    description: T.profilWaehlen,
                    handler: (id, ctx) => this.profilWaehlen(id, ctx),
                },
                {
                    id: 'handydaten',
                    icon: 'settings',
                    description: T.handydaten,
                    handler: (id, ctx) => this.handydaten(id, ctx),
                },
                {
                    id: 'entfernen',
                    icon: 'delete',
                    description: T.entfernen,
                    handler: (id, ctx) => this.entferne(id, ctx),
                },
            ],
        };
    }

    private zaehle(b: Betrieb, profil: Profil): { n: number; m: number } {
        const datenpunkte = berechneRechte(profil, b.katalog).inhalt.datenpunkte;
        return { n: datenpunkte.length, m: datenpunkte.filter(d => d.recht === 'schreiben').length };
    }

    private profiloptionen(b: Betrieb): { label: Text; value: string }[] {
        return b.katalog.alleProfile().map(([id, p]) => {
            const { n, m } = this.zaehle(b, p);
            return { label: mitName(p.name, vorschau(n, m)), value: id };
        });
    }

    private profilauswahl(b: Betrieb): ConfigItemAny {
        return {
            type: 'select',
            label: T.profil,
            options: [{ label: T.keinProfil, value: '' }, ...this.profiloptionen(b)],
            noTranslation: true,
            xs: 12,
        };
    }

    // Nur ein Profil, das es gibt; sonst keins
    private profilId(b: Betrieb, wert: unknown): string {
        const id = eintrag(wert);
        return b.katalog.profil(id) ? id : '';
    }

    // Mit Adresse und Gerät: Hat jemand anderes den QR-Code abfotografiert, fällt es hier auf, nicht erst danach.
    private koppelnFrage(b: Betrieb, anfrage: Kopplungsanfrage, profilId: string): Text {
        const { name, geraet } = anfrage;
        const profil = b.katalog.profil(profilId)?.name;
        const von = `${anfrage.verbindung.herkunft.adresse}, Android ${geraet.android}`;
        const frage: Text = profil
            ? {
                  en: `Pair app "${name}" with profile "${profil}"?`,
                  de: `App „${name}“ mit Profil „${profil}“ koppeln?`,
              }
            : {
                  en: `Pair app "${name}" without a profile? It sees nothing until a profile is chosen.`,
                  de: `App „${name}“ ohne Profil koppeln? Sie sieht nichts, bis ein Profil gewählt ist.`,
              };
        return {
            en: `${frage.en} Request from ${von}, app ${geraet.appVersion}.`,
            de: `${frage.de} Anfrage von ${von}, App ${geraet.appVersion}.`,
        };
    }

    private profilformular(b: Betrieb, vorhanden: boolean): JsonFormSchema {
        const raeume = b.katalog
            .aufzaehlungen('rooms')
            .map(r => ({ label: text(r.name, b.katalog.sprache, r.id), value: r.id }));
        const rechtspalte: ConfigItemAny & { attr: string } = {
            type: 'select',
            attr: 'recht',
            options: RECHTE,
            default: 'lesen',
            width: '30%',
        };
        return panel({
            name: { type: 'text', label: T.name, maxLength: 60, xs: 12 },
            raeume: {
                type: 'table',
                label: T.raeume,
                help: T.raeumeHilfe,
                items: [
                    {
                        type: 'select',
                        attr: 'enum',
                        title: SPALTEN.raum,
                        options: raeume,
                        noTranslation: true,
                        width: '70%',
                    },
                    { ...rechtspalte, title: SPALTEN.recht },
                ],
                xs: 12,
                newLine: true,
            },
            freigaben: {
                type: 'table',
                label: T.freigaben,
                help: T.freigabenHilfe,
                items: [
                    { type: 'objectId', attr: 'id', title: SPALTEN.datenpunkt, width: '70%' },
                    { ...rechtspalte, title: SPALTEN.recht },
                ],
                xs: 12,
                newLine: true,
            },
            sperren: {
                type: 'table',
                label: T.sperren,
                help: T.sperrenHilfe,
                items: [
                    {
                        type: 'objectId',
                        attr: 'id',
                        title: SPALTEN.sperre,
                        types: ['state', 'channel', 'device'],
                    },
                ],
                xs: 12,
                newLine: true,
            },
            ...(vorhanden ? { loeschen: { type: 'checkbox', label: T.loeschen, xs: 12, newLine: true } } : {}),
        });
    }

    private geraeteformular(vorhanden: boolean): JsonFormSchema {
        const teile: Record<string, ConfigItemAny> = Object.fromEntries(
            TEILE.map(teil => [teil, { type: 'objectId', label: TEILNAMEN[teil], xs: 12, newLine: true }]),
        );
        return panel({
            name: { type: 'text', label: T.name, maxLength: 200, xs: 12 },
            typ: {
                type: 'select',
                label: T.typ,
                options: [{ label: T.lampe, value: 'lampe' }],
                xs: 12,
                newLine: true,
            },
            hinweis: { type: 'staticText', text: T.geraeteHinweis, xs: 12, newLine: true },
            ...teile,
            ...(vorhanden ? { loeschen: { type: 'checkbox', label: T.geraetLoeschen, xs: 12, newLine: true } } : {}),
        });
    }

    private async loescheProfil(ctx: ActionContext, b: Betrieb, profilId: string, profil: Profil): Promise<boolean> {
        const nutzer: string[] = [];
        for (const appId of await b.ablage.alle()) {
            if ((await b.ablage.lies(appId))?.profil === profilId) {
                nutzer.push(appId);
            }
        }
        const frage = {
            en: `Delete profile "${profil.name}"? ${
                nutzer.length === 0
                    ? 'No app uses it.'
                    : `Apps using it: ${nutzer.length}. They see nothing afterwards.`
            }`,
            de: `Profil „${profil.name}“ löschen? ${
                nutzer.length === 0
                    ? 'Keine App nutzt es.'
                    : `Apps mit diesem Profil: ${nutzer.length}. Sie sehen danach nichts.`
            }`,
        };
        if (!(await ctx.showConfirmation(frage))) {
            return false;
        }
        // Erst die Apps, dann das Profil: Ein neues Profil gleicher ID gäbe ihnen sonst unbemerkt wieder Rechte.
        for (const appId of nutzer) {
            await b.ablage.aendere(appId, { profil: '' });
        }
        await b.ablage.loescheProfil(profilId);
        return true;
    }

    private sicherFuerApp(
        appId: string,
        ctx: ActionContext,
        was: string,
        schritt: (b: Betrieb, daten: AppDaten) => Promise<DeviceRefreshResponse<string>>,
    ): Promise<DeviceRefreshResponse<string>> {
        return this.sicher(ctx, was, GERAETE, async b => {
            const daten = await b.ablage.lies(appId);
            if (!daten) {
                await ctx.showMessage(T.appWeg);
                return GERAETE;
            }
            return schritt(b, daten);
        });
    }

    // Ein Fehler darf den Dialog im Admin nicht offen hängen lassen: dm-utils schickt dann kein Ergebnis.
    private async sicher<E>(
        ctx: ActionContext,
        was: string,
        sonst: E,
        schritt: (b: Betrieb) => Promise<E>,
    ): Promise<E> {
        const b = this.o.betrieb();
        try {
            if (!b) {
                await ctx.showMessage(T.laeuftNicht);
                return sonst;
            }
            return await schritt(b);
        } catch (fehler) {
            this.o.log.error(`Gerätemanager, ${was}: ${(fehler as Error).message}`);
            try {
                await ctx.showMessage(T.fehler);
            } catch {
                // kein Dialog mehr möglich, das Ergebnis schließt ihn
            }
            return sonst;
        }
    }
}

/** Anbindung an dm-utils */
export class Geraete extends DeviceManagement<AdapterInstance> {
    private gebunden?: ioBroker.Logger;

    public constructor(
        adapter: AdapterInstance,
        private readonly verwaltung: Verwaltung,
    ) {
        super(adapter);
    }

    protected override getInstanceInfo(): InstanceDetails {
        return {
            apiVersion: 'v3',
            actions: [
                { id: 'koppeln', icon: 'qrcode', title: T.koppeln, handler: ctx => this.verwaltung.koppeln(ctx) },
                { id: 'profile', icon: 'users', title: T.profile, handler: ctx => this.verwaltung.profile(ctx) },
                {
                    id: 'geraete',
                    icon: 'lamp',
                    title: T.geraete,
                    handler: ctx => this.verwaltung.geraeteVerwalten(ctx),
                },
            ],
        };
    }

    // dm-utils hängt this.log.error ungebunden an .catch: Ohne gebundene Funktionen wird jeder Fehler dort, etwa bei
    // dm:deviceInfo von einem Skript, zur unbehandelten Ablehnung, und js-controller beendet den Adapter.
    protected override get log(): ioBroker.Logger {
        if (!this.gebunden) {
            const log = this.adapter.log;
            const gebunden = Object.create(log) as ioBroker.Logger;
            for (const stufe of ['silly', 'debug', 'info', 'warn', 'error'] as const) {
                gebunden[stufe] = log[stufe].bind(log);
            }
            this.gebunden = gebunden;
        }
        return this.gebunden;
    }

    protected override async loadDevices(context: DeviceLoadContext<string>): Promise<void> {
        const geraete = await this.verwaltung.geraete();
        context.setTotalDevices(geraete.length);
        geraete.forEach(g => context.addDevice(g));
    }
}
