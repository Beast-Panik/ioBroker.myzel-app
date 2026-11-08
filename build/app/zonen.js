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
var zonen_exports = {};
__export(zonen_exports, {
  GRUENDE: () => GRUENDE,
  RADIUS_BIS: () => RADIUS_BIS,
  RADIUS_VON: () => RADIUS_VON,
  RADIUS_VORGABE: () => RADIUS_VORGABE,
  VORSCHLAG_MS: () => VORSCHLAG_MS,
  ZONENID_LAENGE: () => ZONENID_LAENGE,
  ZONENNAME_LAENGE: () => ZONENNAME_LAENGE,
  ZONEN_HOECHSTENS: () => ZONEN_HOECHSTENS,
  ZONEN_SEIT: () => ZONEN_SEIT,
  alsZone: () => alsZone,
  grundText: () => grundText,
  handydatenFuer: () => handydatenFuer,
  istZonenId: () => istZonenId,
  liesMitte: () => liesMitte,
  zonenDerApp: () => zonenDerApp,
  zonenFuer: () => zonenFuer,
  zonenIdAus: () => zonenIdAus
});
module.exports = __toCommonJS(zonen_exports);
var import_adapter_an_app_schema = __toESM(require("../../protokoll/v1/adapter-an-app.schema.json"));
var import_gemeinsam_schema = __toESM(require("../../protokoll/v1/gemeinsam.schema.json"));
var import_schema = require("../basis/schema");
const ZONEN_SEIT = 7;
const ZONEN_HOECHSTENS = import_adapter_an_app_schema.default.$defs.rechteInhalt.properties.zonen.maxItems;
const ZONENNAME_LAENGE = import_adapter_an_app_schema.default.$defs.zone.properties.name.maxLength;
const RADIUS_VON = import_adapter_an_app_schema.default.$defs.zone.properties.radius.minimum;
const RADIUS_BIS = import_adapter_an_app_schema.default.$defs.zone.properties.radius.maximum;
const RADIUS_VORGABE = 300;
const ZONENID_LAENGE = 30;
const VORSCHLAG_MS = 15 * 6e4;
const GRUENDE = {
  standort_aus: { de: "Standort am Handy aus", en: "Location switched off on the phone" },
  berechtigung: { de: "Standort f\xFCr die App nicht erlaubt", en: "Location not allowed for the app" },
  ungefaehr: { de: "Nur ungef\xE4hrer Standort erlaubt", en: "Only approximate location allowed" },
  hintergrund: { de: "Standort im Hintergrund nicht erlaubt", en: "Location in the background not allowed" },
  energiesparen: {
    de: "Vom Energiesparen des Handys eingeschr\xE4nkt",
    en: "Restricted by the battery saving of the phone"
  },
  keine_standorte: { de: "Seit L\xE4ngerem keine Standorte", en: "No locations for a long time" },
  aus: { de: "In der App ausgeschaltet", en: "Switched off in the app" },
  admin: { de: "Im Admin ausgeschaltet", en: "Switched off in the admin" },
  entfernt: { de: "App im Admin entfernt", en: "App removed in the admin" },
  veraltet: {
    de: "Die App kennt keine Zonen, bitte aktualisieren",
    en: "The app does not know zones, please update"
  }
};
const grundText = (grund, sprache) => sprache === "de" ? GRUENDE[grund].de : GRUENDE[grund].en;
const { id: _id, ...zonenfelder } = import_adapter_an_app_schema.default.$defs.zone.properties;
const pruefeZone = (0, import_schema.erstellePruefer)(
  {
    type: "object",
    additionalProperties: false,
    required: ["name", "breite", "laenge", "radius"],
    properties: zonenfelder
  },
  [import_gemeinsam_schema.default]
);
function alsZone(native) {
  const fehler = pruefeZone(native);
  return fehler.length > 0 ? fehler : native;
}
const pruefeZonenId = (0, import_schema.erstellePruefer)({ $ref: `${import_gemeinsam_schema.default.$id}#/$defs/zonenId` }, [import_gemeinsam_schema.default]);
const istZonenId = (id) => pruefeZonenId(id).length === 0;
function liesMitte(text) {
  if (typeof text !== "string") {
    return void 0;
  }
  const teile = text.trim().split(/\s*[,;]\s*|\s+/).filter((t) => t !== "");
  if (teile.length !== 2 || !teile.every((t) => /^[+-]?\d{1,3}(\.\d+)?$/.test(t))) {
    return void 0;
  }
  const [breite, laenge] = teile.map(Number);
  if (Math.abs(breite) > 90 || Math.abs(laenge) > 180) {
    return void 0;
  }
  const runde = (w) => Math.round(w * 1e6) / 1e6;
  return { breite: runde(breite), laenge: runde(laenge) };
}
function zonenIdAus(name) {
  const id = name.toLowerCase().replaceAll("\xE4", "ae").replaceAll("\xF6", "oe").replaceAll("\xFC", "ue").replaceAll("\xDF", "ss").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^[^a-z]+/, "").slice(0, ZONENID_LAENGE).replace(/_+$/, "");
  return id;
}
function handydatenFuer(h, version) {
  const alt = { akku: h.akku, anruf: h.anruf, benachrichtigung: h.benachrichtigung };
  return version >= ZONEN_SEIT ? { ...alt, zonen: h.zonen === true, standort: h.standort === true } : alt;
}
function zonenDerApp(daten, alle) {
  var _a;
  if (daten.handydaten.zonen !== true) {
    return [];
  }
  const wahl = new Set((_a = daten.zonenwahl) != null ? _a : []);
  return alle.filter(([id]) => wahl.has(id)).slice(0, ZONEN_HOECHSTENS).map(([id, z]) => ({ id, ...z }));
}
function zonenFuer(daten, alle, version) {
  return version >= ZONEN_SEIT ? { zonen: zonenDerApp(daten, alle) } : {};
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  GRUENDE,
  RADIUS_BIS,
  RADIUS_VON,
  RADIUS_VORGABE,
  VORSCHLAG_MS,
  ZONENID_LAENGE,
  ZONENNAME_LAENGE,
  ZONEN_HOECHSTENS,
  ZONEN_SEIT,
  alsZone,
  grundText,
  handydatenFuer,
  istZonenId,
  liesMitte,
  zonenDerApp,
  zonenFuer,
  zonenIdAus
});
//# sourceMappingURL=zonen.js.map
