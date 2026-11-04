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
var sitzung_exports = {};
__export(sitzung_exports, {
  Sitzung: () => Sitzung
});
module.exports = __toCommonJS(sitzung_exports);
var import_anmeldung = require("../basis/anmeldung");
var import_grenzen = require("../basis/grenzen");
var import_kern = require("../basis/kern");
var import_schema = require("../basis/schema");
var import_schutz = require("../basis/schutz");
const SETZE_JE_SEKUNDE = 20;
class Sitzung {
  constructor(appId, verbindung, o) {
    this.appId = appId;
    this.verbindung = verbindung;
    this.o = o;
    var _a;
    this.grenzen = (_a = o.grenzen) != null ? _a : import_grenzen.GRENZEN;
    const jetzt = Date.now();
    this.nachrichten = new import_schutz.Eimer(this.grenzen.nachrichtenJeSekunde, this.grenzen.nachrichtenStoss, jetzt);
    this.setze = new import_schutz.Eimer(SETZE_JE_SEKUNDE, SETZE_JE_SEKUNDE, jetzt);
    this.ueberlast = new import_schutz.Ueberlast(this.grenzen);
    verbindung.empfaenger = (text) => this.empfange(text);
  }
  grenzen;
  nachrichten;
  setze;
  ueberlast;
  ungueltige = 0;
  inArbeit = 0;
  empfange(text) {
    const jetzt = Date.now();
    if (!this.nachrichten.nimm(jetzt)) {
      this.zuviel(jetzt, (0, import_schema.nummerAus)(text));
      return;
    }
    const gelesen = this.o.pruefer.lies(text, jetzt);
    if (gelesen.art === "version") {
      this.ungueltig("Protokollversion gibt es nur bei der Anmeldung", void 0);
      return;
    }
    if (gelesen.art === "ungueltig") {
      this.ungueltig(gelesen.grund, gelesen.n);
      return;
    }
    const nachricht = gelesen.nachricht;
    const n = (0, import_schema.nummerAus)(nachricht);
    if (import_anmeldung.ANMELDENACHRICHTEN.includes(nachricht.t)) {
      this.ungueltig(`${nachricht.t} nach der Anmeldung`, n);
      return;
    }
    if (nachricht.t === "setze" && !this.setze.nimm(jetzt)) {
      this.zuviel(jetzt, n);
      return;
    }
    const behandler = this.o.behandler[nachricht.t];
    if (!behandler) {
      this.verbindung.sendeFehler("intern", { text: `${nachricht.t} ist noch nicht umgesetzt`, n });
      return;
    }
    if (this.inArbeit >= this.grenzen.inArbeitJeSitzung) {
      this.zuviel(jetzt, n);
      return;
    }
    this.inArbeit++;
    Promise.resolve().then(() => behandler(nachricht)).catch((fehler) => {
      this.o.log.error(`App ${this.appId}, ${nachricht.t}: ${fehler.message}`);
      this.verbindung.sendeFehler("intern", { n });
    }).finally(() => this.inArbeit--);
  }
  zuviel(jetzt, n) {
    this.verbindung.sendeFehler("zuviel", { n });
    if (this.ueberlast.abgelehnt(jetzt)) {
      this.o.log.warn(`App ${this.appId} getrennt: Ratenbegrenzung anhaltend \xFCberschritten`);
      this.verbindung.schliesse(import_kern.SCHLIESSCODE.zuviel, "zuviel");
    }
  }
  ungueltig(grund, n) {
    this.o.log.debug(`App ${this.appId}: ung\xFCltige Nachricht, ${grund}`);
    this.verbindung.sendeFehler("ungueltig", { text: grund, n });
    if (++this.ungueltige >= this.grenzen.ungueltigeNachrichten) {
      this.o.log.warn(`App ${this.appId} getrennt: ${this.ungueltige} ung\xFCltige Nachrichten`);
      this.verbindung.schliesse(import_kern.SCHLIESSCODE.ungueltig, "ungueltig");
    }
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Sitzung
});
//# sourceMappingURL=sitzung.js.map
