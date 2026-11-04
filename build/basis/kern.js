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
var kern_exports = {};
__export(kern_exports, {
  Kern: () => Kern,
  SCHLIESSCODE: () => SCHLIESSCODE,
  Verbindung: () => Verbindung
});
module.exports = __toCommonJS(kern_exports);
var import_node_http = __toESM(require("node:http"));
var import_node_tls = __toESM(require("node:tls"));
var import_ws = require("ws");
var import_grenzen = require("./grenzen");
var import_schutz = require("./schutz");
const SCHLIESSCODE = {
  zugang: 4001,
  version: 4002,
  ungueltig: 4003,
  zuviel: 4004,
  abgelehnt: 4005,
  abgelaufen: 4006,
  ersetzt: 4007,
  entfernt: 4008,
  frist: 4009,
  ende: 1001,
  intern: 1011
};
const SCHLIESSEN_HART_MS = 2e3;
class Verbindung {
  constructor(ws, herkunft, grenzen, log, fristErfuellt) {
    this.ws = ws;
    this.herkunft = herkunft;
    this.grenzen = grenzen;
    this.log = log;
    this.fristErfuellt = fristErfuellt;
    ws.on("message", (daten, binaer) => {
      this.letzteAntwort = Date.now();
      if (!this.schliesst) {
        this.empfaenger(!binaer && Buffer.isBuffer(daten) ? daten.toString("utf8") : void 0);
      }
    });
    ws.on("pong", () => {
      this.letzteAntwort = Date.now();
    });
    ws.on("ping", (daten) => {
      if (this.offen) {
        this.ws.pong(daten);
        this.pruefePuffer();
      }
    });
    ws.on("error", (fehler) => log.debug(`WebSocket von ${herkunft.adresse}: ${fehler.message}`));
    ws.on("close", () => {
      this.getrennt = true;
      for (const fn of this.trennungen.splice(0)) {
        fn();
      }
    });
  }
  // undefined bei Binärframes
  empfaenger = () => void 0;
  trennungen = [];
  getrennt = false;
  schliesst = false;
  letzteAntwort = Date.now();
  get offen() {
    return !this.schliesst && this.ws.readyState === import_ws.WebSocket.OPEN;
  }
  sende(nachricht) {
    if (this.offen) {
      this.ws.send(JSON.stringify(nachricht));
      this.pruefePuffer();
    }
  }
  // Für große Antworten in Teilen: erst weiter, wenn der Teil an das Betriebssystem übergeben oder die Verbindung zu
  // ist. So bleibt der Sendepuffer bei einem Teil, statt über die Grenze zu wachsen.
  sendeUndWarte(nachricht) {
    return new Promise((resolve) => {
      if (!this.offen) {
        resolve();
        return;
      }
      const fertig = () => {
        this.ws.off("close", fertig);
        resolve();
      };
      this.ws.once("close", fertig);
      this.ws.send(JSON.stringify(nachricht), fertig);
      this.pruefePuffer();
    });
  }
  sendeFehler(code, angaben = {}) {
    var _a;
    const text = (_a = angaben.text) == null ? void 0 : _a.slice(0, this.grenzen.fehlertextZeichen);
    this.sende({ t: "fehler", code, ...angaben, ...text === void 0 ? {} : { text } });
  }
  schliesse(code, grund) {
    if (this.schliesst) {
      return;
    }
    this.schliesst = true;
    this.ws.close(code, grund);
    setTimeout(() => this.ws.terminate(), SCHLIESSEN_HART_MS).unref();
  }
  trenne() {
    this.schliesst = true;
    this.ws.terminate();
  }
  // Auch für schon getrennte Verbindungen, damit kein Aufrufer die Trennung verpasst.
  beiTrennung(fn) {
    if (this.getrennt) {
      fn();
    } else {
      this.trennungen.push(fn);
    }
  }
  pinge(jetzt) {
    if (jetzt - this.letzteAntwort >= this.grenzen.totMs) {
      this.log.debug(`Verbindung von ${this.herkunft.adresse} getrennt: keine Antwort auf Ping`);
      this.trenne();
    } else if (this.offen) {
      this.ws.ping();
    }
  }
  // Liest die Gegenstelle nicht mit, wird hart getrennt, statt den Speicher zu füllen.
  pruefePuffer() {
    if (this.ws.bufferedAmount > this.grenzen.sendepufferBytes) {
      this.log.warn(`Verbindung von ${this.herkunft.adresse} getrennt: Gegenstelle nimmt keine Nachrichten ab`);
      this.trenne();
    }
  }
}
class Kern {
  constructor(o) {
    this.o = o;
    var _a;
    this.grenzen = (_a = o.grenzen) != null ? _a : import_grenzen.GRENZEN;
    this.kontext = import_node_tls.default.createSecureContext({
      key: o.identitaet.schluessel,
      cert: o.identitaet.zertifikat,
      minVersion: "TLSv1.3"
    });
    this.wss = new import_ws.WebSocketServer({
      noServer: true,
      maxPayload: this.grenzen.nachrichtBytes,
      perMessageDeflate: false,
      clientTracking: false,
      autoPong: false
    });
    this.http.on("request", (_anfrage, antwort) => {
      antwort.writeHead(404, { connection: "close", "content-length": 0 }).end();
    });
    this.http.on(
      "upgrade",
      (anfrage, socket, kopf) => this.upgrade(anfrage, socket, kopf)
    );
    this.http.on("clientError", (_fehler, socket) => socket.destroy());
    this.takt = setInterval(() => {
      var _a2;
      const jetzt = Date.now();
      for (const e of this.eingaenge) {
        (_a2 = e.verbindung) == null ? void 0 : _a2.pinge(jetzt);
      }
    }, this.grenzen.pingMs);
    this.takt.unref();
  }
  grenzen;
  kontext;
  http = import_node_http.default.createServer();
  wss;
  eingaenge = /* @__PURE__ */ new Set();
  zuordnung = /* @__PURE__ */ new WeakMap();
  takt;
  beendet = false;
  nimm(strom, herkunft) {
    strom.on("error", () => void 0);
    const grund = this.ablehnung(herkunft.adresse);
    if (grund) {
      this.o.log.debug(`Verbindung von ${herkunft.adresse} abgewiesen: ${grund}`);
      strom.destroy();
      return;
    }
    const socket = new import_node_tls.default.TLSSocket(strom, { isServer: true, secureContext: this.kontext });
    const eingang = {
      tls: socket,
      herkunft,
      vorAnmeldung: true,
      frist: setTimeout(() => this.fristAbgelaufen(eingang), this.grenzen.anmeldungMs)
    };
    this.eingaenge.add(eingang);
    this.zuordnung.set(socket, eingang);
    socket.on("error", (fehler) => this.o.log.debug(`TLS von ${herkunft.adresse}: ${fehler.message}`));
    socket.on("close", () => {
      clearTimeout(eingang.frist);
      this.eingaenge.delete(eingang);
      strom.destroy();
    });
    this.http.emit("connection", socket);
  }
  async beende() {
    this.beendet = true;
    clearInterval(this.takt);
    for (const e of this.eingaenge) {
      if (e.verbindung) {
        e.verbindung.schliesse(SCHLIESSCODE.ende, "Adapter wird beendet");
      } else {
        e.tls.destroy();
      }
    }
    if (this.eingaenge.size > 0) {
      await new Promise((r) => setTimeout(r, 300));
    }
    for (const e of this.eingaenge) {
      e.tls.destroy();
    }
    this.wss.close();
  }
  ablehnung(adresse) {
    if (this.beendet) {
      return "Adapter wird beendet";
    }
    if (this.o.gesperrt(adresse)) {
      return "Adresse gesperrt";
    }
    if (this.eingaenge.size >= this.grenzen.verbindungen) {
      return `mehr als ${this.grenzen.verbindungen} Verbindungen`;
    }
    const bereich = (0, import_schutz.sperrbereich)(adresse);
    let gesamt = 0;
    let vonHier = 0;
    for (const e of this.eingaenge) {
      if (e.vorAnmeldung) {
        gesamt++;
        vonHier += (0, import_schutz.sperrbereich)(e.herkunft.adresse) === bereich ? 1 : 0;
      }
    }
    if (gesamt >= this.grenzen.ohneAnmeldung) {
      return `${gesamt} Verbindungen ohne Anmeldung insgesamt`;
    }
    return vonHier >= this.grenzen.offenJeAdresse ? `${vonHier} Verbindungen ohne Anmeldung` : void 0;
  }
  upgrade(anfrage, socket, kopf) {
    const eingang = this.zuordnung.get(socket);
    if (!eingang || anfrage.method !== "GET" || anfrage.url !== "/v1") {
      this.antworte(socket, 404);
      return;
    }
    if (anfrage.headers.origin !== void 0) {
      this.o.log.debug(`Verbindung von ${eingang.herkunft.adresse} abgewiesen: Origin-Kopf`);
      this.antworte(socket, 403);
      return;
    }
    this.wss.handleUpgrade(anfrage, socket, kopf, (ws) => {
      if (this.beendet || eingang.tls.destroyed) {
        ws.terminate();
        return;
      }
      eingang.verbindung = new Verbindung(ws, eingang.herkunft, this.grenzen, this.o.log, () => {
        clearTimeout(eingang.frist);
        eingang.vorAnmeldung = false;
      });
      this.o.verbunden(eingang.verbindung);
    });
  }
  antworte(socket, status) {
    socket.end(`HTTP/1.1 ${status} ${import_node_http.default.STATUS_CODES[status]}\r
Connection: close\r
Content-Length: 0\r
\r
`);
  }
  // Zählt als Fehlversuch: Wer Plätze ohne Anmeldung bis zur Frist belegt, wird wie bei falschem Zugang gesperrt.
  fristAbgelaufen(eingang) {
    this.o.fehlversuch(eingang.herkunft.adresse);
    if (eingang.verbindung) {
      this.o.log.warn(`Anmeldung von ${eingang.herkunft.adresse} abgelehnt: keine Anmeldung innerhalb der Frist`);
      eingang.verbindung.schliesse(SCHLIESSCODE.frist, "keine Anmeldung");
    } else {
      this.o.log.debug(`Verbindung von ${eingang.herkunft.adresse} getrennt: kein WebSocket innerhalb der Frist`);
      eingang.tls.destroy();
    }
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Kern,
  SCHLIESSCODE,
  Verbindung
});
//# sourceMappingURL=kern.js.map
