// Abschnitt 7 des Detailentwurfs, soweit es jede Verbindung betrifft. Tests übergeben kürzere Fristen.
export const GRENZEN = {
    anmeldungMs: 10_000,
    pingMs: 15_000,
    totMs: 45_000,
    nachrichtBytes: 64 * 1024,
    sendepufferBytes: 1024 * 1024,
    teilBytes: 256 * 1024,
    verbindungen: 50,
    offenJeAdresse: 5,
    ohneAnmeldung: 20,
    nachrichtenJeSekunde: 50,
    nachrichtenStoss: 100,
    inArbeitJeSitzung: 50,
    ueberlastMs: 10_000,
    ueberlastPauseMs: 1_000,
    ungueltigeNachrichten: 3,
    fehlversuche: 5,
    fehlversuchFensterMs: 5 * 60_000,
    sperreMs: 15 * 60_000,
    sperrlisteEintraege: 1000,
    einmalMs: 10 * 60_000,
    // Die Fortschrittsanzeige im Admin lässt sich nicht wegklicken, daher kurz
    kopplungWartenMs: 2 * 60_000,
    zukunftMs: 5 * 60_000,
    fehlertextZeichen: 300,
};

export type Grenzen = typeof GRENZEN;

// Eigene Schnittstelle statt ioBroker.Logger, damit die Basis später als Bibliothek ohne ioBroker auskommt.
export interface Protokoll {
    debug(text: string): void;
    info(text: string): void;
    warn(text: string): void;
    error(text: string): void;
}
