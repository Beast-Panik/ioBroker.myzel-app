import { createHmac, randomBytes } from 'node:crypto';
import { sha256 } from './kodierung';

// Abgeleitet statt gespeichert (KONZEPT-FERNZUGANG.md, Abschnitt 12): Der Adapter kann jeden Schlüssel jederzeit neu
// bilden und in jedem willkommen mitschicken, ohne je App etwas Geheimes abzulegen. Neu koppeln ändert den Zugang und
// damit von selbst auch den Schlüssel.

export const neuesFerngeheimnis = (): string => randomBytes(32).toString('base64url');

const abgeleitet = (geheimnis: string, wofuer: string): string =>
    createHmac('sha256', Buffer.from(geheimnis, 'base64url')).update(wofuer, 'utf8').digest('base64url');

export const adapterSchluessel = (geheimnis: string): string => abgeleitet(geheimnis, 'adapter');

export const appSchluessel = (geheimnis: string, appId: string, zugangHash: string): string =>
    abgeleitet(geheimnis, `app ${appId} ${zugangHash}`);

// Was der Vermittler kennt: nur Hashes, nie die Schlüssel
export const vermittlerHash = (schluessel: string): string => sha256(schluessel).toString('hex');

export const konfigurationszeile = (adapterId: string, geheimnis: string): string =>
    `adapter ${adapterId} ${vermittlerHash(adapterSchluessel(geheimnis))}`;
