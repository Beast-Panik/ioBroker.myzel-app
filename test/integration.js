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

            before(async function () {
                this.timeout(60_000);
                harness = getHarness();
                port = await freierPort();
                // Feste Adresse für den QR-Code: Ohne private Schnittstelle (etwa in CI) fände der Adapter keine.
                await harness.changeAdapterConfig('myzel-app', { native: { port, adressen: [`127.0.0.1:${port}`] } });
                await harness.startAdapterAndWait(true);
                identitaet = (await harness.objects.getObjectAsync('myzel-app.0.identitaet')).native;
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

                const ok = await anmelden(port, fp, { t: 'hallo', v: 1, app: 'abcdefgh', zugang, geraet });
                expect(ok.erste).to.include({ t: 'willkommen', adapter: identitaet.adapterId });
                await bis(async () => (await online()) === true);
                ok.ws.close();
                await bis(async () => (await online()) === false);

                const falsch = await anmelden(port, fp, {
                    t: 'hallo',
                    v: 1,
                    app: 'abcdefgh',
                    zugang: 'A'.repeat(43),
                    geraet,
                });
                expect(falsch.erste).to.deep.equal({ t: 'fehler', code: 'zugang' });
                expect(await falsch.geschlossen).to.equal(4001);
            });
            it('liest und schreibt Datenpunkte nach Profil und Raum', async () => {
                const lampe = 'javascript.0.test.lampe';
                const temperatur = 'javascript.0.test.temperatur';
                const geheim = 'javascript.0.test.geheim';
                const datenpunkte = [
                    [lampe, { type: 'boolean', role: 'switch', write: true }, false],
                    [temperatur, { type: 'number', role: 'value.temperature', unit: '°C', write: false }, 21],
                    [geheim, { type: 'boolean', role: 'switch', write: true }, false],
                ];
                for (const [id, common, val] of datenpunkte) {
                    await harness.objects.setObjectAsync(id, {
                        type: 'state',
                        common: { name: id, read: true, ...common },
                        native: {},
                    });
                    await harness.states.setStateAsync(id, { val, ack: true });
                }
                await harness.objects.setObjectAsync('enum.rooms.testraum', {
                    type: 'enum',
                    common: { name: { de: 'Testraum', en: 'Test room' }, members: [lampe, temperatur] },
                    native: {},
                });
                await harness.objects.setObjectAsync('myzel-app.0.profile.familie', {
                    type: 'config',
                    common: { name: 'Familie' },
                    native: {
                        name: 'Familie',
                        raeume: [{ enum: 'enum.rooms.testraum', recht: 'schreiben' }],
                        freigaben: [],
                        sperren: [],
                    },
                });
                const zugang = await legeApp('bcdefghi', 'familie');
                const app = await anmelden(port, fingerabdruck(identitaet.zertifikat), {
                    t: 'hallo',
                    v: 1,
                    app: 'bcdefghi',
                    zugang,
                    geraet,
                });

                expect(app.erste.profil).to.equal('Familie');
                expect(app.erste.datenpunkte.map(d => [d.id, d.recht])).to.deep.equal([
                    [lampe, 'schreiben'],
                    [temperatur, 'lesen'],
                ]);
                const sprache = (await harness.objects.getObjectAsync('system.config')).common.language;
                expect(app.erste.raeume).to.deep.equal([
                    {
                        id: 'enum.rooms.testraum',
                        name: sprache === 'de' ? 'Testraum' : 'Test room',
                        mitglieder: [lampe, temperatur],
                    },
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

            it('schickt rechte bei Änderungen an Profil und Raum und trennt eine entfernte App', async function () {
                this.timeout(30_000);
                const lampe = 'javascript.0.test.lampe';
                const temperatur = 'javascript.0.test.temperatur';
                const geheim = 'javascript.0.test.geheim';
                const zugang = await legeApp('cdefghij', 'familie');
                const app = await anmelden(port, fingerabdruck(identitaet.zertifikat), {
                    t: 'hallo',
                    v: 1,
                    app: 'cdefghij',
                    zugang,
                    geraet,
                });
                expect(app.erste.datenpunkte.map(d => d.id)).to.deep.equal([lampe, temperatur]);
                app.ws.send(JSON.stringify({ t: 'abo', ids: [lampe, temperatur] }));
                expect((await app.naechste()).t).to.equal('werte');

                await harness.objects.setObjectAsync('myzel-app.0.profile.familie', {
                    type: 'config',
                    common: { name: 'Familie' },
                    native: {
                        name: 'Familie',
                        raeume: [{ enum: 'enum.rooms.testraum', recht: 'schreiben' }],
                        freigaben: [],
                        sperren: [lampe],
                    },
                });
                const rechte = await app.naechste(5000);
                expect(rechte.t).to.equal('rechte');
                expect(rechte.datenpunkte.map(d => d.id)).to.deep.equal([temperatur]);
                await harness.states.setStateAsync(lampe, { val: false, ack: true });
                await harness.states.setStateAsync(temperatur, { val: 23, ack: true });
                expect(Object.keys((await app.naechste()).werte)).to.deep.equal([temperatur]);

                await harness.objects.setObjectAsync('enum.rooms.testraum', {
                    type: 'enum',
                    common: { name: { de: 'Testraum', en: 'Test room' }, members: [lampe, temperatur, geheim] },
                    native: {},
                });
                expect((await app.naechste(5000)).datenpunkte.map(d => d.id)).to.deep.equal([geheim, temperatur]);

                await harness.objects.delObjectAsync('myzel-app.0.apps.cdefghij');
                expect(await app.geschlossen).to.equal(4008);
            });

            it('schreibt eingeschaltete Handydaten mit ack=true und Zeit vom Handy, legt nur dafür Datenpunkte an', async () => {
                const zugang = await legeApp('defghijk', '', { akku: true, anruf: false, benachrichtigung: true });
                const app = await anmelden(port, fingerabdruck(identitaet.zertifikat), {
                    t: 'hallo',
                    v: 1,
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
                    v: 1,
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

            // Über das Nachrichtenfach wie der Admin: jede Antwort der GUI eine eigene Nachricht mit origin
            it('Gerätemanager: koppelt per QR-Code, wählt das Profil, entfernt die App', async function () {
                this.timeout(30_000);
                await harness.enableSendTo();
                // Nacheinander: sendTo des Testrahmens ordnet Antworten nicht der Anfrage zu
                const dm = (command, message) =>
                    new Promise(resolve => harness.sendTo('myzel-app.0', command, message, resolve));
                expect((await dm('dm:instanceInfo', null)).actions.map(a => a.id)).to.deep.equal([
                    'koppeln',
                    'profile',
                    'geraete',
                ]);

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
                    v: 1,
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
                expect((await app.naechste(5000)).datenpunkte).to.deep.equal([]);
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
