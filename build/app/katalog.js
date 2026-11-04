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
var katalog_exports = {};
__export(katalog_exports, {
  Katalog: () => Katalog
});
module.exports = __toCommonJS(katalog_exports);
var import_objekte = require("./objekte");
var import_rechte = require("./rechte");
const SPRACHE = "en";
const KENNUNG = "ID erlaubt nur a bis z, 0 bis 9 und _";
class Katalog {
  constructor(namespace, log, quelle) {
    this.namespace = namespace;
    this.log = log;
    this.quelle = quelle;
    this.profilPraefix = `${namespace}.profile.`;
    this.geraetPraefix = `${namespace}.geraete.`;
    this.eigeneApps = `${namespace}.apps`;
  }
  sprache = SPRACHE;
  eigeneApps;
  datenpunkte = /* @__PURE__ */ new Map();
  sortiert;
  raeume = /* @__PURE__ */ new Map();
  funktionen = /* @__PURE__ */ new Map();
  profile = /* @__PURE__ */ new Map();
  profilPraefix;
  geraeteNachId = /* @__PURE__ */ new Map();
  geraeteSortiert;
  geraetPraefix;
  puffer;
  laden = Promise.resolve();
  hoerer = () => void 0;
  // Erst abonnieren, dann laden: Änderungen während des Ladens hält der Katalog zurück und wendet sie danach an,
  // sonst überschriebe der ältere Ladestand sie. Nacheinander, sonst nähme ein zweites Laden dem ersten den Puffer.
  lade() {
    this.laden = this.laden.catch(() => void 0).then(() => this.ladeJetzt());
    return this.laden;
  }
  async ladeJetzt() {
    this.puffer = [];
    try {
      const listen = await Promise.all([
        this.quelle.objekte("config", "system.config"),
        this.quelle.objekte("state", ""),
        this.quelle.objekte("enum", "enum."),
        this.quelle.objekte("config", this.profilPraefix),
        this.quelle.objekte("config", this.geraetPraefix)
      ]);
      for (const objekt of listen.flat()) {
        this.uebernimmSicher(objekt._id, objekt);
      }
      for (const [id, objekt] of this.puffer) {
        this.uebernimmSicher(id, objekt);
      }
    } finally {
      this.puffer = void 0;
    }
  }
  beiAenderung(hoerer) {
    this.hoerer = hoerer;
  }
  geaendert(id, objekt) {
    if (this.puffer) {
      this.puffer.push([id, objekt]);
      return;
    }
    if (this.uebernimmSicher(id, objekt)) {
      this.hoerer();
    }
  }
  get anzahl() {
    return this.datenpunkte.size;
  }
  profil(profilId) {
    return this.profile.get(profilId);
  }
  // Nur brauchbare Profile, nach Namen sortiert
  alleProfile() {
    return [...this.profile].sort(([, a], [, b]) => a.name.localeCompare(b.name));
  }
  geraet(geraetId) {
    return this.geraeteNachId.get(geraetId);
  }
  geraete() {
    var _a;
    (_a = this.geraeteSortiert) != null ? _a : this.geraeteSortiert = [...this.geraeteNachId].sort(([a], [b]) => a.localeCompare(b));
    return this.geraeteSortiert;
  }
  aufzaehlungen(art) {
    return [...(art === "rooms" ? this.raeume : this.funktionen).values()].sort((a, b) => a.id.localeCompare(b.id));
  }
  zustaende(praefix) {
    var _a;
    (_a = this.sortiert) != null ? _a : this.sortiert = [...this.datenpunkte.keys()].sort();
    const ergebnis = /* @__PURE__ */ new Map();
    for (let i = ersterAb(this.sortiert, praefix); i < this.sortiert.length; i++) {
      const id = this.sortiert[i];
      if (!id.startsWith(praefix)) {
        break;
      }
      if ((0, import_rechte.liegtUnter)(id, praefix)) {
        ergebnis.set(id, this.datenpunkte.get(id));
      }
    }
    return ergebnis;
  }
  // Objekte schreiben auch andere Adapter und Skripte: Ein kaputtes darf weder das Laden noch objectChange abbrechen.
  uebernimmSicher(id, objekt) {
    try {
      return this.uebernimm(id, objekt);
    } catch (fehler) {
      this.log.warn(`Objekt ${id} nicht \xFCbernommen: ${fehler.message}`);
      return false;
    }
  }
  // true, wenn sich etwas geändert haben kann, das Rechte einer App betrifft
  uebernimm(id, objekt) {
    var _a, _b, _c;
    if (id === "system.config") {
      const sprache = (_a = objekt == null ? void 0 : objekt.common) == null ? void 0 : _a.language;
      const neu = typeof sprache === "string" && sprache !== "" ? sprache : SPRACHE;
      if (neu === this.sprache) {
        return false;
      }
      this.sprache = neu;
      if (this.datenpunkte.size === 0) {
        return true;
      }
      this.lade().then(
        () => this.hoerer(),
        (fehler) => this.log.error(`Katalog f\xFCr die neue Systemsprache nicht geladen: ${fehler.message}`)
      );
      return false;
    }
    if ((0, import_objekte.appIdAus)(this.namespace, id)) {
      return true;
    }
    const art = id.startsWith("enum.rooms.") ? this.raeume : id.startsWith("enum.functions.") ? this.funktionen : void 0;
    if (art) {
      if ((objekt == null ? void 0 : objekt.type) !== "enum") {
        return art.delete(id);
      }
      const members = (_b = objekt.common) == null ? void 0 : _b.members;
      const mitglieder = Array.isArray(members) ? members.filter((m) => typeof m === "string") : [];
      art.set(id, { id, name: (_c = objekt.common) == null ? void 0 : _c.name, mitglieder });
      return true;
    }
    if (id.startsWith(this.profilPraefix)) {
      return this.uebernimmProfil(id.slice(this.profilPraefix.length), objekt);
    }
    if (id.startsWith(this.geraetPraefix)) {
      this.geraeteSortiert = void 0;
      return this.uebernimmGeraet(id.slice(this.geraetPraefix.length), objekt);
    }
    if ((objekt == null ? void 0 : objekt.type) === "state") {
      if (!this.datenpunkte.has(id)) {
        this.sortiert = void 0;
      }
      this.datenpunkte.set(id, (0, import_rechte.merkmale)(id, objekt.common, this.sprache));
      return true;
    }
    if (this.datenpunkte.delete(id)) {
      this.sortiert = void 0;
      return true;
    }
    return false;
  }
  uebernimmProfil(profilId, objekt) {
    if ((objekt == null ? void 0 : objekt.type) !== "config") {
      return this.profile.delete(profilId);
    }
    const profil = (0, import_rechte.istKennung)(profilId) ? (0, import_rechte.alsProfil)(objekt.native) : [KENNUNG];
    if (Array.isArray(profil)) {
      this.log.warn(`Profil ${profilId} ist unbrauchbar und gibt keine Rechte: ${profil.join("; ")}`);
      return this.profile.delete(profilId);
    }
    this.profile.set(profilId, profil);
    return true;
  }
  uebernimmGeraet(geraetId, objekt) {
    if ((objekt == null ? void 0 : objekt.type) !== "config") {
      return this.geraeteNachId.delete(geraetId);
    }
    const geraet = (0, import_rechte.istKennung)(geraetId) ? (0, import_rechte.alsGeraet)(objekt.native) : [KENNUNG];
    if (Array.isArray(geraet)) {
      this.log.warn(`Ger\xE4t ${geraetId} ist unbrauchbar und fehlt auf den Handys: ${geraet.join("; ")}`);
      return this.geraeteNachId.delete(geraetId);
    }
    this.geraeteNachId.set(geraetId, geraet);
    return true;
  }
}
function ersterAb(sortiert, praefix) {
  let von = 0;
  let bis = sortiert.length;
  while (von < bis) {
    const mitte = von + bis >>> 1;
    if (sortiert[mitte] < praefix) {
      von = mitte + 1;
    } else {
      bis = mitte;
    }
  }
  return von;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Katalog
});
//# sourceMappingURL=katalog.js.map
