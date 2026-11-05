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
var erkennung_exports = {};
__export(erkennung_exports, {
  erkenneGeraete: () => erkenneGeraete,
  vorschlaege: () => vorschlaege
});
module.exports = __toCommonJS(erkennung_exports);
var import_type_detector = require("@iobroker/type-detector");
var import_rechte = require("./rechte");
const LICHT = { schalten: ["ON"], helligkeit: ["DIMMER", "BRIGHTNESS"], farbtemperatur: ["TEMPERATURE"] };
const ZUORDNUNG = {
  [import_type_detector.Types.light]: { typ: "lampe", teile: { schalten: ["SET"] } },
  [import_type_detector.Types.dimmer]: { typ: "lampe", teile: { schalten: ["ON_SET"], helligkeit: ["SET"] } },
  [import_type_detector.Types.ct]: { typ: "lampe", teile: LICHT },
  [import_type_detector.Types.rgbSingle]: { typ: "lampe", teile: { ...LICHT, farbe: ["RGB"] } },
  [import_type_detector.Types.rgbwSingle]: { typ: "lampe", teile: LICHT },
  [import_type_detector.Types.hue]: { typ: "lampe", teile: LICHT },
  [import_type_detector.Types.rgb]: { typ: "lampe", teile: LICHT },
  [import_type_detector.Types.socket]: { typ: "schalter", teile: { schalten: ["SET"] } },
  [import_type_detector.Types.thermostat]: { typ: "thermostat", teile: { soll: ["SET", "SET_HEATING"], ist: ["ACTUAL"] } },
  [import_type_detector.Types.temperature]: { typ: "messwert", werte: ["ACTUAL", "SECOND"] },
  [import_type_detector.Types.humidity]: { typ: "messwert", werte: ["ACTUAL"] },
  [import_type_detector.Types.illuminance]: { typ: "messwert", werte: ["ACTUAL"] },
  [import_type_detector.Types.pressure]: { typ: "messwert", werte: ["PRESSURE"] },
  [import_type_detector.Types.window]: { typ: "messwert", werte: ["ACTUAL"] },
  [import_type_detector.Types.windowTilt]: { typ: "messwert", werte: ["ACTUAL"] },
  [import_type_detector.Types.door]: { typ: "messwert", werte: ["ACTUAL"] },
  [import_type_detector.Types.contact]: { typ: "messwert", werte: ["ACTUAL"] },
  [import_type_detector.Types.motion]: { typ: "messwert", werte: ["ACTUAL", "SECOND"] },
  [import_type_detector.Types.fireAlarm]: { typ: "messwert", werte: ["ACTUAL", "CO"] },
  [import_type_detector.Types.floodAlarm]: { typ: "messwert", werte: ["ACTUAL"] },
  [import_type_detector.Types.airQuality]: { typ: "messwert", werte: ["AQI", "CO2", "PM25", "PM10", "TVOC", "ACTUAL", "HUMIDITY"] },
  [import_type_detector.Types.electricity]: { typ: "messwert", werte: ["ELECTRIC_POWER", "CONSUMPTION", "CURRENT", "VOLTAGE"] }
};
const ERKANNT = Object.keys(ZUORDNUNG);
const EIN_LICHT = [["light", "dimmer", "ct", "rgbSingle", "rgbwSingle", "hue", "rgb"]];
const OHNE_GERAETE = /* @__PURE__ */ new Set([
  "communication",
  "date-and-time",
  "general",
  "logic",
  "messaging",
  "misc-data",
  "network",
  "notifications",
  "storage",
  "utility",
  "visualization",
  "visualization-icons",
  "visualization-widgets"
]);
const istGeraet = (o) => (o == null ? void 0 : o.type) === "device" || (o == null ? void 0 : o.type) === "channel";
function eltern(id) {
  const teile = id.split(".");
  return teile.slice(1, -1).map((_, i) => teile.slice(0, teile.length - 1 - i).join("."));
}
function erkenneGeraete(objekte, o) {
  var _a;
  const fremd = [
    "system",
    o.namespace,
    ...Object.values(objekte).filter((a) => a.type === "adapter" && OHNE_GERAETE.has(String(a.common.type))).map((a) => a._id.slice("system.adapter.".length))
  ];
  const nutzbar = {};
  for (const [id, obj] of Object.entries(objekte)) {
    if (obj.type === "enum" || ["state", "channel", "device"].includes(obj.type) && !fremd.some((f) => (0, import_rechte.liegtUnter)(id, f))) {
      nutzbar[id] = obj;
    }
  }
  const ids = Object.keys(nutzbar).sort();
  const reihe = [
    ...ids.filter((id) => nutzbar[id].type === "channel"),
    ...ids.filter((id) => nutzbar[id].type === "device"),
    ...ids.filter((id) => nutzbar[id].type === "state" && !eltern(id).some((e) => istGeraet(nutzbar[e])))
  ];
  const erkenner = new import_type_detector.ChannelDetector();
  const vergeben = /* @__PURE__ */ new Set();
  const ergebnis = [];
  for (const id of reihe) {
    const gefunden = (_a = erkenner.detect({
      objects: nutzbar,
      id,
      _keysOptional: ids,
      // Je Aufruf neu: Der Erkenner sperrt sonst auch, was er in einem Gerät gesehen, aber nicht genommen hat,
      // und ein zweiter Kanal ginge verloren. Doppeltes fängt vergeben ab.
      _usedIdsOptional: [],
      ignoreIndicators: ["UNREACH_STICKY"],
      allowedTypes: ERKANNT,
      limitTypesToOneOf: EIN_LICHT
    })) != null ? _a : [];
    for (const steuerung of gefunden) {
      const teile = teileAus(steuerung);
      const dps = Object.values(teile);
      if (dps.length === 0 || dps.some((dp) => vergeben.has(dp))) {
        continue;
      }
      dps.forEach((dp) => vergeben.add(dp));
      const kanal = eltern(dps[0]).find(
        (e) => {
          var _a2;
          return ((_a2 = nutzbar[e]) == null ? void 0 : _a2.type) === "channel" && (0, import_rechte.liegtUnter)(e, id) && dps.every((dp) => (0, import_rechte.liegtUnter)(dp, e));
        }
      );
      ergebnis.push({ herkunft: kanal != null ? kanal : id, typ: ZUORDNUNG[steuerung.type].typ, teile });
    }
  }
  return benenne(ohneDoppelteAliase(ergebnis, nutzbar), nutzbar, o.sprache);
}
function teileAus(steuerung) {
  const z = ZUORDNUNG[steuerung.type];
  const zustand = (namen) => namen.map((n) => {
    var _a;
    return (_a = steuerung.states.find((s) => s.name === n && s.id)) == null ? void 0 : _a.id;
  }).find(Boolean);
  if (z.werte) {
    const werte = z.werte.map((n) => zustand([n])).filter((dp) => dp !== void 0);
    return Object.fromEntries(werte.slice(0, 4).map((dp, i) => [`wert${i + 1}`, dp]));
  }
  return Object.fromEntries(
    Object.entries(z.teile).map(([teil, namen]) => [teil, zustand(namen)]).filter((e) => e[1] !== void 0)
  );
}
function benenne(liste, objekte, sprache) {
  const name = (id) => {
    var _a;
    return (0, import_rechte.text)((_a = objekte[id]) == null ? void 0 : _a.common.name, sprache, id.slice(id.lastIndexOf(".") + 1)).trim();
  };
  const geraete = liste.map(
    (e) => {
      var _a;
      return ((_a = objekte[e.herkunft]) == null ? void 0 : _a.type) === "device" ? e.herkunft : eltern(e.herkunft).find((x) => {
        var _a2;
        return ((_a2 = objekte[x]) == null ? void 0 : _a2.type) === "device";
      });
    }
  );
  return liste.map((e, i) => {
    const geraet = geraete[i];
    const eigener = name(e.herkunft);
    let gesamt = eigener;
    if (geraet && geraet !== e.herkunft) {
      const gname = name(geraet);
      gesamt = geraete.filter((g) => g === geraet).length === 1 ? gname : eigener.startsWith(gname) ? eigener : `${gname} ${eigener}`;
    }
    return { ...e, name: (gesamt || e.herkunft).slice(0, import_rechte.NAME_LAENGE) };
  });
}
function ohneDoppelteAliase(liste, objekte) {
  const ziele = new Set(
    liste.filter((e) => (0, import_rechte.liegtUnter)(e.herkunft, "alias")).flatMap((e) => Object.values(e.teile)).flatMap((dp) => {
      var _a, _b;
      return (_b = (0, import_rechte.merkmale)(dp, (_a = objekte[dp]) == null ? void 0 : _a.common, "").ziele) != null ? _b : [];
    })
  );
  return liste.filter((e) => (0, import_rechte.liegtUnter)(e.herkunft, "alias") || !Object.values(e.teile).every((dp) => ziele.has(dp)));
}
function vorschlaege(erkannt, o) {
  var _a;
  const mitZielen = (dp) => {
    var _a2, _b;
    return [dp, ...(_b = (_a2 = o.datenpunkt(dp)) == null ? void 0 : _a2.ziele) != null ? _b : []];
  };
  const belegt = new Set(o.karten.flatMap((k) => Object.values(k.teile)).flatMap(mitZielen));
  const ergebnis = [];
  for (const e of erkannt) {
    const alle = Object.values(e.teile).flatMap(mitZielen);
    if (alle.some((dp) => belegt.has(dp) || (0, import_rechte.liegtUnter)(dp, o.eigeneApps))) {
      continue;
    }
    const raum = o.raeume.find((r) => r.mitglieder.some((m) => [e.herkunft, ...alle].some((id) => (0, import_rechte.liegtUnter)(id, m))));
    const roh = { name: e.name, typ: e.typ, raum: (_a = raum == null ? void 0 : raum.id) != null ? _a : "", teile: e.teile };
    const maengel = (0, import_rechte.maengelDerKarte)(roh, o.datenpunkt);
    if (maengel.folge === "fehlt") {
      continue;
    }
    const passend = Object.entries(e.teile).filter(([teil]) => !maengel.teile[teil]);
    const teile = Object.fromEntries(
      e.typ === "messwert" ? passend.map(([, dp], i) => [`wert${i + 1}`, dp]) : passend
    );
    ergebnis.push({ herkunft: e.herkunft, karte: { ...roh, teile } });
  }
  return ergebnis;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  erkenneGeraete,
  vorschlaege
});
//# sourceMappingURL=erkennung.js.map
