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
var kartenseite_exports = {};
__export(kartenseite_exports, {
  KARTENBEFEHLE: () => KARTENBEFEHLE,
  Kartenseite: () => Kartenseite
});
module.exports = __toCommonJS(kartenseite_exports);
var import_rechte = require("../app/rechte");
var import_eintraege = require("./eintraege");
const KARTENBEFEHLE = [
  "kartenseite",
  "kartenstand",
  "datenpunkte",
  "speichereKarte",
  "loescheKarte"
];
const TREFFER = 100;
const ARTEN = Object.fromEntries(
  import_rechte.KARTENTYPEN.map((typ) => {
    const art = import_rechte.KARTENARTEN[typ];
    return [
      typ,
      {
        teile: Object.entries(art.teile).map(([teil, t]) => ({ teil, typen: t.typen })),
        pflicht: art.pflicht,
        bezeichnungen: art.bezeichnungen === true
      }
    ];
  })
);
function texte(roh, erlaubt) {
  if (!roh || typeof roh !== "object" || Array.isArray(roh)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(roh).filter(([k, w]) => erlaubt.includes(k) && typeof w === "string" && w.trim() !== "").map(([k, w]) => [k, w.trim()])
  );
}
function bereinigt(roh) {
  if (!roh || typeof roh !== "object" || Array.isArray(roh)) {
    return roh;
  }
  const r = roh;
  const art = import_rechte.KARTENARTEN[r.typ];
  if (!art) {
    return roh;
  }
  const teile = texte(r.teile, Object.keys(art.teile));
  const bezeichnungen = art.bezeichnungen ? texte(r.bezeichnungen, Object.keys(teile)) : {};
  return {
    name: typeof r.name === "string" ? r.name.trim() : r.name,
    typ: r.typ,
    raum: typeof r.raum === "string" ? r.raum : "",
    teile,
    ...Object.keys(bezeichnungen).length > 0 ? { bezeichnungen } : {}
  };
}
class Kartenseite {
  constructor(o) {
    this.o = o;
    this.karten = new import_eintraege.Eintraege(
      {
        ordner: "karten",
        kennbuchstabe: "k",
        was: "Karte",
        pruefe: (roh) => (0, import_rechte.alsKarte)(bereinigt(roh)),
        imKatalog: (katalog, id) => katalog.karte(id),
        anzahl: (katalog) => katalog.karten().length,
        hoechstens: import_rechte.KARTEN_HOECHSTENS
      },
      o
    );
  }
  karten;
  async beantworte(befehl, roh) {
    if (befehl === "kartenseite") {
      return (0, import_eintraege.seitenadresse)(this.o.namespace, "karten.html");
    }
    const katalog = this.o.katalog();
    if (!katalog) {
      return { fehler: "nichtBereit" };
    }
    const n = (0, import_eintraege.nachricht)(roh);
    switch (befehl) {
      case "kartenstand":
        return this.stand(katalog);
      case "datenpunkte":
        return this.suche(katalog, n);
      case "speichereKarte":
        return this.mitStand(katalog, await this.karten.speichere(katalog, n.id, n.karte));
      case "loescheKarte":
        return this.mitStand(katalog, await this.karten.loesche(katalog, n.id));
      default:
        return void 0;
    }
  }
  mitStand(katalog, antwort) {
    return "fehler" in antwort ? antwort : { id: antwort.id, stand: this.stand(katalog) };
  }
  stand(katalog) {
    var _a;
    const sprache = katalog.sprache;
    const karten = katalog.karten().map(([id, k]) => ({
      id,
      name: k.name,
      typ: k.typ,
      raum: k.raum,
      teile: { ...k.teile },
      ...k.bezeichnungen ? { bezeichnungen: { ...k.bezeichnungen } } : {},
      maengel: (0, import_rechte.maengelDerKarte)(k, (dp) => katalog.datenpunkt(dp))
    }));
    const namen = {};
    for (const dp of karten.flatMap((k) => Object.values(k.teile))) {
      const name = (_a = katalog.datenpunkt(dp)) == null ? void 0 : _a.name;
      if (typeof name === "string" && name !== dp) {
        namen[dp] = name;
      }
    }
    return {
      sprache,
      raeume: katalog.raeume().map((r) => ({ id: r.id, name: (0, import_rechte.text)(r.name, sprache, r.id) })),
      arten: ARTEN,
      karten,
      namen,
      hoechstens: import_rechte.KARTEN_HOECHSTENS,
      laengen: { name: import_rechte.NAME_LAENGE, bezeichnung: import_rechte.BEZEICHNUNG_LAENGE }
    };
  }
  // Jedes Wort muss in ID oder Name stehen; nur Datenpunkte, deren Typ zum Teil passt, nie unter system
  suche(katalog, n) {
    var _a;
    const art = (_a = import_rechte.KARTENARTEN[n.typ]) == null ? void 0 : _a.teile[String(n.teil)];
    if (!art) {
      return { treffer: [], mehr: false };
    }
    const woerter = (typeof n.suche === "string" ? n.suche : "").toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8);
    const treffer = [];
    for (const [id, m] of katalog.alleDatenpunkte()) {
      if (!art.typen.includes(m.type) || (0, import_rechte.liegtUnter)(id, "system")) {
        continue;
      }
      const name = typeof m.name === "string" ? m.name : id;
      const heu = `${id}
${name}`.toLowerCase();
      if (woerter.every((w) => heu.includes(w))) {
        treffer.push({ id, name, typ: m.type, ...typeof m.unit === "string" ? { einheit: m.unit } : {} });
      }
    }
    treffer.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    return { treffer: treffer.slice(0, TREFFER), mehr: treffer.length > TREFFER };
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  KARTENBEFEHLE,
  Kartenseite
});
//# sourceMappingURL=kartenseite.js.map
