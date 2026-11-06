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
var fernschluessel_exports = {};
__export(fernschluessel_exports, {
  adapterSchluessel: () => adapterSchluessel,
  appSchluessel: () => appSchluessel,
  konfigurationszeile: () => konfigurationszeile,
  neuesFerngeheimnis: () => neuesFerngeheimnis,
  vermittlerHash: () => vermittlerHash
});
module.exports = __toCommonJS(fernschluessel_exports);
var import_node_crypto = require("node:crypto");
var import_kodierung = require("./kodierung");
const neuesFerngeheimnis = () => (0, import_node_crypto.randomBytes)(32).toString("base64url");
const abgeleitet = (geheimnis, wofuer) => (0, import_node_crypto.createHmac)("sha256", Buffer.from(geheimnis, "base64url")).update(wofuer, "utf8").digest("base64url");
const adapterSchluessel = (geheimnis) => abgeleitet(geheimnis, "adapter");
const appSchluessel = (geheimnis, appId, zugangHash) => abgeleitet(geheimnis, `app ${appId} ${zugangHash}`);
const vermittlerHash = (schluessel) => (0, import_kodierung.sha256)(schluessel).toString("hex");
const konfigurationszeile = (adapterId, geheimnis) => `adapter ${adapterId} ${vermittlerHash(adapterSchluessel(geheimnis))}`;
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  adapterSchluessel,
  appSchluessel,
  konfigurationszeile,
  neuesFerngeheimnis,
  vermittlerHash
});
//# sourceMappingURL=fernschluessel.js.map
