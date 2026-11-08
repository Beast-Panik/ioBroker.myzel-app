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
  Eimer: () => Eimer,
  Handyeingang: () => Handyeingang,
  kuerze: () => kuerze,
  meldeZonenAus: () => meldeZonenAus,
  neueHandyeimer: () => neueHandyeimer
});
module.exports = __toCommonJS(handydaten_exports);
var import_node_util = require("node:util");
var import_objekte = require("./objekte");
var import_zonen = require("./zonen");
function kuerze(text, laenge) {
  return text.length <= laenge ? text : [...text].slice(0, laenge).join("");
}
const ZONEN_JE_STUNDE = 60;
const ZONEN_STOSS = 10;
const STANDORT_ABSTAND_MS = 6e4;
const STANDORT_STOSS = 2;
const VORSCHLAG_ABSTAND_MS = 6e4;
function uhrzeit(ms) {
  const d = new Date(ms);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":");
}
function neueHandyeimer(g) {
  var _a, _b;
  return {
    zonen: new Eimer(ZONEN_STOSS, 36e5 / ((_a = g == null ? void 0 : g.zonenJeStunde) != null ? _a : ZONEN_JE_STUNDE)),
    standort: new Eimer(STANDORT_STOSS, (_b = g == null ? void 0 : g.standortAbstandMs) != null ? _b : STANDORT_ABSTAND_MS),
    vorschlag: new Eimer(1, VORSCHLAG_ABSTAND_MS)
  };
}
const ORDNER_HOECHSTENS = 100;
class Handyeingang {
  constructor(o) {
    this.o = o;
    var _a, _b;
    this.handydaten = o.handydaten;
    this.zonen = o.zonen;
    this.jetzt = (_a = o.jetzt) != null ? _a : Date.now;
    const eimer = (_b = o.eimer) != null ? _b : neueHandyeimer(o.grenzen);
    this.eimer = eimer;
    this.zonenEimer = eimer.zonen;
    this.standortEimer = eimer.standort;
    this.vorschlagEimer = eimer.vorschlag;
  }
  // Ändern nur über uebernimm und schraenkeEin
  handydaten;
  // Nacheinander, sonst überholt ein späteres Ereignis ein früheres zwischen den Einzelwerten.
  reihe = Promise.resolve();
  // Ordner nur für Apps, die das Handy zuletzt ausgewählt hat; ein falsches Handy legte sonst mit jedem neuen
  // Paketnamen einen Ordner an. Ohne Auswahl (Protokoll 3) höchstens ORDNER_HOECHSTENS.
  ausgewaehlt;
  ohneAuswahl;
  zuVieleGemeldet = false;
  zonen;
  zonenEimer;
  standortEimer;
  vorschlagEimer;
  eimer;
  jetzt;
  /**
   * Neue, geprüfte Freigaben aus der Neuberechnung. Endet die Freigabe der Zonen, sagt zonen.aktiv es gleich in der
   * Reihe, hinter allem, was die App vorher geschickt hat; sonst schriebe ein Stand, der kurz vorher kam, aktiv=true,
   * und danach schriebe niemand mehr etwas.
   */
  uebernimm(handydaten, grund = "admin") {
    const zonenEnden = this.handydaten.zonen === true && handydaten.zonen !== true;
    this.handydaten = handydaten;
    if (zonenEnden && this.o.version >= import_zonen.ZONEN_SEIT) {
      void this.zonenAus(grund);
    }
  }
  // Sofort bei einer Änderung am Objekt der App, vor der Neuberechnung: nur ausschalten, nie einschalten
  schraenkeEin(bleibt, grund = "admin") {
    const neu = { ...this.handydaten };
    for (const art of Object.keys(neu)) {
      neu[art] = neu[art] === true && bleibt(art);
    }
    if (!(0, import_node_util.isDeepStrictEqual)(neu, this.handydaten)) {
      this.uebernimm(neu, grund);
    }
  }
  // zonen.aktiv false mit Grund, falls es den Datenpunkt gibt und er noch nicht so steht
  zonenAus(grund) {
    this.reihe = this.reihe.then(async () => {
      this.eimer.imLog = void 0;
      try {
        await meldeZonenAus(this.o.ablage, this.o.appId, (0, import_zonen.grundText)(grund, this.o.sprache()));
      } catch {
        this.o.log.warn(`App ${this.o.appId}: Ende der Zonen nicht geschrieben`);
      }
    });
    return this.reihe;
  }
  // Betreten oder verlassen: erst der Datenpunkt der Zone, dann zonen.letzte. Ein Skript auf letzte sieht so den
  // Stand aller Zonen schon richtig.
  zone(m) {
    const z = m;
    if (!this.zonenPruefen("zone")) {
      return Promise.resolve();
    }
    const zone = this.zonen.find((x) => x.id === z.id);
    if (this.handydaten.zonen && !zone) {
      this.o.log.debug(`App ${this.o.appId}: Meldung zu einer Zone, die ihr nicht freigegeben ist`);
      this.o.verbindung.sendeFehler("abgelehnt", { text: "Diese Zone ist f\xFCr die App nicht freigegeben" });
      return Promise.resolve();
    }
    return this.erledige("zonen", "Zonenwechsel", async () => {
      var _a, _b, _c;
      const id = zone.id;
      const name = (_c = (_b = (_a = this.o).zonenname) == null ? void 0 : _b.call(_a, id)) != null ? _c : zone.name;
      const letzte = JSON.stringify({
        zone: id,
        name,
        ereignis: z.drin ? "betreten" : "verlassen",
        zeit: z.zeit
      });
      await this.o.ablage.schreibeZone(this.o.appId, id, name, z.drin, z.zeit);
      await this.o.ablage.schreibe(this.o.appId, { "zonen.letzte": letzte }, z.zeit);
      this.o.log.info(
        `App ${this.o.appId}: Zone \u201E${name}\u201C ${z.drin ? "betreten" : "verlassen"} um ${uhrzeit(z.zeit)}`
      );
      const imLog = this.eimer.imLog;
      if (imLog == null ? void 0 : imLog.aktiv) {
        const drin = new Set(imLog.drin);
        if (z.drin) {
          drin.add(id);
        } else {
          drin.delete(id);
        }
        this.eimer.imLog = { ...imLog, drin: [...drin].sort() };
      }
    });
  }
  // Ersetzt den Stand aller freigegebenen Zonen; ohne aktiv bleiben die Zonen, wie sie waren, nur aktiv und grund
  // ändern sich. Zonen, die inzwischen nicht mehr freigegeben sind, übergeht er.
  zonenstand(m) {
    var _a;
    const s = m;
    if (!this.zonenPruefen("zonenstand")) {
      return Promise.resolve();
    }
    const drin = new Set(s.drin);
    const zonen = [...this.zonen];
    const grund = s.aktiv ? "" : (0, import_zonen.grundText)((_a = s.grund) != null ? _a : "keine_standorte", this.o.sprache());
    return this.erledige("zonen", "Zonenstand", async () => {
      var _a2, _b, _c;
      if (s.aktiv) {
        for (const zone of zonen) {
          const name = (_c = (_b = (_a2 = this.o).zonenname) == null ? void 0 : _b.call(_a2, zone.id)) != null ? _c : zone.name;
          await this.o.ablage.schreibeZone(this.o.appId, zone.id, name, drin.has(zone.id), s.zeit);
        }
      }
      await this.o.ablage.schreibe(this.o.appId, { "zonen.aktiv": s.aktiv, "zonen.grund": grund }, s.zeit);
      this.logStand(s, grund, zonen);
    });
  }
  // Nur, wenn sich etwas geändert hat; die Zonen mit Namen, nie ein Ort
  logStand(s, grund, zonen) {
    const neu = {
      aktiv: s.aktiv,
      grund,
      drin: s.aktiv ? zonen.map((z) => z.id).filter((id) => s.drin.includes(id)).sort() : []
    };
    if ((0, import_node_util.isDeepStrictEqual)(neu, this.eimer.imLog)) {
      return;
    }
    this.eimer.imLog = neu;
    const um = uhrzeit(s.zeit);
    if (!s.aktiv) {
      this.o.log.info(`App ${this.o.appId}: Zonen nicht aktiv um ${um}: ${grund}`);
      return;
    }
    const namen = neu.drin.map((id) => {
      var _a, _b, _c, _d, _e;
      return `\u201E${(_e = (_d = (_b = (_a = this.o).zonenname) == null ? void 0 : _b.call(_a, id)) != null ? _d : (_c = zonen.find((z) => z.id === id)) == null ? void 0 : _c.name) != null ? _e : id}\u201C`;
    });
    this.o.log.info(
      `App ${this.o.appId}: Zonen aktiv um ${um}, ${namen.length === 0 ? "in keiner Zone" : `drin: ${namen.join(", ")}`}`
    );
  }
  // json zuletzt, wie bei den Benachrichtigungen. Koordinaten nie ins Log.
  standort(m) {
    const s = m;
    if (this.o.version < import_zonen.ZONEN_SEIT) {
      this.o.verbindung.sendeFehler("ungueltig", { text: "standort erst ab Protokollversion 7" });
      return Promise.resolve();
    }
    if (this.handydaten.standort && !this.standortEimer.nimm(this.jetzt())) {
      this.o.verbindung.sendeFehler("zuviel", { text: "h\xF6chstens ein Standort je Minute" });
      return Promise.resolve();
    }
    const json = JSON.stringify({ breite: s.breite, laenge: s.laenge, genauigkeit: s.genauigkeit, zeit: s.zeit });
    return this.schreibe(
      "standort",
      {
        "standort.breite": s.breite,
        "standort.laenge": s.laenge,
        "standort.genauigkeit": s.genauigkeit,
        "standort.json": json
      },
      s.zeit
    );
  }
  // Bei der Anmeldung: Datenpunkte von Zonen, die die App nicht mehr hat, etwa nach einem Löschen im Objektbrowser,
  // während sie nicht verbunden war
  entferneUebrige(behalten) {
    this.reihe = this.reihe.then(async () => {
      try {
        for (const zone of (await this.o.ablage.zonenpunkte(this.o.appId)).filter((z) => !behalten(z))) {
          await this.o.ablage.entferneZone(this.o.appId, zone);
        }
      } catch (fehler) {
        this.o.log.warn(
          `App ${this.o.appId}: Datenpunkte gel\xF6schter Zonen nicht entfernt: ${fehler.message}`
        );
      }
    });
    return this.reihe;
  }
  /**
   * Entfernt die Datenpunkte von Zonen, die der App entzogen oder gelöscht sind. In der Reihe, damit kein Wechsel, der
   * vor der Neuberechnung kam und noch aussteht, sie danach wieder anlegt.
   */
  entferneZonen(zonen) {
    if (zonen.length === 0) {
      return this.reihe;
    }
    this.reihe = this.reihe.then(async () => {
      try {
        const da = await this.o.ablage.zonenpunkte(this.o.appId);
        for (const zone of zonen.filter((z) => da.includes(z))) {
          await this.o.ablage.entferneZone(this.o.appId, zone);
        }
      } catch (fehler) {
        this.o.log.warn(
          `App ${this.o.appId}: Datenpunkte entzogener Zonen nicht entfernt: ${fehler.message}`
        );
      }
    });
    return this.reihe;
  }
  // Nur mit der Datenart Zonen, nur im Speicher des Dienstes, nie ins Log
  vorschlag(m) {
    var _a, _b;
    const v = m;
    if (this.o.version < import_zonen.ZONEN_SEIT) {
      this.o.verbindung.sendeFehler("ungueltig", { text: "vorschlag erst ab Protokollversion 7" });
      return Promise.resolve();
    }
    if (!this.handydaten.zonen) {
      this.o.verbindung.sendeFehler("aus", { text: "zonen ist f\xFCr diese App nicht eingeschaltet" });
      return Promise.resolve();
    }
    if (!this.vorschlagEimer.nimm(this.jetzt())) {
      this.o.verbindung.sendeFehler("zuviel", { text: "h\xF6chstens ein Vorschlag je Minute" });
      return Promise.resolve();
    }
    (_b = (_a = this.o).vorschlag) == null ? void 0 : _b.call(_a, { breite: v.breite, laenge: v.laenge, genauigkeit: v.genauigkeit, zeit: v.zeit });
    this.o.log.info(`App ${this.o.appId}: Vorschlag f\xFCr den Mittelpunkt einer Zone empfangen`);
    return Promise.resolve();
  }
  // Version und Menge; die Freigabe prüft erledige
  zonenPruefen(was) {
    if (this.o.version < import_zonen.ZONEN_SEIT) {
      this.o.verbindung.sendeFehler("ungueltig", { text: `${was} erst ab Protokollversion 7` });
      return false;
    }
    if (this.handydaten.zonen && !this.zonenEimer.nimm(this.jetzt())) {
      this.o.verbindung.sendeFehler("zuviel", { text: "zu viele Zonenmeldungen" });
      return false;
    }
    return true;
  }
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
      if (ordner && await this.darfOrdner(ordner)) {
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
    if (this.handydaten.benachrichtigung) {
      this.ausgewaehlt = new Set(namen.keys());
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
  async darfOrdner(ordner) {
    var _a;
    if (this.ausgewaehlt) {
      return this.ausgewaehlt.has(ordner);
    }
    (_a = this.ohneAuswahl) != null ? _a : this.ohneAuswahl = new Set(await this.o.ablage.benachrichtigungsordner(this.o.appId));
    if (this.ohneAuswahl.has(ordner)) {
      return true;
    }
    if (this.ohneAuswahl.size >= ORDNER_HOECHSTENS) {
      if (!this.zuVieleGemeldet) {
        this.zuVieleGemeldet = true;
        this.o.log.warn(
          `App ${this.o.appId}: mehr als ${ORDNER_HOECHSTENS} Apps mit Benachrichtigungen, weitere nur unter ${import_objekte.LETZTE}`
        );
      }
      return false;
    }
    this.ohneAuswahl.add(ordner);
    return true;
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
async function meldeZonenAus(ablage, appId, text) {
  var _a;
  const aktiv = await ablage.zustand(appId, "zonen.aktiv");
  if (!aktiv) {
    return;
  }
  if (aktiv.val !== false || ((_a = await ablage.zustand(appId, "zonen.grund")) == null ? void 0 : _a.val) !== text) {
    await ablage.schreibe(appId, { "zonen.aktiv": false, "zonen.grund": text });
  }
}
class Eimer {
  constructor(stoss, abstandMs) {
    this.stoss = stoss;
    this.abstandMs = abstandMs;
    this.marken = stoss;
  }
  marken;
  zeit;
  nimm(jetzt) {
    if (this.zeit !== void 0) {
      this.marken = Math.min(this.stoss, this.marken + (jetzt - this.zeit) / this.abstandMs);
    }
    this.zeit = jetzt;
    if (this.marken < 1) {
      return false;
    }
    this.marken -= 1;
    return true;
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
  Eimer,
  Handyeingang,
  kuerze,
  meldeZonenAus,
  neueHandyeimer
});
//# sourceMappingURL=handydaten.js.map
