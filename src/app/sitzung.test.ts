import { expect } from 'chai';
import { GRENZEN } from '../basis/grenzen';
import type { Verbindung } from '../basis/kern';
import { appPruefer } from './dienst';
import { Sitzung } from './sitzung';

describe('Sitzung', () => {
    it('nimmt nur begrenzt viele Nachrichten gleichzeitig in Arbeit, darüber zuviel', async () => {
        const fehler: string[] = [];
        const verbindung = {
            empfaenger: (): void => undefined,
            sendeFehler: (code: string) => fehler.push(code),
            schliesse: () => undefined,
        } as unknown as Verbindung;
        const still = { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined };
        let fertig!: () => void;
        const haengt = new Promise<void>(r => (fertig = r));
        let aufrufe = 0;
        new Sitzung('abcdefgh', verbindung, {
            pruefer: appPruefer(),
            log: still,
            behandler: {
                angezeigt: () => {
                    aufrufe++;
                    return haengt;
                },
            },
            grenzen: { ...GRENZEN, inArbeitJeSitzung: 3 },
        });
        const sende = (): void => verbindung.empfaenger(JSON.stringify({ t: 'angezeigt', id: 'AAAAAAAA' }));
        const naechsterTakt = (): Promise<void> => new Promise(r => setImmediate(r));
        for (let i = 0; i < 4; i++) {
            sende();
        }
        await naechsterTakt();
        expect([aufrufe, fehler]).to.deep.equal([3, ['zuviel']]);
        fertig();
        await naechsterTakt();
        sende();
        await naechsterTakt();
        expect([aufrufe, fehler]).to.deep.equal([4, ['zuviel']]);
    });
});
