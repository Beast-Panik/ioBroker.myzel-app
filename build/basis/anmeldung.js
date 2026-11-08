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
var anmeldung_exports = {};
__export(anmeldung_exports, {
  ANMELDENACHRICHTEN: () => ANMELDENACHRICHTEN,
  Anmeldung: () => Anmeldung
});
module.exports = __toCommonJS(anmeldung_exports);
var import_kern = require("./kern");
const ANMELDENACHRICHTEN = ["hallo", "koppeln"];
class Anmeldung {
  constructor(o) {
    this.o = o;
  }
  begruesse(v) {
    let erhalten = false;
    v.empfaenger = (text) => {
      if (erhalten) {
        this.lehneAb(v, "ungueltig", "weitere Nachricht vor Abschluss der Anmeldung");
        return;
      }
      erhalten = true;
      this.erste(v, text).catch((fehler) => {
        this.o.log.error(`Anmeldung von ${v.herkunft.adresse}: ${fehler.message}`);
        v.sendeFehler("intern");
        v.schliesse(import_kern.SCHLIESSCODE.intern, "interner Fehler");
      });
    };
  }
  async erste(v, text) {
    const gelesen = this.o.pruefer.lies(text, Date.now());
    if (gelesen.art === "version") {
      this.o.log.warn(
        `Anmeldung von ${v.herkunft.adresse} abgelehnt: Protokollversion ${gelesen.v} nicht unterst\xFCtzt`
      );
      v.sendeFehler("version", { unterstuetzt: this.o.pruefer.versionen });
      v.schliesse(import_kern.SCHLIESSCODE.version, "Version");
    } else if (gelesen.art === "ungueltig") {
      this.lehneAb(v, "ungueltig", gelesen.grund);
    } else if (gelesen.nachricht.t === "hallo") {
      const hallo = gelesen.nachricht;
      if (v.herkunft.weg === "fern" && hallo.app !== v.herkunft.app) {
        this.lehneAb(v, "zugang", `App ${hallo.app} \xFCber den Fernzugang einer anderen App`);
      } else {
        await this.hallo(v, hallo);
      }
    } else if (gelesen.nachricht.t === "koppeln") {
      if (v.herkunft.weg === "fern") {
        this.lehneAb(v, "zugang", "Koppeln geht nur im Heimnetz");
      } else {
        this.koppeln(v, gelesen.nachricht);
      }
    } else {
      this.lehneAb(v, "ungueltig", `${gelesen.nachricht.t} vor der Anmeldung`);
    }
  }
  async hallo(v, hallo) {
    const ergebnis = await this.o.ziel.pruefeZugang(hallo.app, hallo.zugang);
    if (!v.offen) {
      return;
    }
    if (ergebnis === "beschaedigt") {
      v.sendeFehler("intern");
      v.schliesse(import_kern.SCHLIESSCODE.intern, "Objekt besch\xE4digt");
      this.o.log.debug(`Anmeldung von ${v.herkunft.adresse} abgewiesen: Objekt der App ${hallo.app} besch\xE4digt`);
      return;
    }
    if (ergebnis !== "ok") {
      this.lehneAb(
        v,
        "zugang",
        ergebnis === "unbekannt" ? `App ${hallo.app} unbekannt` : `Zugang der App ${hallo.app} falsch`
      );
      return;
    }
    v.fristErfuellt();
    await this.o.ziel.angemeldet(v, hallo);
  }
  koppeln(v, koppeln) {
    const anfrage = { verbindung: v, name: koppeln.name, geraet: koppeln.geraet, version: koppeln.v };
    if (!this.o.kopplung.melde(koppeln.geheimnis, anfrage)) {
      this.lehneAb(v, "zugang", "Einmalgeheimnis falsch, verbraucht oder abgelaufen");
      return;
    }
    v.fristErfuellt();
    this.o.log.info(`Kopplungsanfrage von ${v.herkunft.adresse}, wartet auf Best\xE4tigung im Admin`);
  }
  // Beim Zugang bekommt die App keinen Grund, damit sie nicht erfährt, ob es die App-ID gibt.
  lehneAb(v, code, grund) {
    v.sendeFehler(code, code === "ungueltig" ? { text: grund } : {});
    v.schliesse(import_kern.SCHLIESSCODE[code], code);
    this.o.log.warn(`Anmeldung von ${v.herkunft.adresse} abgelehnt: ${grund}`);
    this.o.fehlversuch(v.herkunft.adresse);
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ANMELDENACHRICHTEN,
  Anmeldung
});
//# sourceMappingURL=anmeldung.js.map
