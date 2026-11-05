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
  seitenadresse: () => seitenadresse
});
module.exports = __toCommonJS(eintraege_exports);
var import_rechte = require("../app/rechte");
const nachricht = (n) => n && typeof n === "object" && !Array.isArray(n) ? n : {};
function seitenadresse(namespace, datei) {
  const adapter = namespace.slice(0, namespace.lastIndexOf("."));
  return `adapter/${adapter}/${datei}?instanz=${encodeURIComponent(namespace)}`;
}
class Eintraege {
  constructor(art, o) {
    this.art = art;
    this.o = o;
    var _a;
    this.jetzt = (_a = o.jetzt) != null ? _a : Date.now;
  }
  jetzt;
  // Ohne id ein neuer Eintrag
  async speichere(katalog, id, roh) {
    const eintrag = this.art.pruefe(roh);
    if (Array.isArray(eintrag)) {
      return { fehler: "ungueltig", einzelheiten: eintrag };
    }
    let ziel;
    if (id === void 0) {
      if (this.art.hoechstens !== void 0 && this.art.anzahl(katalog) >= this.art.hoechstens) {
        return { fehler: "zuViele" };
      }
      ziel = await this.neueId(katalog);
    } else if ((0, import_rechte.istKennung)(id) && await this.gibt(id)) {
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
    if (!(0, import_rechte.istKennung)(id) || !await this.gibt(id)) {
      return { fehler: "weg" };
    }
    const name = (_b = (_a = this.art.imKatalog(katalog, id)) == null ? void 0 : _a.name) != null ? _b : id;
    await this.o.ablage.loescheEintrag(this.art.ordner, id);
    katalog.geaendert(this.objektId(id), null);
    this.o.log.info(`${this.art.was} \u201E${name}\u201C (${id}) gel\xF6scht`);
    return { id };
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
  seitenadresse
});
//# sourceMappingURL=eintraege.js.map
