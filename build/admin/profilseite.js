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
var profilseite_exports = {};
__export(profilseite_exports, {
  PROFILBEFEHLE: () => PROFILBEFEHLE,
  Profilseite: () => Profilseite
});
module.exports = __toCommonJS(profilseite_exports);
var import_rechte = require("../app/rechte");
var import_eintraege = require("./eintraege");
const PROFILBEFEHLE = [
  "profilseite",
  "profilstand",
  "profilvorschau",
  "speichereProfil",
  "loescheProfil"
];
function bereinigt(roh) {
  if (!roh || typeof roh !== "object" || Array.isArray(roh)) {
    return roh;
  }
  const r = roh;
  const nur = (felder) => (w) => w && typeof w === "object" && !Array.isArray(w) ? Object.fromEntries(felder.map((f) => [f, w[f]])) : w;
  const je = (w, f) => Array.isArray(w) ? w.map(f) : w;
  return {
    name: typeof r.name === "string" ? r.name.trim() : r.name,
    raeume: je(r.raeume, nur(["enum", "recht"])),
    karten: je(r.karten, nur(["id", "recht"])),
    gesperrt: je(r.gesperrt, (x) => x)
  };
}
const pruefe = (roh) => (0, import_rechte.alsProfil)(bereinigt(roh));
class Profilseite {
  constructor(o) {
    this.o = o;
    this.profile = new import_eintraege.Eintraege(
      {
        ordner: "profile",
        kennbuchstabe: "p",
        was: "Profil",
        pruefe,
        imKatalog: (katalog, id) => katalog.profil(id),
        anzahl: (katalog) => katalog.alleProfile().length
      },
      o
    );
  }
  profile;
  async beantworte(befehl, roh) {
    if (befehl === "profilseite") {
      return (0, import_eintraege.seitenadresse)(this.o.namespace, "profile.html");
    }
    const katalog = this.o.katalog();
    if (!katalog) {
      return { fehler: "nichtBereit" };
    }
    const n = (0, import_eintraege.nachricht)(roh);
    switch (befehl) {
      case "profilstand":
        return this.stand(katalog);
      case "profilvorschau":
        return this.vorschau(katalog, n.profil);
      case "speichereProfil":
        return this.mitStand(katalog, await this.profile.speichere(katalog, n.id, n.profil));
      case "loescheProfil":
        return this.mitStand(katalog, await this.profile.loesche(katalog, n.id));
      default:
        return void 0;
    }
  }
  async mitStand(katalog, antwort) {
    return "fehler" in antwort ? antwort : { id: antwort.id, stand: await this.stand(katalog) };
  }
  // Der Name zählt hier nicht; ohne ihn ginge beim Anlegen keine Vorschau.
  vorschau(katalog, roh) {
    const profil = pruefe({ ...(0, import_eintraege.nachricht)(roh), name: "-" });
    return Array.isArray(profil) ? { fehler: "ungueltig", einzelheiten: profil } : { sieht: (0, import_rechte.sicht)(profil, katalog) };
  }
  async stand(katalog) {
    const sprache = katalog.sprache;
    const apps = await this.appsJeProfil();
    return {
      sprache,
      raeume: (0, import_eintraege.raeumeFuerSeiten)(katalog),
      karten: katalog.karten().map(([id, k]) => ({
        id,
        name: k.name,
        typ: k.typ,
        raum: k.raum,
        persoenlich: (0, import_rechte.istPersoenlich)(k, katalog),
        fehlt: (0, import_rechte.maengelDerKarte)(k, (dp) => katalog.datenpunkt(dp)).folge === "fehlt"
      })),
      profile: katalog.alleProfile().map(([id, p]) => {
        var _a;
        return {
          id,
          ...structuredClone(p),
          sieht: (0, import_rechte.sicht)(p, katalog),
          apps: (_a = apps.get(id)) != null ? _a : []
        };
      }),
      laengen: { name: import_rechte.PROFILNAME_LAENGE }
    };
  }
  async appsJeProfil() {
    var _a;
    const je = /* @__PURE__ */ new Map();
    for (const appId of await this.o.ablage.alle()) {
      const app = await this.o.ablage.lies(appId);
      if (app == null ? void 0 : app.profil) {
        je.set(app.profil, [...(_a = je.get(app.profil)) != null ? _a : [], app.name]);
      }
    }
    for (const namen of je.values()) {
      namen.sort((a, b) => a.localeCompare(b));
    }
    return je;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  PROFILBEFEHLE,
  Profilseite
});
//# sourceMappingURL=profilseite.js.map
