"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var hinweise_exports = {};
__export(hinweise_exports, {
  Hinweise: () => Hinweise,
  alsHinweis: () => alsHinweis
});
module.exports = __toCommonJS(hinweise_exports);
var import_adapter_an_app_schema = __toESM(require("../../protokoll/v1/adapter-an-app.schema.json"));
var import_gemeinsam_schema = __toESM(require("../../protokoll/v1/gemeinsam.schema.json"));
var import_kodierung = require("../basis/kodierung");
var import_schema = require("../basis/schema");
const WARTEND_HOECHSTENS = 20;
const pruefeHinweis = (0, import_schema.erstellePruefer)({ $ref: `${import_adapter_an_app_schema.default.$id}#/$defs/hinweis` }, [import_adapter_an_app_schema.default, import_gemeinsam_schema.default]);
function alsHinweis(val, zeit) {
  if (typeof val !== "string") {
    return ["hinweis.senden braucht Text"];
  }
  let teile = { text: val };
  try {
    const json = JSON.parse(val);
    if (json && typeof json === "object" && !Array.isArray(json)) {
      teile = json;
    }
  } catch {
  }
  const { titel, text, wichtigkeit = "normal", ...rest } = teile;
  if (Object.keys(rest).length > 0) {
    return [`unbekannte Felder: ${Object.keys(rest).join(", ")}`.slice(0, 200)];
  }
  const hinweis = {
    t: "hinweis",
    id: (0, import_kodierung.neueHinweisId)(),
    ...titel === void 0 ? {} : { titel },
    text,
    wichtigkeit,
    zeit
  };
  const fehler = pruefeHinweis(hinweis);
  return fehler.length > 0 ? fehler : hinweis;
}
const pruefsumme = (val) => (0, import_kodierung.sha256)(String(val)).toString("base64url");
const bearbeitet = (stand, state) => state.ts < stand.bearbeitet || state.ts === stand.bearbeitet && pruefsumme(state.val) === stand.pruefsumme;
class Hinweise {
  constructor(o) {
    this.o = o;
  }
  fristen = /* @__PURE__ */ new Map();
  // Nacheinander, weil jeder Schritt den Stand einer App liest und ganz zurückschreibt
  reihe = Promise.resolve();
  beendet = false;
  starte(appIds) {
    return this.nacheinander(async () => {
      for (const appId of appIds) {
        for (const hinweis of (await this.o.ablage.hinweise(appId)).warteschlange) {
          this.planeFrist(appId, hinweis);
        }
      }
    });
  }
  // Was Skripte geschrieben haben, während der Adapter nicht lief oder noch nicht abonniert hatte
  async holeNach(appIds) {
    for (const appId of appIds) {
      const state = await this.o.ablage.zustand(appId, "hinweis.senden");
      if (state && !state.ack) {
        this.neu(appId, state);
      }
    }
    await this.reihe;
  }
  neu(appId, state) {
    void this.nacheinander(async () => {
      const stand = await this.o.ablage.hinweise(appId);
      if (bearbeitet(stand, state)) {
        return;
      }
      stand.bearbeitet = state.ts;
      stand.pruefsumme = pruefsumme(state.val);
      const hinweis = alsHinweis(state.val, state.ts);
      if (Array.isArray(hinweis) || stand.warteschlange.length >= WARTEND_HOECHSTENS) {
        const grund = Array.isArray(hinweis) ? hinweis.join("; ") : "Warteschlange voll";
        this.o.log.debug(`Hinweis an App ${appId} abgewiesen: ${grund}`);
        stand.letzter = "";
        await this.o.ablage.legeHinweise(appId, stand);
        await this.status(appId, Array.isArray(hinweis) ? "ungueltig" : "voll");
        return;
      }
      stand.warteschlange.push(hinweis);
      stand.letzter = hinweis.id;
      await this.o.ablage.legeHinweise(appId, stand);
      this.planeFrist(appId, hinweis);
      const v = this.o.verbindung(appId);
      if (v == null ? void 0 : v.offen) {
        v.sende(hinweis);
      }
      await this.status(appId, (v == null ? void 0 : v.offen) ? "gesendet" : "wartet");
    });
  }
  // Alle noch nicht angezeigten, auch schon einmal gesendete: Die App erkennt doppelte an der ID.
  angemeldet(appId, v) {
    return this.nacheinander(async () => {
      const stand = await this.o.ablage.hinweise(appId);
      const gueltig = stand.warteschlange.filter((h) => pruefeHinweis(h).length === 0);
      gueltig.forEach((h) => v.sende(h));
      if (gueltig.some((h) => h.id === stand.letzter)) {
        await this.status(appId, "gesendet");
      }
    });
  }
  angezeigt(appId, id) {
    return this.nacheinander(async () => {
      const stand = await this.entferne(appId, id);
      if ((stand == null ? void 0 : stand.letzter) !== id) {
        return;
      }
      await this.status(appId, "angezeigt");
      const senden = await this.o.ablage.zustand(appId, "hinweis.senden");
      if ((senden == null ? void 0 : senden.ts) === stand.bearbeitet && pruefsumme(senden.val) === stand.pruefsumme) {
        await this.o.ablage.schreibe(appId, { "hinweis.senden": senden.val }, senden.ts);
      }
    });
  }
  // Die App ist entfernt, mit ihr die Warteschlange.
  vergiss(appId) {
    for (const [schluessel, frist] of this.fristen) {
      if (schluessel.startsWith(`${appId} `)) {
        clearTimeout(frist);
        this.fristen.delete(schluessel);
      }
    }
  }
  beende() {
    this.beendet = true;
    this.fristen.forEach((f) => clearTimeout(f));
    this.fristen.clear();
  }
  planeFrist(appId, hinweis) {
    const schluessel = `${appId} ${hinweis.id}`;
    clearTimeout(this.fristen.get(schluessel));
    this.fristen.set(
      schluessel,
      setTimeout(
        () => {
          this.fristen.delete(schluessel);
          void this.nacheinander(async () => {
            const stand = await this.entferne(appId, hinweis.id);
            if (!stand) {
              return;
            }
            this.o.log.warn(`Hinweis ${hinweis.id} der App ${appId} abgelaufen, nicht angezeigt`);
            if (stand.letzter === hinweis.id) {
              await this.status(appId, "abgelaufen");
            }
          });
        },
        Math.max(0, hinweis.zeit + this.o.fristMs - Date.now())
      )
    );
  }
  // Stand ohne den Hinweis, oder undefined, wenn er nicht (mehr) wartet
  async entferne(appId, id) {
    const stand = await this.o.ablage.hinweise(appId);
    const vorher = stand.warteschlange.length;
    stand.warteschlange = stand.warteschlange.filter((h) => h.id !== id);
    if (stand.warteschlange.length === vorher) {
      return void 0;
    }
    clearTimeout(this.fristen.get(`${appId} ${id}`));
    this.fristen.delete(`${appId} ${id}`);
    await this.o.ablage.legeHinweise(appId, stand);
    return stand;
  }
  status(appId, status) {
    return this.o.ablage.schreibe(appId, { "hinweis.status": status });
  }
  nacheinander(schritt) {
    this.reihe = this.reihe.then(() => this.beendet ? void 0 : schritt()).catch(() => this.o.log.error("Hinweise: Lesen oder Schreiben in ioBroker fehlgeschlagen"));
    return this.reihe;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Hinweise,
  alsHinweis
});
//# sourceMappingURL=hinweise.js.map
