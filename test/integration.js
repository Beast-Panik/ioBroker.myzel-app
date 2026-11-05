const crypto = require('node:crypto');
const net = require('node:net');
const path = require('node:path');
const { tests } = require('@iobroker/testing');
const { expect } = require('chai');
const WebSocket = require('ws');

const freierPort = () =>
    new Promise(resolve => {
        const s = net.createServer().listen(0, '127.0.0.1', () => {
            const { port } = s.address();
            s.close(() => resolve(port));
        });
    });

const fingerabdruck = pem =>
    crypto.createHash('sha256').update(new crypto.X509Certificate(pem).raw).digest('base64url');

// Verbindet sich wie die App: Zertifikat über den Fingerabdruck geprüft, bevor etwas gesendet wird.
function anmelden(port, fp, hallo) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(`wss://127.0.0.1:${port}/v1`, { rejectUnauthorized: false });
        const geschlossen = new Promise(r => ws.on('close', code => r(code)));
        const eingang = [];
        const naechste = async (ms = 3000) => {
            const ende = Date.now() + ms;
            while (eingang.length === 0) {
                if (Date.now() > ende) {
                    throw new Error('keine Nachricht vom Adapter');
                }
                await new Promise(r => setTimeout(r, 20));
            }
            return eingang.shift();
        };
        ws.on('upgrade', antwort => {
            const zertifikat = antwort.socket.getPeerX509Certificate();
            if (crypto.createHash('sha256').update(zertifikat.raw).digest('base64url') !== fp) {
                ws.terminate();
                reject(new Error('Fingerabdruck passt nicht'));
            }
        });
        ws.on('message', daten => eingang.push(JSON.parse(daten.toString())));
        ws.on('open', () => {
            ws.send(JSON.stringify(hallo));
            naechste().then(erste => resolve({ ws, erste, naechste, geschlossen }), reject);
        });
        ws.on('error', reject);
    });
}

async function bis(bedingung, ms = 3000) {
    const ende = Date.now() + ms;
    while (!(await bedingung())) {
        if (Date.now() > ende) {
            throw new Error('Bedingung nicht erfüllt');
        }
        await new Promise(r => setTimeout(r, 50));
    }
}

// Ohne Angabe nimmt @iobroker/testing die Entwicklerversion (dev). Getestet wird gegen die stabile Version,
// die auch im Betrieb läuft; IOB_CONTROLLER=dev prüft vorab gegen die nächste.
tests.integration(path.join(__dirname, '..'), {
    controllerVersion: process.env.IOB_CONTROLLER || 'latest',
    defineAdditionalTests({ suite }) {
        suite('Server für Apps', getHarness => {
            let harness;
            let port;
            let identitaet;

            const raum = 'enum.rooms.testraum';
            const lampe = 'javascript.0.test.lampe';
            const temperatur = 'javascript.0.test.temperatur';
            const geheim = 'javascript.0.test.geheim';
            const altlampe = 'javascript.0.alt.an';

            before(async function () {
                this.timeout(60_000);
                harness = getHarness();
                port = await freierPort();
                for (const [id, common, val] of [
                    [lampe, { type: 'boolean', role: 'switch', write: true }, false],
                    [temperatur, { type: 'number', role: 'value.temperature', unit: '°C', write: false }, 21],
                    [geheim, { type: 'boolean', role: 'switch', write: true }, false],
                    [altlampe, { type: 'boolean', role: 'switch', write: true }, true],
                ]) {
                    await harness.objects.setObjectAsync(id, {
                        type: 'state',
                        common: { name: id, read: true, ...common },
                        native: {},
                    });
                    await harness.states.setStateAsync(id, { val, ack: true });
                }
                await harness.objects.setObjectAsync(raum, {
                    type: 'enum',
                    common: { name: { de: 'Testraum', en: 'Test room' }, members: [] },
                    native: {},
                });
                // Feste Adresse für den QR-Code: Ohne private Schnittstelle (etwa in CI) fände der Adapter keine.
                // Karten und Profile so, wie der Admin sie speichert: flache Zeilen
                // Direkt am Instanzobjekt: changeAdapterConfig des Testrahmens führt Listen zu Objekten zusammen.
                const instanz = await harness.objects.getObjectAsync('system.adapter.myzel-app.0');
                await harness.objects.setObjectAsync('system.adapter.myzel-app.0', {
                    ...instanz,
                    native: {
                        ...instanz.native,
                        port,
                        adressen: [`127.0.0.1:${port}`],
                        karten: [
                            { id: 'lampe', name: 'Lampe', typ: 'schalter', raum, schalten: lampe },
                            {
                                id: 'klima',
                                name: 'Klima',
                                typ: 'messwert',
                                raum,
                                wert1: temperatur,
                                bezeichnung1: 'Innen',
                            },
                            { id: 'geheim', name: 'Geheim', typ: 'schalter', raum: '', schalten: geheim },
                        ],
                        profile: [
                            {
                                id: 'familie',
                                name: 'Familie',
                                raeumeSchreiben: [raum],
                                raeumeLesen: [],
                                kartenSchreiben: [],
                                kartenLesen: ['altlampe'],
                                gesperrt: [],
                            },
                        ],
                    },
                });
                // Stände früherer Versionen als Objekte, die der Start in die Einstellungen übernimmt
                for (const [id, native] of [
                    ['geraete.altlampe', { name: 'Altlampe', typ: 'lampe', teile: { schalten: altlampe } }],
                    [
                        'karten.altschalter',
                        { name: 'Altschalter', typ: 'schalter', raum: '', teile: { schalten: 'javascript.0.alt.aus' } },
                    ],
                    [
                        'profile.alt',
                        { name: 'Alt', raeume: [], freigaben: [{ id: 'a.b', recht: 'lesen' }], sperren: [] },
                    ],
                ]) {
                    await harness.objects.setObjectAsync(`myzel-app.0.${id}`, { type: 'config', common: {}, native });
                }
                await harness.startAdapterAndWait(true);
                identitaet = (await harness.objects.getObjectAsync('myzel-app.0.identitaet')).native;
            });

            it('übernimmt Geräte, Karten und Profile früherer Stände in die Einstellungen und löscht die Objekte', async () => {
                for (const id of ['geraete.altlampe', 'karten.altschalter', 'profile.alt']) {
                    expect(await harness.objects.getObjectAsync(`myzel-app.0.${id}`), id).to.equal(null);
                }
                const { karten, profile } = (await harness.objects.getObjectAsync('system.adapter.myzel-app.0')).native;
                // Danach nach Räumen geordnet: Testraum, dann ohne Raum, je nach Namen
                expect(karten.map(k => k.id)).to.deep.equal(['klima', 'lampe', 'altlampe', 'altschalter', 'geheim']);
                expect(karten[2]).to.deep.equal({
                    id: 'altlampe',
                    name: 'Altlampe',
                    typ: 'lampe',
                    raum: '',
                    schalten: altlampe,
                });
                expect(profile.map(p => p.id)).to.deep.equal(['familie', 'alt']);
                expect(profile[1]).to.deep.equal({
                    id: 'alt',
                    name: 'Alt',
                    raeumeSchreiben: [],
                    raeumeLesen: [],
                    kartenSchreiben: [],
                    kartenLesen: [],
                    gesperrt: [],
                });
            });

            it('erzeugt beim ersten Start Adapter-ID und Zertifikat, den Schlüssel verschlüsselt', async () => {
                expect(identitaet.adapterId).to.match(/^[a-z2-7]{26}$/);
                expect(identitaet.zertifikat).to.contain('BEGIN CERTIFICATE');
                expect(identitaet.schluessel).to.match(/^\$\/aes-192-cbc:/);
                const instanz = await harness.objects.getObjectAsync('system.adapter.myzel-app.0');
                expect(JSON.stringify(instanz.native)).to.not.contain('BEGIN');
            });

            const geraet = { android: '15', appVersion: '1.0.0' };

            async function legeApp(appId, profil, handydaten = { akku: false, anruf: false, benachrichtigung: false }) {
                const zugang = crypto.randomBytes(32).toString('base64url');
                await harness.objects.setObjectAsync(`myzel-app.0.apps.${appId}`, {
                    type: 'device',
                    common: { name: appId },
                    native: {
                        name: appId,
                        zugangHash: crypto.createHash('sha256').update(zugang).digest('hex'),
                        profil,
                        handydaten,
                        gekoppeltAm: Date.now(),
                        geraet,
                    },
                });
                for (const [name, type] of [
                    ['online', 'boolean'],
                    ['weg', 'string'],
                    ['zuletzt', 'number'],
                ]) {
                    await harness.objects.setObjectAsync(`myzel-app.0.apps.${appId}.${name}`, {
                        type: 'state',
                        common: { name, type, role: 'state', read: true, write: false },
                        native: {},
                    });
                }
                return zugang;
            }

            it('meldet eine gekoppelte App an und setzt sie online', async () => {
                const zugang = await legeApp('abcdefgh', '');
                const fp = fingerabdruck(identitaet.zertifikat);
                const online = async () =>
                    (await harness.states.getStateAsync('myzel-app.0.apps.abcdefgh.online'))?.val;

                const ok = await anmelden(port, fp, { t: 'hallo', v: 3, app: 'abcdefgh', zugang, geraet });
                expect(ok.erste).to.include({ t: 'willkommen', adapter: identitaet.adapterId });
                await bis(async () => (await online()) === true);
                ok.ws.close();
                await bis(async () => (await online()) === false);

                const falsch = await anmelden(port, fp, {
                    t: 'hallo',
                    v: 3,
                    app: 'abcdefgh',
                    zugang: 'A'.repeat(43),
                    geraet,
                });
                expect(falsch.erste).to.deep.equal({ t: 'fehler', code: 'zugang' });
                expect(await falsch.geschlossen).to.equal(4001);
            });
            it('liest und schreibt Datenpunkte der Karten nach Profil, Raum und einzelner Freigabe', async () => {
                const zugang = await legeApp('bcdefghi', 'familie');
                const app = await anmelden(port, fingerabdruck(identitaet.zertifikat), {
                    t: 'hallo',
                    v: 3,
                    app: 'bcdefghi',
                    zugang,
                    geraet,
                });

                expect(app.erste.profil).to.equal('Familie');
                // altlampe kam erst beim Start aus einem Gerät von 0.1.x und ist ohne Neustart da
                expect(
                    app.erste.karten.map(k => [k.id, k.raum, Object.values(k.teile).map(t => [t.recht, t.name])]),
                ).to.deep.equal([
                    ['altlampe', undefined, [['lesen', undefined]]],
                    ['klima', raum, [['lesen', 'Innen']]],
                    ['lampe', raum, [['schreiben', undefined]]],
                ]);
                const sprache = (await harness.objects.getObjectAsync('system.config')).common.language;
                expect(app.erste.raeume).to.deep.equal([
                    { id: raum, name: sprache === 'de' ? 'Testraum' : 'Test room' },
                ]);

                app.ws.send(JSON.stringify({ t: 'abo', ids: [lampe, temperatur, geheim] }));
                expect(await app.naechste()).to.include({ t: 'fehler', code: 'rechte' });
                const werte = await app.naechste();
                expect(Object.keys(werte.werte)).to.have.members([lampe, temperatur]);
                expect(werte.werte[temperatur]).to.include({ val: 21, ack: true });

                await harness.states.setStateAsync(temperatur, { val: 22.5, ack: true });
                expect((await app.naechste()).werte[temperatur]).to.include({ val: 22.5, ack: true });

                app.ws.send(JSON.stringify({ t: 'setze', n: 1, id: lampe, val: true }));
                expect(await app.naechste()).to.deep.equal({ t: 'quittung', n: 1, ok: true });
                expect(await harness.states.getStateAsync(lampe)).to.include({
                    val: true,
                    ack: false,
                    c: 'App bcdefghi',
                });
                expect((await app.naechste()).werte[lampe]).to.include({ val: true, ack: false });

                app.ws.send(JSON.stringify({ t: 'setze', n: 2, id: temperatur, val: 30 }));
                expect(await app.naechste()).to.deep.equal({ t: 'quittung', n: 2, ok: false, fehler: 'rechte' });
                app.ws.close();
            });

            // Karten und Profile ändert nur das Speichern der Einstellungen, und das startet die Instanz neu. Ohne Neustart
            // wirken Datenpunkte, Räume und die Apps selbst.
            it('schickt rechte bei Änderungen an Datenpunkt und Raum und trennt eine entfernte App', async function () {
                this.timeout(30_000);
                const zugang = await legeApp('cdefghij', 'familie');
                const app = await anmelden(port, fingerabdruck(identitaet.zertifikat), {
                    t: 'hallo',
                    v: 3,
                    app: 'cdefghij',
                    zugang,
                    geraet,
                });
                const recht = karten => karten.find(k => k.id === 'lampe').teile.schalten.recht;
                expect(recht(app.erste.karten)).to.equal('schreiben');

                const objekt = await harness.objects.getObjectAsync(lampe);
                await harness.objects.setObjectAsync(lampe, { ...objekt, common: { ...objekt.common, write: false } });
                const rechte = await app.naechste(5000);
                expect(rechte.t).to.equal('rechte');
                expect(recht(rechte.karten)).to.equal('lesen');

                const zimmer = await harness.objects.getObjectAsync(raum);
                await harness.objects.setObjectAsync(raum, {
                    ...zimmer,
                    common: { ...zimmer.common, name: { de: 'Wohnraum', en: 'Living room' } },
                });
                const sprache = (await harness.objects.getObjectAsync('system.config')).common.language;
                expect((await app.naechste(5000)).raeume).to.deep.equal([
                    { id: raum, name: sprache === 'de' ? 'Wohnraum' : 'Living room' },
                ]);

                await harness.objects.delObjectAsync('myzel-app.0.apps.cdefghij');
                expect(await app.geschlossen).to.equal(4008);
            });

            it('schreibt eingeschaltete Handydaten mit ack=true und Zeit vom Handy, legt nur dafür Datenpunkte an', async () => {
                const zugang = await legeApp('defghijk', '', { akku: true, anruf: false, benachrichtigung: true });
                const app = await anmelden(port, fingerabdruck(identitaet.zertifikat), {
                    t: 'hallo',
                    v: 3,
                    app: 'defghijk',
                    zugang,
                    geraet,
                });
                expect(app.erste.handydaten).to.deep.equal({ akku: true, anruf: false, benachrichtigung: true });
                const zustand = name => harness.states.getStateAsync(`myzel-app.0.apps.defghijk.${name}`);
                await bis(async () => (await zustand('anwesend'))?.val === true);

                const zeit = Date.now() - 5000;
                app.ws.send(JSON.stringify({ t: 'akku', stand: 42, laedt: true, zeit }));
                app.ws.send(JSON.stringify({ t: 'anruf', status: 'klingelt', nummer: '+4930123', zeit }));
                expect(await app.naechste()).to.include({ t: 'fehler', code: 'aus' });
                app.ws.send(
                    JSON.stringify({
                        t: 'benachrichtigung',
                        app: 'Signal',
                        paket: 'org.signal',
                        titel: 'Anna',
                        text: 'Hallo',
                        zeit,
                    }),
                );
                await bis(async () => (await zustand('benachrichtigung.json')) !== null);
                expect(await zustand('akku.stand')).to.include({ val: 42, ack: true, ts: zeit });
                expect(await zustand('akku.laedt')).to.include({ val: true, ack: true });
                expect(JSON.parse((await zustand('benachrichtigung.json')).val)).to.include({
                    titel: 'Anna',
                    text: 'Hallo',
                });
                expect((await harness.objects.getObjectAsync('myzel-app.0.apps.defghijk.akku')).type).to.equal(
                    'channel',
                );
                expect(
                    (await harness.objects.getObjectAsync('myzel-app.0.apps.defghijk.akku.stand')).common,
                ).to.include({
                    role: 'value.battery',
                    unit: '%',
                    write: false,
                });
                expect(await harness.objects.getObjectAsync('myzel-app.0.apps.defghijk.anruf.status')).to.equal(null);
                app.ws.close();
            });

            it('schickt einen Hinweis aus hinweis.senden und bestätigt ihn nach angezeigt', async () => {
                const zugang = await legeApp('efghijkl', '');
                const senden = 'myzel-app.0.apps.efghijkl.hinweis.senden';
                await harness.objects.setObjectAsync(senden, {
                    type: 'state',
                    common: { name: 'senden', type: 'string', role: 'text', read: true, write: true },
                    native: {},
                });
                const app = await anmelden(port, fingerabdruck(identitaet.zertifikat), {
                    t: 'hallo',
                    v: 3,
                    app: 'efghijkl',
                    zugang,
                    geraet,
                });
                expect(app.erste.t).to.equal('willkommen');
                const status = async () =>
                    (await harness.states.getStateAsync('myzel-app.0.apps.efghijkl.hinweis.status'))?.val;

                await harness.states.setStateAsync(senden, {
                    val: JSON.stringify({ titel: 'Garage', text: 'Tor offen', wichtigkeit: 'hoch' }),
                    ack: false,
                });
                const hinweis = await app.naechste();
                expect(hinweis).to.include({ t: 'hinweis', titel: 'Garage', text: 'Tor offen', wichtigkeit: 'hoch' });
                await bis(async () => (await status()) === 'gesendet');
                const kanal = await harness.objects.getObjectAsync('myzel-app.0.apps.efghijkl.hinweis');
                expect(kanal.type).to.equal('channel');
                expect(kanal.native.warteschlange.map(h => h.id)).to.deep.equal([hinweis.id]);

                app.ws.send(JSON.stringify({ t: 'angezeigt', id: hinweis.id }));
                await bis(async () => (await status()) === 'angezeigt');
                expect((await harness.states.getStateAsync(senden)).ack).to.equal(true);
                expect(
                    (await harness.objects.getObjectAsync('myzel-app.0.apps.efghijkl.hinweis')).native.warteschlange,
                ).to.deep.equal([]);
                app.ws.close();
            });

            // Über das Nachrichtenfach wie der Admin: jede Antwort der GUI eine eigene Nachricht mit origin.
            // Nacheinander: sendTo des Testrahmens ordnet Antworten nicht der Anfrage zu.
            const frage = (command, message) =>
                new Promise(resolve => harness.sendTo('myzel-app.0', command, message, resolve));

            it('liefert die Auswahllisten der Reiter Profile: Räume aus ioBroker, Karten aus dem Formular', async () => {
                await harness.enableSendTo();
                expect(await frage('raeume', {})).to.deep.include({
                    value: raum,
                    label: { en: 'Living room', de: 'Wohnraum' },
                });
                expect(
                    await frage('karten', {
                        karten: [
                            { id: 'neu', name: 'Neu', typ: 'thermostat', raum },
                            { id: 'ohne', name: '', typ: 'lampe', raum: '' },
                        ],
                    }),
                ).to.deep.equal([
                    { value: 'neu', label: { en: 'Neu (Thermostat, Living room)', de: 'Neu (Thermostat, Wohnraum)' } },
                ]);
                expect(await frage('karten', null)).to.deep.equal([]);
            });

            it('Gerätemanager: koppelt per QR-Code, wählt das Profil, entfernt die App', async function () {
                this.timeout(30_000);
                const dm = frage;
                expect((await dm('dm:instanceInfo', null)).actions.map(a => a.id)).to.deep.equal(['koppeln']);

                const formular = await dm('dm:instanceAction', { actionId: 'koppeln' });
                const { origin } = formular;
                const qr = new URL(formular.form.schema.items.qr.data);
                const fp = fingerabdruck(identitaet.zertifikat);
                expect(qr.searchParams.get('f')).to.equal(fp);
                expect(qr.searchParams.getAll('h')).to.deep.equal([`127.0.0.1:${port}`]);
                expect((await dm('dm:actionProgress', { origin, data: { profil: 'familie' } })).type).to.equal(
                    'progress',
                );
                // Die Fortschrittsanzeige schließt erst, wenn sich die App meldet.
                const fortschritt = dm('dm:actionProgress', { origin });
                const kopplung = anmelden(port, fp, {
                    t: 'koppeln',
                    v: 3,
                    geheimnis: qr.searchParams.get('g'),
                    name: 'Tablet Flur',
                    geraet,
                });
                expect((await fortschritt).progress).to.deep.equal({ open: false });
                expect((await dm('dm:actionProgress', { origin })).confirm.de).to.equal(
                    'App „Tablet Flur“ mit Profil „Familie“ koppeln? Anfrage von 127.0.0.1, Android 15, App 1.0.0.',
                );
                expect((await dm('dm:actionProgress', { origin, confirm: true })).result).to.deep.equal({
                    refresh: true,
                });
                const app = await kopplung;
                const appId = app.erste.app;
                expect((await app.naechste()).t).to.equal('willkommen');

                const geraete = await dm('dm:loadDevices', null);
                expect(geraete.add.map(g => [g.id, g.name])).to.deep.include([appId, 'Tablet Flur']);
                const wahl = await dm('dm:deviceAction', { deviceId: appId, actionId: 'profil' });
                await dm('dm:actionProgress', { origin: wahl.origin, data: { profil: '' } });
                expect((await app.naechste(5000)).karten).to.deep.equal([]);
                expect((await harness.objects.getObjectAsync(`myzel-app.0.apps.${appId}`)).native.profil).to.equal('');
                expect((await harness.states.getStateAsync(`myzel-app.0.apps.${appId}.profil`)).val).to.equal('');

                const entfernen = await dm('dm:deviceAction', { deviceId: appId, actionId: 'entfernen' });
                expect(entfernen.type).to.equal('confirm');
                await dm('dm:actionProgress', { origin: entfernen.origin, confirm: true });
                expect(await app.geschlossen).to.equal(4008);
                for (const weg of ['', '.hinweis', '.hinweis.senden']) {
                    expect(await harness.objects.getObjectAsync(`myzel-app.0.apps.${appId}${weg}`), weg).to.equal(null);
                }
                expect(await harness.objects.getObjectAsync(`myzel-app.0.apps.${appId}.online`)).to.not.equal(null);
            });
        });
    },
});
