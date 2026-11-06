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
var server_exports = {};
__export(server_exports, {
  starteServer: () => starteServer
});
module.exports = __toCommonJS(server_exports);
var import_anmeldung = require("../basis/anmeldung");
var import_kern = require("../basis/kern");
var import_kopplung = require("../basis/kopplung");
var import_schutz = require("../basis/schutz");
var import_heimnetz = require("../zugang/heimnetz");
var import_dienst = require("./dienst");
var import_fernzugang = require("./fernzugang");
async function starteServer(o) {
  const pruefer = (0, import_dienst.appPruefer)(o.versionen);
  const sperrliste = new import_schutz.Sperrliste(o.grenzen);
  const kopplung = new import_kopplung.Kopplung(o.grenzen);
  let fern;
  const fehlversuch = (adresse) => {
    if (sperrliste.fehlversuch(adresse, Date.now())) {
      o.log.warn(`Adresse ${(0, import_schutz.sperrbereich)(adresse)} nach wiederholten Fehlversuchen gesperrt`);
    }
  };
  const dienst = new import_dienst.Dienst({
    adapterId: o.adapterId,
    namespace: o.namespace,
    ablage: o.ablage,
    pruefer,
    kopplung,
    log: o.log,
    adressen: o.adressen,
    katalog: o.katalog,
    zustaende: o.zustaende,
    nachlaufMs: o.nachlaufMs,
    textLaenge: o.textLaenge,
    hinweisFristMs: o.hinweisFristMs,
    grenzen: o.grenzen,
    neuberechnungMs: o.neuberechnungMs,
    fernzugang: () => fern == null ? void 0 : fern.zugang()
  });
  await dienst.starte();
  const anmeldung = new import_anmeldung.Anmeldung({ pruefer, kopplung, fehlversuch, ziel: dienst, log: o.log });
  const kern = new import_kern.Kern({
    identitaet: o.identitaet,
    log: o.log,
    gesperrt: (adresse) => sperrliste.gesperrt(adresse, Date.now()),
    fehlversuch,
    verbunden: (v) => anmeldung.begruesse(v),
    grenzen: o.grenzen
  });
  const heimnetz = new import_heimnetz.Heimnetz({
    port: o.port,
    nimm: (strom, herkunft) => kern.nimm(strom, herkunft),
    log: o.log,
    zustand: o.zustand
  });
  heimnetz.starte();
  if (o.fernablage) {
    fern = new import_fernzugang.Fernverwaltung({
      adapterId: o.adapterId,
      ablage: o.fernablage,
      apps: o.ablage,
      nimm: (strom, herkunft) => kern.nimm(strom, herkunft),
      log: o.log,
      verbunden: (ja) => {
        var _a;
        return (_a = o.fernVerbunden) == null ? void 0 : _a.call(o, ja);
      },
      geaendert: () => dienst.fernzugangGeaendert()
    });
    await fern.starte();
  }
  return {
    kopplung,
    dienst,
    heimnetz,
    fern,
    nimm: (strom, herkunft) => kern.nimm(strom, herkunft),
    geaendert: (id, state) => dienst.geaendert(id, state),
    async beende() {
      dienst.beende();
      kopplung.brichAb();
      fern == null ? void 0 : fern.beende();
      heimnetz.beende();
      await kern.beende();
    }
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  starteServer
});
//# sourceMappingURL=server.js.map
