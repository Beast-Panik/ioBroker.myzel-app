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
class Katalog {
  constructor(namespace, log, quelle) {
    this.namespace = namespace;
    this.log = log;
    this.quelle = quelle;
    this.eigeneApps = `${namespace}.apps`;
  }
  sprache = SPRACHE;
  eigeneApps;
  datenpunkte = /* @__PURE__ */ new Map();
  raeumeNachId = /* @__PURE__ */ new Map();
  raeumeSortiert;
  profile = /* @__PURE__ */ new Map();
  kartenSortiert = [];
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
        this.quelle.objekte("enum", "enum.rooms.")
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
  // Einmal beim Start; die Tests ändern damit Karten und Profile wie ein Neustart mit neuen Einstellungen.
  konfiguriere(konfiguration) {
    this.profile = new Map(konfiguration.profile);
    this.kartenSortiert = [...konfiguration.karten].sort(([a], [b]) => a.localeCompare(b));
    this.hoerer();
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
  karten() {
    return this.kartenSortiert;
  }
  raeume() {
    var _a;
    (_a = this.raeumeSortiert) != null ? _a : this.raeumeSortiert = [...this.raeumeNachId.values()].sort((a, b) => a.id.localeCompare(b.id));
    return this.raeumeSortiert;
  }
  datenpunkt(id) {
    return this.datenpunkte.get(id);
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
    if (id.startsWith("enum.rooms.")) {
      this.raeumeSortiert = void 0;
      if ((objekt == null ? void 0 : objekt.type) !== "enum") {
        return this.raeumeNachId.delete(id);
      }
      const members = (_b = objekt.common) == null ? void 0 : _b.members;
      const mitglieder = Array.isArray(members) ? members.filter((m) => typeof m === "string") : [];
      this.raeumeNachId.set(id, { id, name: (_c = objekt.common) == null ? void 0 : _c.name, mitglieder });
      return true;
    }
    if ((objekt == null ? void 0 : objekt.type) === "state") {
      this.datenpunkte.set(id, (0, import_rechte.merkmale)(id, objekt.common, this.sprache));
      return true;
    }
    return this.datenpunkte.delete(id);
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Katalog
});
//# sourceMappingURL=katalog.js.map
