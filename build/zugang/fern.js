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
var fern_exports = {};
__export(fern_exports, {
  Datenstrom: () => Datenstrom,
  FERNZEITEN: () => FERNZEITEN,
  Fern: () => Fern,
  VERMITTLERPROTOKOLL: () => VERMITTLERPROTOKOLL,
  grundAus: () => grundAus
});
module.exports = __toCommonJS(fern_exports);
var import_node_stream = require("node:stream");
var import_ws = require("ws");
const VERMITTLERPROTOKOLL = 1;
const NACHRICHT_BYTES = 32 * 1024;
const VERMITTLER_NACHRICHT_BYTES = 64 * 1024;
const FRIST_MS = 1e4;
const FERNZEITEN = {
  ersterVersuchMs: 1e3,
  letzterVersuchMs: 6e4,
  // Erst eine so lange stehende Steuerverbindung setzt den Abstand zurück. Sonst verbände ein Adapter, den der
  // Vermittler gleich wieder trennt, etwa weil eine zweite Instanz mit demselben Schlüssel läuft, jede Sekunde neu.
  stabilMs: 6e4,
  // Der Vermittler pingt die Steuerverbindung alle 30 s.
  stilleMs: 9e4,
  messenMs: 6e4,
  sitzungenJeFenster: 30,
  fensterMs: 10 * 6e4
};
class Datenstrom extends import_node_stream.Duplex {
  constructor(ws) {
    super();
    this.ws = ws;
    ws.on("message", (daten, binaer) => {
      if (!binaer) {
        this.destroy(new Error("Text auf der Datenverbindung"));
      } else if (!this.push(daten)) {
        ws.pause();
      }
    });
    ws.once("close", () => {
      if (!this.destroyed) {
        this.push(null);
      }
    });
    ws.on("error", (fehler) => this.destroy(fehler));
  }
  _read() {
    this.ws.resume();
  }
  _write(chunk, _kodierung, fertig) {
    let rest = chunk;
    const weiter = (fehler) => {
      if (fehler || rest.length === 0) {
        fertig(fehler);
        return;
      }
      const teil = rest.subarray(0, NACHRICHT_BYTES);
      rest = rest.subarray(teil.length);
      this.ws.send(teil, { binary: true }, weiter);
    };
    weiter();
  }
  _final(fertig) {
    this.ws.close(1e3);
    fertig();
  }
  _destroy(fehler, fertig) {
    if (this.ws.readyState !== import_ws.WebSocket.CLOSED) {
      this.ws.terminate();
    }
    fertig(fehler);
  }
}
class Fern {
  constructor(o) {
    this.o = o;
    this.z = { ...FERNZEITEN, ...o.zeiten };
    this.versuchMs = this.z.ersterVersuchMs;
    this.basis = o.adresse.replace(/^https:/, "wss:").replace(/\/+$/, "");
  }
  z;
  steuer;
  versuchMs;
  wiederholung;
  stille;
  messen;
  gepingt;
  seit = 0;
  beendet = false;
  letzterGrund = "";
  hashZuApp = /* @__PURE__ */ new Map();
  // Wann zuletzt Sitzungen abgeholt wurden, nur im laufenden Fenster
  abgeholt = [];
  gebremstGemeldet = 0;
  basis;
  starte() {
    void this.verbinde();
  }
  beende() {
    var _a;
    this.beendet = true;
    this.raeumeAuf();
    clearTimeout(this.wiederholung);
    (_a = this.steuer) == null ? void 0 : _a.terminate();
  }
  // Neue Liste der freigegebenen Apps: Wer fehlt, verliert beim Vermittler sofort seine Sitzungen.
  async abgleich() {
    var _a;
    const apps = await this.o.apps();
    this.hashZuApp = new Map(apps.map((a) => [a.hash, a.appId]));
    if (((_a = this.steuer) == null ? void 0 : _a.readyState) === import_ws.WebSocket.OPEN) {
      this.steuer.send(JSON.stringify({ art: "apps", hashes: [...this.hashZuApp.keys()] }));
    }
  }
  kopf() {
    return {
      headers: { Authorization: `Bearer ${this.o.adapterSchluessel}` },
      maxPayload: VERMITTLER_NACHRICHT_BYTES,
      perMessageDeflate: false,
      handshakeTimeout: FRIST_MS
    };
  }
  async verbinde() {
    if (this.beendet) {
      return;
    }
    this.o.stand({ art: "verbindet" });
    this.letzterGrund = "";
    try {
      await this.pruefeVersion();
      await this.abgleich();
    } catch (fehler) {
      this.spaeter(fehler.message);
      return;
    }
    if (this.beendet) {
      return;
    }
    const ws = new import_ws.WebSocket(`${this.basis}/adapter`, this.kopf());
    this.steuer = ws;
    ws.on("open", () => {
      this.seit = Date.now();
      this.o.log.info(`Fernzugang: mit dem Vermittler ${this.o.adresse} verbunden`);
      this.o.stand({ art: "verbunden", seit: this.seit });
      ws.send(JSON.stringify({ art: "apps", hashes: [...this.hashZuApp.keys()] }));
      this.lebt();
      this.messen = setInterval(() => {
        this.gepingt = Date.now();
        ws.ping();
      }, this.z.messenMs);
    });
    ws.on("ping", () => this.lebt());
    ws.on("pong", () => {
      this.lebt();
      if (this.gepingt !== void 0) {
        this.o.stand({ art: "verbunden", seit: this.seit, verzoegerungMs: Date.now() - this.gepingt });
        this.gepingt = void 0;
      }
    });
    ws.on("message", (daten, binaer) => {
      this.lebt();
      if (!binaer) {
        this.nachricht(daten.toString("utf8"));
      }
    });
    ws.on("error", (fehler) => {
      this.letzterGrund = grundAus(fehler);
    });
    ws.on("close", (code, grund) => {
      this.raeumeAuf();
      const stabil = this.seit > 0 && Date.now() - this.seit >= this.z.stabilMs;
      this.seit = 0;
      if (this.steuer === ws) {
        this.steuer = void 0;
        if (stabil) {
          this.versuchMs = this.z.ersterVersuchMs;
        }
        const ersetzt = code === 1001 && grund.toString("utf8") === "ersetzt";
        this.spaeter(
          this.letzterGrund || (ersetzt ? "Ein anderer Adapter mit demselben Schl\xFCssel hat sich beim Vermittler angemeldet" : `Verbindung beendet (${code})`)
        );
      }
    });
  }
  async pruefeVersion() {
    let info;
    try {
      const antwort = await fetch(`${this.o.adresse.replace(/\/+$/, "")}/info`, {
        signal: AbortSignal.timeout(FRIST_MS),
        redirect: "error"
      });
      if (!antwort.ok) {
        throw new Error(`antwortet mit ${antwort.status}`);
      }
      info = await antwort.json();
    } catch (fehler) {
      throw new Error(`Vermittler nicht erreichbar: ${grundAus(fehler)}`);
    }
    const version = info == null ? void 0 : info.protokoll;
    if (version !== VERMITTLERPROTOKOLL) {
      throw new Error(`Vermittler spricht Protokoll ${String(version)}, der Adapter ${VERMITTLERPROTOKOLL}`);
    }
  }
  nachricht(text) {
    let m;
    try {
      m = JSON.parse(text);
    } catch {
      this.o.log.debug("Fernzugang: unlesbare Nachricht vom Vermittler");
      return;
    }
    if (m.art !== "sitzung" || typeof m.nummer !== "string" || !/^[0-9a-f]{32}$/.test(m.nummer)) {
      this.o.log.debug(`Fernzugang: unbekannte Nachricht vom Vermittler (${String(m.art)})`);
      return;
    }
    const appId = typeof m.app === "string" ? this.hashZuApp.get(m.app) : void 0;
    if (!appId) {
      this.o.log.debug("Fernzugang: Sitzung einer unbekannten App nicht ge\xF6ffnet");
      return;
    }
    if (!this.darfAbholen(Date.now())) {
      return;
    }
    const daten = new import_ws.WebSocket(`${this.basis}/adapter/sitzung/${m.nummer}`, this.kopf());
    daten.on("error", (fehler) => this.o.log.debug(`Fernzugang, Sitzung der App ${appId}: ${fehler.message}`));
    daten.once("open", () => {
      this.o.nimm(new Datenstrom(daten), { weg: "fern", adresse: `fern:${appId}`, app: appId });
    });
  }
  // Die App bekommt dann vom Vermittler nach 10 s Schluss und versucht es später wieder.
  darfAbholen(jetzt) {
    this.abgeholt = this.abgeholt.filter((t) => jetzt - t < this.z.fensterMs);
    if (this.abgeholt.length < this.z.sitzungenJeFenster) {
      this.abgeholt.push(jetzt);
      return true;
    }
    if (jetzt - this.gebremstGemeldet >= this.z.fensterMs) {
      this.gebremstGemeldet = jetzt;
      this.o.log.warn(
        `Fernzugang: mehr als ${this.z.sitzungenJeFenster} Sitzungen in ${this.z.fensterMs / 6e4} Minuten, weitere bleiben vorerst zu. Sonst sperrt der Schutz vor dem Vermittler wom\xF6glich diesen Anschluss.`
      );
    }
    return false;
  }
  lebt() {
    clearTimeout(this.stille);
    this.stille = setTimeout(() => {
      var _a;
      this.letzterGrund = "Vermittler antwortet nicht mehr";
      (_a = this.steuer) == null ? void 0 : _a.terminate();
    }, this.z.stilleMs);
  }
  raeumeAuf() {
    clearTimeout(this.stille);
    clearInterval(this.messen);
    this.gepingt = void 0;
  }
  spaeter(grund) {
    if (this.beendet) {
      return;
    }
    const naechsterVersuch = Date.now() + this.versuchMs;
    if (this.versuchMs === this.z.ersterVersuchMs) {
      this.o.log.warn(`Fernzugang: ${grund}. Neuer Versuch l\xE4uft im Hintergrund.`);
    } else {
      this.o.log.debug(`Fernzugang: ${grund}`);
    }
    this.o.stand({ art: "getrennt", grund, naechsterVersuch });
    this.wiederholung = setTimeout(() => void this.verbinde(), this.versuchMs);
    this.versuchMs = Math.min(this.versuchMs * 2, this.z.letzterVersuchMs);
  }
}
function grundAus(fehler) {
  var _a, _b, _c;
  const status = (_a = /Unexpected server response: (\d+)/.exec(fehler.message)) == null ? void 0 : _a[1];
  if (status === "401") {
    return "Der Vermittler kennt diesen Adapter nicht, die Zeile f\xFCr den Vermittler fehlt dort oder ist veraltet";
  }
  if (status === "429") {
    return "Der Vermittler bremst nach zu vielen Versuchen";
  }
  if (status) {
    return `Vermittler antwortet mit ${status}`;
  }
  const ursache = fehler.cause instanceof Error ? fehler.cause : void 0;
  const code = (_b = fehler.code) != null ? _b : ursache == null ? void 0 : ursache.code;
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return "Name des Vermittlers nicht gefunden";
  }
  if (code === "ECONNREFUSED" || code === "ECONNRESET" || code === "ETIMEDOUT") {
    return `keine Verbindung (${code})`;
  }
  if (code && /CERT|SELF_SIGNED|UNABLE_TO_VERIFY/.test(code)) {
    return `Zertifikat des Vermittlers ung\xFCltig (${code})`;
  }
  if ((ursache == null ? void 0 : ursache.message) === "bad port") {
    return "Port f\xFCr Webanfragen gesperrt, bitte einen anderen w\xE4hlen";
  }
  if (fehler.name === "TimeoutError") {
    return "keine Antwort binnen 10 s";
  }
  return (_c = ursache == null ? void 0 : ursache.message) != null ? _c : fehler.message;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Datenstrom,
  FERNZEITEN,
  Fern,
  VERMITTLERPROTOKOLL,
  grundAus
});
//# sourceMappingURL=fern.js.map
