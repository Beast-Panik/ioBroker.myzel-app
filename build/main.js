"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
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
var utils = __toESM(require("@iobroker/adapter-core"));
var import_gemeinsam_schema = __toESM(require("../protokoll/v1/gemeinsam.schema.json"));
var import_geraete = require("./admin/geraete");
var import_fernseite = require("./admin/fernseite");
var import_kartenseite = require("./admin/kartenseite");
var import_profilseite = require("./admin/profilseite");
var import_raumseite = require("./admin/raumseite");
var import_zonenseite = require("./admin/zonenseite");
var import_fernzugang = require("./app/fernzugang");
var import_katalog = require("./app/katalog");
var import_objekte = require("./app/objekte");
var import_rechte = require("./app/rechte");
var import_umstellung = require("./app/umstellung");
var import_server = require("./app/server");
var import_kodierung = require("./basis/kodierung");
var import_schema = require("./basis/schema");
var import_zertifikat = require("./basis/zertifikat");
var import_einstellungen = require("./einstellungen");
var import_heimnetz = require("./zugang/heimnetz");
const IDENTITAET = "identitaet";
const FERNZUGANG = "fernzugang";
const pruefeAdapterId = (0, import_schema.erstellePruefer)({ $ref: `${import_gemeinsam_schema.default.$id}#/$defs/adapterId` }, [import_gemeinsam_schema.default]);
class MyzelApp extends utils.Adapter {
  server;
  katalog;
  betrieb;
  seiten = [];
  beendet = false;
  constructor(options = {}) {
    super({
      ...options,
      name: "myzel-app"
    });
    this.on("ready", this.onReady.bind(this));
    this.on("stateChange", (id, state) => {
      var _a;
      return (_a = this.server) == null ? void 0 : _a.geaendert(id, state);
    });
    this.on("objectChange", (id, objekt) => {
      var _a, _b, _c;
      (_a = this.katalog) == null ? void 0 : _a.geaendert(id, objekt);
      if ((0, import_objekte.appIdAus)(this.namespace, id)) {
        (_c = (_b = this.server) == null ? void 0 : _b.fern) == null ? void 0 : _c.appsGeaendert();
      }
    });
    this.on("message", (obj) => void this.beantworte(obj));
    this.on("unload", this.onUnload.bind(this));
  }
  async onReady() {
    new import_geraete.Geraete(this, new import_geraete.Verwaltung({ namespace: this.namespace, log: this.log, betrieb: () => this.betrieb }));
    const objekte = new import_objekte.IoBrokerQuelle(this);
    const seite = {
      namespace: this.namespace,
      katalog: () => this.katalog,
      ablage: new import_objekte.IoBrokerAblage(this),
      log: this.log,
      alleObjekte: () => objekte.alleObjekte(),
      aendereRaum: (raum, aendere) => objekte.aendereRaum(raum, aendere)
    };
    this.seiten = [
      [import_kartenseite.KARTENBEFEHLE, new import_kartenseite.Kartenseite(seite)],
      [import_profilseite.PROFILBEFEHLE, new import_profilseite.Profilseite(seite)],
      [import_raumseite.RAUMBEFEHLE, new import_raumseite.Raumseite(seite)],
      [import_fernseite.FERNBEFEHLE, new import_fernseite.Fernseite({ namespace: this.namespace, betrieb: () => this.fernbetrieb() })],
      [
        import_zonenseite.ZONENBEFEHLE,
        new import_zonenseite.Zonenseite({
          ...seite,
          apps: () => {
            var _a;
            return (_a = this.betrieb) == null ? void 0 : _a.ablage;
          },
          vorschlaege: () => {
            var _a, _b;
            return (_b = (_a = this.betrieb) == null ? void 0 : _a.dienst.mittelpunktvorschlaege()) != null ? _b : [];
          }
        })
      ]
    ];
    try {
      await this.starte();
    } catch (fehler) {
      this.log.error(`Start fehlgeschlagen, der Server l\xE4uft nicht: ${fehler.message}`);
    }
  }
  async starte() {
    await this.setStateAsync("info.connection", false, true);
    await this.setStateAsync("info.fernzugang", false, true);
    const fehler = (0, import_einstellungen.pruefeEinstellungen)(this.config);
    if (fehler.length > 0) {
      this.log.error(`Einstellungen ung\xFCltig, der Server startet nicht: ${fehler.join("; ")}`);
      return;
    }
    const identitaet = await this.identitaet();
    if (!identitaet) {
      return;
    }
    const fp = (0, import_zertifikat.fingerabdruck)(identitaet.zertifikat);
    this.log.info(`Fingerabdruck des Zertifikats: ${fp}`);
    const quelle = new import_objekte.IoBrokerQuelle(this);
    const ablage = new import_objekte.IoBrokerAblage(this);
    const adressen = () => this.config.adressen.length > 0 ? this.config.adressen : (0, import_heimnetz.automatischeAdressen)(this.config.port);
    await (0, import_umstellung.stelleUm)(this.namespace, quelle, this.config, ablage, this.log).catch(
      (fehler2) => this.log.error(`Umstellung auf Karten- und Profilobjekte: ${fehler2.message}`)
    );
    const katalog = new import_katalog.Katalog(this.namespace, this.log, quelle);
    await this.subscribeForeignObjectsAsync("*");
    await katalog.lade();
    this.katalog = katalog;
    this.log.info(
      `${katalog.anzahl} Datenpunkte, ${katalog.karten().length} Karten und ${katalog.alleProfile().length} Profile im Katalog`
    );
    for (const mangel of (0, import_rechte.kartenmaengel)(katalog)) {
      this.log.warn(mangel);
    }
    const server = await (0, import_server.starteServer)({
      adapterId: identitaet.adapterId,
      namespace: this.namespace,
      identitaet,
      ablage,
      katalog,
      zustaende: quelle,
      port: this.config.port,
      adressen,
      log: this.log,
      zustand: (laeuft) => void this.setStateAsync("info.connection", laeuft, true),
      nachlaufMs: this.config.nachlaufMin * 6e4,
      textLaenge: this.config.textLaenge,
      hinweisFristMs: this.config.hinweisFristMin * 6e4,
      fernablage: { lies: () => this.liesFernzugang(), schreibe: (e) => this.schreibeFernzugang(e) },
      fernVerbunden: (ja) => void this.setStateAsync("info.fernzugang", ja, true)
    });
    if (this.beendet) {
      await server.beende();
      return;
    }
    this.server = server;
    this.betrieb = {
      adapterId: identitaet.adapterId,
      fingerabdruck: fp,
      adressen,
      kopplung: server.kopplung,
      dienst: server.dienst,
      katalog,
      ablage,
      adminOhneAnmeldung: () => this.adminOhneAnmeldung()
    };
    await this.subscribeStatesAsync("apps.*.hinweis.senden");
    await server.dienst.holeHinweiseNach();
    const offen = await this.adminOhneAnmeldung().catch(() => []);
    if (offen.length > 0) {
      this.log.warn((0, import_geraete.adminOffen)(offen).de);
    }
  }
  // Die Seiten in den Reitern Karten, Räume, Profile, Fernzugang und Zonen (admin/jsonConfig.json)
  async beantworte(obj) {
    var _a;
    const seite = (_a = this.seiten.find(([befehle]) => befehle.includes(obj == null ? void 0 : obj.command))) == null ? void 0 : _a[1];
    if (!(obj == null ? void 0 : obj.callback) || !seite) {
      return;
    }
    let antwort;
    try {
      antwort = await seite.beantworte(obj.command, obj.message);
    } catch (fehler) {
      this.log.warn(`${obj.command}: ${fehler.message}`);
      antwort = { fehler: "gescheitert", einzelheiten: [fehler.message] };
    }
    this.sendTo(obj.from, obj.command, antwort != null ? antwort : null, obj.callback);
  }
  fernbetrieb() {
    var _a;
    const fern = (_a = this.server) == null ? void 0 : _a.fern;
    const b = this.betrieb;
    const katalog = this.katalog;
    return fern && b && katalog ? { fern, ablage: b.ablage, verbindungen: () => b.dienst.verbindungen(), sprache: katalog.sprache } : void 0;
  }
  async adminOhneAnmeldung() {
    const praefix = "system.adapter.admin.";
    const ansicht = await this.getObjectViewAsync("system", "instance", {
      startkey: praefix,
      endkey: `${praefix}\u9999`
    });
    return ansicht.rows.filter((r) => {
      var _a, _b, _c;
      return ((_b = (_a = r.value) == null ? void 0 : _a.common) == null ? void 0 : _b.enabled) === true && ((_c = r.value.native) == null ? void 0 : _c.auth) !== true;
    }).map((r) => r.id.slice("system.adapter.".length));
  }
  // Eigenes Objekt statt Instanz-Einstellungen: Eine Admin-Seite, die vor dem ersten Start geöffnet wurde, schreibt beim
  // Speichern ihren alten Stand zurück und würde die Identität sonst löschen. Alle Apps müssten dann neu koppeln.
  async identitaet() {
    const objekt = await this.getObjectAsync(IDENTITAET);
    if (!objekt) {
      const adapterId2 = (0, import_kodierung.neueAdapterId)();
      const neu = (0, import_zertifikat.erzeugeIdentitaet)(adapterId2);
      await this.setObjectAsync(IDENTITAET, {
        type: "config",
        common: { name: { de: "Identit\xE4t f\xFCr die Apps", en: "Identity for the apps" } },
        native: { adapterId: adapterId2, zertifikat: neu.zertifikat, schluessel: this.encrypt(neu.schluessel) }
      });
      this.log.info("Schl\xFCssel und Zertifikat erzeugt");
      return { adapterId: adapterId2, ...neu };
    }
    const { adapterId, zertifikat, schluessel } = objekt.native;
    let grund = "unvollst\xE4ndig";
    let gespeichert;
    if (typeof adapterId === "string" && typeof zertifikat === "string" && typeof schluessel === "string") {
      gespeichert = { adapterId, zertifikat, schluessel: this.decrypt(schluessel) };
      grund = pruefeAdapterId(adapterId).length > 0 ? "Adapter-ID ung\xFCltig" : (0, import_zertifikat.pruefeIdentitaet)(adapterId, gespeichert);
    }
    if (grund) {
      this.log.error(
        `Identit\xE4t in ${this.namespace}.${IDENTITAET} unbrauchbar (${grund}), der Server startet nicht. Abhilfe: Objekt l\xF6schen und Instanz neu starten, danach alle Apps neu koppeln.`
      );
      return void 0;
    }
    return gespeichert;
  }
  // Eigenes Objekt wie identitaet, aus demselben Grund. Ein unbrauchbares Geheimnis gilt als fehlend und wird neu erzeugt.
  async liesFernzugang() {
    var _a;
    const n = (_a = await this.getObjectAsync(FERNZUGANG)) == null ? void 0 : _a.native;
    if (typeof (n == null ? void 0 : n.adresse) !== "string" || typeof n.geheimnis !== "string") {
      return void 0;
    }
    let geheimnis = "";
    try {
      geheimnis = this.decrypt(n.geheimnis);
    } catch {
    }
    if (!/^[A-Za-z0-9_-]{43}$/.test(geheimnis)) {
      this.log.warn(`Geheimnis in ${this.namespace}.${FERNZUGANG} unbrauchbar, wird neu erzeugt`);
      return void 0;
    }
    if (n.adresse && !(0, import_fernzugang.istVermittleradresse)(n.adresse)) {
      this.log.warn(`Adresse in ${this.namespace}.${FERNZUGANG} ung\xFCltig, der Fernzugang bleibt aus`);
      return { adresse: "", geheimnis };
    }
    return { adresse: n.adresse, geheimnis };
  }
  async schreibeFernzugang(e) {
    await this.setObjectAsync(FERNZUGANG, {
      type: "config",
      common: { name: { de: "Fernzugang \xFCber den Vermittler", en: "Remote access via relay" } },
      native: { adresse: e.adresse, geheimnis: this.encrypt(e.geheimnis) }
    });
  }
  onUnload(callback) {
    var _a, _b;
    try {
      this.beendet = true;
      void this.setState("info.connection", false, true);
      void this.setState("info.fernzugang", false, true);
      ((_b = (_a = this.server) == null ? void 0 : _a.beende()) != null ? _b : Promise.resolve()).catch((fehler) => this.log.error(`Fehler beim Beenden: ${fehler.message}`)).finally(callback);
    } catch (error) {
      this.log.error(`Fehler beim Beenden: ${error.message}`);
      callback();
    }
  }
}
if (require.main !== module) {
  module.exports = (options) => new MyzelApp(options);
} else {
  (() => new MyzelApp())();
}
//# sourceMappingURL=main.js.map
