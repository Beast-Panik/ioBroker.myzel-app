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
var kodierung_exports = {};
__export(kodierung_exports, {
  base32: () => base32,
  neueAdapterId: () => neueAdapterId,
  neueAppId: () => neueAppId,
  neueHinweisId: () => neueHinweisId,
  neuerZugang: () => neuerZugang,
  neuesGeheimnis: () => neuesGeheimnis,
  passtZuHash: () => passtZuHash,
  sha256: () => sha256
});
module.exports = __toCommonJS(kodierung_exports);
var import_node_crypto = require("node:crypto");
const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";
function base32(daten) {
  let ergebnis = "";
  let puffer = 0;
  let bits = 0;
  for (const byte of daten) {
    puffer = puffer << 8 | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      ergebnis += BASE32[puffer >>> bits & 31];
    }
  }
  if (bits > 0) {
    ergebnis += BASE32[puffer << 5 - bits & 31];
  }
  return ergebnis;
}
function sha256(text) {
  return (0, import_node_crypto.createHash)("sha256").update(text, "utf8").digest();
}
function passtZuHash(gegeben, erwartetHash) {
  return erwartetHash.length === 32 && (0, import_node_crypto.timingSafeEqual)(sha256(gegeben), erwartetHash);
}
const neueAdapterId = () => base32((0, import_node_crypto.randomBytes)(16));
const neueAppId = () => base32((0, import_node_crypto.randomBytes)(5));
const neuerZugang = () => (0, import_node_crypto.randomBytes)(32).toString("base64url");
const neuesGeheimnis = () => (0, import_node_crypto.randomBytes)(16).toString("base64url");
const neueHinweisId = () => (0, import_node_crypto.randomBytes)(6).toString("base64url");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  base32,
  neueAdapterId,
  neueAppId,
  neueHinweisId,
  neuerZugang,
  neuesGeheimnis,
  passtZuHash,
  sha256
});
//# sourceMappingURL=kodierung.js.map
