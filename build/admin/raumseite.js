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
var raumseite_exports = {};
__export(raumseite_exports, {
  RAUMBEFEHLE: () => RAUMBEFEHLE,
  Raumseite: () => Raumseite
});
module.exports = __toCommonJS(raumseite_exports);
var import_rechte = require("../app/rechte");
var import_eintraege = require("./eintraege");
const RAUMBEFEHLE = [
  "raumseite",
  "raumstand",
  "speichereEtage",
  "loescheEtage",
  "ordneRaeume"
];
const ohneLeerraum = (w) => typeof w === "string" ? w.trim() : w;
class Raumseite {
  constructor(o) {
    this.o = o;
    this.etagen = new import_eintraege.Eintraege(
      {
        ordner: "etagen",
        kennbuchstabe: "e",
        was: "Etage",
        pruefe: import_rechte.alsEtage,
        imKatalog: (katalog, id) => {
          var _a;
          return (_a = katalog.alleEtagen().find(([e]) => e === id)) == null ? void 0 : _a[1];
        },
        anzahl: (katalog) => katalog.alleEtagen().length,
        hoechstens: import_rechte.ETAGEN_HOECHSTENS
      },
      o
    );
  }
  etagen;
  async beantworte(befehl, roh) {
    if (befehl === "raumseite") {
      return (0, import_eintraege.seitenadresse)(this.o.namespace, "raeume.html");
    }
    const katalog = this.o.katalog();
    if (!katalog) {
      return { fehler: "nichtBereit" };
    }
    const n = (0, import_eintraege.nachricht)(roh);
    switch (befehl) {
      case "raumstand":
        return this.stand(katalog);
      case "speichereEtage":
        return this.mitStand(katalog, await this.speichereEtage(katalog, n.id, n.etage));
      case "loescheEtage":
        return this.mitStand(katalog, await this.etagen.loesche(katalog, n.id));
      case "ordneRaeume":
        return this.mitStand(katalog, await this.ordne(katalog, n.etagen));
      default:
        return void 0;
    }
  }
  mitStand(katalog, antwort) {
    return "fehler" in antwort ? antwort : { id: antwort.id, stand: this.stand(katalog) };
  }
  // Eine neue Etage kommt nach unten und ist leer; eine bestehende behält Position und Räume.
  speichereEtage(katalog, id, roh) {
    var _a, _b, _c;
    const n = (0, import_eintraege.nachricht)(roh);
    const alle = katalog.alleEtagen();
    const bisher = id === void 0 ? void 0 : (_a = alle.find(([e]) => e === id)) == null ? void 0 : _a[1];
    const etage = {
      name: ohneLeerraum(n.name),
      kurz: ohneLeerraum(n.kurz),
      position: (_b = bisher == null ? void 0 : bisher.position) != null ? _b : alle.length > 0 ? Math.max(...alle.map(([, e]) => e.position)) + 1 : 0,
      raeume: (_c = bisher == null ? void 0 : bisher.raeume) != null ? _c : []
    };
    return this.etagen.speichere(katalog, id, etage);
  }
  // Die Seite schickt die Etagen von oben nach unten, je mit ihren Räumen. Geschrieben wird nur, was sich ändert; ein
  // Raum, den es nicht gibt oder der schon weiter oben steht, fällt weg.
  async ordne(katalog, roh) {
    if (!Array.isArray(roh) || roh.length > import_rechte.ETAGEN_HOECHSTENS) {
      return { fehler: "ungueltig", einzelheiten: ["etagen"] };
    }
    const bisher = new Map(katalog.alleEtagen());
    const raeume = new Set(katalog.raeume().map((r) => r.id));
    const vergeben = /* @__PURE__ */ new Set();
    const folge = [];
    for (const eintrag of roh) {
      const e = (0, import_eintraege.nachricht)(eintrag);
      const alt = (0, import_rechte.istKennung)(e.id) ? bisher.get(e.id) : void 0;
      if (!alt || !Array.isArray(e.raeume) || folge.some(([id]) => id === e.id)) {
        return { fehler: "weg" };
      }
      const eigene = e.raeume.filter(
        (r) => typeof r === "string" && raeume.has(r) && !vergeben.has(r)
      );
      eigene.forEach((r) => vergeben.add(r));
      folge.push([e.id, { ...alt, position: folge.length, raeume: eigene }]);
    }
    for (const [id, alt] of bisher) {
      if (!folge.some(([e]) => e === id)) {
        folge.push([id, { ...alt, position: folge.length, raeume: alt.raeume.filter((r) => !vergeben.has(r)) }]);
      }
    }
    for (const [id, neu] of folge) {
      const alt = bisher.get(id);
      if (alt.position !== neu.position || alt.raeume.join("\n") !== neu.raeume.join("\n")) {
        const antwort = await this.etagen.speichere(katalog, id, neu);
        if ("fehler" in antwort) {
          return antwort;
        }
      }
    }
    return { id: "" };
  }
  stand(katalog) {
    var _a;
    const sprache = katalog.sprache;
    const karten = /* @__PURE__ */ new Map();
    for (const [, k] of katalog.karten()) {
      karten.set(k.raum, ((_a = karten.get(k.raum)) != null ? _a : 0) + 1);
    }
    return {
      sprache,
      raeume: (0, import_eintraege.raeumeFuerSeiten)(katalog).map((r) => {
        var _a2;
        return { ...r, karten: (_a2 = karten.get(r.id)) != null ? _a2 : 0 };
      }),
      etagen: katalog.alleEtagen().map(([id, e]) => ({
        id,
        name: e.name,
        kurz: e.kurz,
        raeume: katalog.raeume().filter((r) => r.etage === id).map((r) => r.id)
      })),
      laengen: { name: import_rechte.ETAGENNAME_LAENGE, kurz: import_rechte.ETAGENKURZ_LAENGE },
      hoechstens: import_rechte.ETAGEN_HOECHSTENS
    };
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  RAUMBEFEHLE,
  Raumseite
});
//# sourceMappingURL=raumseite.js.map
