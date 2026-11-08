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
var zonenseite_exports = {};
__export(zonenseite_exports, {
  ZONENBEFEHLE: () => ZONENBEFEHLE,
  Zonenseite: () => Zonenseite
});
module.exports = __toCommonJS(zonenseite_exports);
var import_zonen = require("../app/zonen");
var import_eintraege = require("./eintraege");
const ZONENBEFEHLE = ["zonenseite", "zonenstand", "speichereZone", "loescheZone"];
function pruefe(roh) {
  const r = (0, import_eintraege.nachricht)(roh);
  const mitte = (0, import_zonen.liesMitte)(r.mitte);
  if (!mitte) {
    return ["/mitte erwartet Breite und L\xE4nge mit Dezimalpunkt"];
  }
  return (0, import_zonen.alsZone)({
    name: typeof r.name === "string" ? r.name.trim() : r.name,
    breite: mitte.breite,
    laenge: mitte.laenge,
    radius: r.radius
  });
}
class Zonenseite {
  constructor(o) {
    this.o = o;
    this.zonen = new import_eintraege.Eintraege(
      {
        ordner: "zonen",
        kennbuchstabe: "z",
        was: "Zone",
        pruefe,
        imKatalog: (katalog, id) => katalog.zone(id),
        anzahl: (katalog) => katalog.zonen().length,
        hoechstens: import_zonen.ZONEN_HOECHSTENS,
        istId: import_zonen.istZonenId
      },
      o
    );
  }
  zonen;
  async beantworte(befehl, roh) {
    if (befehl === "zonenseite") {
      return (0, import_eintraege.seitenadresse)(this.o.namespace, "zonen.html");
    }
    const katalog = this.o.katalog();
    const apps = this.o.apps();
    if (!katalog || !apps) {
      return { fehler: "nichtBereit" };
    }
    const n = (0, import_eintraege.nachricht)(roh);
    switch (befehl) {
      case "zonenstand":
        return this.stand(katalog, apps);
      case "speichereZone":
        return this.mitStand(katalog, apps, await this.speichere(katalog, apps, n));
      case "loescheZone":
        return this.mitStand(katalog, apps, await this.loesche(katalog, apps, n.id));
      default:
        return void 0;
    }
  }
  async mitStand(katalog, apps, antwort) {
    return "fehler" in antwort ? antwort : { id: antwort.id, stand: await this.stand(katalog, apps) };
  }
  // Neu mit der ID aus wunsch, sonst die Zone id. Ein neuer Name gilt gleich für die Datenpunkte aller Apps.
  async speichere(katalog, apps, n) {
    var _a, _b;
    const vorher = (0, import_zonen.istZonenId)(n.id) ? (_a = katalog.zone(n.id)) == null ? void 0 : _a.name : void 0;
    if (n.id === void 0 && (0, import_zonen.istZonenId)(n.wunsch) && !katalog.gibtZone(n.wunsch) && !await this.o.ablage.liesEintrag("zonen", n.wunsch)) {
      await this.raeumeAuf(apps, n.wunsch);
    }
    const antwort = await this.zonen.speichere(katalog, n.id, n.zone, n.id === void 0 ? n.wunsch : void 0);
    const name = "fehler" in antwort ? void 0 : (_b = katalog.zone(antwort.id)) == null ? void 0 : _b.name;
    if (!("fehler" in antwort) && vorher !== void 0 && name !== void 0 && name !== vorher) {
      for (const appId of await apps.alle()) {
        await apps.benenneZone(appId, antwort.id, name);
      }
    }
    return antwort;
  }
  // Erst die Zone, dann bei jeder App die Wahl und der Datenpunkt. Für verbundene Apps entfernt der Dienst ihn nach der
  // Neuberechnung noch einmal, falls ein Wechsel vom Handy dazwischenkam.
  async loesche(katalog, apps, id) {
    const antwort = await this.zonen.loesche(katalog, id);
    if ("fehler" in antwort) {
      return antwort;
    }
    await this.raeumeAuf(apps, antwort.id);
    return antwort;
  }
  // Die Zone aus Wahl und Datenpunkten aller Apps. Scheitert es bei einer, geht es mit den übrigen weiter; was bleibt,
  // räumt spätestens eine neue Zone unter derselben ID auf.
  async raeumeAuf(apps, zone) {
    var _a;
    for (const appId of await apps.alle()) {
      try {
        const daten = await apps.lies(appId);
        if ((_a = daten == null ? void 0 : daten.zonenwahl) == null ? void 0 : _a.includes(zone)) {
          await apps.aendere(appId, { zonenwahl: daten.zonenwahl.filter((z) => z !== zone) });
        }
        if ((await apps.zonenpunkte(appId)).includes(zone)) {
          await apps.entferneZone(appId, zone);
        }
      } catch (fehler) {
        this.o.log.warn(`Zone ${zone} bei App ${appId} nicht aufger\xE4umt: ${fehler.message}`);
      }
    }
  }
  async stand(katalog, apps) {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    const je = /* @__PURE__ */ new Map();
    for (const appId of await apps.alle()) {
      const daten = await apps.lies(appId);
      if ((daten == null ? void 0 : daten.handydaten.zonen) === true) {
        for (const zone of (_a = daten.zonenwahl) != null ? _a : []) {
          je.set(zone, [...(_b = je.get(zone)) != null ? _b : [], daten.name]);
        }
      }
    }
    for (const namen of je.values()) {
      namen.sort((a, b) => a.localeCompare(b));
    }
    const vorschlaege = [];
    for (const { appId, ...v } of (_e = (_d = (_c = this.o).vorschlaege) == null ? void 0 : _d.call(_c)) != null ? _e : []) {
      const name = (_f = await apps.lies(appId)) == null ? void 0 : _f.name;
      if (name !== void 0) {
        vorschlaege.push({ app: name, ...v });
      }
    }
    return {
      sprache: katalog.sprache,
      zonen: katalog.zonen().map(([id, z]) => {
        var _a2;
        return { id, ...structuredClone(z), apps: (_a2 = je.get(id)) != null ? _a2 : [] };
      }),
      zuhause: (_g = katalog.zuhause()) != null ? _g : null,
      hoechstens: import_zonen.ZONEN_HOECHSTENS,
      laengen: { name: import_zonen.ZONENNAME_LAENGE, id: import_zonen.ZONENID_LAENGE },
      radius: { von: import_zonen.RADIUS_VON, bis: import_zonen.RADIUS_BIS, vorgabe: import_zonen.RADIUS_VORGABE },
      vorschlaege,
      jetzt: ((_h = this.o.jetzt) != null ? _h : Date.now)()
    };
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ZONENBEFEHLE,
  Zonenseite
});
//# sourceMappingURL=zonenseite.js.map
