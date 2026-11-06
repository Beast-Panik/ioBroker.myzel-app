"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var fernzugang_exports = {};
__export(fernzugang_exports, {
  Fernverwaltung: () => Fernverwaltung
});
module.exports = __toCommonJS(fernzugang_exports);
var import_gemeinsam_schema = __toESM(require("../../protokoll/v1/gemeinsam.schema.json"));
var import_fernschluessel = require("../basis/fernschluessel");
var import_schema = require("../basis/schema");
var import_fern = require("../zugang/fern");
const pruefeVermittler = (0, import_schema.erstellePruefer)({ $ref: `${import_gemeinsam_schema.default.$id}#/$defs/vermittler` }, [import_gemeinsam_schema.default]);
const ABGLEICH_MS = 500;
class Fernverwaltung {
  constructor(o) {
    this.o = o;
  }
  einstellung = { adresse: "", geheimnis: "" };
  fern;
  lage = { art: "aus" };
  abgleich;
  get stand() {
    return this.lage;
  }
  get adresse() {
    return this.einstellung.adresse;
  }
  get zeile() {
    return (0, import_fernschluessel.konfigurationszeile)(this.o.adapterId, this.einstellung.geheimnis);
  }
  async starte() {
    const gelesen = await this.o.ablage.lies();
    if (gelesen) {
      this.einstellung = gelesen;
    } else {
      this.einstellung = { adresse: "", geheimnis: (0, import_fernschluessel.neuesFerngeheimnis)() };
      await this.o.ablage.schreibe(this.einstellung);
      this.o.log.info("Geheimnis f\xFCr den Fernzugang erzeugt");
    }
    this.verbinde();
  }
  zugang() {
    const { adresse, geheimnis } = this.einstellung;
    return adresse ? { adresse, geheimnis } : void 0;
  }
  // Fehler als Text für die Seite, leer bei Erfolg
  async setzeAdresse(eingabe) {
    const adresse = eingabe.trim().replace(/\/+$/, "");
    if (adresse && pruefeVermittler(adresse).length > 0) {
      return ["Adresse ung\xFCltig: nur https:// mit Namen, ohne Abfrage und Anker"];
    }
    if (adresse === this.einstellung.adresse) {
      return [];
    }
    await this.uebernimm({ ...this.einstellung, adresse });
    this.o.log.info(adresse ? `Fernzugang \xFCber ${adresse}` : "Fernzugang ausgeschaltet");
    return [];
  }
  async neuesGeheimnis() {
    await this.uebernimm({ ...this.einstellung, geheimnis: (0, import_fernschluessel.neuesFerngeheimnis)() });
    this.o.log.warn(
      "Fernzugang: Schl\xFCssel neu erzeugt. Der Vermittler braucht die neue Zeile, die Apps ihren neuen Schl\xFCssel beim n\xE4chsten Verbinden im Heimnetz."
    );
  }
  // Freigabe, Kopplung oder Entfernen einer App; gesammelt, weil ein Speichern mehrere Objektänderungen auslöst
  appsGeaendert() {
    clearTimeout(this.abgleich);
    this.abgleich = setTimeout(() => {
      var _a;
      (_a = this.fern) == null ? void 0 : _a.abgleich().catch((fehler) => this.o.log.error(`Fernzugang, Abgleich: ${fehler.message}`));
    }, ABGLEICH_MS);
  }
  beende() {
    var _a;
    clearTimeout(this.abgleich);
    (_a = this.fern) == null ? void 0 : _a.beende();
    this.fern = void 0;
  }
  async uebernimm(einstellung) {
    await this.o.ablage.schreibe(einstellung);
    this.einstellung = einstellung;
    this.verbinde();
    this.o.geaendert();
  }
  verbinde() {
    var _a;
    (_a = this.fern) == null ? void 0 : _a.beende();
    this.fern = void 0;
    const { adresse, geheimnis } = this.einstellung;
    if (!adresse) {
      this.setze({ art: "aus" });
      return;
    }
    const fern = new import_fern.Fern({
      adresse,
      adapterSchluessel: (0, import_fernschluessel.adapterSchluessel)(geheimnis),
      apps: () => this.freigegebene(geheimnis),
      nimm: this.o.nimm,
      log: this.o.log,
      stand: (stand) => {
        if (this.fern === fern) {
          this.setze(stand);
        }
      }
    });
    this.fern = fern;
    fern.starte();
  }
  setze(lage) {
    const vorher = this.lage.art === "verbunden";
    this.lage = lage;
    if (vorher !== (lage.art === "verbunden")) {
      this.o.verbunden(lage.art === "verbunden");
    }
  }
  async freigegebene(geheimnis) {
    const liste = [];
    for (const appId of await this.o.apps.alle()) {
      const daten = await this.o.apps.lies(appId);
      if ((daten == null ? void 0 : daten.fern) === true) {
        liste.push({ appId, hash: (0, import_fernschluessel.vermittlerHash)((0, import_fernschluessel.appSchluessel)(geheimnis, appId, daten.zugangHash)) });
      }
    }
    return liste;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Fernverwaltung
});
//# sourceMappingURL=fernzugang.js.map
