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
var import_zonen = require("./zonen");
const SPRACHE = "en";
const EINTRAEGE = {
  karten: { pruefe: import_rechte.alsKarte, unbrauchbar: (id) => `Karte ${id} ist unbrauchbar und fehlt auf den Handys` },
  profile: { pruefe: import_rechte.alsProfil, unbrauchbar: (id) => `Profil ${id} ist unbrauchbar und gibt keine Rechte` },
  etagen: {
    pruefe: import_rechte.alsEtage,
    unbrauchbar: (id) => `Etage ${id} ist unbrauchbar, ihre R\xE4ume stehen ohne Etage`
  },
  zonen: { pruefe: import_zonen.alsZone, unbrauchbar: (id) => `Zone ${id} ist unbrauchbar und fehlt auf den Handys` }
};
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
  eintraege = {
    karten: /* @__PURE__ */ new Map(),
    profile: /* @__PURE__ */ new Map(),
    etagen: /* @__PURE__ */ new Map(),
    zonen: /* @__PURE__ */ new Map()
  };
  zonenSortiert;
  // Zonen, deren Objekt es gibt, die aber gerade unbrauchbar sind: Sie fehlen auf den Handys, gelten aber nicht als
  // gelöscht, sonst verlören ihre Datenpunkte bei einem Tippfehler im Objektbrowser die Einstellungen etwa für History.
  zonenUnbrauchbar = /* @__PURE__ */ new Set();
  // Breite und Länge aus den Systemeinstellungen, für „Zuhause“ im Reiter Zonen
  systemort;
  etagenSortiert;
  kartenSortiert;
  profileSortiert;
  puffer;
  laden = Promise.resolve();
  hoerer = () => void 0;
  appHoerer = () => void 0;
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
        this.quelle.objekte("enum", "enum.rooms."),
        this.quelle.objekte("config", `${this.namespace}.karten.`),
        this.quelle.objekte("config", `${this.namespace}.profile.`),
        this.quelle.objekte("config", `${this.namespace}.etagen.`),
        this.quelle.objekte("config", `${this.namespace}.zonen.`)
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
  // Jede Änderung am Objekt einer App sofort, vor der gesammelten Neuberechnung
  beiApp(hoerer) {
    this.appHoerer = hoerer;
  }
  geaendert(id, objekt) {
    const appId = (0, import_objekte.appIdAus)(this.namespace, id);
    if (appId) {
      this.appHoerer(appId, objekt);
    }
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
    return this.eintraege.profile.get(profilId);
  }
  // Nur brauchbare Profile, nach Namen sortiert
  alleProfile() {
    var _a;
    (_a = this.profileSortiert) != null ? _a : this.profileSortiert = [...this.eintraege.profile].sort(
      ([a, x], [b, y]) => x.name.localeCompare(y.name) || a.localeCompare(b)
    );
    return this.profileSortiert;
  }
  // Nur brauchbare Zonen, nach Namen sortiert
  zonen() {
    var _a;
    (_a = this.zonenSortiert) != null ? _a : this.zonenSortiert = [...this.eintraege.zonen].sort(
      ([a, x], [b, y]) => x.name.localeCompare(y.name, this.sprache) || a.localeCompare(b)
    );
    return this.zonenSortiert;
  }
  zone(zonenId) {
    return this.eintraege.zonen.get(zonenId);
  }
  // Ob es das Objekt der Zone gibt, auch wenn sie gerade unbrauchbar ist
  gibtZone(zonenId) {
    return this.eintraege.zonen.has(zonenId) || this.zonenUnbrauchbar.has(zonenId);
  }
  zuhause() {
    return this.systemort;
  }
  karten() {
    var _a;
    (_a = this.kartenSortiert) != null ? _a : this.kartenSortiert = [...this.eintraege.karten].sort(([a], [b]) => a.localeCompare(b));
    return this.kartenSortiert;
  }
  karte(kartenId) {
    return this.eintraege.karten.get(kartenId);
  }
  // Von oben nach unten; bei gleicher Position nach Namen, damit die Folge nie vom Zufall des Ladens abhängt
  alleEtagen() {
    var _a;
    (_a = this.etagenSortiert) != null ? _a : this.etagenSortiert = [...this.eintraege.etagen].sort(
      ([a, x], [b, y]) => x.position - y.position || x.name.localeCompare(y.name) || a.localeCompare(b)
    );
    return this.etagenSortiert;
  }
  etagen() {
    return this.alleEtagen().map(([id, e]) => ({ id, name: e.name, kurz: e.kurz }));
  }
  // Nach Etagen, darin wie im Admin geordnet; ein Raum in zwei Etagen zählt bei der oberen. Räume ohne Etage zuletzt
  // nach Namen in der Systemsprache, wie die App sie vor Protokoll 5 selbst ordnete.
  raeume() {
    if (!this.raeumeSortiert) {
      const folge = [];
      const vergeben = /* @__PURE__ */ new Set();
      for (const [etage, e] of this.alleEtagen()) {
        for (const id of e.raeume) {
          const raum = this.raeumeNachId.get(id);
          if (raum && !vergeben.has(id)) {
            vergeben.add(id);
            folge.push({ ...raum, etage });
          }
        }
      }
      const name = (r) => (0, import_rechte.text)(r.name, this.sprache, r.id);
      const rest = [...this.raeumeNachId.values()].filter((r) => !vergeben.has(r.id)).sort((a, b) => name(a).localeCompare(name(b), this.sprache) || a.id.localeCompare(b.id));
      this.raeumeSortiert = [...folge, ...rest];
    }
    return this.raeumeSortiert;
  }
  datenpunkt(id) {
    return this.datenpunkte.get(id);
  }
  alleDatenpunkte() {
    return this.datenpunkte.entries();
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
      this.systemort = ortAus(objekt == null ? void 0 : objekt.common);
      const sprache = (_a = objekt == null ? void 0 : objekt.common) == null ? void 0 : _a.language;
      const neu = typeof sprache === "string" && sprache !== "" ? sprache : SPRACHE;
      if (neu === this.sprache) {
        return false;
      }
      this.sprache = neu;
      this.raeumeSortiert = void 0;
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
    for (const ordner of ["karten", "profile", "etagen", "zonen"]) {
      const praefix = `${this.namespace}.${ordner}.`;
      if (id.startsWith(praefix)) {
        return this.uebernimmEintrag(ordner, id.slice(praefix.length), objekt);
      }
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
  // Ein unbrauchbarer Eintrag fehlt, bis er wieder passt; was darunter liegt, etwa ein Datenpunkt, ist keiner.
  uebernimmEintrag(ordner, id, objekt) {
    if (ordner === "zonen" ? !(0, import_zonen.istZonenId)(id) : !(0, import_rechte.istKennung)(id)) {
      return false;
    }
    this.kartenSortiert = void 0;
    this.profileSortiert = void 0;
    this.etagenSortiert = void 0;
    this.raeumeSortiert = void 0;
    this.zonenSortiert = void 0;
    const eintraege = this.eintraege[ordner];
    if (ordner === "zonen") {
      this.zonenUnbrauchbar.delete(id);
    }
    if ((objekt == null ? void 0 : objekt.type) !== "config") {
      return eintraege.delete(id);
    }
    const eintrag = EINTRAEGE[ordner].pruefe(objekt.native);
    if (Array.isArray(eintrag)) {
      this.log.warn(`${EINTRAEGE[ordner].unbrauchbar(id)}: ${eintrag.join("; ")}`);
      if (ordner === "zonen") {
        this.zonenUnbrauchbar.add(id);
      }
      return eintraege.delete(id);
    }
    eintraege.set(id, structuredClone(eintrag));
    return true;
  }
}
function ortAus(common) {
  const c = common;
  const zahl = (w) => typeof w === "number" ? w : typeof w === "string" && w.trim() !== "" ? Number(w) : NaN;
  const breite = zahl(c == null ? void 0 : c.latitude);
  const laenge = zahl(c == null ? void 0 : c.longitude);
  if (!Number.isFinite(breite) || !Number.isFinite(laenge) || Math.abs(breite) > 90 || Math.abs(laenge) > 180) {
    return void 0;
  }
  return breite === 0 && laenge === 0 ? void 0 : { breite, laenge };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Katalog
});
//# sourceMappingURL=katalog.js.map
