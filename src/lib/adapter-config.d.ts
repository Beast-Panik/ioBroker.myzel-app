// Erweitert AdapterConfig aus @iobroker/types um die Felder aus io-package.json.

import { native } from '../../io-package.json';

// Aus dem leeren Array in io-package.json leitet TypeScript never[] ab.
type _AdapterConfig = Omit<typeof native, 'adressen'> & { adressen: string[] };

declare global {
    namespace ioBroker {
        interface AdapterConfig extends _AdapterConfig {
            // Do not enter anything here!
        }
    }
}

export {};
