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
var rechte_exports = {};
__export(rechte_exports, {
  GERAETE_HOECHSTENS: () => GERAETE_HOECHSTENS,
  Rechtestand: () => Rechtestand,
  TEILE: () => TEILE,
  TEILTYP: () => TEILTYP,
  alsGeraet: () => alsGeraet,
  alsProfil: () => alsProfil,
  berechneRechte: () => berechneRechte,
  beschreibe: () => beschreibe,
  istKennung: () => istKennung,
  liegtUnter: () => liegtUnter,
  merkmale: () => merkmale,
  passtZuTeil: () => passtZuTeil,
  rechteFuer: () => rechteFuer,
  text: () => text
});
module.exports = __toCommonJS(rechte_exports);
var import_adapter_an_app_schema = __toESM(require("../../protokoll/v1/adapter-an-app.schema.json"));
var import_gemeinsam_schema = __toESM(require("../../protokoll/v1/gemeinsam.schema.json"));
var import_schema = require("../basis/schema");
const TEILTYP = {
  schalten: "boolean",
  helligkeit: "number",
  farbe: "string",
  farbtemperatur: "number"
};
const TEILE = Object.keys(TEILTYP);
const GERAETE_HOECHSTENS = import_adapter_an_app_schema.default.$defs.rechteInhalt.properties.geraete.maxItems;
const MERKMALE = ["name", "type", "role", "unit", "min", "max", "step", "states", "write"];
function aliasziele(alias) {
  const id = alias == null ? void 0 : alias.id;
  const ziele = id && typeof id === "object" ? [id.read, id.write] : [id];
  return ziele.filter((z) => typeof z === "string" && z !== "");
}
function merkmale(id, common, sprache) {
  const felder = Object.fromEntries(
    MERKMALE.filter((m) => (common == null ? void 0 : common[m]) !== void 0).map((m) => [m, common[m]])
  );
  const ziele = aliasziele(common == null ? void 0 : common.alias);
  return { ...felder, name: text(common == null ? void 0 : common.name, sprache, id), ...ziele.length > 0 ? { ziele } : {} };
}
const TYPEN = /* @__PURE__ */ new Set(["number", "string", "boolean", "json", "mixed", "array", "object", "file"]);
const RANG = { lesen: 1, schreiben: 2 };
const FEST_GESPERRT = ["system"];
const pruefeObjektId = (0, import_schema.erstellePruefer)({ $ref: `${import_gemeinsam_schema.default.$id}#/$defs/objektId` }, [import_gemeinsam_schema.default]);
const pruefeProfil = (0, import_schema.erstellePruefer)({
  type: "object",
  required: ["name", "raeume", "freigaben", "sperren"],
  properties: {
    name: { type: "string", minLength: 1, maxLength: 60 },
    raeume: {
      type: "array",
      items: {
        type: "object",
        required: ["enum", "recht"],
        properties: {
          enum: { type: "string", pattern: "^enum\\.rooms\\." },
          recht: { enum: ["lesen", "schreiben"] }
        }
      }
    },
    freigaben: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "recht"],
        properties: { id: { type: "string", minLength: 1 }, recht: { enum: ["lesen", "schreiben"] } }
      }
    },
    sperren: { type: "array", items: { type: "string", minLength: 1 } }
  }
});
function alsProfil(native) {
  const fehler = pruefeProfil(native);
  return fehler.length > 0 ? fehler : native;
}
const geraetFeld = (feld) => ({ $ref: `${import_adapter_an_app_schema.default.$id}#/$defs/geraet/properties/${feld}` });
const pruefeGeraet = (0, import_schema.erstellePruefer)(
  {
    type: "object",
    required: ["name", "typ", "teile"],
    properties: {
      name: { type: "string", minLength: 1, maxLength: 200 },
      typ: geraetFeld("typ"),
      teile: geraetFeld("teile")
    }
  },
  [import_gemeinsam_schema.default, import_adapter_an_app_schema.default]
);
function alsGeraet(native) {
  const fehler = pruefeGeraet(native);
  return fehler.length > 0 ? fehler : native;
}
const pruefeKennung = (0, import_schema.erstellePruefer)({ $ref: `${import_gemeinsam_schema.default.$id}#/$defs/kennung` }, [import_gemeinsam_schema.default]);
const istKennung = (id) => pruefeKennung(id).length === 0;
const zahl = (w) => typeof w === "number" && Number.isFinite(w) ? w : void 0;
function passtZuTeil(teil, typ, min, max) {
  if (typ !== TEILTYP[teil]) {
    return false;
  }
  const von = zahl(min);
  const bis = zahl(max);
  return teil !== "farbtemperatur" || von !== void 0 && bis !== void 0 && von < bis;
}
function text(name, sprache, ersatz) {
  var _a, _b;
  if (typeof name === "string") {
    return name;
  }
  const uebersetzt = (_b = (_a = name == null ? void 0 : name[sprache]) != null ? _a : name == null ? void 0 : name.en) != null ? _b : Object.values(name != null ? name : {})[0];
  return typeof uebersetzt === "string" ? uebersetzt : ersatz;
}
function auswahl(states) {
  let paare = [];
  if (typeof states === "string") {
    paare = states.split(";").filter((teil) => teil.includes(":")).map((teil) => [teil.slice(0, teil.indexOf(":")), teil.slice(teil.indexOf(":") + 1)]);
  } else if (Array.isArray(states)) {
    paare = states.map((t, i) => [String(i), t]);
  } else if (states && typeof states === "object") {
    paare = Object.entries(states);
  }
  const ergebnis = paare.filter(([, t]) => typeof t === "string" || typeof t === "number" || typeof t === "boolean").slice(0, 200).map(([w, t]) => [w, String(t).slice(0, 200)]);
  return ergebnis.length > 0 ? Object.fromEntries(ergebnis) : void 0;
}
const kurz = (w, laenge) => typeof w === "string" && w !== "" ? w.slice(0, laenge) : void 0;
function beschreibe(id, common, recht, sprache) {
  const felder = {
    rolle: kurz(common.role, 100),
    einheit: kurz(common.unit, 30),
    min: zahl(common.min),
    max: zahl(common.max),
    schritt: zahl(common.step),
    auswahl: auswahl(common.states)
  };
  return {
    id,
    name: text(common.name, sprache, id).slice(0, 200),
    typ: common.type && TYPEN.has(common.type) ? common.type : "mixed",
    ...Object.fromEntries(Object.entries(felder).filter(([, w]) => w !== void 0)),
    recht
  };
}
const liegtUnter = (id, praefix) => id === praefix || id.startsWith(`${praefix}.`);
const gesperrt = (id, m, sperren) => {
  var _a;
  return [id, ...(_a = m.ziele) != null ? _a : []].some((i) => sperren.some((s) => liegtUnter(i, s)));
};
class Rechtestand {
  constructor(inhalt) {
    this.inhalt = inhalt;
    this.rechte = new Map(inhalt.datenpunkte.map((d) => [d.id, d.recht]));
  }
  rechte;
  recht(id) {
    return this.rechte.get(id);
  }
  // Geräte erst ab Version 2: Eine App mit Version 1 trennt bei einem unbekannten Feld.
  inhaltFuer(version) {
    if (version >= 2) {
      return this.inhalt;
    }
    const { geraete: _, ...ohneGeraete } = this.inhalt;
    return ohneGeraete;
  }
  static leer() {
    return new Rechtestand({ profil: "", datenpunkte: [], raeume: [], funktionen: [], geraete: [] });
  }
}
function rechteFuer(profilId, quelle) {
  const profil = istKennung(profilId) ? quelle.profil(profilId) : void 0;
  return profil ? berechneRechte(profil, quelle) : Rechtestand.leer();
}
function berechneRechte(profil, quelle) {
  var _a, _b;
  const { sprache } = quelle;
  const rechte = /* @__PURE__ */ new Map();
  const objekte = /* @__PURE__ */ new Map();
  const raeume = quelle.aufzaehlungen("rooms");
  const funktionen = quelle.aufzaehlungen("functions");
  for (const { enum: raumId, recht } of profil.raeume) {
    for (const mitglied of (_b = (_a = raeume.find((r) => r.id === raumId)) == null ? void 0 : _a.mitglieder) != null ? _b : []) {
      for (const [id, common] of quelle.zustaende(mitglied)) {
        if (gesperrt(id, common, [quelle.eigeneApps])) {
          continue;
        }
        objekte.set(id, common);
        const bisher = rechte.get(id);
        if (!bisher || RANG[recht] > RANG[bisher]) {
          rechte.set(id, recht);
        }
      }
    }
  }
  for (const { id, recht } of profil.freigaben) {
    const common = quelle.zustaende(id).get(id);
    if (common) {
      objekte.set(id, common);
      rechte.set(id, recht);
    }
  }
  const datenpunkte = [];
  for (const [id, recht] of rechte) {
    const common = objekte.get(id);
    if (gesperrt(id, common, [...profil.sperren, ...FEST_GESPERRT]) || pruefeObjektId(id).length > 0) {
      continue;
    }
    datenpunkte.push(beschreibe(id, common, common.write === false ? "lesen" : recht, sprache));
  }
  datenpunkte.sort((a, b) => a.id.localeCompare(b.id));
  const gruppiere = (liste) => liste.map((a) => ({
    id: a.id,
    name: text(a.name, sprache, a.id).slice(0, 200),
    mitglieder: datenpunkte.filter((d) => a.mitglieder.some((m) => liegtUnter(d.id, m))).map((d) => d.id)
  })).filter((g) => g.mitglieder.length > 0 && pruefeObjektId(g.id).length === 0);
  return new Rechtestand({
    profil: profil.name,
    datenpunkte,
    raeume: gruppiere(raeume),
    funktionen: gruppiere(funktionen),
    geraete: geraeteAus(datenpunkte, quelle)
  });
}
function geraeteAus(datenpunkte, quelle) {
  const erlaubt = new Map(datenpunkte.map((d) => [d.id, d]));
  const vergeben = /* @__PURE__ */ new Set();
  const geraete = [];
  for (const [id, geraet] of quelle.geraete()) {
    const teile = {};
    for (const teil of TEILE) {
      const dpId = geraet.teile[teil];
      if (dpId === void 0 || vergeben.has(dpId)) {
        continue;
      }
      vergeben.add(dpId);
      const d = erlaubt.get(dpId);
      if (d && passtZuTeil(teil, d.typ, d.min, d.max)) {
        teile[teil] = dpId;
      }
    }
    if (Object.keys(teile).length > 0 && geraete.length < GERAETE_HOECHSTENS) {
      geraete.push({ id, name: geraet.name, typ: geraet.typ, teile });
    }
  }
  return geraete;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  GERAETE_HOECHSTENS,
  Rechtestand,
  TEILE,
  TEILTYP,
  alsGeraet,
  alsProfil,
  berechneRechte,
  beschreibe,
  istKennung,
  liegtUnter,
  merkmale,
  passtZuTeil,
  rechteFuer,
  text
});
//# sourceMappingURL=rechte.js.map
