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
var import_zonen = require("./zonen");
const NEUBERECHNUNG_MS = 2e3;
const PROTOKOLLVERSIONEN = import_gemeinsam_schema.default.$defs.version.enum;
const NEUESTE_VERSION = Math.max(...PROTOKOLLVERSIONEN);
const appPruefer = (versionen = PROTOKOLLVERSIONEN) => new import_schema.Nachrichtenpruefer(import_app_an_adapter_schema.default, [import_gemeinsam_schema.default], versionen);
const adapterPruefer = () => new import_schema.Nachrichtenpruefer(import_adapter_an_app_schema.default, [import_gemeinsam_schema.default], PROTOKOLLVERSIONEN);
function zugangslage(stand, passt) {
  if (stand.art === "fehlt") {
    return { art: "unbekannt" };
  }
  const hash = stand.art === "da" ? stand.daten.zugangHash : stand.zugangHash;
  if (hash !== void 0 && !passt(hash)) {
    return { art: "falsch" };
  }
  return stand.art === "da" ? { art: "ok", daten: stand.daten } : { art: "beschaedigt" };
}
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
    o.katalog.beiApp((appId, objekt) => this.appGeaendert(appId, objekt));
  }
  sitzungen = /* @__PURE__ */ new Map();
  // Eimer der Anmeldungen je App, nur für Apps mit gültigem Zugang
  anmeldungen = /* @__PURE__ */ new Map();
  abostelle;
  anwesenheit;
  hinweise;
  // Je App der letzte Vorschlag für einen Mittelpunkt, nur im Speicher (KONZEPT-ZONEN.md, Abschnitt 17.7)
  vorschlaege = /* @__PURE__ */ new Map();
  // Mengen der Handydaten je App über alle Sitzungen; eine App, die immer wieder neu verbindet, bekäme sonst jedes Mal
  // einen vollen Stoß
  handyeimer = /* @__PURE__ */ new Map();
  vorgemerkt;
  neuberechnung = Promise.resolve();
  beendet = false;
  // Ausschalten im Admin gilt sofort, nicht erst mit der Neuberechnung nach rund 2 s: Danach schreibt der Adapter von
  // der Datenart nichts mehr, auch keinen Standort. Einschalten kommt mit der Neuberechnung und ihrer Prüfung.
  appGeaendert(appId, objekt) {
    var _a;
    const handy = (_a = this.sitzungen.get(appId)) == null ? void 0 : _a.handy;
    if (!handy) {
      return;
    }
    const native = (objekt == null ? void 0 : objekt.type) === "device" ? objekt.native : void 0;
    const neu = native && typeof native === "object" ? native.handydaten : {};
    const an = (art) => !!neu && typeof neu === "object" && neu[art] === true;
    handy.schraenkeEin(an, objekt ? "admin" : "entfernt");
  }
  // Adresse oder Geheimnis des Fernzugangs neu: Jede App bekommt den neuen Stand wie bei neuen Rechten.
  fernzugangGeaendert() {
    this.vormerken();
  }
  // Die Vorschläge der letzten 15 Minuten, der neueste zuerst
  mittelpunktvorschlaege(jetzt = Date.now()) {
    for (const [appId, v] of this.vorschlaege) {
      if (v.bis <= jetzt) {
        this.vorschlaege.delete(appId);
      }
    }
    return [...this.vorschlaege.values()].sort((a, b) => b.zeit - a.zeit).map(({ bis: _bis, ...v }) => v);
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
  // Beim Start ist keine App verbunden, auch wenn der letzte Lauf das nicht mehr schreiben konnte. weg ist leer,
  // solange die App nicht verbunden ist; sonst zeigte der Gerätemanager den alten Weg.
  async starte() {
    const appIds = await this.o.ablage.alle();
    for (const appId of appIds) {
      await this.o.ablage.schreibe(appId, { online: false, weg: "" });
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
    return (await this.lageFuer(appId, zugang)).art;
  }
  async angemeldet(v, hallo) {
    if (!this.darfAnmelden(hallo.app, Date.now())) {
      v.sendeFehler("zuviel");
      v.schliesse(import_kern.SCHLIESSCODE.zuviel, "zu viele Anmeldungen");
      return;
    }
    const lage = await this.lageFuer(hallo.app, hallo.zugang);
    if (lage.art === "beschaedigt") {
      v.sendeFehler("intern");
      v.schliesse(import_kern.SCHLIESSCODE.intern, "Objekt besch\xE4digt");
      return;
    }
    if (lage.art !== "ok") {
      v.sendeFehler("zugang");
      v.schliesse(import_kern.SCHLIESSCODE.zugang, "zugang");
      return;
    }
    const daten = lage.daten;
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
      handydaten: { akku: false, anruf: false, benachrichtigung: false, zonen: false, standort: false },
      gekoppeltAm: Date.now(),
      geraet: anfrage.geraet,
      zonenwahl: []
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
  // zonen.aktiv false, wie anwesend: Von der App kommt sicher nichts mehr.
  async entferne(appId) {
    await this.o.ablage.entferne(appId);
    this.hinweise.vergiss(appId);
    this.vorschlaege.delete(appId);
    this.handyeimer.delete(appId);
    this.anwesenheit.entferne(appId);
    const angemeldet = this.sitzungen.get(appId);
    if (angemeldet) {
      angemeldet.handy.schraenkeEin(() => false, "entfernt");
      angemeldet.sitzung.verbindung.schliesse(import_kern.SCHLIESSCODE.entfernt, "entfernt");
    } else {
      await (0, import_handydaten.meldeZonenAus)(this.o.ablage, appId, (0, import_zonen.grundText)("entfernt", this.o.katalog.sprache)).catch(
        (fehler) => this.o.log.warn(`App ${appId}: Ende der Zonen nicht geschrieben: ${fehler.message}`)
      );
    }
    this.o.log.info(`App ${appId} entfernt`);
  }
  async freieAppId() {
    for (let versuch = 0; versuch < 5; versuch++) {
      const appId = (0, import_kodierung.neueAppId)();
      if ((await this.o.ablage.stand(appId)).art === "fehlt") {
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
    const fern = this.fernFuer(appId, daten, version);
    if (v.herkunft.weg === "fern" && !fern) {
      this.o.log.info(`App ${appId}: Fernzugang nicht freigegeben, Verbindung \xFCber den Vermittler beendet`);
      v.schliesse(import_kern.SCHLIESSCODE.fernAus, "Fernzugang aus");
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
    const zonen = version >= import_zonen.ZONEN_SEIT ? (0, import_zonen.zonenDerApp)(daten, this.o.katalog.zonen()) : [];
    const handy = new import_handydaten.Handyeingang({
      appId,
      verbindung: v,
      ablage: this.o.ablage,
      log: this.o.log,
      textLaenge: this.o.textLaenge,
      handydaten: daten.handydaten,
      version,
      zonen,
      zonenname: (zone) => {
        var _a2;
        return (_a2 = this.o.katalog.zone(zone)) == null ? void 0 : _a2.name;
      },
      sprache: () => this.o.katalog.sprache,
      vorschlag: (v2) => this.vorschlaege.set(appId, { appId, ...v2, bis: Date.now() + import_zonen.VORSCHLAG_MS }),
      eimer: this.eimerFuer(appId)
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
        angezeigt: (m) => this.hinweise.angezeigt(appId, m.id),
        zone: (m) => handy.zone(m),
        zonenstand: (m) => handy.zonenstand(m),
        standort: (m) => handy.standort(m),
        vorschlag: (m) => handy.vorschlag(m)
      },
      grenzen: this.o.grenzen
    });
    const alt = this.sitzungen.get(appId);
    this.sitzungen.set(appId, {
      sitzung,
      werte,
      handy,
      zugangHash: daten.zugangHash,
      version,
      fern,
      handydaten: daten.handydaten
    });
    if (alt) {
      this.o.log.info(`App ${appId}: neue Verbindung ersetzt die bisherige`);
      alt.sitzung.verbindung.schliesse(import_kern.SCHLIESSCODE.ersetzt, "ersetzt");
      this.anwesenheit.getrennt(appId, alt.sitzung.verbindung.herkunft.weg);
    }
    v.beiTrennung(() => {
      this.getrennt(sitzung);
      werte.beende().catch((fehler) => this.o.log.error(`Abo der App ${appId}: ${fehler.message}`));
    });
    const nachher = zugangslage(await this.o.ablage.stand(appId), (hash) => hash === daten.zugangHash);
    if (nachher.art === "beschaedigt") {
      this.o.log.info(`App ${appId}: Objekt w\xE4hrend der Anmeldung besch\xE4digt, Verbindung beendet`);
      v.schliesse(import_kern.SCHLIESSCODE.intern, "Objekt besch\xE4digt");
      return;
    }
    if (nachher.art !== "ok") {
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
      handydaten: (0, import_zonen.handydatenFuer)(daten.handydaten, version),
      ...(0, import_zonen.zonenFuer)(daten, this.o.katalog.zonen(), version),
      ...fern && { fern }
    });
    this.o.log.info(`App ${appId} verbunden \xFCber ${v.herkunft.weg} von ${v.herkunft.adresse}`);
    await this.o.ablage.schreibe(appId, { online: true, weg: v.herkunft.weg });
    await this.anwesenheit.angemeldet(appId, v.herkunft.weg);
    await this.hinweise.angemeldet(appId, v);
    if (version >= import_zonen.ZONEN_SEIT) {
      const wahl = new Set((_b = daten.zonenwahl) != null ? _b : []);
      void handy.entferneUebrige((zone) => wahl.has(zone) && this.o.katalog.gibtZone(zone));
    } else {
      void handy.zonenAus("veraltet");
    }
  }
  eimerFuer(appId) {
    const da = this.handyeimer.get(appId);
    if (da) {
      return da;
    }
    const neu = (0, import_handydaten.neueHandyeimer)();
    this.handyeimer.set(appId, neu);
    return neu;
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
    var _a, _b;
    const jeProfil = /* @__PURE__ */ new Map();
    for (const [appId, angemeldet] of [...this.sitzungen]) {
      const stand = await this.o.ablage.stand(appId);
      if (this.beendet || this.sitzungen.get(appId) !== angemeldet) {
        continue;
      }
      const { sitzung, werte, handy } = angemeldet;
      const lage = zugangslage(stand, (hash) => hash === angemeldet.zugangHash);
      if (lage.art === "beschaedigt") {
        this.o.log.info(`App ${appId}: Objekt besch\xE4digt, Verbindung beendet, die App bleibt gekoppelt`);
        sitzung.verbindung.schliesse(import_kern.SCHLIESSCODE.intern, "Objekt besch\xE4digt");
        continue;
      }
      if (lage.art !== "ok") {
        this.o.log.info(`App ${appId} entfernt oder Zugang ge\xE4ndert, Verbindung beendet`);
        sitzung.verbindung.schliesse(import_kern.SCHLIESSCODE.entfernt, "entfernt");
        continue;
      }
      const daten = lage.daten;
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
      const zonen = angemeldet.version >= import_zonen.ZONEN_SEIT ? (0, import_zonen.zonenDerApp)(daten, this.o.katalog.zonen()) : [];
      if (!rechteNeu && !fernNeu && (0, import_node_util.isDeepStrictEqual)(daten.handydaten, angemeldet.handydaten) && (0, import_node_util.isDeepStrictEqual)(daten.handydaten, handy.handydaten) && (0, import_node_util.isDeepStrictEqual)(zonen, handy.zonen)) {
        continue;
      }
      if (rechteNeu) {
        werte.neueRechte(rechte).catch((fehler) => this.o.log.error(`Abo der App ${appId}: ${fehler.message}`));
      }
      handy.uebernimm(daten.handydaten);
      angemeldet.handydaten = daten.handydaten;
      const gewaehlt = new Set((_b = daten.zonenwahl) != null ? _b : []);
      const entzogen = handy.zonen.map((z) => z.id).filter((id) => !gewaehlt.has(id) || !this.o.katalog.gibtZone(id));
      handy.zonen = zonen;
      void handy.entferneZonen(entzogen);
      angemeldet.fern = fern;
      sitzung.verbindung.sende({
        t: "rechte",
        ...fuerApp,
        handydaten: (0, import_zonen.handydatenFuer)(daten.handydaten, angemeldet.version),
        ...(0, import_zonen.zonenFuer)(daten, this.o.katalog.zonen(), angemeldet.version),
        ...fern && { fern }
      });
      this.o.log.debug(`App ${appId}: neue Rechte, ${rechte.inhalt.karten.length} Karten`);
    }
  }
  // Eimer je App: anmeldungenStoss sofort, danach eine je anmeldungAbstandMs
  darfAnmelden(appId, jetzt) {
    var _a;
    const g = (_a = this.o.grenzen) != null ? _a : import_grenzen.GRENZEN;
    const alt = this.anmeldungen.get(appId);
    const marken = alt ? Math.min(g.anmeldungenStoss, alt.marken + (jetzt - alt.zeit) / g.anmeldungAbstandMs) : g.anmeldungenStoss;
    if (marken < 1) {
      this.anmeldungen.set(appId, { marken, zeit: jetzt, gemeldet: true });
      if (!(alt == null ? void 0 : alt.gemeldet)) {
        this.o.log.warn(`App ${appId} meldet sich zu oft an, vorerst abgewiesen`);
      }
      return false;
    }
    this.anmeldungen.set(appId, { marken: marken - 1, zeit: jetzt, gemeldet: false });
    return true;
  }
  async lageFuer(appId, zugang) {
    return zugangslage(await this.o.ablage.stand(appId), (hash) => (0, import_kodierung.passtZuHash)(zugang, Buffer.from(hash, "hex")));
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
    this.o.ablage.schreibe(sitzung.appId, { online: false, weg: "", zuletzt: Date.now() }).catch((fehler) => this.o.log.error(`Status der App ${sitzung.appId}: ${fehler.message}`));
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
