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
var objekte_exports = {};
__export(objekte_exports, {
  IoBrokerAblage: () => IoBrokerAblage,
  IoBrokerQuelle: () => IoBrokerQuelle,
  LETZTE: () => LETZTE,
  appIdAus: () => appIdAus,
  ordnerFuer: () => ordnerFuer
});
module.exports = __toCommonJS(objekte_exports);
var import_gemeinsam_schema = __toESM(require("../../protokoll/v1/gemeinsam.schema.json"));
var import_schema = require("../basis/schema");
const nurLesen = { read: true, write: false };
const text = (de, en) => ({
  name: { de, en },
  type: "string",
  role: "text",
  ...nurLesen
});
const KANAELE = {
  akku: { de: "Akku", en: "Battery" },
  anruf: { de: "Anruf", en: "Call" },
  hinweis: { de: "Hinweis", en: "Notice" }
};
const DATENPUNKTE = {
  online: {
    name: { de: "Verbunden", en: "Connected" },
    type: "boolean",
    role: "indicator.reachable",
    def: false,
    ...nurLesen
  },
  zuletzt: { name: { de: "Zuletzt getrennt", en: "Last disconnected" }, type: "number", role: "date", ...nurLesen },
  weg: { name: { de: "Zugangsweg", en: "Connection path" }, type: "string", role: "text", ...nurLesen },
  profil: text("Profil", "Profile"),
  anwesend: { name: { de: "Anwesend", en: "Present" }, type: "boolean", role: "indicator", ...nurLesen },
  "akku.stand": {
    name: { de: "Akkustand", en: "Battery level" },
    type: "number",
    role: "value.battery",
    unit: "%",
    min: 0,
    max: 100,
    ...nurLesen
  },
  "akku.laedt": { name: { de: "L\xE4dt", en: "Charging" }, type: "boolean", role: "indicator", ...nurLesen },
  "anruf.status": text("Anrufstatus", "Call state"),
  "anruf.richtung": text("Richtung", "Direction"),
  "anruf.nummer": { ...text("Rufnummer", "Phone number"), role: "text.phone" },
  "anruf.name": text("Name", "Name"),
  "hinweis.senden": { ...text("Hinweis senden", "Send notice"), write: true },
  "hinweis.status": text("Hinweisstatus", "Notice state")
};
const BENACHRICHTIGUNG = {
  app: text("App", "App"),
  paket: text("Paketname", "Package name"),
  titel: text("Titel", "Title"),
  text: text("Text", "Text"),
  zeit: { name: { de: "Zeit", en: "Time" }, type: "number", role: "date", ...nurLesen },
  json: { ...text("Alles als JSON", "All as JSON"), role: "json" }
};
const LETZTE = "letzte";
const LETZTE_NAME = { de: "Letzte Benachrichtigung", en: "Latest notification" };
const BENACHRICHTIGUNGEN_NAME = { de: "Benachrichtigungen", en: "Notifications" };
function ordnerFuer(paket) {
  const ordner = paket.replaceAll(".", "-");
  return ordner === LETZTE ? void 0 : ordner;
}
const pruefeAppId = (0, import_schema.erstellePruefer)({ $ref: `${import_gemeinsam_schema.default.$id}#/$defs/appId` }, [import_gemeinsam_schema.default]);
function appIdAus(namespace, objektId, name) {
  const praefix = `${namespace}.apps.`;
  const ende = name ? `.${name}` : "";
  if (!objektId.startsWith(praefix) || !objektId.endsWith(ende)) {
    return void 0;
  }
  const appId = objektId.slice(praefix.length, objektId.length - ende.length);
  return pruefeAppId(appId).length === 0 ? appId : void 0;
}
const LEERER_STAND = { warteschlange: [], letzter: "", bearbeitet: 0, pruefsumme: "" };
function alsHinweisstand(n) {
  return Array.isArray(n == null ? void 0 : n.warteschlange) && typeof n.letzter === "string" && typeof n.bearbeitet === "number" && typeof n.pruefsumme === "string" ? n : structuredClone(LEERER_STAND);
}
const istText = (w) => typeof w === "string";
const istJaNein = (w) => typeof w === "boolean";
function alsAppDaten(n) {
  const h = n.handydaten;
  const g = n.geraet;
  const gueltig = istText(n.name) && istText(n.zugangHash) && /^[0-9a-f]{64}$/.test(n.zugangHash) && istText(n.profil) && typeof n.gekoppeltAm === "number" && istJaNein(h == null ? void 0 : h.akku) && istJaNein(h == null ? void 0 : h.anruf) && istJaNein(h == null ? void 0 : h.benachrichtigung) && istText(g == null ? void 0 : g.android) && istText(g == null ? void 0 : g.appVersion);
  return gueltig ? { ...n, handydaten: { akku: h.akku, anruf: h.anruf, benachrichtigung: h.benachrichtigung } } : void 0;
}
const ORDNERNAMEN = {
  karten: { de: "Karten f\xFCr die Apps", en: "Cards for the apps" },
  profile: { de: "Profile f\xFCr die Apps", en: "Profiles for the apps" }
};
class IoBrokerAblage {
  constructor(adapter) {
    this.adapter = adapter;
  }
  angelegt = /* @__PURE__ */ new Set();
  async lies(appId) {
    const objekt = await this.adapter.getObjectAsync(`apps.${appId}`);
    if ((objekt == null ? void 0 : objekt.type) !== "device") {
      return void 0;
    }
    const daten = alsAppDaten(objekt.native);
    if (!daten) {
      this.adapter.log.warn(`Objekt der App ${appId} ist besch\xE4digt, die App gilt als unbekannt`);
    }
    return daten;
  }
  async alle() {
    const praefix = `${this.adapter.namespace}.apps.`;
    const ansicht = await this.adapter.getObjectViewAsync("system", "device", {
      startkey: praefix,
      endkey: `${praefix}\u9999`
    });
    return ansicht.rows.map((r) => appIdAus(this.adapter.namespace, r.id)).filter((id) => id !== void 0);
  }
  async lege(appId, daten) {
    await this.adapter.setObjectAsync(`apps.${appId}`, {
      type: "device",
      common: { name: daten.name, statusStates: { onlineId: `${this.adapter.namespace}.apps.${appId}.online` } },
      native: daten
    });
    await this.richteEin(appId);
    await this.schreibe(appId, { profil: daten.profil });
  }
  async richteEin(appId) {
    await this.sichere(appId, "hinweis.senden");
    const alt = `apps.${appId}.benachrichtigung`;
    if (await this.adapter.getObjectAsync(alt)) {
      await this.adapter.delObjectAsync(alt, { recursive: true });
      this.adapter.log.info(`App ${appId}: Kanal benachrichtigung entfernt, jetzt unter benachrichtigungen`);
    }
  }
  async benachrichtigungsordner(appId) {
    const praefix = `${this.adapter.namespace}.apps.${appId}.benachrichtigungen.`;
    const ansicht = await this.adapter.getObjectViewAsync("system", "channel", {
      startkey: praefix,
      endkey: `${praefix}\u9999`
    });
    return ansicht.rows.map((r) => r.id.slice(praefix.length)).filter((ordner) => ordner !== LETZTE && ordner.length > 0 && !ordner.includes("."));
  }
  // Nur bei neuem Namen geschrieben: Jede Auswahl nennt alle Apps, ihre Ordner bleiben meist, wie sie sind.
  async legeBenachrichtigungsordner(appId, ordner, name) {
    var _a, _b;
    const kanal = `apps.${appId}.benachrichtigungen.${ordner}`;
    await this.sichereBenachrichtigungen(appId);
    if (((_b = (_a = await this.adapter.getObjectAsync(kanal)) == null ? void 0 : _a.common) == null ? void 0 : _b.name) !== name) {
      await this.adapter.extendObjectAsync(kanal, { type: "channel", common: { name }, native: {} });
    }
    await this.sichereZustaende(kanal);
  }
  async entferneBenachrichtigungsordner(appId, ordner) {
    const kanal = `apps.${appId}.benachrichtigungen.${ordner}`;
    await this.adapter.delObjectAsync(kanal, { recursive: true });
    this.angelegt.delete(kanal);
  }
  async schreibeBenachrichtigung(appId, ordner, name, werte, ts) {
    const kanal = `apps.${appId}.benachrichtigungen.${ordner}`;
    if (!this.angelegt.has(kanal)) {
      await this.sichereBenachrichtigungen(appId);
      await this.adapter.setObjectNotExistsAsync(kanal, {
        type: "channel",
        common: { name: ordner === LETZTE ? LETZTE_NAME : name },
        native: {}
      });
      await this.sichereZustaende(kanal);
    }
    for (const [n, val] of Object.entries(werte)) {
      await this.adapter.setStateAsync(`${kanal}.${n}`, { val, ack: true, ts });
    }
  }
  async hinweise(appId) {
    var _a;
    return alsHinweisstand((_a = await this.adapter.getObjectAsync(`apps.${appId}.hinweis`)) == null ? void 0 : _a.native);
  }
  // Ganzes Objekt statt extendObject: extendObject führt Listen stellenweise zusammen, aus [1, 2, 3] und [9] würde
  // [9, 2, 3]. Ein eigenes Objekt statt des Geräts, damit nicht jeder Hinweis die Rechte neu berechnen lässt.
  async legeHinweise(appId, stand) {
    await this.adapter.setObjectAsync(`apps.${appId}.hinweis`, {
      type: "channel",
      common: { name: KANAELE.hinweis },
      native: stand
    });
  }
  async aendere(appId, daten) {
    await this.adapter.extendObjectAsync(`apps.${appId}`, { native: daten });
    if (daten.profil !== void 0) {
      await this.schreibe(appId, { profil: daten.profil });
    }
  }
  async entferne(appId) {
    await this.adapter.delObjectAsync(`apps.${appId}.hinweis`, { recursive: true });
    await this.adapter.delObjectAsync(`apps.${appId}`);
    [...this.angelegt].filter((id) => id.startsWith(`apps.${appId}.`)).forEach((id) => this.angelegt.delete(id));
  }
  async leereEinstellungen() {
    await this.adapter.updateConfig({ karten: [], profile: [] });
  }
  async liesEintrag(ordner, id) {
    var _a;
    const objekt = await this.adapter.getObjectAsync(`${ordner}.${id}`);
    return (objekt == null ? void 0 : objekt.type) === "config" ? (_a = objekt.native) != null ? _a : {} : void 0;
  }
  async schreibeEintrag(ordner, id, name, native) {
    if (!this.angelegt.has(ordner)) {
      await this.adapter.setObjectNotExistsAsync(ordner, {
        type: "folder",
        common: { name: ORDNERNAMEN[ordner] },
        native: {}
      });
      this.angelegt.add(ordner);
    }
    await this.adapter.setObjectAsync(`${ordner}.${id}`, { type: "config", common: { name }, native });
  }
  async loescheEintrag(ordner, id) {
    await this.adapter.delObjectAsync(`${ordner}.${id}`);
  }
  async loescheObjekt(id) {
    await this.adapter.delObjectAsync(id);
  }
  async schreibe(appId, werte, ts) {
    for (const [name, val] of Object.entries(werte)) {
      await this.sichere(appId, name);
      await this.adapter.setStateAsync(
        `apps.${appId}.${name}`,
        ts === void 0 ? { val, ack: true } : { val, ack: true, ts }
      );
    }
  }
  zustand(appId, name) {
    return this.adapter.getStateAsync(`apps.${appId}.${name}`);
  }
  async sichereBenachrichtigungen(appId) {
    const ordner = `apps.${appId}.benachrichtigungen`;
    if (!this.angelegt.has(ordner)) {
      await this.adapter.setObjectNotExistsAsync(ordner, {
        type: "folder",
        common: { name: BENACHRICHTIGUNGEN_NAME },
        native: {}
      });
      this.angelegt.add(ordner);
    }
  }
  async sichereZustaende(kanal) {
    for (const [n, common] of Object.entries(BENACHRICHTIGUNG)) {
      await this.adapter.setObjectNotExistsAsync(`${kanal}.${n}`, { type: "state", common, native: {} });
    }
    this.angelegt.add(kanal);
  }
  // Erst beim ersten Wert: So entstehen keine Datenpunkte für ausgeschaltete Handydaten.
  async sichere(appId, name) {
    const id = `apps.${appId}.${name}`;
    if (this.angelegt.has(id)) {
      return;
    }
    const kanal = name.includes(".") ? name.slice(0, name.indexOf(".")) : void 0;
    if (kanal) {
      await this.adapter.setObjectNotExistsAsync(`apps.${appId}.${kanal}`, {
        type: "channel",
        common: { name: KANAELE[kanal] },
        native: {}
      });
    }
    await this.adapter.setObjectNotExistsAsync(id, { type: "state", common: DATENPUNKTE[name], native: {} });
    this.angelegt.add(id);
  }
}
class IoBrokerQuelle {
  constructor(adapter) {
    this.adapter = adapter;
  }
  async objekte(typ, praefix) {
    const ansicht = await this.adapter.getObjectViewAsync("system", typ, {
      startkey: praefix,
      endkey: `${praefix}\u9999`
    });
    return ansicht.rows.map((r) => r.value).filter((o) => typeof (o == null ? void 0 : o._id) === "string");
  }
  abonniere(ids) {
    return this.adapter.subscribeForeignStatesAsync(ids);
  }
  kuendige(ids) {
    return this.adapter.unsubscribeForeignStatesAsync(ids);
  }
  async lies(ids) {
    return ids.length > 0 ? await this.adapter.getForeignStatesAsync(ids) : {};
  }
  async objekt(id) {
    const objekt = await this.adapter.getForeignObjectAsync(id);
    return (objekt == null ? void 0 : objekt.type) === "state" ? objekt.common : void 0;
  }
  async schreibe(id, val, kommentar) {
    await this.adapter.setForeignStateAsync(id, { val, ack: false, c: kommentar });
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  IoBrokerAblage,
  IoBrokerQuelle,
  LETZTE,
  appIdAus,
  ordnerFuer
});
//# sourceMappingURL=objekte.js.map
