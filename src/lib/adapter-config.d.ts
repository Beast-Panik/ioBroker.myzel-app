// Erweitert AdapterConfig aus @iobroker/types um die Felder aus io-package.json.

import { native } from '../../io-package.json';

// Aus den leeren Arrays in io-package.json leitet TypeScript never[] ab. Karten und Profile prüft app/konfiguration.ts.
type _AdapterConfig = Omit<typeof native, 'adressen' | 'karten' | 'profile'> & {
    adressen: string[];
    karten: unknown[];
    profile: unknown[];
};

declare global {
    namespace ioBroker {
        interface AdapterConfig extends _AdapterConfig {
            // Do not enter anything here!
        }
    }
}

export {};
