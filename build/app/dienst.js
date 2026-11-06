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
var dienst_exports = {};
__export(dienst_exports, {
  Dienst: () => Dienst,
  NEUESTE_VERSION: () => NEUESTE_VERSION,
  PROTOKOLLVERSIONEN: () => PROTOKOLLVERSIONEN,
  adapterPruefer: () => adapterPruefer,
  appPruefer: () => appPruefer
});
module.exports = __toCommonJS(dienst_exports);
var import_node_util = require("node:util");
var import_adapter_an_app_schema = __toESM(require("../../protokoll/v1/adapter-an-app.schema.json"));
var import_app_an_adapter_schema = __toESM(require("../../protokoll/v1/app-an-adapter.schema.json"));
var import_gemeinsam_schema = __toESM(require("../../protokoll/v1/gemeinsam.schema.json"));
var import_grenzen = require("../basis/grenzen");
var import_kern = require("../basis/kern");
var import_fernschluessel = require("../basis/fernschluessel");
var import_kodierung = require("../basis/kodierung");
var import_schema = require("../basis/schema");
var import_handydaten = require("./handydaten");
var import_hinweise = require("./hinweise");
var import_objekte = require("./objekte");
var import_rechte = require("./rechte");
var import_sitzung = require("./sitzung");
var import_werte = require("./werte");
const NEUBERECHNUNG_MS = 2e3;
const PROTOKOLLVERSIONEN = import_gemeinsam_schema.default.$defs.version.enum;
const NEUESTE_VERSION = Math.max(...PROTOKOLLVERSIONEN);
const appPruefer = (versionen = PROTOKOLLVERSIONEN) => new import_schema.Nachrichtenpruefer(import_app_an_adapter_schema.default, [import_gemeinsam_schema.default], versionen);
const adapterPruefer = () => new import_schema.Nachrichtenpruefer(import_adapter_an_app_schema.default, [import_gemeinsam_schema.default], PROTOKOLLVERSIONEN);
class Dienst {
  constructor(o) {
    this.o = o;
    this.abostelle = new import_werte.Abostelle(o.zustaende);
    this.anwesenheit = new import_handydaten.Anwesenheit({ ablage: o.ablage, nachlaufMs: o.nachlaufMs, log: o.log });
    this.hinweise = new import_hinweise.Hinweise({
      ablage: o.ablage,
      log: o.log,
      fristMs: o.hinweisFristMs,
      verbindung: (appId) => {
        var _a;
        return (_a = this.sitzungen.get(appId)) == null ? void 0 : _a.sitzung.verbindung;
      }
    });
    o.katalog.beiAenderung(() => this.vormerken());
  }
  sitzungen = /* @__PURE__ */ new Map();
  abostelle;
  anwesenheit;
  hinweise;
  vorgemerkt;
  neuberechnung = Promise.resolve();
  beendet = false;
  // Adresse oder Geheimnis des Fernzugangs neu: Jede App bekommt den neuen Stand wie bei neuen Rechten.
  fernzugangGeaendert() {
    this.vormerken();
  }
  // Weg je angemeldeter App
  verbindungen() {
    return new Map([...this.sitzungen].map(([appId, a]) => [appId, a.sitzung.verbindung.herkunft.weg]));
  }
  geaendert(id, state) {
    this.abostelle.geaendert(id, state);
    const hinweisFuer = state && !state.ack ? (0, import_objekte.appIdAus)(this.o.namespace, id, "hinweis.senden") : void 0;
    if (state && hinweisFuer) {
      this.hinweise.neu(hinweisFuer, state);
    }
  }
  // Beim Start ist keine App verbunden, auch wenn der letzte Lauf das nicht mehr schreiben konnte.
  async starte() {
    const appIds = await this.o.ablage.alle();
    for (const appId of appIds) {
      await this.o.ablage.schreibe(appId, { online: false });
      await this.o.ablage.richteEin(appId);
    }
    await this.anwesenheit.starte(appIds);
    await this.hinweise.starte(appIds);
  }
  // Erst nach dem Abonnieren von hinweis.senden, sonst ginge ein Hinweis aus der Zeit dazwischen verloren.
  async holeHinweiseNach() {
    await this.hinweise.holeNach(await this.o.ablage.alle());
  }
  beende() {
    this.beendet = true;
    clearTimeout(this.vorgemerkt);
    this.anwesenheit.beende();
    this.hinweise.beende();
  }
  async pruefeZugang(appId, zugang) {
    const daten = await this.o.ablage.lies(appId);
    if (!daten) {
      return "unbekannt";
    }
    return (0, import_kodierung.passtZuHash)(zugang, Buffer.from(daten.zugangHash, "hex")) ? "ok" : "falsch";
  }
  async angemeldet(v, hallo) {
    const daten = await this.o.ablage.lies(hallo.app);
    if (!daten) {
      v.sendeFehler("zugang");
      v.schliesse(import_kern.SCHLIESSCODE.zugang, "zugang");
      return;
    }
    if (daten.geraet.android !== hallo.geraet.android || daten.geraet.appVersion !== hallo.geraet.appVersion) {
      daten.geraet = hallo.geraet;
      await this.o.ablage.aendere(hallo.app, { geraet: hallo.geraet });
    }
    await this.oeffne(v, hallo.app, daten, hallo.v);
  }
  async kopplungAnnehmen(anfrage, profil) {
    if (!this.o.kopplung.abschliessen(anfrage)) {
      return void 0;
    }
    const appId = await this.freieAppId();
    const zugang = (0, import_kodierung.neuerZugang)();
    const daten = {
      name: anfrage.name,
      zugangHash: (0, import_kodierung.sha256)(zugang).toString("hex"),
      profil,
      handydaten: { akku: false, anruf: false, benachrichtigung: false },
      gekoppeltAm: Date.now(),
      geraet: anfrage.geraet
    };
    await this.o.ablage.lege(appId, daten);
    this.o.log.info(`App ${appId} gekoppelt`);
    const v = anfrage.verbindung;
    if (v.offen) {
      v.sende({ t: "gekoppelt", app: appId, zugang });
      await this.oeffne(v, appId, daten, anfrage.version);
    }
    return appId;
  }
  // Sofort, nicht erst mit der Neuberechnung der Rechte: Der Zugang gilt ab jetzt nicht mehr.
  async entferne(appId) {
    var _a;
    await this.o.ablage.entferne(appId);
    this.hinweise.vergiss(appId);
    this.anwesenheit.entferne(appId);
    (_a = this.sitzungen.get(appId)) == null ? void 0 : _a.sitzung.verbindung.schliesse(import_kern.SCHLIESSCODE.entfernt, "entfernt");
    this.o.log.info(`App ${appId} entfernt`);
  }
  async freieAppId() {
    for (let versuch = 0; versuch < 5; versuch++) {
      const appId = (0, import_kodierung.neueAppId)();
      if (!await this.o.ablage.lies(appId)) {
        return appId;
      }
    }
    throw new Error("keine freie App-ID gefunden");
  }
  async oeffne(v, appId, daten, version) {
    var _a, _b;
    if (!v.offen) {
      return;
    }
    const eingestellt = this.o.adressen();
    const eigene = v.herkunft.eigeneAdresse;
    const adressen = eingestellt.length > 0 || !eigene ? eingestellt : [eigene];
    if (adressen.length === 0) {
      this.o.log.error(
        `App ${appId} abgewiesen: keine Adresse des Adapters bekannt, bitte in den Einstellungen eintragen`
      );
      v.sendeFehler("intern");
      v.schliesse(import_kern.SCHLIESSCODE.intern, "keine Adresse");
      return;
    }
    const rechte = (0, import_rechte.rechteFuer)(daten.profil, this.o.katalog);
    const werte = new import_werte.Werteversand({
      appId,
      verbindung: v,
      stelle: this.abostelle,
      quelle: this.o.zustaende,
      rechte,
      log: this.o.log,
      teilBytes: ((_a = this.o.grenzen) != null ? _a : import_grenzen.GRENZEN).teilBytes
    });
    const handy = new import_handydaten.Handyeingang({
      appId,
      verbindung: v,
      ablage: this.o.ablage,
      log: this.o.log,
      textLaenge: this.o.textLaenge,
      handydaten: daten.handydaten
    });
    const sitzung = new import_sitzung.Sitzung(appId, v, {
      pruefer: this.o.pruefer,
      log: this.o.log,
      behandler: {
        abo: (m) => werte.abo(m.ids),
        setze: (m) => werte.setze(m.n, m.id, m.val),
        akku: (m) => handy.akku(m),
        anruf: (m) => handy.anruf(m),
        benachrichtigung: (m) => handy.benachrichtigung(m),
        auswahl: (m) => handy.auswahl(m),
        angezeigt: (m) => this.hinweise.angezeigt(appId, m.id)
      },
      grenzen: this.o.grenzen
    });
    const alt = this.sitzungen.get(appId);
    const fern = this.fernFuer(appId, daten, version);
    this.sitzungen.set(appId, { sitzung, werte, handy, zugangHash: daten.zugangHash, version, fern });
    if (alt) {
      this.o.log.info(`App ${appId}: neue Verbindung ersetzt die bisherige`);
      alt.sitzung.verbindung.schliesse(import_kern.SCHLIESSCODE.ersetzt, "ersetzt");
    }
    v.beiTrennung(() => {
      this.getrennt(sitzung);
      werte.beende().catch((fehler) => this.o.log.error(`Abo der App ${appId}: ${fehler.message}`));
    });
    if (((_b = await this.o.ablage.lies(appId)) == null ? void 0 : _b.zugangHash) !== daten.zugangHash) {
      this.o.log.info(`App ${appId} w\xE4hrend der Anmeldung entfernt, Verbindung beendet`);
      v.schliesse(import_kern.SCHLIESSCODE.entfernt, "entfernt");
      return;
    }
    v.sende({
      t: "willkommen",
      v: version,
      adapter: this.o.adapterId,
      adressen,
      ...(0, import_rechte.inhaltFuer)(rechte.inhalt, version),
      handydaten: daten.handydaten,
      ...fern && { fern }
    });
    this.o.log.info(`App ${appId} verbunden \xFCber ${v.herkunft.weg} von ${v.herkunft.adresse}`);
    await this.o.ablage.schreibe(appId, { online: true, weg: v.herkunft.weg });
    await this.anwesenheit.angemeldet(appId, v.herkunft.weg);
    await this.hinweise.angemeldet(appId, v);
  }
  // Gesammelt, weil eine Änderung selten allein kommt: Ein Adapter legt beim Start viele Objekte an.
  vormerken() {
    var _a, _b;
    if (this.beendet) {
      return;
    }
    (_b = this.vorgemerkt) != null ? _b : this.vorgemerkt = setTimeout(() => {
      this.vorgemerkt = void 0;
      this.neuberechnung = this.neuberechnung.then(() => this.berechneNeu()).catch((fehler) => this.o.log.error(`Neuberechnung der Rechte: ${fehler.message}`));
    }, (_a = this.o.neuberechnungMs) != null ? _a : NEUBERECHNUNG_MS);
  }
  async berechneNeu() {
    var _a;
    const jeProfil = /* @__PURE__ */ new Map();
    for (const [appId, angemeldet] of [...this.sitzungen]) {
      const daten = await this.o.ablage.lies(appId);
      if (this.beendet || this.sitzungen.get(appId) !== angemeldet) {
        continue;
      }
      const { sitzung, werte, handy } = angemeldet;
      if ((daten == null ? void 0 : daten.zugangHash) !== angemeldet.zugangHash) {
        this.o.log.info(`App ${appId} entfernt oder Zugang ge\xE4ndert, Verbindung beendet`);
        sitzung.verbindung.schliesse(import_kern.SCHLIESSCODE.entfernt, "entfernt");
        continue;
      }
      const fern = this.fernFuer(appId, daten, angemeldet.version);
      if (sitzung.verbindung.herkunft.weg === "fern" && !fern) {
        this.o.log.info(`App ${appId}: Fernzugang ausgeschaltet, Verbindung \xFCber den Vermittler beendet`);
        sitzung.verbindung.schliesse(import_kern.SCHLIESSCODE.fernAus, "Fernzugang aus");
        continue;
      }
      const rechte = (_a = jeProfil.get(daten.profil)) != null ? _a : (0, import_rechte.rechteFuer)(daten.profil, this.o.katalog);
      jeProfil.set(daten.profil, rechte);
      const fuerApp = (0, import_rechte.inhaltFuer)(rechte.inhalt, angemeldet.version);
      const rechteNeu = !(0, import_node_util.isDeepStrictEqual)(fuerApp, (0, import_rechte.inhaltFuer)(werte.rechte.inhalt, angemeldet.version));
      const fernNeu = !(0, import_node_util.isDeepStrictEqual)(fern, angemeldet.fern);
      if (!rechteNeu && !fernNeu && (0, import_node_util.isDeepStrictEqual)(daten.handydaten, handy.handydaten)) {
        continue;
      }
      if (rechteNeu) {
        werte.neueRechte(rechte).catch((fehler) => this.o.log.error(`Abo der App ${appId}: ${fehler.message}`));
      }
      handy.handydaten = daten.handydaten;
      angemeldet.fern = fern;
      sitzung.verbindung.sende({ t: "rechte", ...fuerApp, handydaten: daten.handydaten, ...fern && { fern } });
      this.o.log.debug(`App ${appId}: neue Rechte, ${rechte.inhalt.karten.length} Karten`);
    }
  }
  fernFuer(appId, daten, version) {
    var _a, _b, _c;
    const zugang = (_b = (_a = this.o).fernzugang) == null ? void 0 : _b.call(_a);
    if (version < import_rechte.FERN_SEIT || !zugang || daten.fern !== true) {
      return void 0;
    }
    const grenzen = (_c = this.o.grenzen) != null ? _c : import_grenzen.GRENZEN;
    return {
      adresse: zugang.adresse,
      schluessel: (0, import_fernschluessel.appSchluessel)(zugang.geheimnis, appId, daten.zugangHash),
      pingS: grenzen.fernPingMs / 1e3,
      totS: grenzen.fernTotMs / 1e3
    };
  }
  getrennt(sitzung) {
    var _a;
    if (((_a = this.sitzungen.get(sitzung.appId)) == null ? void 0 : _a.sitzung) !== sitzung) {
      return;
    }
    this.sitzungen.delete(sitzung.appId);
    this.o.log.info(`App ${sitzung.appId} getrennt`);
    this.o.ablage.schreibe(sitzung.appId, { online: false, zuletzt: Date.now() }).catch((fehler) => this.o.log.error(`Status der App ${sitzung.appId}: ${fehler.message}`));
    this.anwesenheit.getrennt(sitzung.appId, sitzung.verbindung.herkunft.weg);
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Dienst,
  NEUESTE_VERSION,
  PROTOKOLLVERSIONEN,
  adapterPruefer,
  appPruefer
});
//# sourceMappingURL=dienst.js.map
