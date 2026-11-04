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
var heimnetz_exports = {};
__export(heimnetz_exports, {
  Heimnetz: () => Heimnetz,
  alsAdresse: () => alsAdresse,
  automatischeAdressen: () => automatischeAdressen,
  imHeimnetz: () => imHeimnetz,
  normalisiere: () => normalisiere
});
module.exports = __toCommonJS(heimnetz_exports);
var import_node_net = __toESM(require("node:net"));
var import_node_os = __toESM(require("node:os"));
const WIEDERHOLEN_MS = 6e4;
const HOECHSTENS_ADRESSEN = 4;
const NICHT_IM_HEIMNETZ = /^(lo|docker.*|br-.*|veth.*|virbr.*)$/;
function normalisiere(adresse) {
  const v4 = adresse.startsWith("::ffff:") ? adresse.slice(7) : "";
  return import_node_net.default.isIPv4(v4) ? v4 : adresse;
}
function alsAdresse(host, port) {
  return import_node_net.default.isIPv6(host) ? `[${host}]:${port}` : `${host}:${port}`;
}
function privatV4(adresse) {
  const [a, b] = adresse.split(".").map(Number);
  return a === 10 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168;
}
const PRIVAT = new import_node_net.default.BlockList();
for (const [netz, laenge] of [
  ["10.0.0.0", 8],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16]
]) {
  PRIVAT.addSubnet(netz, laenge, "ipv4");
}
for (const [netz, laenge] of [
  ["fc00::", 7],
  ["fe80::", 10],
  ["::1", 128]
]) {
  PRIVAT.addSubnet(netz, laenge, "ipv6");
}
function imHeimnetz(adresse, schnittstellen = () => import_node_os.default.networkInterfaces()) {
  const art = import_node_net.default.isIPv4(adresse) ? "ipv4" : import_node_net.default.isIPv6(adresse) ? "ipv6" : void 0;
  if (!art) {
    return false;
  }
  if (PRIVAT.check(adresse, art)) {
    return true;
  }
  const eigene = new import_node_net.default.BlockList();
  for (const a of Object.values(schnittstellen()).flat()) {
    if ((a == null ? void 0 : a.cidr) && a.family.toLowerCase() === art) {
      const [netz, laenge] = a.cidr.split("/");
      eigene.addSubnet(netz, Number(laenge), art);
    }
  }
  return eigene.check(adresse, art);
}
function automatischeAdressen(port, schnittstellen = import_node_os.default.networkInterfaces()) {
  const v4 = /* @__PURE__ */ new Set();
  const v6 = /* @__PURE__ */ new Set();
  for (const [name, liste] of Object.entries(schnittstellen)) {
    if (NICHT_IM_HEIMNETZ.test(name)) {
      continue;
    }
    for (const a of liste != null ? liste : []) {
      if (a.internal) {
        continue;
      }
      if (a.family === "IPv4" && privatV4(a.address)) {
        v4.add(alsAdresse(a.address, port));
      } else if (a.family === "IPv6" && /^fd/i.test(a.address)) {
        v6.add(alsAdresse(a.address, port));
      }
    }
  }
  return [...v4, ...v6].slice(0, HOECHSTENS_ADRESSEN);
}
class Heimnetz {
  constructor(o) {
    this.o = o;
  }
  server;
  wiederholung;
  beendet = false;
  fremdGemeldet = false;
  get port() {
    var _a;
    const a = (_a = this.server) == null ? void 0 : _a.address();
    return typeof a === "object" && a ? a.port : void 0;
  }
  starte() {
    const server = import_node_net.default.createServer((socket) => this.angenommen(socket));
    this.server = server;
    server.on("error", (fehler) => {
      const grund = fehler.code === "EADDRINUSE" ? `Port ${this.o.port} ist belegt` : fehler.message;
      this.o.log.error(`Server f\xFCr Apps l\xE4uft nicht: ${grund}. Neuer Versuch in einer Minute.`);
      this.o.zustand(false);
      server.close();
      if (!this.beendet) {
        this.wiederholung = setTimeout(() => this.starte(), WIEDERHOLEN_MS);
      }
    });
    server.listen(this.o.port, () => {
      this.o.log.info(`Server f\xFCr Apps l\xE4uft auf Port ${this.port}`);
      this.o.zustand(true);
    });
  }
  // Offene Verbindungen beendet der Kern.
  beende() {
    var _a;
    this.beendet = true;
    clearTimeout(this.wiederholung);
    (_a = this.server) == null ? void 0 : _a.close();
  }
  angenommen(socket) {
    const adresse = socket.remoteAddress && normalisiere(socket.remoteAddress);
    if (!adresse || !imHeimnetz(adresse, this.o.schnittstellen)) {
      this.meldeFremd(adresse);
      socket.destroy();
      return;
    }
    socket.setNoDelay(true);
    const eigeneAdresse = socket.localAddress && socket.localPort ? alsAdresse(normalisiere(socket.localAddress), socket.localPort) : void 0;
    this.o.nimm(socket, { weg: "lokal", adresse, eigeneAdresse });
  }
  // Einmal als Warnung, damit eine Portweiterleitung auffällt; danach nur im Debug-Log, Scanner im Internet sind laut.
  meldeFremd(adresse) {
    const text = `Verbindung von ${adresse != null ? adresse : "unbekannter Adresse"} abgewiesen: nicht aus dem Heimnetz`;
    if (this.fremdGemeldet) {
      this.o.log.debug(text);
    } else {
      this.fremdGemeldet = true;
      this.o.log.warn(`${text}. Weitere nur im Debug-Log.`);
    }
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Heimnetz,
  alsAdresse,
  automatischeAdressen,
  imHeimnetz,
  normalisiere
});
//# sourceMappingURL=heimnetz.js.map
