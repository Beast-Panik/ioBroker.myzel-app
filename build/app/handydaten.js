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
var handydaten_exports = {};
__export(handydaten_exports, {
  Anwesenheit: () => Anwesenheit,
  Handyeingang: () => Handyeingang,
  kuerze: () => kuerze
});
module.exports = __toCommonJS(handydaten_exports);
var import_objekte = require("./objekte");
function kuerze(text, laenge) {
  return text.length <= laenge ? text : [...text].slice(0, laenge).join("");
}
class Handyeingang {
  constructor(o) {
    this.o = o;
    this.handydaten = o.handydaten;
  }
  handydaten;
  // Nacheinander, sonst überholt ein späteres Ereignis ein früheres zwischen den Einzelwerten.
  reihe = Promise.resolve();
  akku(m) {
    const a = m;
    return this.schreibe("akku", { "akku.stand": a.stand, "akku.laedt": a.laedt }, a.zeit);
  }
  // Leer statt fehlend, sonst bliebe die Nummer des letzten Anrufs stehen. Status zuletzt: Ein Skript, das auf
  // klingelt reagiert, findet Nummer und Name schon vor.
  anruf(m) {
    var _a, _b, _c;
    const a = m;
    return this.schreibe(
      "anruf",
      {
        "anruf.richtung": (_a = a.richtung) != null ? _a : "",
        "anruf.nummer": (_b = a.nummer) != null ? _b : "",
        "anruf.name": (_c = a.name) != null ? _c : "",
        "anruf.status": a.status
      },
      a.zeit
    );
  }
  // Erst der Ordner der App, dann letzte, je mit json zuletzt: Ein Skript, das darauf reagiert, sieht immer eine
  // vollständige Benachrichtigung, und mit letzte.json ist alles geschrieben.
  benachrichtigung(m) {
    var _a, _b;
    const b = m;
    const inhalt = {
      app: b.app,
      paket: b.paket,
      titel: kuerze((_a = b.titel) != null ? _a : "", this.o.textLaenge),
      text: kuerze((_b = b.text) != null ? _b : "", this.o.textLaenge),
      zeit: b.zeit,
      nachgeliefert: b.nachgeliefert === true
    };
    const werte = {
      app: inhalt.app,
      paket: inhalt.paket,
      titel: inhalt.titel,
      text: inhalt.text,
      zeit: inhalt.zeit,
      json: JSON.stringify(inhalt)
    };
    const ordner = (0, import_objekte.ordnerFuer)(b.paket);
    return this.erledige("benachrichtigung", "benachrichtigung", async () => {
      if (ordner) {
        await this.o.ablage.schreibeBenachrichtigung(this.o.appId, ordner, b.app, werte, b.zeit);
      }
      await this.o.ablage.schreibeBenachrichtigung(this.o.appId, import_objekte.LETZTE, b.app, werte, b.zeit);
    });
  }
  // Ab Protokoll 4. Bei doppeltem Paketnamen gilt der letzte Eintrag.
  auswahl(m) {
    const namen = /* @__PURE__ */ new Map();
    for (const a of m.apps) {
      const ordner = (0, import_objekte.ordnerFuer)(a.paket);
      if (ordner) {
        namen.set(ordner, a.app);
      }
    }
    return this.erledige("benachrichtigung", "Auswahl", async () => {
      for (const ordner of await this.o.ablage.benachrichtigungsordner(this.o.appId)) {
        if (!namen.has(ordner)) {
          await this.o.ablage.entferneBenachrichtigungsordner(this.o.appId, ordner);
        }
      }
      for (const [ordner, name] of namen) {
        await this.o.ablage.legeBenachrichtigungsordner(this.o.appId, ordner, name);
      }
      this.o.log.debug(`App ${this.o.appId}: Auswahl mit ${namen.size} Apps \xFCbernommen`);
    });
  }
  schreibe(art, werte, zeit) {
    return this.erledige(art, art, () => this.o.ablage.schreibe(this.o.appId, werte, zeit));
  }
  erledige(art, was, aufgabe) {
    if (!this.handydaten[art]) {
      this.o.log.debug(`App ${this.o.appId}: ${art} abgelehnt, nicht eingeschaltet`);
      this.o.verbindung.sendeFehler("aus", { text: `${art} ist f\xFCr diese App nicht eingeschaltet` });
      return Promise.resolve();
    }
    this.reihe = this.reihe.then(async () => {
      try {
        await aufgabe();
      } catch {
        this.o.log.warn(`App ${this.o.appId}: ${was} nicht geschrieben`);
        this.o.verbindung.sendeFehler("intern");
      }
    });
    return this.reihe;
  }
}
class Anwesenheit {
  constructor(o) {
    this.o = o;
  }
  nachlauf = /* @__PURE__ */ new Map();
  entfernt = /* @__PURE__ */ new Set();
  // Nach einem Neustart ist offen, ob die App noch da ist: Nachlauf wie nach einer Trennung, statt sofort abwesend.
  async starte(appIds) {
    var _a;
    for (const appId of appIds) {
      if (((_a = await this.o.ablage.zustand(appId, "anwesend")) == null ? void 0 : _a.val) === true) {
        this.getrennt(appId, "lokal");
      }
    }
  }
  async angemeldet(appId, weg) {
    if (weg !== "lokal") {
      return;
    }
    clearTimeout(this.nachlauf.get(appId));
    this.nachlauf.delete(appId);
    await this.o.ablage.schreibe(appId, { anwesend: true });
  }
  getrennt(appId, weg) {
    if (weg !== "lokal") {
      return;
    }
    clearTimeout(this.nachlauf.get(appId));
    if (this.entfernt.has(appId)) {
      this.abwesend(appId);
      return;
    }
    this.nachlauf.set(
      appId,
      setTimeout(() => this.abwesend(appId), this.o.nachlaufMs)
    );
  }
  // Sofort abwesend statt nach dem Nachlauf: Sonst gälte die entfernte App noch Minuten als da, und der Nachlauf
  // legte einen inzwischen gelöschten Datenpunkt neu an.
  entferne(appId) {
    this.entfernt.add(appId);
    if (this.nachlauf.has(appId)) {
      clearTimeout(this.nachlauf.get(appId));
      this.abwesend(appId);
    }
  }
  beende() {
    this.nachlauf.forEach((t) => clearTimeout(t));
    this.nachlauf.clear();
  }
  abwesend(appId) {
    this.nachlauf.delete(appId);
    this.o.ablage.schreibe(appId, { anwesend: false }).catch((fehler) => this.o.log.error(`Anwesenheit der App ${appId}: ${fehler.message}`));
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Anwesenheit,
  Handyeingang,
  kuerze
});
//# sourceMappingURL=handydaten.js.map
