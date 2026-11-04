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
var schutz_exports = {};
__export(schutz_exports, {
  Eimer: () => Eimer,
  Sperrliste: () => Sperrliste,
  Ueberlast: () => Ueberlast,
  sperrbereich: () => sperrbereich
});
module.exports = __toCommonJS(schutz_exports);
var import_node_net = __toESM(require("node:net"));
var import_grenzen = require("./grenzen");
class Eimer {
  constructor(jeSekunde, stoss, jetzt) {
    this.jeSekunde = jeSekunde;
    this.stoss = stoss;
    this.vorrat = stoss;
    this.stand = jetzt;
  }
  vorrat;
  stand;
  nimm(jetzt) {
    this.vorrat = Math.min(this.stoss, this.vorrat + (jetzt - this.stand) * this.jeSekunde / 1e3);
    this.stand = jetzt;
    if (this.vorrat < 1) {
      return false;
    }
    this.vorrat -= 1;
    return true;
  }
}
class Ueberlast {
  constructor(grenzen = import_grenzen.GRENZEN) {
    this.grenzen = grenzen;
  }
  beginn;
  letzte = 0;
  abgelehnt(jetzt) {
    if (this.beginn === void 0 || jetzt - this.letzte > this.grenzen.ueberlastPauseMs) {
      this.beginn = jetzt;
    }
    this.letzte = jetzt;
    return jetzt - this.beginn >= this.grenzen.ueberlastMs;
  }
}
function sperrbereich(adresse) {
  const ohneZone = adresse.split("%")[0];
  if (!import_node_net.default.isIPv6(ohneZone)) {
    return adresse;
  }
  const [vorn, hinten] = ohneZone.split("::");
  const gruppen = (teil) => teil ? teil.split(":") : [];
  const laenge = (g) => {
    var _a;
    return g.length + (((_a = g.at(-1)) == null ? void 0 : _a.includes(".")) ? 1 : 0);
  };
  const a = gruppen(vorn);
  const b = gruppen(hinten);
  const alle = hinten === void 0 ? a : [...a, ...Array(8 - laenge(a) - laenge(b)).fill("0"), ...b];
  return `${alle.slice(0, 4).map((g) => parseInt(g, 16).toString(16)).join(":")}::/64`;
}
class Sperrliste {
  constructor(grenzen = import_grenzen.GRENZEN) {
    this.grenzen = grenzen;
  }
  eintraege = /* @__PURE__ */ new Map();
  gesperrt(adresse, jetzt) {
    return this.istGesperrt(this.eintraege.get(sperrbereich(adresse)), jetzt);
  }
  // true, wenn die Adresse durch diesen Versuch gesperrt wurde
  fehlversuch(adresse, jetzt) {
    var _a;
    const bereich = sperrbereich(adresse);
    const e = (_a = this.eintraege.get(bereich)) != null ? _a : { zeiten: [] };
    if (this.istGesperrt(e, jetzt)) {
      return false;
    }
    this.eintraege.delete(bereich);
    e.zeiten = [...e.zeiten.filter((z) => jetzt - z < this.grenzen.fehlversuchFensterMs), jetzt];
    e.gesperrtBis = void 0;
    const gesperrt = e.zeiten.length >= this.grenzen.fehlversuche;
    if (gesperrt) {
      e.zeiten = [];
      e.gesperrtBis = jetzt + this.grenzen.sperreMs;
    }
    this.eintraege.set(bereich, e);
    this.raeumeAuf(jetzt);
    return gesperrt;
  }
  istGesperrt(e, jetzt) {
    return (e == null ? void 0 : e.gesperrtBis) !== void 0 && e.gesperrtBis > jetzt;
  }
  raeumeAuf(jetzt) {
    if (this.eintraege.size <= this.grenzen.sperrlisteEintraege) {
      return;
    }
    for (const [bereich, e] of this.eintraege) {
      const aktiv = this.istGesperrt(e, jetzt) || e.zeiten.some((z) => jetzt - z < this.grenzen.fehlversuchFensterMs);
      if (!aktiv) {
        this.eintraege.delete(bereich);
      }
    }
    for (const auchGesperrte of [false, true]) {
      for (const [bereich, e] of this.eintraege) {
        if (this.eintraege.size <= this.grenzen.sperrlisteEintraege) {
          return;
        }
        if (auchGesperrte || !this.istGesperrt(e, jetzt)) {
          this.eintraege.delete(bereich);
        }
      }
    }
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Eimer,
  Sperrliste,
  Ueberlast,
  sperrbereich
});
//# sourceMappingURL=schutz.js.map
