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
var konfiguration_exports = {};
__export(konfiguration_exports, {
  bezeichnungsfeld: () => bezeichnungsfeld,
  karteAusZeile: () => karteAusZeile,
  lies: () => lies,
  profilAusZeile: () => profilAusZeile
});
module.exports = __toCommonJS(konfiguration_exports);
var import_rechte = require("./rechte");
const bezeichnungsfeld = (teil) => teil.replace(/^wert/, "bezeichnung");
const eintrag = (w) => typeof w === "string" ? w.trim() : "";
const liste = (w) => Array.isArray(w) ? w.map(eintrag).filter(Boolean) : [];
const zeilen = (w) => Array.isArray(w) ? w.filter((z) => !!z && typeof z === "object" && !Array.isArray(z)) : [];
function karteAusZeile(z) {
  const typ = z.typ;
  if (!import_rechte.KARTENTYPEN.includes(typ)) {
    return [`Typ ${String(z.typ)} unbekannt`];
  }
  const art = import_rechte.KARTENARTEN[typ];
  const teile = {};
  const bezeichnungen = {};
  for (const teil of Object.keys(art.teile)) {
    const dp = eintrag(z[teil]);
    if (!dp) {
      continue;
    }
    teile[teil] = dp;
    const bezeichnung = art.bezeichnungen ? eintrag(z[bezeichnungsfeld(teil)]) : "";
    if (bezeichnung) {
      bezeichnungen[teil] = bezeichnung;
    }
  }
  return (0, import_rechte.alsKarte)({
    name: eintrag(z.name),
    typ,
    raum: eintrag(z.raum),
    teile,
    ...Object.keys(bezeichnungen).length > 0 ? { bezeichnungen } : {}
  });
}
const mitRecht = (schreiben, lesen) => [
  ...schreiben.map((id) => [id, "schreiben"]),
  ...lesen.filter((id) => !schreiben.includes(id)).map((id) => [id, "lesen"])
];
function profilAusZeile(z) {
  return (0, import_rechte.alsProfil)({
    name: eintrag(z.name),
    raeume: mitRecht(liste(z.raeumeSchreiben), liste(z.raeumeLesen)).map(([id, recht]) => ({ enum: id, recht })),
    karten: mitRecht(liste(z.kartenSchreiben), liste(z.kartenLesen)).map(([id, recht]) => ({ id, recht })),
    gesperrt: liste(z.gesperrt)
  });
}
function lies(roh, was, folge, umwandeln, log) {
  const ergebnis = /* @__PURE__ */ new Map();
  for (const z of zeilen(roh)) {
    const id = eintrag(z.id);
    const name = eintrag(z.name) || id || "?";
    const wert = !(0, import_rechte.istKennung)(id) ? ["ID erlaubt nur a bis z, 0 bis 9 und _"] : ergebnis.has(id) ? [`ID ${id} doppelt`] : umwandeln(z);
    if (Array.isArray(wert)) {
      log.warn(`${was} \u201E${name}\u201C ist unbrauchbar und ${folge}: ${wert.join("; ")}. Zeile: ${JSON.stringify(z)}`);
      continue;
    }
    ergebnis.set(id, wert);
  }
  return ergebnis;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  bezeichnungsfeld,
  karteAusZeile,
  lies,
  profilAusZeile
});
//# sourceMappingURL=konfiguration.js.map
