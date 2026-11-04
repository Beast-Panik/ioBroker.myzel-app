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
var kopplung_exports = {};
__export(kopplung_exports, {
  Kopplung: () => Kopplung,
  LINKFORMAT: () => LINKFORMAT,
  qrInhalt: () => qrInhalt
});
module.exports = __toCommonJS(kopplung_exports);
var import_grenzen = require("./grenzen");
var import_kern = require("./kern");
var import_kodierung = require("./kodierung");
const LINKFORMAT = 1;
function qrInhalt(q) {
  const teile = [
    ["v", String(LINKFORMAT)],
    ["a", q.adapterId],
    ["f", q.fingerabdruck],
    ["g", q.geheimnis],
    ...q.adressen.map((h) => ["h", h])
  ];
  return `myzelapp://koppeln?${teile.map(([k, w]) => `${k}=${encodeURIComponent(w)}`).join("&")}`;
}
class Kopplung {
  constructor(grenzen = import_grenzen.GRENZEN) {
    this.grenzen = grenzen;
  }
  schluessel;
  anfrage;
  wartender;
  starte() {
    this.brichAb();
    const geheimnis = (0, import_kodierung.neuesGeheimnis)();
    const ablauf = setTimeout(() => this.brichAb(), this.grenzen.einmalMs);
    ablauf.unref();
    this.schluessel = { hash: (0, import_kodierung.sha256)(geheimnis), benutzt: false, ablauf };
    return { geheimnis, gueltigBis: Date.now() + this.grenzen.einmalMs };
  }
  // Falsche Geheimnisse machen den Schlüssel nicht ungültig: 128 Bit errät niemand, ein Zähler ließe nur jeden im
  // Heimnetz die Kopplung verhindern. Gezählt wird je Adresse in der Sperrliste.
  melde(geheimnis, anfrage) {
    const s = this.schluessel;
    if (!s || s.benutzt || !(0, import_kodierung.passtZuHash)(geheimnis, s.hash)) {
      return false;
    }
    s.benutzt = true;
    this.anfrage = anfrage;
    anfrage.verbindung.beiTrennung(() => {
      if (this.anfrage === anfrage) {
        this.anfrage = void 0;
      }
    });
    this.wecke(anfrage);
    return true;
  }
  warte(fristMs) {
    var _a;
    if ((_a = this.anfrage) == null ? void 0 : _a.verbindung.offen) {
      return Promise.resolve(this.anfrage);
    }
    this.wecke(void 0);
    return new Promise((resolve) => {
      const frist = setTimeout(() => this.wecke(void 0), fristMs);
      this.wartender = (anfrage) => {
        clearTimeout(frist);
        resolve(anfrage);
      };
    });
  }
  abschliessen(anfrage) {
    if (this.anfrage !== anfrage || !anfrage.verbindung.offen) {
      return false;
    }
    this.anfrage = void 0;
    this.loescheSchluessel();
    return true;
  }
  ablehnen(anfrage) {
    if (this.anfrage !== anfrage) {
      return;
    }
    this.anfrage = void 0;
    this.loescheSchluessel();
    anfrage.verbindung.sendeFehler("abgelehnt");
    anfrage.verbindung.schliesse(import_kern.SCHLIESSCODE.abgelehnt, "abgelehnt");
  }
  brichAb() {
    this.loescheSchluessel();
    const anfrage = this.anfrage;
    this.anfrage = void 0;
    if (anfrage) {
      anfrage.verbindung.sendeFehler("abgelaufen");
      anfrage.verbindung.schliesse(import_kern.SCHLIESSCODE.abgelaufen, "abgelaufen");
    }
    this.wecke(void 0);
  }
  loescheSchluessel() {
    if (this.schluessel) {
      clearTimeout(this.schluessel.ablauf);
      this.schluessel = void 0;
    }
  }
  wecke(anfrage) {
    const wartender = this.wartender;
    this.wartender = void 0;
    wartender == null ? void 0 : wartender(anfrage);
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Kopplung,
  LINKFORMAT,
  qrInhalt
});
//# sourceMappingURL=kopplung.js.map
