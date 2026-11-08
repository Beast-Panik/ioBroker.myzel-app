import { expect } from 'chai';
import { type AppDaten, IoBrokerAblage, appstandAus } from './objekte';

const HASH = 'a'.repeat(64);
const DATEN: AppDaten = {
    name: 'Handy',
    zugangHash: HASH,
    profil: 'familie',
    handydaten: { akku: false, anruf: false, benachrichtigung: false },
    gekoppeltAm: 1,
    geraet: { android: '15', appVersion: '1.0.0' },
};

describe('Stand des Objekts einer App', () => {
    it('unterscheidet fehlend, beschädigt und da', () => {
        expect(appstandAus(null)).to.deep.equal({ art: 'fehlt' });
        expect(appstandAus(undefined)).to.deep.equal({ art: 'fehlt' });
        expect(appstandAus({ type: 'device', native: DATEN }).art).to.equal('da');
        // Hash lesbar, der Rest nicht
        expect(appstandAus({ type: 'device', native: { ...DATEN, fern: 'true' } })).to.deep.equal({
            art: 'beschaedigt',
            zugangHash: HASH,
        });
        expect(appstandAus({ type: 'channel', native: DATEN })).to.deep.equal({ art: 'beschaedigt', zugangHash: HASH });
        // Hash nicht lesbar
        for (const native of [{ ...DATEN, zugangHash: 'A'.repeat(64) }, null, undefined, 'kaputt', []]) {
            expect(appstandAus({ type: 'device', native })).to.deep.equal({ art: 'beschaedigt' });
        }
    });

    it('warnt einmal je App, solange das Objekt beschädigt bleibt, und meldet, wenn es wieder lesbar ist', async () => {
        let objekt: unknown = { type: 'device', native: { ...DATEN, profil: 3 } };
        const log: string[] = [];
        const adapter = {
            getObjectAsync: () => Promise.resolve(objekt),
            log: { warn: (t: string) => log.push(`warn ${t}`), info: (t: string) => log.push(`info ${t}`) },
        } as unknown as ioBroker.Adapter;
        const ablage = new IoBrokerAblage(adapter);
        expect(await ablage.stand('abcdefgh')).to.deep.equal({ art: 'beschaedigt', zugangHash: HASH });
        expect(await ablage.lies('abcdefgh')).to.equal(undefined);
        expect(log).to.have.length(1);
        expect(log[0]).to.match(/^warn Objekt der App abcdefgh ist beschädigt/);
        objekt = { type: 'device', native: DATEN };
        expect((await ablage.lies('abcdefgh'))?.zugangHash).to.equal(HASH);
        expect(log.slice(1)).to.deep.equal(['info Objekt der App abcdefgh ist wieder lesbar']);
        objekt = { type: 'device', native: null };
        await ablage.stand('abcdefgh');
        objekt = null;
        await ablage.stand('abcdefgh');
        expect(log.slice(2).map(z => z.split(' ')[0])).to.deep.equal(['warn']);
    });
});

describe('Datenpunkte der Zonen', () => {
    it('ein neuer Name ändert nur Name, Typ und Rechte; Einstellungen etwa für History bleiben', async () => {
        const objekte = new Map<string, Record<string, any>>();
        const adapter = {
            namespace: 'myzel-app.0',
            getObjectAsync: (id: string) => Promise.resolve(structuredClone(objekte.get(id))),
            setObjectAsync: (id: string, o: Record<string, any>) => Promise.resolve(void objekte.set(id, o)),
            setObjectNotExistsAsync: (id: string, o: Record<string, any>) =>
                Promise.resolve(void (objekte.has(id) || objekte.set(id, o))),
            setStateAsync: () => Promise.resolve(),
        } as unknown as ioBroker.Adapter;
        const id = 'apps.abcdefgh.zonen.zuhause';
        objekte.set(id, {
            type: 'state',
            common: {
                name: 'Zuhause',
                type: 'boolean',
                role: 'indicator',
                read: true,
                write: false,
                custom: { 'history.0': { enabled: true } },
            },
            native: {},
        });
        // Nach einem Neustart des Adapters, die Zone heißt inzwischen anders
        await new IoBrokerAblage(adapter).schreibeZone('abcdefgh', 'zuhause', 'Heim', true, 1);
        expect(objekte.get(id)?.common).to.deep.include({
            name: 'Heim',
            type: 'boolean',
            write: false,
            custom: { 'history.0': { enabled: true } },
        });
        // Kein Datenpunkt an der Stelle: neu angelegt
        objekte.set(id, { type: 'channel', common: { name: 'x' }, native: {} });
        await new IoBrokerAblage(adapter).schreibeZone('abcdefgh', 'zuhause', 'Heim', true, 1);
        expect(objekte.get(id)).to.deep.include({ type: 'state' });
        expect(objekte.get(id)?.common).not.to.have.property('custom');
    });
});
