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
var fernseite_exports = {};
__export(fernseite_exports, {
  FERNBEFEHLE: () => FERNBEFEHLE,
  Fernseite: () => Fernseite
});
module.exports = __toCommonJS(fernseite_exports);
var import_gemeinsam_schema = __toESM(require("../../protokoll/v1/gemeinsam.schema.json"));
var import_schema = require("../basis/schema");
var import_eintraege = require("./eintraege");
const FERNBEFEHLE = [
  "fernseite",
  "fernstand",
  "fernAdresse",
  "fernFreigabe",
  "fernSchluessel"
];
const pruefeAppId = (0, import_schema.erstellePruefer)({ $ref: `${import_gemeinsam_schema.default.$id}#/$defs/appId` }, [import_gemeinsam_schema.default]);
class Fernseite {
  constructor(o) {
    this.o = o;
  }
  async beantworte(befehl, roh) {
    if (befehl === "fernseite") {
      return (0, import_eintraege.seitenadresse)(this.o.namespace, "fern.html");
    }
    const b = this.o.betrieb();
    if (!b) {
      return { fehler: "nichtBereit" };
    }
    const n = (0, import_eintraege.nachricht)(roh);
    switch (befehl) {
      case "fernstand":
        return this.stand(b);
      case "fernAdresse": {
        if (typeof n.adresse !== "string") {
          return { fehler: "ungueltig", einzelheiten: ["adresse"] };
        }
        const fehler = await b.fern.setzeAdresse(n.adresse);
        return fehler.length > 0 ? { fehler: "ungueltig", einzelheiten: fehler } : this.stand(b);
      }
      case "fernFreigabe": {
        if (typeof n.app !== "string" || pruefeAppId(n.app).length > 0 || typeof n.fern !== "boolean") {
          return { fehler: "ungueltig", einzelheiten: ["app", "fern"] };
        }
        if (!await b.ablage.lies(n.app)) {
          return { fehler: "weg" };
        }
        await b.ablage.aendere(n.app, { fern: n.fern });
        return this.stand(b);
      }
      case "fernSchluessel":
        await b.fern.neuesGeheimnis();
        return this.stand(b);
      default:
        return void 0;
    }
  }
  async stand(b) {
    var _a;
    const verbindungen = b.verbindungen();
    const apps = [];
    for (const id of await b.ablage.alle()) {
      const daten = await b.ablage.lies(id);
      if (daten) {
        const verbunden = verbindungen.get(id);
        apps.push({
          id,
          name: daten.name,
          gekoppeltAm: daten.gekoppeltAm,
          fern: daten.fern === true,
          ...verbunden && { verbunden }
        });
      }
    }
    apps.sort((x, y) => x.name.localeCompare(y.name, "de") || x.id.localeCompare(y.id));
    return {
      sprache: b.sprache,
      adresse: b.fern.adresse,
      lage: b.fern.stand,
      jetzt: ((_a = this.o.jetzt) != null ? _a : Date.now)(),
      zeile: b.fern.zeile,
      apps
    };
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  FERNBEFEHLE,
  Fernseite
});
//# sourceMappingURL=fernseite.js.map
