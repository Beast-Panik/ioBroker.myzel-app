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
var geraete_exports = {};
__export(geraete_exports, {
  Geraete: () => Geraete,
  Verwaltung: () => Verwaltung,
  adminOffen: () => adminOffen
});
module.exports = __toCommonJS(geraete_exports);
var import_dm_utils = require("@iobroker/dm-utils");
var import_rechte = require("../app/rechte");
var import_grenzen = require("../basis/grenzen");
var import_kopplung = require("../basis/kopplung");
const T = {
  koppeln: { en: "Pair app", de: "App koppeln" },
  profilWaehlen: { en: "Choose profile", de: "Profil w\xE4hlen" },
  handydaten: { en: "Phone data", de: "Handydaten" },
  entfernen: { en: "Remove", de: "Entfernen" },
  heimnetz: { en: "Home network", de: "Heimnetz" },
  trennung: { en: "Disconnected", de: "Getrennt" },
  nichtVerbunden: { en: "Not connected", de: "Nicht verbunden" },
  vermittler: { en: "Relay", de: "Vermittler" },
  ueberHeimnetz: { en: "Connected in the home network", de: "Im Heimnetz verbunden" },
  ueberVermittler: { en: "Connected on the go via the relay", de: "Unterwegs \xFCber den Vermittler verbunden" },
  profil: { en: "Profile", de: "Profil" },
  keinProfil: { en: "No profile (sees nothing)", de: "Kein Profil (sieht nichts)" },
  weiter: { en: "Next", de: "Weiter" },
  scannen: {
    en: `Scan the QR code with the app, then press Next. The code is valid for ${import_grenzen.GRENZEN.einmalMs / 6e4} minutes and once only.`,
    de: `Den QR-Code mit der App scannen, dann auf Weiter dr\xFCcken. Der Code gilt ${import_grenzen.GRENZEN.einmalMs / 6e4} Minuten und nur einmal.`
  },
  warte: { en: "Waiting for the app", de: "Warte auf die App" },
  akku: { en: "Battery", de: "Akku" },
  anruf: { en: "Calls", de: "Anrufe" },
  benachrichtigung: { en: "Notifications", de: "Benachrichtigungen" },
  handydatenHinweis: {
    en: "Each data type must also be switched on in the app. Switched off types are rejected and not written.",
    de: "Jede Datenart muss auch in der App eingeschaltet sein. Was hier aus ist, lehnt der Adapter ab und schreibt nichts."
  },
  persoenlich: {
    en: "Calls and notifications contain personal data: phone numbers, contact names, message texts. Every adapter and script can read them. A history adapter on these data points stores them permanently.",
    de: "Anrufe und Benachrichtigungen enthalten pers\xF6nliche Daten: Rufnummern, Kontaktnamen, Nachrichtentexte. Jeder Adapter und jedes Skript kann sie lesen. Ein History-Adapter auf diesen Datenpunkten speichert sie dauerhaft."
  },
  laeuftNicht: {
    en: "The adapter is not running. The cause is in the log.",
    de: "Der Adapter l\xE4uft nicht. Die Ursache steht im Log."
  },
  fehler: {
    en: "That did not work. The cause is in the log.",
    de: "Das hat nicht geklappt. Die Ursache steht im Log."
  },
  keineAdresse: {
    en: "No address of the adapter is known. Please enter it in the settings.",
    de: "Keine Adresse des Adapters bekannt. Bitte in den Einstellungen eintragen."
  },
  abgelaufen: {
    en: "No app has responded. The QR code is no longer valid.",
    de: "Keine App hat sich gemeldet. Der QR-Code gilt nicht mehr."
  },
  getrennt: {
    en: "The app has disconnected. Please pair again.",
    de: "Die App hat die Verbindung getrennt. Bitte neu koppeln."
  },
  appWeg: { en: "This app no longer exists.", de: "Diese App gibt es nicht mehr." }
};
const vorschau = (n, m) => ({
  en: `sees ${n} card${n === 1 ? "" : "s"}, ${m} of them operable`,
  de: `sieht ${n} ${n === 1 ? "Karte" : "Karten"}, ${m} davon bedienbar`
});
const mitName = (name, t) => ({ en: `${name}: ${t.en}`, de: `${name}: ${t.de}` });
const HANDY = `data:image/svg+xml;base64,${Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="2" width="12" height="20" rx="2"/><path d="M10 18h4"/></svg>'
).toString("base64")}`;
const adminOffen = (instanzen) => ({
  en: `Caution: ${instanzen.join(", ")} runs without login. Anyone who can reach the admin can pair apps and change cards and profiles.`,
  de: `Achtung: ${instanzen.join(", ")} l\xE4uft ohne Anmeldung. Wer den Admin erreicht, kann Apps koppeln sowie Karten und Profile \xE4ndern.`
});
const KEINE = { refresh: false };
const GERAETE = { refresh: "devices" };
const FARBE = {
  gut: "#00ac00",
  mittel: "#ffcc00",
  knapp: "#da8200",
  schlecht: "#ff0000"
};
const eintrag = (wert) => typeof wert === "string" ? wert.trim() : "";
const panel = (items) => ({ type: "panel", items });
class Verwaltung {
  constructor(o) {
    this.o = o;
    var _a;
    this.warteMs = (_a = o.warteMs) != null ? _a : import_grenzen.GRENZEN.kopplungWartenMs;
  }
  warteMs;
  async geraete() {
    const b = this.o.betrieb();
    if (!b) {
      return [];
    }
    const liste = [];
    for (const appId of await b.ablage.alle()) {
      const daten = await b.ablage.lies(appId);
      if (daten) {
        liste.push(this.appEintrag(appId, daten));
      }
    }
    return liste;
  }
  koppeln(ctx) {
    return this.sicher(ctx, "App koppeln", KEINE, async (b) => {
      const adressen = b.adressen();
      if (adressen.length === 0) {
        await ctx.showMessage(T.keineAdresse);
        return KEINE;
      }
      const offen = await b.adminOhneAnmeldung().catch(() => []);
      const { geheimnis, gueltigBis } = b.kopplung.starte();
      const qr = (0, import_kopplung.qrInhalt)({ adapterId: b.adapterId, fingerabdruck: b.fingerabdruck, geheimnis, adressen });
      const antwort = await ctx.showForm(
        panel({
          ...offen.length > 0 ? { offen: { type: "staticText", text: adminOffen(offen), xs: 12 } } : {},
          hinweis: { type: "staticText", text: T.scannen, xs: 12 },
          qr: { type: "qrCode", data: qr, size: 280, level: "M", xs: 12 },
          profil: this.profilauswahl(b)
        }),
        {
          title: T.koppeln,
          data: { profil: "" },
          buttons: ["cancel", { type: "apply", label: T.weiter }],
          ignoreApplyDisabled: true
        }
      );
      if (!antwort || Date.now() > gueltigBis) {
        b.kopplung.brichAb();
        if (antwort) {
          await ctx.showMessage(T.abgelaufen);
        }
        return KEINE;
      }
      const profilId = this.profilId(b, antwort.profil);
      const fortschritt = await ctx.openProgress(T.warte, { indeterminate: true });
      const anfrage = await b.kopplung.warte(this.warteMs).finally(() => fortschritt.close());
      if (!anfrage) {
        b.kopplung.brichAb();
        await ctx.showMessage(T.abgelaufen);
        return KEINE;
      }
      if (!await ctx.showConfirmation(this.koppelnFrage(b, anfrage, profilId))) {
        b.kopplung.ablehnen(anfrage);
        return KEINE;
      }
      if (!await b.dienst.kopplungAnnehmen(anfrage, profilId)) {
        await ctx.showMessage(T.getrennt);
        return KEINE;
      }
      return { refresh: true };
    });
  }
  profilWaehlen(appId, ctx) {
    return this.sicherFuerApp(appId, ctx, "Profil w\xE4hlen", async (b, daten) => {
      const antwort = await ctx.showForm(panel({ profil: this.profilauswahl(b) }), {
        title: mitName(daten.name, T.profilWaehlen),
        data: { profil: daten.profil },
        buttons: ["cancel", "apply"]
      });
      if (antwort) {
        const profil = this.profilId(b, antwort.profil);
        if (profil !== daten.profil) {
          await b.ablage.aendere(appId, { profil });
        }
      }
      return GERAETE;
    });
  }
  handydaten(appId, ctx) {
    return this.sicherFuerApp(appId, ctx, "Handydaten", async (b, daten) => {
      const antwort = await ctx.showForm(
        panel({
          hinweis: { type: "staticText", text: T.handydatenHinweis, xs: 12 },
          akku: { type: "checkbox", label: T.akku, xs: 12, newLine: true },
          anruf: { type: "checkbox", label: T.anruf, xs: 12, newLine: true },
          benachrichtigung: { type: "checkbox", label: T.benachrichtigung, xs: 12, newLine: true },
          persoenlich: { type: "staticText", text: T.persoenlich, xs: 12, newLine: true }
        }),
        {
          title: mitName(daten.name, T.handydaten),
          data: { ...daten.handydaten },
          buttons: ["cancel", "apply"]
        }
      );
      if (antwort) {
        const handydaten = {
          akku: antwort.akku === true,
          anruf: antwort.anruf === true,
          benachrichtigung: antwort.benachrichtigung === true
        };
        if (JSON.stringify(handydaten) !== JSON.stringify(daten.handydaten)) {
          await b.ablage.aendere(appId, { handydaten });
        }
      }
      return GERAETE;
    });
  }
  entferne(appId, ctx) {
    return this.sicherFuerApp(appId, ctx, "Entfernen", async (b, daten) => {
      const frage = {
        en: `Remove app "${daten.name}"? Its access is deleted and an existing connection is closed. The data points of the app remain.`,
        de: `App \u201E${daten.name}\u201C entfernen? Ihr Zugang wird gel\xF6scht und eine bestehende Verbindung getrennt. Die Datenpunkte der App bleiben stehen.`
      };
      if (await ctx.showConfirmation(frage)) {
        await b.dienst.entferne(appId);
      }
      return GERAETE;
    });
  }
  // Ohne customInfo: Der Admin übernimmt dessen Inhalt nur beim ersten Anzeigen der Karte.
  appEintrag(appId, daten) {
    const praefix = `${this.o.namespace}.apps.${appId}`;
    return {
      id: appId,
      identifier: appId,
      name: daten.name,
      icon: HANDY,
      model: `Android ${daten.geraet.android}, App ${daten.geraet.appVersion}`,
      // Alles als eigene Anzeigen in einer Zeile: Eingebaute Symbole stellt der Admin in eine eigene Zeile darüber.
      indicators: [
        {
          id: "weg",
          value: { stateId: `${praefix}.weg` },
          hideIfEmpty: false,
          levels: [
            {
              value: "lokal",
              icon: "fa-wifi",
              color: FARBE.gut,
              text: T.heimnetz,
              tooltip: T.ueberHeimnetz
            },
            {
              value: "fern",
              icon: "web",
              color: FARBE.gut,
              text: T.vermittler,
              tooltip: T.ueberVermittler
            },
            // weg ist leer, solange die App nicht verbunden ist
            { icon: "fa-unlink", color: FARBE.schlecht, text: T.trennung, tooltip: T.nichtVerbunden }
          ]
        },
        ...daten.handydaten.akku ? [
          {
            id: "akku",
            value: { stateId: `${praefix}.akku.stand` },
            showValue: true,
            unit: "%",
            tooltip: T.akku,
            levels: [
              { max: 10, icon: "batteryAlert", color: FARBE.schlecht },
              { max: 25, icon: "battery", color: FARBE.knapp },
              { max: 55, icon: "battery", color: FARBE.mittel },
              { icon: "battery", color: FARBE.gut }
            ]
          }
        ] : []
      ],
      actions: [
        {
          id: "profil",
          icon: "users",
          description: T.profilWaehlen,
          handler: (id, ctx) => this.profilWaehlen(id, ctx)
        },
        {
          id: "handydaten",
          icon: "settings",
          description: T.handydaten,
          handler: (id, ctx) => this.handydaten(id, ctx)
        },
        {
          id: "entfernen",
          icon: "delete",
          description: T.entfernen,
          handler: (id, ctx) => this.entferne(id, ctx)
        }
      ]
    };
  }
  zaehle(b, profil) {
    const rechte = Object.values((0, import_rechte.sicht)(profil, b.katalog));
    return { n: rechte.length, m: rechte.filter((r) => r === "schreiben").length };
  }
  profilauswahl(b) {
    const profile = b.katalog.alleProfile().map(([id, p]) => {
      const { n, m } = this.zaehle(b, p);
      return { label: mitName(p.name, vorschau(n, m)), value: id };
    });
    return {
      type: "select",
      label: T.profil,
      options: [{ label: T.keinProfil, value: "" }, ...profile],
      noTranslation: true,
      xs: 12
    };
  }
  // Nur ein Profil, das es gibt; sonst keins
  profilId(b, wert) {
    const id = eintrag(wert);
    return b.katalog.profil(id) ? id : "";
  }
  // Mit Adresse und Gerät: Hat jemand anderes den QR-Code abfotografiert, fällt es hier auf, nicht erst danach.
  koppelnFrage(b, anfrage, profilId) {
    var _a;
    const { name, geraet } = anfrage;
    const profil = (_a = b.katalog.profil(profilId)) == null ? void 0 : _a.name;
    const von = `${anfrage.verbindung.herkunft.adresse}, Android ${geraet.android}`;
    const frage = profil ? {
      en: `Pair app "${name}" with profile "${profil}"?`,
      de: `App \u201E${name}\u201C mit Profil \u201E${profil}\u201C koppeln?`
    } : {
      en: `Pair app "${name}" without a profile? It sees nothing until a profile is chosen.`,
      de: `App \u201E${name}\u201C ohne Profil koppeln? Sie sieht nichts, bis ein Profil gew\xE4hlt ist.`
    };
    return {
      en: `${frage.en} Request from ${von}, app ${geraet.appVersion}.`,
      de: `${frage.de} Anfrage von ${von}, App ${geraet.appVersion}.`
    };
  }
  sicherFuerApp(appId, ctx, was, schritt) {
    return this.sicher(ctx, was, GERAETE, async (b) => {
      const daten = await b.ablage.lies(appId);
      if (!daten) {
        await ctx.showMessage(T.appWeg);
        return GERAETE;
      }
      return schritt(b, daten);
    });
  }
  // Ein Fehler darf den Dialog im Admin nicht offen hängen lassen: dm-utils schickt dann kein Ergebnis.
  async sicher(ctx, was, sonst, schritt) {
    const b = this.o.betrieb();
    try {
      if (!b) {
        await ctx.showMessage(T.laeuftNicht);
        return sonst;
      }
      return await schritt(b);
    } catch (fehler) {
      this.o.log.error(`Ger\xE4temanager, ${was}: ${fehler.message}`);
      try {
        await ctx.showMessage(T.fehler);
      } catch {
      }
      return sonst;
    }
  }
}
class Geraete extends import_dm_utils.DeviceManagement {
  constructor(adapter, verwaltung) {
    super(adapter);
    this.verwaltung = verwaltung;
  }
  gebunden;
  getInstanceInfo() {
    return {
      apiVersion: "v3",
      actions: [
        { id: "koppeln", icon: "qrcode", title: T.koppeln, handler: (ctx) => this.verwaltung.koppeln(ctx) }
      ]
    };
  }
  // dm-utils hängt this.log.error ungebunden an .catch: Ohne gebundene Funktionen wird jeder Fehler dort, etwa bei
  // dm:deviceInfo von einem Skript, zur unbehandelten Ablehnung, und js-controller beendet den Adapter.
  get log() {
    if (!this.gebunden) {
      const log = this.adapter.log;
      const gebunden = Object.create(log);
      for (const stufe of ["silly", "debug", "info", "warn", "error"]) {
        gebunden[stufe] = log[stufe].bind(log);
      }
      this.gebunden = gebunden;
    }
    return this.gebunden;
  }
  async loadDevices(context) {
    const geraete = await this.verwaltung.geraete();
    context.setTotalDevices(geraete.length);
    geraete.forEach((g) => context.addDevice(g));
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Geraete,
  Verwaltung,
  adminOffen
});
//# sourceMappingURL=geraete.js.map
