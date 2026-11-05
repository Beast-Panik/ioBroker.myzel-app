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
  BEZEICHNUNG_LAENGE: () => BEZEICHNUNG_LAENGE,
  KARTENARTEN: () => KARTENARTEN,
  KARTENTYPEN: () => KARTENTYPEN,
  KARTEN_HOECHSTENS: () => KARTEN_HOECHSTENS,
  NAME_LAENGE: () => NAME_LAENGE,
  PROFILNAME_LAENGE: () => PROFILNAME_LAENGE,
  Rechtestand: () => Rechtestand,
  alsKarte: () => alsKarte,
  alsProfil: () => alsProfil,
  berechneRechte: () => berechneRechte,
  bereich: () => bereich,
  istKennung: () => istKennung,
  istPersoenlich: () => istPersoenlich,
  kartenmaengel: () => kartenmaengel,
  liegtUnter: () => liegtUnter,
  maengelDerKarte: () => maengelDerKarte,
  merkmale: () => merkmale,
  rechteFuer: () => rechteFuer,
  sicht: () => sicht,
  text: () => text
});
module.exports = __toCommonJS(rechte_exports);
var import_adapter_an_app_schema = __toESM(require("../../protokoll/v1/adapter-an-app.schema.json"));
var import_gemeinsam_schema = __toESM(require("../../protokoll/v1/gemeinsam.schema.json"));
var import_schema = require("../basis/schema");
const AN_AUS = { typen: ["boolean"], bedienbar: true };
const ANZEIGE = { typen: ["number", "string", "boolean"], bedienbar: false };
const KARTENARTEN = {
  lampe: {
    teile: {
      schalten: AN_AUS,
      helligkeit: { typen: ["number"], bedienbar: true, bereich: { min: 0, max: 100 } },
      farbe: { typen: ["string"], bedienbar: true },
      farbtemperatur: { typen: ["number"], bedienbar: true, bereich: "pflicht" }
    },
    pflicht: []
  },
  schalter: { teile: { schalten: AN_AUS }, pflicht: ["schalten"] },
  messwert: {
    teile: { wert1: ANZEIGE, wert2: ANZEIGE, wert3: ANZEIGE, wert4: ANZEIGE },
    pflicht: [],
    bezeichnungen: true
  },
  thermostat: {
    teile: {
      soll: { typen: ["number"], bedienbar: true, bereich: { min: 5, max: 30 }, schritt: 0.5 },
      ist: { typen: ["number"], bedienbar: false }
    },
    pflicht: ["soll"]
  }
};
const KARTENTYPEN = Object.keys(KARTENARTEN);
const KARTEN_HOECHSTENS = import_adapter_an_app_schema.default.$defs.rechteInhalt.properties.karten.maxItems;
const NAME_LAENGE = 200;
const BEZEICHNUNG_LAENGE = 60;
const PROFILNAME_LAENGE = 60;
const MERKMALE = ["name", "type", "unit", "min", "max", "step", "states", "write"];
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
const RANG = { lesen: 1, schreiben: 2 };
const FEST_GESPERRT = ["system"];
const hoeher = (a, b) => a && RANG[a] >= RANG[b] ? a : b;
const pruefeObjektId = (0, import_schema.erstellePruefer)({ $ref: `${import_gemeinsam_schema.default.$id}#/$defs/objektId` }, [import_gemeinsam_schema.default]);
const kennung = { $ref: `${import_gemeinsam_schema.default.$id}#/$defs/kennung` };
const rechtwahl = { enum: ["lesen", "schreiben"] };
const pruefeProfil = (0, import_schema.erstellePruefer)(
  {
    type: "object",
    required: ["name", "raeume", "karten", "gesperrt"],
    properties: {
      name: { type: "string", minLength: 1, maxLength: PROFILNAME_LAENGE },
      raeume: {
        type: "array",
        items: {
          type: "object",
          required: ["enum", "recht"],
          properties: { enum: { type: "string", pattern: "^enum\\.rooms\\." }, recht: rechtwahl }
        }
      },
      karten: {
        type: "array",
        items: { type: "object", required: ["id", "recht"], properties: { id: kennung, recht: rechtwahl } }
      },
      gesperrt: { type: "array", items: kennung }
    }
  },
  [import_gemeinsam_schema.default]
);
function alsProfil(native) {
  const fehler = pruefeProfil(native);
  return fehler.length > 0 ? fehler : native;
}
const pruefeKarte = (0, import_schema.erstellePruefer)(
  {
    type: "object",
    required: ["name", "typ", "raum", "teile"],
    properties: {
      name: { type: "string", minLength: 1, maxLength: NAME_LAENGE },
      typ: { enum: KARTENTYPEN },
      raum: {
        anyOf: [
          { const: "" },
          {
            allOf: [
              { $ref: `${import_gemeinsam_schema.default.$id}#/$defs/objektId` },
              { type: "string", pattern: "^enum\\.rooms\\." }
            ]
          }
        ]
      }
    },
    oneOf: KARTENTYPEN.map((typ) => {
      const art = KARTENARTEN[typ];
      const je = (schema) => Object.fromEntries(Object.keys(art.teile).map((teil) => [teil, schema]));
      return {
        type: "object",
        properties: {
          typ: { const: typ },
          teile: {
            type: "object",
            additionalProperties: false,
            minProperties: 1,
            required: art.pflicht,
            properties: je({ $ref: `${import_gemeinsam_schema.default.$id}#/$defs/objektId` })
          },
          bezeichnungen: art.bezeichnungen ? {
            type: "object",
            additionalProperties: false,
            properties: je({ type: "string", maxLength: BEZEICHNUNG_LAENGE })
          } : false
        }
      };
    })
  },
  [import_gemeinsam_schema.default]
);
function alsKarte(native) {
  const fehler = pruefeKarte(native);
  return fehler.length > 0 ? fehler : native;
}
const pruefeKennung = (0, import_schema.erstellePruefer)(kennung, [import_gemeinsam_schema.default]);
const istKennung = (id) => pruefeKennung(id).length === 0;
const zahl = (w) => typeof w === "number" && Number.isFinite(w) ? w : void 0;
function bereich(art, m) {
  var _a, _b, _c;
  if (!art.bereich) {
    return void 0;
  }
  const vorgabe = art.bereich === "pflicht" ? void 0 : art.bereich;
  const min = (_a = zahl(m.min)) != null ? _a : vorgabe == null ? void 0 : vorgabe.min;
  const max = (_b = zahl(m.max)) != null ? _b : vorgabe == null ? void 0 : vorgabe.max;
  if (min === void 0 || max === void 0 || min >= max) {
    return void 0;
  }
  const eigener = zahl(m.step);
  const schritt = eigener !== void 0 && eigener > 0 ? eigener : (_c = art.schritt) != null ? _c : max - min >= 10 ? 1 : void 0;
  return { min, max, ...schritt !== void 0 ? { schritt } : {} };
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
function beschreibe(id, m, art, recht, name) {
  const regler = bereich(art, m);
  const felder = {
    einheit: kurz(m.unit, 30),
    min: regler == null ? void 0 : regler.min,
    max: regler == null ? void 0 : regler.max,
    schritt: regler == null ? void 0 : regler.schritt,
    // Text zu einem Wert braucht nur, was angezeigt wird
    auswahl: art.bedienbar ? void 0 : auswahl(m.states),
    name: name == null ? void 0 : name.slice(0, NAME_LAENGE)
  };
  return {
    id,
    typ: m.type,
    ...Object.fromEntries(Object.entries(felder).filter(([, w]) => w !== void 0)),
    recht
  };
}
const liegtUnter = (id, praefix) => id === praefix || id.startsWith(`${praefix}.`);
const betrifft = (id, m, praefixe) => {
  var _a;
  return [id, ...(_a = m == null ? void 0 : m.ziele) != null ? _a : []].some((i) => praefixe.some((p) => liegtUnter(i, p)));
};
function teilmangel(dp, m, art) {
  if (pruefeObjektId(dp).length > 0) {
    return { art: "id" };
  }
  if (!m) {
    return { art: "fehlt" };
  }
  if (betrifft(dp, m, FEST_GESPERRT)) {
    return { art: "system" };
  }
  if (!art.typen.includes(m.type)) {
    return { art: "typ", ist: String(m.type), erwartet: art.typen };
  }
  if (art.bereich && bereich(art, m) === void 0) {
    return { art: "bereich" };
  }
  return void 0;
}
function mangeltext(m) {
  switch (m.art) {
    case "id":
      return "ID ung\xFCltig";
    case "fehlt":
      return "Datenpunkt fehlt";
    case "system":
      return "unter system, nie freigegeben";
    case "typ":
      return `Typ ${m.ist} statt ${m.erwartet.join(" oder ")}`;
    case "bereich":
      return "min und max fehlen oder passen nicht";
  }
}
function maengelDerKarte(karte, datenpunkt) {
  const art = KARTENARTEN[karte.typ];
  const teile = {};
  for (const [teil, dp] of Object.entries(karte.teile)) {
    const mangel = teilmangel(dp, datenpunkt(dp), art.teile[teil]);
    if (mangel) {
      teile[teil] = mangel;
    }
  }
  const bleiben = Object.keys(karte.teile).filter((teil) => !teile[teil]);
  const folge = bleiben.length === 0 || art.pflicht.some((p) => !bleiben.includes(p)) ? "fehlt" : bleiben.length < Object.keys(karte.teile).length ? "teilweise" : void 0;
  return { teile, ...folge ? { folge } : {} };
}
function kartenmaengel(quelle) {
  const maengel = [];
  for (const [id, karte] of quelle.karten()) {
    const { teile, folge } = maengelDerKarte(karte, (dp) => quelle.datenpunkt(dp));
    if (!folge) {
      continue;
    }
    const liste = Object.entries(teile).map(([teil, m]) => `${teil} ${karte.teile[teil]}: ${mangeltext(m)}`).join("; ");
    const satz = folge === "fehlt" ? "fehlt auf den Handys" : "zeigt nicht alle Teile";
    maengel.push(`Karte \u201E${karte.name}\u201C (${id}) ${satz}: ${liste}`);
  }
  return maengel;
}
class Rechtestand {
  constructor(inhalt) {
    this.inhalt = inhalt;
    for (const karte of inhalt.karten) {
      for (const t of Object.values(karte.teile)) {
        this.rechte.set(t.id, hoeher(this.rechte.get(t.id), t.recht));
      }
    }
  }
  rechte = /* @__PURE__ */ new Map();
  recht(id) {
    return this.rechte.get(id);
  }
  get anzahlDatenpunkte() {
    return this.rechte.size;
  }
  static leer() {
    return new Rechtestand({ profil: "", raeume: [], karten: [] });
  }
}
const istPersoenlich = (karte, quelle) => Object.values(karte.teile).some((dp) => betrifft(dp, quelle.datenpunkt(dp), [quelle.eigeneApps]));
function sicht(profil, quelle) {
  return Object.fromEntries(
    berechneRechte(profil, quelle).inhalt.karten.map((k) => [
      k.id,
      Object.values(k.teile).some((t) => t.recht === "schreiben") ? "schreiben" : "lesen"
    ])
  );
}
function rechteFuer(profilId, quelle) {
  const profil = istKennung(profilId) ? quelle.profil(profilId) : void 0;
  return profil ? berechneRechte(profil, quelle) : Rechtestand.leer();
}
function berechneRechte(profil, quelle) {
  var _a;
  const raumrecht = /* @__PURE__ */ new Map();
  profil.raeume.forEach((r) => raumrecht.set(r.enum, hoeher(raumrecht.get(r.enum), r.recht)));
  const einzeln = /* @__PURE__ */ new Map();
  profil.karten.forEach((k) => einzeln.set(k.id, hoeher(einzeln.get(k.id), k.recht)));
  const gesperrt = new Set(profil.gesperrt);
  const raeume = new Map(quelle.raeume().map((r) => [r.id, r]));
  const karten = [];
  for (const [id, karte] of quelle.karten()) {
    if (karten.length >= KARTEN_HOECHSTENS) {
      break;
    }
    if (gesperrt.has(id)) {
      continue;
    }
    const raum = raeume.has(karte.raum) ? karte.raum : void 0;
    const recht = (_a = einzeln.get(id)) != null ? _a : raum && !istPersoenlich(karte, quelle) ? raumrecht.get(raum) : void 0;
    const eintrag = recht && kartenEintrag(id, karte, recht, raum, quelle);
    if (eintrag) {
      karten.push(eintrag);
    }
  }
  const sichtbar = new Set(karten.map((k) => k.raum));
  return new Rechtestand({
    profil: profil.name,
    raeume: [...raeume.values()].filter((r) => sichtbar.has(r.id) && pruefeObjektId(r.id).length === 0).map((r) => ({ id: r.id, name: text(r.name, quelle.sprache, r.id).slice(0, NAME_LAENGE) })),
    karten
  });
}
function kartenEintrag(id, karte, recht, raum, quelle) {
  var _a;
  const art = KARTENARTEN[karte.typ];
  const teile = {};
  for (const [teil, teilart] of Object.entries(art.teile)) {
    const dp = karte.teile[teil];
    const m = dp === void 0 ? void 0 : quelle.datenpunkt(dp);
    if (dp === void 0 || !m || teilmangel(dp, m, teilart) !== void 0) {
      continue;
    }
    const teilrecht = recht === "schreiben" && teilart.bedienbar && m.write !== false ? "schreiben" : "lesen";
    const name = art.bezeichnungen ? ((_a = karte.bezeichnungen) == null ? void 0 : _a[teil]) || text(m.name, quelle.sprache, dp) : void 0;
    teile[teil] = beschreibe(dp, m, teilart, teilrecht, name);
  }
  if (Object.keys(teile).length === 0 || art.pflicht.some((p) => !teile[p])) {
    return void 0;
  }
  return { id, name: karte.name.slice(0, NAME_LAENGE), typ: karte.typ, ...raum ? { raum } : {}, teile };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  BEZEICHNUNG_LAENGE,
  KARTENARTEN,
  KARTENTYPEN,
  KARTEN_HOECHSTENS,
  NAME_LAENGE,
  PROFILNAME_LAENGE,
  Rechtestand,
  alsKarte,
  alsProfil,
  berechneRechte,
  bereich,
  istKennung,
  istPersoenlich,
  kartenmaengel,
  liegtUnter,
  maengelDerKarte,
  merkmale,
  rechteFuer,
  sicht,
  text
});
//# sourceMappingURL=rechte.js.map
