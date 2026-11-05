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
var einstellungen_exports = {};
__export(einstellungen_exports, {
  pruefeEinstellungen: () => pruefeEinstellungen
});
module.exports = __toCommonJS(einstellungen_exports);
var import_gemeinsam_schema = __toESM(require("../protokoll/v1/gemeinsam.schema.json"));
var import_schema = require("./basis/schema");
const schema = {
  type: "object",
  required: ["port", "adressen", "nachlaufMin", "hinweisFristMin", "textLaenge"],
  properties: {
    port: { type: "integer", minimum: 1024, maximum: 65535 },
    adressen: {
      type: "array",
      maxItems: 4,
      uniqueItems: true,
      items: { $ref: `${import_gemeinsam_schema.default.$id}#/$defs/adresse` }
    },
    nachlaufMin: { type: "integer", minimum: 1, maximum: 120 },
    hinweisFristMin: { type: "integer", minimum: 1, maximum: 1440 },
    textLaenge: { type: "integer", minimum: 100, maximum: 4e3 },
    // Einzeln geprüft in app/konfiguration.ts: Eine unbrauchbare Karte soll nicht den ganzen Server aufhalten.
    karten: { type: "array" },
    profile: { type: "array" }
  }
};
const pruefeEinstellungen = (0, import_schema.erstellePruefer)(schema, [import_gemeinsam_schema.default]);
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  pruefeEinstellungen
});
//# sourceMappingURL=einstellungen.js.map
