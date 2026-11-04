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
var schema_exports = {};
__export(schema_exports, {
  Nachrichtenpruefer: () => Nachrichtenpruefer,
  erstellePruefer: () => erstellePruefer,
  nummerAus: () => nummerAus
});
module.exports = __toCommonJS(schema_exports);
var import__ = __toESM(require("ajv/dist/2020"));
var import_grenzen = require("./grenzen");
function texte(fehler) {
  return (fehler != null ? fehler : []).map((f) => {
    var _a;
    return `${f.instancePath || "/"} ${(_a = f.message) != null ? _a : "ung\xFCltig"}`;
  });
}
function neuesAjv(bausteine) {
  const ajv = new import__.default({ strict: true });
  for (const b of bausteine) {
    ajv.addSchema(b);
  }
  return ajv;
}
function erstellePruefer(schema, bausteine = []) {
  const pruefe = neuesAjv(bausteine).compile(schema);
  return (daten) => pruefe(daten) ? [] : texte(pruefe.errors);
}
function nummerAus(daten) {
  let o = daten;
  if (typeof o === "string") {
    try {
      o = JSON.parse(o);
    } catch {
      return void 0;
    }
  }
  const n = o == null ? void 0 : o.n;
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 2 ** 31 - 1 ? n : void 0;
}
class Nachrichtenpruefer {
  constructor(richtung, bausteine, versionen, grenzen = import_grenzen.GRENZEN) {
    this.versionen = versionen;
    this.grenzen = grenzen;
    var _a, _b;
    const ajv = neuesAjv([...bausteine, richtung]);
    for (const { $ref } of richtung.oneOf) {
      const name = (_a = /^#\/\$defs\/(\w+)$/.exec($ref)) == null ? void 0 : _a[1];
      const felder = name ? richtung.$defs[name].properties : void 0;
      const typ = (_b = felder == null ? void 0 : felder.t) == null ? void 0 : _b.const;
      const pruefe = ajv.getSchema(`${richtung.$id}${$ref}`);
      if (typeof typ !== "string" || !pruefe) {
        throw new Error(`Schema ${richtung.$id}: Verweis ${$ref} ist kein Nachrichtentyp`);
      }
      this.typen.set(typ, pruefe);
      if (felder == null ? void 0 : felder.v) {
        this.mitVersion.add(typ);
      }
    }
  }
  typen = /* @__PURE__ */ new Map();
  mitVersion = /* @__PURE__ */ new Set();
  pruefe(daten) {
    const t = daten == null ? void 0 : daten.t;
    if (typeof t !== "string") {
      return ["/t fehlt oder ist keine Zeichenkette"];
    }
    const pruefe = this.typen.get(t);
    if (!pruefe) {
      return ["/t unbekannter Nachrichtentyp"];
    }
    return pruefe(daten) ? [] : texte(pruefe.errors);
  }
  lies(text, jetzt) {
    if (text === void 0) {
      return { art: "ungueltig", grund: "Bin\xE4rframe statt Text" };
    }
    let daten;
    try {
      daten = JSON.parse(text);
    } catch {
      return { art: "ungueltig", grund: "kein JSON" };
    }
    if (typeof daten !== "object" || daten === null || Array.isArray(daten)) {
      return { art: "ungueltig", grund: "kein JSON-Objekt" };
    }
    const o = daten;
    const n = nummerAus(o);
    if (typeof o.t === "string" && this.mitVersion.has(o.t) && Number.isInteger(o.v) && !this.versionen.includes(o.v)) {
      return { art: "version", v: o.v };
    }
    const fehler = this.pruefe(o);
    if (fehler.length > 0) {
      return { art: "ungueltig", grund: fehler.join("; "), n };
    }
    if (typeof o.zeit === "number" && o.zeit > jetzt + this.grenzen.zukunftMs) {
      return { art: "ungueltig", grund: "/zeit liegt zu weit in der Zukunft", n };
    }
    return { art: "nachricht", nachricht: o };
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Nachrichtenpruefer,
  erstellePruefer,
  nummerAus
});
//# sourceMappingURL=schema.js.map
