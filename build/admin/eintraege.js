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
var eintraege_exports = {};
__export(eintraege_exports, {
  Eintraege: () => Eintraege,
  nachricht: () => nachricht,
  raeumeFuerSeiten: () => raeumeFuerSeiten,
  seitenadresse: () => seitenadresse
});
module.exports = __toCommonJS(eintraege_exports);
var import_rechte = require("../app/rechte");
const nachricht = (n) => n && typeof n === "object" && !Array.isArray(n) ? n : {};
function seitenadresse(namespace, datei) {
  const adapter = namespace.slice(0, namespace.lastIndexOf("."));
  return `adapter/${adapter}/${datei}?instanz=${encodeURIComponent(namespace)}`;
}
function raeumeFuerSeiten(katalog) {
  var _a;
  const raeume = katalog.raeume().map((r) => ({ id: r.id, name: (0, import_rechte.text)(r.name, katalog.sprache, r.id).trim() }));
  const schluessel = (name) => name.toLocaleLowerCase();
  const anzahl = /* @__PURE__ */ new Map();
  for (const r of raeume) {
    anzahl.set(schluessel(r.name), ((_a = anzahl.get(schluessel(r.name))) != null ? _a : 0) + 1);
  }
  return raeume.map(
    (r) => anzahl.get(schluessel(r.name)) > 1 ? { ...r, name: `${r.name} (${r.id.slice("enum.rooms.".length)})` } : r
  );
}
class Eintraege {
  constructor(art, o) {
    this.art = art;
    this.o = o;
    var _a;
    this.jetzt = (_a = o.jetzt) != null ? _a : Date.now;
  }
  jetzt;
  /**
   * Ohne id ein neuer Eintrag, mit wunsch unter dieser ID, sonst unter einer neuen aus Buchstabe und Zeit. Eine
   * gewünschte ID muss frei sein; überschreiben geht nur über id.
   */
  async speichere(katalog, id, roh, wunsch) {
    const eintrag = this.art.pruefe(roh);
    if (Array.isArray(eintrag)) {
      return { fehler: "ungueltig", einzelheiten: eintrag };
    }
    let ziel;
    if (id === void 0) {
      if (wunsch !== void 0 && !this.istId(wunsch)) {
        return { fehler: "ungueltig", einzelheiten: ["id"] };
      }
      if (this.art.hoechstens !== void 0 && this.art.anzahl(katalog) >= this.art.hoechstens) {
        return { fehler: "zuViele" };
      }
      if (wunsch === void 0) {
        ziel = await this.neueId(katalog);
      } else if (this.art.imKatalog(katalog, wunsch) || await this.gibt(wunsch)) {
        return { fehler: "vergeben" };
      } else {
        ziel = wunsch;
      }
    } else if (this.istId(id) && await this.gibt(id)) {
      ziel = id;
    } else {
      return { fehler: "weg" };
    }
    await this.o.ablage.schreibeEintrag(this.art.ordner, ziel, eintrag.name, eintrag);
    katalog.geaendert(this.objektId(ziel), {
      _id: this.objektId(ziel),
      type: "config",
      common: { name: eintrag.name },
      native: eintrag
    });
    this.o.log.info(`${this.art.was} \u201E${eintrag.name}\u201C (${ziel}) gespeichert`);
    return { id: ziel };
  }
  async loesche(katalog, id) {
    var _a, _b;
    if (!this.istId(id) || !await this.gibt(id)) {
      return { fehler: "weg" };
    }
    const name = (_b = (_a = this.art.imKatalog(katalog, id)) == null ? void 0 : _a.name) != null ? _b : id;
    await this.o.ablage.loescheEintrag(this.art.ordner, id);
    katalog.geaendert(this.objektId(id), null);
    this.o.log.info(`${this.art.was} \u201E${name}\u201C (${id}) gel\xF6scht`);
    return { id };
  }
  istId(id) {
    var _a;
    return ((_a = this.art.istId) != null ? _a : import_rechte.istKennung)(id);
  }
  async gibt(id) {
    return await this.o.ablage.liesEintrag(this.art.ordner, id) !== void 0;
  }
  objektId(id) {
    return `${this.o.namespace}.${this.art.ordner}.${id}`;
  }
  // Buchstabe und Zeit: nie wieder vergeben, damit ein Verweis auf einen gelöschten Eintrag, etwa eine gelöschte Karte
  // in einem Profil, keinem neuen Rechte gibt.
  async neueId(katalog) {
    for (let zeit = this.jetzt(); ; zeit++) {
      const id = `${this.art.kennbuchstabe}${zeit.toString(36)}`;
      if (!this.art.imKatalog(katalog, id) && !await this.gibt(id)) {
        return id;
      }
    }
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Eintraege,
  nachricht,
  raeumeFuerSeiten,
  seitenadresse
});
//# sourceMappingURL=eintraege.js.map
