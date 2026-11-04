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
var zertifikat_exports = {};
__export(zertifikat_exports, {
  erzeugeIdentitaet: () => erzeugeIdentitaet,
  fingerabdruck: () => fingerabdruck,
  pruefeIdentitaet: () => pruefeIdentitaet,
  zertifikatsname: () => zertifikatsname
});
module.exports = __toCommonJS(zertifikat_exports);
var import_node_crypto = require("node:crypto");
const GUELTIG_JAHRE = 20;
const OID_ECDSA_SHA256 = "1.2.840.10045.4.3.2";
const OID_CN = "2.5.4.3";
function laenge(n) {
  if (n < 128) {
    return Buffer.from([n]);
  }
  const bytes = [];
  for (let r = n; r > 0; r >>= 8) {
    bytes.unshift(r & 255);
  }
  return Buffer.from([128 | bytes.length, ...bytes]);
}
const tlv = (tag, inhalt) => Buffer.concat([Buffer.from([tag]), laenge(inhalt.length), inhalt]);
const folge = (...teile) => tlv(48, Buffer.concat(teile));
const menge = (...teile) => tlv(49, Buffer.concat(teile));
const explizit = (nr, inhalt) => tlv(160 | nr, inhalt);
const bitfolge = (b) => tlv(3, Buffer.concat([Buffer.from([0]), b]));
const utf8 = (s) => tlv(12, Buffer.from(s, "utf8"));
function ganzzahl(bytes) {
  let b = bytes;
  while (b.length > 1 && b[0] === 0 && b[1] < 128) {
    b = b.subarray(1);
  }
  if (b[0] >= 128) {
    b = Buffer.concat([Buffer.from([0]), b]);
  }
  return tlv(2, b);
}
function oid(text) {
  const t = text.split(".").map(Number);
  const bytes = [40 * t[0] + t[1]];
  for (const z of t.slice(2)) {
    const teil = [z & 127];
    for (let r = z >> 7; r > 0; r >>= 7) {
      teil.unshift(r & 127 | 128);
    }
    bytes.push(...teil);
  }
  return tlv(6, Buffer.from(bytes));
}
function zeit(d) {
  const iso = d.toISOString().replace(/[-:T]/g, "").slice(0, 14);
  return tlv(24, Buffer.from(`${iso}Z`, "ascii"));
}
const zertifikatsname = (adapterId) => `myzel-app ${adapterId}`;
function erzeugeIdentitaet(adapterId, jetzt = /* @__PURE__ */ new Date()) {
  var _a;
  const { privateKey, publicKey } = (0, import_node_crypto.generateKeyPairSync)("ec", { namedCurve: "P-256" });
  const algorithmus = folge(oid(OID_ECDSA_SHA256));
  const name = folge(menge(folge(oid(OID_CN), utf8(zertifikatsname(adapterId)))));
  const ende = new Date(jetzt);
  ende.setUTCFullYear(ende.getUTCFullYear() + GUELTIG_JAHRE);
  const inhalt = folge(
    explizit(0, ganzzahl(Buffer.from([2]))),
    ganzzahl((0, import_node_crypto.randomBytes)(16)),
    algorithmus,
    name,
    folge(zeit(jetzt), zeit(ende)),
    name,
    publicKey.export({ type: "spki", format: "der" })
  );
  const der = folge(inhalt, algorithmus, bitfolge((0, import_node_crypto.sign)("sha256", inhalt, privateKey)));
  const zeilen = (_a = der.toString("base64").match(/.{1,64}/g)) != null ? _a : [];
  return {
    zertifikat: `-----BEGIN CERTIFICATE-----
${zeilen.join("\n")}
-----END CERTIFICATE-----
`,
    schluessel: privateKey.export({ type: "pkcs8", format: "pem" }).toString()
  };
}
function fingerabdruck(zertifikat) {
  return (0, import_node_crypto.createHash)("sha256").update(new import_node_crypto.X509Certificate(zertifikat).raw).digest("base64url");
}
function pruefeIdentitaet(adapterId, identitaet) {
  var _a;
  let zertifikat;
  try {
    zertifikat = new import_node_crypto.X509Certificate(identitaet.zertifikat);
  } catch {
    return "Zertifikat nicht lesbar";
  }
  let schluessel;
  try {
    schluessel = (0, import_node_crypto.createPrivateKey)(identitaet.schluessel);
  } catch {
    return "Schl\xFCssel nicht lesbar";
  }
  if (schluessel.asymmetricKeyType !== "ec" || ((_a = schluessel.asymmetricKeyDetails) == null ? void 0 : _a.namedCurve) !== "prime256v1") {
    return "Schl\xFCssel ist kein ECDSA P-256";
  }
  if (!zertifikat.checkPrivateKey(schluessel)) {
    return "Schl\xFCssel passt nicht zum Zertifikat";
  }
  if (zertifikat.subject !== `CN=${zertifikatsname(adapterId)}`) {
    return "Zertifikat geh\xF6rt zu einer anderen Adapter-ID";
  }
  return void 0;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  erzeugeIdentitaet,
  fingerabdruck,
  pruefeIdentitaet,
  zertifikatsname
});
//# sourceMappingURL=zertifikat.js.map
