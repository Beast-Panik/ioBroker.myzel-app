"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var grenzen_exports = {};
__export(grenzen_exports, {
  GRENZEN: () => GRENZEN
});
module.exports = __toCommonJS(grenzen_exports);
const GRENZEN = {
  anmeldungMs: 1e4,
  pingMs: 15e3,
  totMs: 45e3,
  // Über den Vermittler selten: Im Mobilfunk hielt eine stille Verbindung in F0 mindestens 30 min (KONZEPT-FERNZUGANG.md).
  fernPingMs: 10 * 6e4,
  fernTotMs: 25 * 6e4,
  nachrichtBytes: 64 * 1024,
  sendepufferBytes: 1024 * 1024,
  teilBytes: 256 * 1024,
  verbindungen: 50,
  offenJeAdresse: 5,
  ohneAnmeldung: 20,
  // Über den Vermittler, ebenfalls ohne Anmeldung: je App wie beim Vermittler, insgesamt die Hälfte von ohneAnmeldung
  fernJeApp: 2,
  fernOhneAnmeldung: 10,
  // Anmeldungen je App: Eine App in einer Schleife schriebe sonst ohne Ende Log und Datenbank voll
  anmeldungenStoss: 5,
  anmeldungAbstandMs: 2e3,
  nachrichtenJeSekunde: 50,
  nachrichtenStoss: 100,
  inArbeitJeSitzung: 50,
  ueberlastMs: 1e4,
  ueberlastPauseMs: 1e3,
  ungueltigeNachrichten: 3,
  fehlversuche: 5,
  fehlversuchFensterMs: 5 * 6e4,
  sperreMs: 15 * 6e4,
  sperrlisteEintraege: 1e3,
  einmalMs: 10 * 6e4,
  // Die Fortschrittsanzeige im Admin lässt sich nicht wegklicken, daher kurz
  kopplungWartenMs: 2 * 6e4,
  zukunftMs: 5 * 6e4,
  fehlertextZeichen: 300
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  GRENZEN
});
//# sourceMappingURL=grenzen.js.map
