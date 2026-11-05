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
var umstellung_exports = {};
__export(umstellung_exports, {
  stelleUm: () => stelleUm
});
module.exports = __toCommonJS(umstellung_exports);
var import_konfiguration = require("./konfiguration");
var import_rechte = require("./rechte");
const LAMPENTEILE = Object.keys(import_rechte.KARTENARTEN.lampe.teile);
async function stelleUm(namespace, quelle, einstellungen, ablage, log) {
  const ids = (zeilen) => new Set(
    Array.isArray(zeilen) ? zeilen.map((z) => z == null ? void 0 : z.id).filter((id) => typeof id === "string") : []
  );
  const stand = {
    karten: [],
    profile: [],
    loeschen: [],
    ids: { karten: ids(einstellungen.karten), profile: ids(einstellungen.profile) }
  };
  await geraeteZuKarten(namespace, quelle, stand, log);
  await kartenobjekte(namespace, quelle, stand, log);
  await profilobjekte(namespace, quelle, stand, log);
  if (stand.karten.length + stand.profile.length > 0) {
    await ablage.ergaenzeEinstellungen(stand.karten, stand.profile);
    log.info(
      `${stand.karten.length} Karten und ${stand.profile.length} Profile in die Instanzeinstellungen \xFCbernommen`
    );
  }
  for (const id of stand.loeschen) {
    await ablage.loescheObjekt(id);
  }
  return { karten: stand.karten, profile: stand.profile };
}
function uebernimm(stand, liste, id, zeile) {
  if (stand.ids[liste].has(id)) {
    return false;
  }
  stand.ids[liste].add(id);
  stand[liste].push(zeile);
  return true;
}
async function geraeteZuKarten(namespace, quelle, stand, log) {
  var _a;
  const praefix = `${namespace}.geraete.`;
  const geraete = await quelle.objekte("config", praefix);
  if (geraete.length === 0) {
    return;
  }
  const raeume = (await quelle.objekte("enum", "enum.rooms.")).sort((a, b) => a._id.localeCompare(b._id));
  for (const objekt of geraete) {
    const id = objekt._id.slice(praefix.length);
    const native = objekt.native;
    const teile = Object.fromEntries(
      LAMPENTEILE.map((teil) => {
        var _a2;
        return [teil, (_a2 = native == null ? void 0 : native.teile) == null ? void 0 : _a2[teil]];
      }).filter(([, dp]) => typeof dp === "string")
    );
    const raum = (_a = Object.values(teile).map((dp) => {
      var _a2;
      return (_a2 = raeume.find((r) => mitglieder(r).some((m) => (0, import_rechte.liegtUnter)(dp, m)))) == null ? void 0 : _a2._id;
    }).find((r) => r !== void 0)) != null ? _a : "";
    const karte = (0, import_rechte.alsKarte)({ name: native == null ? void 0 : native.name, typ: "lampe", raum, teile });
    if (!(0, import_rechte.istKennung)(id) || Array.isArray(karte)) {
      log.warn(`Ger\xE4t ${id} bleibt stehen, es l\xE4sst sich nicht in eine Karte umwandeln`);
      continue;
    }
    if (uebernimm(stand, "karten", id, (0, import_konfiguration.zeileAusKarte)(id, karte))) {
      log.info(`Ger\xE4t ${id} ist jetzt eine Lampenkarte`);
    } else {
      log.warn(`Ger\xE4t ${id} entfernt, eine Karte mit dieser ID gibt es schon`);
    }
    stand.loeschen.push(`geraete.${id}`);
  }
}
function mitglieder(raum) {
  var _a;
  const members = (_a = raum.common) == null ? void 0 : _a.members;
  return Array.isArray(members) ? members.filter((m) => typeof m === "string") : [];
}
async function kartenobjekte(namespace, quelle, stand, log) {
  const praefix = `${namespace}.karten.`;
  for (const objekt of await quelle.objekte("config", praefix)) {
    const id = objekt._id.slice(praefix.length);
    const karte = (0, import_rechte.alsKarte)(objekt.native);
    if (!(0, import_rechte.istKennung)(id) || Array.isArray(karte)) {
      log.warn(`Kartenobjekt ${id} bleibt stehen, es ist unbrauchbar`);
      continue;
    }
    uebernimm(stand, "karten", id, (0, import_konfiguration.zeileAusKarte)(id, karte));
    stand.loeschen.push(`karten.${id}`);
  }
}
async function profilobjekte(namespace, quelle, stand, log) {
  var _a, _b, _c, _d;
  const praefix = `${namespace}.profile.`;
  for (const objekt of await quelle.objekte("config", praefix)) {
    const id = objekt._id.slice(praefix.length);
    const native = (_a = objekt.native) != null ? _a : {};
    const profil = (0, import_rechte.alsProfil)({
      name: native.name,
      raeume: (_b = native.raeume) != null ? _b : [],
      karten: (_c = native.karten) != null ? _c : [],
      gesperrt: (_d = native.gesperrt) != null ? _d : []
    });
    if (!(0, import_rechte.istKennung)(id) || Array.isArray(profil)) {
      log.warn(`Profilobjekt ${id} bleibt stehen, es ist unbrauchbar und gibt keine Rechte`);
      continue;
    }
    uebernimm(stand, "profile", id, (0, import_konfiguration.zeileAusProfil)(id, profil));
    stand.loeschen.push(`profile.${id}`);
    const anzahl = (w) => Array.isArray(w) ? w.length : 0;
    const freigaben = anzahl(native.freigaben);
    const sperren = anzahl(native.sperren);
    if (freigaben + sperren > 0) {
      log.warn(
        `Profil ${id}: ${freigaben} Freigaben und ${sperren} Sperren von Datenpunkten entfernt, bitte Karten freigeben`
      );
    }
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  stelleUm
});
//# sourceMappingURL=umstellung.js.map
