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
  kartenoptionen: () => kartenoptionen,
  liesKonfiguration: () => liesKonfiguration,
  nachRaeumen: () => nachRaeumen,
  profilAusZeile: () => profilAusZeile,
  raumoptionen: () => raumoptionen,
  zeileAusKarte: () => zeileAusKarte,
  zeileAusProfil: () => zeileAusProfil
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
function zeileAusKarte(id, karte) {
  var _a;
  return {
    id,
    name: karte.name,
    typ: karte.typ,
    raum: karte.raum,
    ...karte.teile,
    ...Object.fromEntries(
      Object.entries((_a = karte.bezeichnungen) != null ? _a : {}).map(([teil, b]) => [bezeichnungsfeld(teil), b])
    )
  };
}
function zeileAusProfil(id, profil) {
  const raeume = (recht) => profil.raeume.filter((r) => r.recht === recht).map((r) => r.enum);
  const karten = (recht) => profil.karten.filter((k) => k.recht === recht).map((k) => k.id);
  return {
    id,
    name: profil.name,
    raeumeSchreiben: raeume("schreiben"),
    raeumeLesen: raeume("lesen"),
    kartenSchreiben: karten("schreiben"),
    kartenLesen: karten("lesen"),
    gesperrt: [...profil.gesperrt]
  };
}
function lies(roh, was, folge, umwandeln, log, hoechstens = Infinity) {
  const ergebnis = /* @__PURE__ */ new Map();
  for (const z of zeilen(roh)) {
    const id = eintrag(z.id);
    const name = eintrag(z.name) || id || "?";
    const wert = !(0, import_rechte.istKennung)(id) ? ["ID erlaubt nur a bis z, 0 bis 9 und _"] : ergebnis.has(id) ? [`ID ${id} doppelt`] : ergebnis.size >= hoechstens ? [`mehr als ${hoechstens}`] : umwandeln(z);
    if (Array.isArray(wert)) {
      log.warn(`${was} \u201E${name}\u201C ist unbrauchbar und ${folge}: ${wert.join("; ")}`);
      continue;
    }
    ergebnis.set(id, wert);
  }
  return ergebnis;
}
function liesKonfiguration(native, log) {
  return {
    karten: lies(native.karten, "Karte", "fehlt auf den Handys", karteAusZeile, log, import_rechte.KARTEN_HOECHSTENS),
    profile: lies(native.profile, "Profil", "gibt keine Rechte", profilAusZeile, log)
  };
}
const SPRACHEN = ["en", "de"];
const je = (f) => Object.fromEntries(SPRACHEN.map((s) => [s, f(s)]));
const nachText = (a, b) => a.label.en.localeCompare(b.label.en);
const TYPNAMEN = {
  lampe: { en: "Lamp", de: "Lampe" },
  schalter: { en: "Switch", de: "Schalter" },
  messwert: { en: "Measurement", de: "Messwert" },
  thermostat: { en: "Thermostat", de: "Thermostat" }
};
const OHNE_RAUM = { en: "no room", de: "ohne Raum" };
function raumoptionen(raeume) {
  return raeume.map((r) => ({ value: r.id, label: je((s) => (0, import_rechte.text)(r.name, s, r.id)) })).sort(nachText);
}
function kartenoptionen(roh, raeume) {
  const raum = new Map(raeume.map((r) => [r.id, r]));
  return zeilen(roh).filter((z) => (0, import_rechte.istKennung)(eintrag(z.id)) && eintrag(z.name)).map((z) => {
    const typ = TYPNAMEN[z.typ];
    const r = raum.get(eintrag(z.raum));
    return {
      value: eintrag(z.id),
      label: je((s) => {
        const wo = r ? (0, import_rechte.text)(r.name, s, r.id) : OHNE_RAUM[s];
        return typ ? `${eintrag(z.name)} (${typ[s]}, ${wo})` : `${eintrag(z.name)} (${wo})`;
      })
    };
  }).sort(nachText);
}
function nachRaeumen(roh, raeume, sprache) {
  if (!Array.isArray(roh)) {
    return void 0;
  }
  const raumname = new Map(raeume.map((r) => [r.id, (0, import_rechte.text)(r.name, sprache, r.id)]));
  const vergleiche = new Intl.Collator(sprache).compare;
  const schluessel = (z) => {
    if (!z || typeof z !== "object" || Array.isArray(z)) {
      return void 0;
    }
    const zeile = z;
    const raum = eintrag(zeile.raum);
    const name = raumname.get(raum);
    return name === void 0 ? ["1", "", "", eintrag(zeile.name), eintrag(zeile.id)] : ["0", name, raum, eintrag(zeile.name), eintrag(zeile.id)];
  };
  const sortiert = roh.map((z) => ({ z, s: schluessel(z) })).sort((a, b) => {
    if (!a.s || !b.s) {
      return (a.s ? 0 : 1) - (b.s ? 0 : 1);
    }
    for (let i = 0; i < a.s.length; i++) {
      const unterschied = vergleiche(a.s[i], b.s[i]) || (a.s[i] < b.s[i] ? -1 : a.s[i] > b.s[i] ? 1 : 0);
      if (unterschied !== 0) {
        return unterschied;
      }
    }
    return 0;
  }).map(({ z }) => z);
  return sortiert.every((z, i) => z === roh[i]) ? void 0 : sortiert;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  bezeichnungsfeld,
  karteAusZeile,
  kartenoptionen,
  liesKonfiguration,
  nachRaeumen,
  profilAusZeile,
  raumoptionen,
  zeileAusKarte,
  zeileAusProfil
});
//# sourceMappingURL=konfiguration.js.map
