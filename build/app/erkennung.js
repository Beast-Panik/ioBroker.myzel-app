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
  verschoben: () => verschoben,
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
const WERTE_HOECHSTENS = Object.keys(import_rechte.KARTENARTEN.messwert.teile).length;
const alsWerte = (dps) => Object.fromEntries(dps.map((dp, i) => [`wert${i + 1}`, dp]));
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
const geraetVon = (herkunft, objekte) => [herkunft, ...eltern(herkunft)].find((x) => {
  var _a;
  return ((_a = objekte[x]) == null ? void 0 : _a.type) === "device";
});
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
      // Sonst sortiert der Erkenner die ganze Liste bei jedem Aufruf neu: quadratisch, bei 40 000 Objekten 30 s
      // Stillstand des Adapters statt 0,6 s
      _keysOptionalSorted: true,
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
      const herkunft = kanal != null ? kanal : id;
      ergebnis.push({
        herkunft,
        typ: ZUORDNUNG[steuerung.type].typ,
        teile,
        art: steuerung.type,
        geraet: geraetVon(herkunft, nutzbar)
      });
    }
  }
  return benenne(ohneEinstellungen(ohneDoppelteAliase(ergebnis, nutzbar), nutzbar), nutzbar, o.sprache);
}
function teileAus(steuerung) {
  const z = ZUORDNUNG[steuerung.type];
  const zustand = (namen) => namen.map((n) => {
    var _a;
    return (_a = steuerung.states.find((s) => s.name === n && s.id)) == null ? void 0 : _a.id;
  }).find(Boolean);
  if (z.werte) {
    const werte = z.werte.map((n) => zustand([n])).filter((dp) => dp !== void 0);
    return alsWerte(werte.slice(0, WERTE_HOECHSTENS));
  }
  return Object.fromEntries(
    Object.entries(z.teile).map(([teil, namen]) => [teil, zustand(namen)]).filter((e) => e[1] !== void 0)
  );
}
function benenne(liste, objekte, sprache) {
  const name = (id) => {
    var _a;
    return ((0, import_rechte.text)((_a = objekte[id]) == null ? void 0 : _a.common.name, sprache, id.slice(id.lastIndexOf(".") + 1)).trim() || id).slice(0, import_rechte.NAME_LAENGE);
  };
  return liste.map(({ geraet, ...e }) => {
    const eigener = name(e.herkunft);
    if (!geraet) {
      return { ...e, name: eigener };
    }
    const gname = name(geraet);
    const gesamt = geraet === e.herkunft || liste.filter((x) => x.geraet === geraet).length === 1 ? gname : eigener.startsWith(gname) ? eigener : `${gname} ${eigener}`;
    return { ...e, name: gesamt.slice(0, import_rechte.NAME_LAENGE), geraet: { id: geraet, name: gname } };
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
function ohneEinstellungen(liste, objekte) {
  const allgemein = (e) => {
    var _a, _b;
    return e.typ === "schalter" && ((_b = (_a = objekte[e.teile.schalten]) == null ? void 0 : _a.common) == null ? void 0 : _b.role) === "state";
  };
  const bestimmt = new Set(liste.filter((e) => e.geraet && !allgemein(e)).map((e) => e.geraet));
  return liste.filter((e) => !allgemein(e) || !bestimmt.has(e.geraet));
}
function teileAls(g, typ) {
  if (g.typ === typ || typ === "lampe" && g.typ === "schalter") {
    return g.teile;
  }
  const werte = Object.values(g.teile);
  if (typ === "thermostat" && werte.length === 1 && g.arten.every((a) => a === import_type_detector.Types.temperature)) {
    return { ist: werte[0] };
  }
  return void 0;
}
function vereint(a, b) {
  var _a;
  if (a.raum && b.raum && a.raum !== b.raum || a.geraet && b.geraet && a.geraet.id !== b.geraet.id) {
    return void 0;
  }
  const typ = a.typ === b.typ ? a.typ : ["lampe", "thermostat"].find((t) => a.typ === t || b.typ === t);
  const ta = typ && teileAls(a, typ);
  const tb = typ && teileAls(b, typ);
  if (!typ || !ta || !tb) {
    return void 0;
  }
  let teile;
  if (typ === "messwert") {
    const werte = [...Object.values(ta), ...Object.values(tb)];
    if (werte.length > WERTE_HOECHSTENS || a.arten.some((x) => b.arten.includes(x))) {
      return void 0;
    }
    teile = alsWerte(werte);
  } else {
    if (Object.keys(ta).some((t) => t in tb)) {
      return void 0;
    }
    teile = Object.fromEntries(
      Object.keys(import_rechte.KARTENARTEN[typ].teile).filter((t) => {
        var _a2;
        return (_a2 = ta[t]) != null ? _a2 : tb[t];
      }).map((t) => {
        var _a2;
        return [t, (_a2 = ta[t]) != null ? _a2 : tb[t]];
      })
    );
  }
  const geraet = (_a = a.geraet) != null ? _a : b.geraet;
  return {
    herkunft: [...a.herkunft, ...b.herkunft],
    // Aus einem Gerät zusammengefasst, heißt es wie das Gerät, nicht wie einer seiner Kanäle.
    name: a.geraet && b.geraet ? a.geraet.name : a.name,
    typ,
    teile,
    arten: [...a.arten, ...b.arten],
    raum: a.raum || b.raum,
    ...geraet && { geraet }
  };
}
function zusammengefasst(gruppen) {
  var _a;
  const schluessel = (g) => [
    `name ${g.herkunft[0].split(".").slice(0, 2).join(".")} ${g.name.trim().replace(/\s+/g, " ").toLocaleLowerCase()}`,
    ...g.geraet ? [`geraet ${g.geraet.id}`] : []
  ];
  const ergebnis = [];
  const offen = /* @__PURE__ */ new Map();
  for (const g of gruppen) {
    const stelle = schluessel(g).flatMap((s) => {
      var _a2;
      return (_a2 = offen.get(s)) != null ? _a2 : [];
    }).find((i2) => vereint(ergebnis[i2], g));
    const i = stelle != null ? stelle : ergebnis.push(g) - 1;
    if (stelle !== void 0) {
      ergebnis[i] = vereint(ergebnis[i], g);
    }
    for (const s of schluessel(ergebnis[i])) {
      const stellen = (_a = offen.get(s)) != null ? _a : [];
      if (!stellen.includes(i)) {
        offen.set(s, [...stellen, i]);
      }
    }
  }
  return ergebnis;
}
function vorschlaege(erkannt, o) {
  const ids = [...o.alleIds].sort();
  const unter = (m) => {
    const praefix = `${m}.`;
    let i = ersterAb(ids, praefix);
    const aus = [];
    while (i < ids.length && ids[i].startsWith(praefix)) {
      aus.push(ids[i++]);
    }
    return aus;
  };
  const mitZielen = (dp) => {
    var _a, _b;
    return [dp, ...(_b = (_a = o.datenpunkt(dp)) == null ? void 0 : _a.ziele) != null ? _b : []];
  };
  const belegt = new Set(o.karten.flatMap((k) => Object.values(k.teile)).flatMap(mitZielen));
  const gruppen = erkannt.map((e) => ({
    herkunft: [e.herkunft],
    name: e.name,
    typ: e.typ,
    teile: e.teile,
    arten: [e.art],
    raum: raumVon([e.herkunft, ...Object.values(e.teile).flatMap(mitZielen)], o.raeume),
    ...e.geraet && { geraet: e.geraet }
  }));
  const ergebnis = [];
  const alleGruppen = zusammengefasst(gruppen);
  for (const g of alleGruppen) {
    const alle = Object.values(g.teile).flatMap(mitZielen);
    if (alle.some((dp) => belegt.has(dp) || (0, import_rechte.istHandydatum)(dp, o.eigeneApps))) {
      continue;
    }
    const roh = { name: g.name, typ: g.typ, raum: g.raum, teile: g.teile };
    const maengel = (0, import_rechte.maengelDerKarte)(roh, o.datenpunkt);
    if (maengel.folge === "fehlt") {
      continue;
    }
    const passend = Object.entries(g.teile).filter(([teil]) => !maengel.teile[teil]);
    const teile = g.typ === "messwert" ? alsWerte(passend.map(([, dp]) => dp)) : Object.fromEntries(passend);
    ergebnis.push({
      herkunft: g.herkunft,
      ...zuordnungVon(g, alleGruppen, o.raeume, unter),
      karte: { ...roh, teile }
    });
  }
  return ergebnis;
}
function zuordnungVon(g, alle, raeume, unter) {
  const andere = alle.filter((x) => x !== g).flatMap((x) => [...x.herkunft, ...Object.values(x.teile)]);
  const eigene = [...g.herkunft, ...Object.values(g.teile)];
  const ganz = (m) => {
    var _a;
    return m === ((_a = g.geraet) == null ? void 0 : _a.id) || unter(m).every((dp) => eigene.some((e) => (0, import_rechte.liegtUnter)(dp, e)));
  };
  const zuordnung = /* @__PURE__ */ new Set();
  const bleibt = /* @__PURE__ */ new Map();
  for (const h of g.herkunft) {
    const halter = raeume.flatMap(
      (r) => r.mitglieder.filter((m) => m !== h && (0, import_rechte.liegtUnter)(h, m)).map((m) => ({ raum: r.id, ueber: m }))
    );
    const aeusserstes = halter.map((x) => x.ueber).filter((m) => m.split(".").length > 2 && !andere.some((id) => (0, import_rechte.liegtUnter)(id, m)) && ganz(m)).sort((a, b) => a.length - b.length)[0];
    zuordnung.add(aeusserstes != null ? aeusserstes : h);
    for (const x of halter.filter((x2) => !aeusserstes || !(0, import_rechte.liegtUnter)(x2.ueber, aeusserstes))) {
      bleibt.set(`${x.raum} ${x.ueber}`, x);
    }
  }
  return { zuordnung: [...zuordnung], bleibt: [...bleibt.values()] };
}
function ersterAb(sortiert, wert) {
  let links = 0;
  let rechts = sortiert.length;
  while (links < rechts) {
    const mitte = links + rechts >> 1;
    if (sortiert[mitte] < wert) {
      links = mitte + 1;
    } else {
      rechts = mitte;
    }
  }
  return links;
}
function raumVon(ids, raeume) {
  var _a, _b;
  return (_b = (_a = raeume.find((r) => r.mitglieder.some((m) => ids.some((id) => (0, import_rechte.liegtUnter)(id, m))))) == null ? void 0 : _a.id) != null ? _b : "";
}
function verschoben(mitglieder, zuordnung, imNeuen) {
  if (imNeuen) {
    return [...mitglieder, ...zuordnung.filter((z) => !mitglieder.some((m) => (0, import_rechte.liegtUnter)(z, m)))];
  }
  return mitglieder.filter((m) => !zuordnung.some((z) => (0, import_rechte.liegtUnter)(m, z)));
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  erkenneGeraete,
  verschoben,
  vorschlaege
});
//# sourceMappingURL=erkennung.js.map
