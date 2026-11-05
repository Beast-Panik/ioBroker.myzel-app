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
const BRAUCHBAR = {
  karten: (native) => !Array.isArray((0, import_rechte.alsKarte)(native)),
  profile: (native) => !Array.isArray((0, import_rechte.alsProfil)(native)),
  etagen: (native) => !Array.isArray((0, import_rechte.alsEtage)(native))
};
async function stelleUm(namespace, quelle, einstellungen, ablage, log) {
  const loeschen = [];
  let karten = 0;
  let profile = 0;
  for (const [id, karte] of (0, import_konfiguration.lies)(einstellungen.karten, "Karte", "wird nicht \xFCbernommen", import_konfiguration.karteAusZeile, log)) {
    karten += Number(await legeAn(ablage, "karten", id, karte));
  }
  karten += await geraeteZuKarten(namespace, quelle, ablage, loeschen, log);
  for (const [id, profil] of (0, import_konfiguration.lies)(einstellungen.profile, "Profil", "wird nicht \xFCbernommen", import_konfiguration.profilAusZeile, log)) {
    profile += Number(await legeAn(ablage, "profile", id, profil));
  }
  profile += await bereinigeProfilobjekte(namespace, quelle, ablage, log);
  const voll = (liste) => Array.isArray(liste) && liste.length > 0;
  if (voll(einstellungen.karten) || voll(einstellungen.profile)) {
    await ablage.leereEinstellungen();
  }
  if (karten + profile > 0) {
    log.info(`${karten} Karten und ${profile} Profile als Objekte \xFCbernommen`);
  }
  for (const id of loeschen) {
    await ablage.loescheObjekt(id);
  }
}
async function legeAn(ablage, ordner, id, eintrag) {
  const da = await ablage.liesEintrag(ordner, id);
  if (da !== void 0 && BRAUCHBAR[ordner](da)) {
    return false;
  }
  await ablage.schreibeEintrag(ordner, id, eintrag.name, eintrag);
  return true;
}
async function geraeteZuKarten(namespace, quelle, ablage, loeschen, log) {
  var _a;
  const praefix = `${namespace}.geraete.`;
  const geraete = await quelle.objekte("config", praefix);
  if (geraete.length === 0) {
    return 0;
  }
  let angelegt = 0;
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
    if (await legeAn(ablage, "karten", id, karte)) {
      angelegt++;
      log.info(`Ger\xE4t ${id} ist jetzt eine Lampenkarte`);
    } else {
      log.warn(`Ger\xE4t ${id} entfernt, eine Karte mit dieser ID gibt es schon`);
    }
    loeschen.push(`geraete.${id}`);
  }
  return angelegt;
}
function mitglieder(raum) {
  var _a;
  const members = (_a = raum.common) == null ? void 0 : _a.members;
  return Array.isArray(members) ? members.filter((m) => typeof m === "string") : [];
}
async function bereinigeProfilobjekte(namespace, quelle, ablage, log) {
  var _a, _b, _c, _d;
  const praefix = `${namespace}.profile.`;
  let bereinigt = 0;
  for (const objekt of await quelle.objekte("config", praefix)) {
    const id = objekt._id.slice(praefix.length);
    const native = (_a = objekt.native) != null ? _a : {};
    const anzahl = (w) => Array.isArray(w) ? w.length : 0;
    const alt = "freigaben" in native || "sperren" in native;
    if (!(0, import_rechte.istKennung)(id) || !alt && BRAUCHBAR.profile(native)) {
      continue;
    }
    const profil = (0, import_rechte.alsProfil)({
      name: native.name,
      raeume: (_b = native.raeume) != null ? _b : [],
      karten: (_c = native.karten) != null ? _c : [],
      gesperrt: (_d = native.gesperrt) != null ? _d : []
    });
    if (Array.isArray(profil)) {
      continue;
    }
    await ablage.schreibeEintrag("profile", id, profil.name, profil);
    bereinigt++;
    const freigaben = anzahl(native.freigaben);
    const sperren = anzahl(native.sperren);
    if (freigaben + sperren > 0) {
      log.warn(
        `Profil ${id}: ${freigaben} Freigaben und ${sperren} Sperren von Datenpunkten entfernt, bitte Karten freigeben`
      );
    }
  }
  return bereinigt;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  stelleUm
});
//# sourceMappingURL=umstellung.js.map
