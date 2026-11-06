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
var kartenseite_exports = {};
__export(kartenseite_exports, {
  KARTENBEFEHLE: () => KARTENBEFEHLE,
  Kartenseite: () => Kartenseite
});
module.exports = __toCommonJS(kartenseite_exports);
var import_erkennung = require("../app/erkennung");
var import_rechte = require("../app/rechte");
var import_eintraege = require("./eintraege");
const KARTENBEFEHLE = [
  "kartenseite",
  "kartenstand",
  "datenpunkte",
  "speichereKarte",
  "loescheKarte",
  "vorschlaege",
  "legeKartenAn"
];
const TREFFER = 100;
const ERKENNUNG_GILT = 6e4;
const ARTEN = Object.fromEntries(
  import_rechte.KARTENTYPEN.map((typ) => {
    const art = import_rechte.KARTENARTEN[typ];
    return [
      typ,
      {
        teile: Object.entries(art.teile).map(([teil, t]) => ({ teil, typen: t.typen })),
        pflicht: art.pflicht,
        bezeichnungen: art.bezeichnungen === true
      }
    ];
  })
);
function texte(roh, erlaubt) {
  if (!roh || typeof roh !== "object" || Array.isArray(roh)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(roh).filter(([k, w]) => erlaubt.includes(k) && typeof w === "string" && w.trim() !== "").map(([k, w]) => [k, w.trim()])
  );
}
function bereinigt(roh) {
  if (!roh || typeof roh !== "object" || Array.isArray(roh)) {
    return roh;
  }
  const r = roh;
  const art = import_rechte.KARTENARTEN[r.typ];
  if (!art) {
    return roh;
  }
  const teile = texte(r.teile, Object.keys(art.teile));
  const bezeichnungen = art.bezeichnungen ? texte(r.bezeichnungen, Object.keys(teile)) : {};
  return {
    name: typeof r.name === "string" ? r.name.trim() : r.name,
    typ: r.typ,
    raum: typeof r.raum === "string" ? r.raum : "",
    teile,
    ...Object.keys(bezeichnungen).length > 0 ? { bezeichnungen } : {}
  };
}
class Kartenseite {
  constructor(o) {
    this.o = o;
    var _a;
    this.jetzt = (_a = o.jetzt) != null ? _a : Date.now;
    this.karten = new import_eintraege.Eintraege(
      {
        ordner: "karten",
        kennbuchstabe: "k",
        was: "Karte",
        pruefe: (roh) => (0, import_rechte.alsKarte)(bereinigt(roh)),
        imKatalog: (katalog, id) => katalog.karte(id),
        anzahl: (katalog) => katalog.karten().length,
        hoechstens: import_rechte.KARTEN_HOECHSTENS
      },
      o
    );
  }
  karten;
  erkannt;
  jetzt;
  async beantworte(befehl, roh) {
    if (befehl === "kartenseite") {
      return (0, import_eintraege.seitenadresse)(this.o.namespace, "karten.html");
    }
    const katalog = this.o.katalog();
    if (!katalog) {
      return { fehler: "nichtBereit" };
    }
    const n = (0, import_eintraege.nachricht)(roh);
    switch (befehl) {
      case "kartenstand":
        return this.stand(katalog);
      case "datenpunkte":
        return this.suche(katalog, n);
      case "speichereKarte":
        return this.mitStand(katalog, await this.karten.speichere(katalog, n.id, n.karte));
      case "loescheKarte":
        return this.mitStand(katalog, await this.karten.loesche(katalog, n.id));
      case "vorschlaege":
        return this.vorschlaege(katalog, n.frisch === true);
      case "legeKartenAn":
        return this.legeAn(katalog, n.karten);
      default:
        return void 0;
    }
  }
  mitStand(katalog, antwort) {
    return "fehler" in antwort ? antwort : { id: antwort.id, stand: this.stand(katalog) };
  }
  async vorschlaege(katalog, frisch) {
    if (!this.o.alleObjekte) {
      return { vorschlaege: [], namen: {} };
    }
    if (frisch || !this.erkannt || this.jetzt() - this.erkannt.zeit > ERKENNUNG_GILT) {
      const liste2 = (0, import_erkennung.erkenneGeraete)(await this.o.alleObjekte(), {
        namespace: this.o.namespace,
        sprache: katalog.sprache
      });
      this.erkannt = { zeit: this.jetzt(), liste: liste2 };
    }
    const liste = (0, import_erkennung.vorschlaege)(this.erkannt.liste, {
      karten: katalog.karten().map(([, k]) => k),
      raeume: katalog.raeume(),
      datenpunkt: (dp) => katalog.datenpunkt(dp),
      eigeneApps: katalog.eigeneApps
    });
    return {
      vorschlaege: liste,
      namen: this.namen(
        katalog,
        liste.map((v) => v.karte)
      )
    };
  }
  // Jede Karte für sich, mit derselben Prüfung wie aus dem Dialog. Welche Objekte ihren Raum in ioBroker wechseln,
  // bestimmt der Vorschlag mit denselben Datenpunkten, nie die Seite.
  async legeAn(katalog, roh) {
    if (!Array.isArray(roh) || roh.length > import_rechte.KARTEN_HOECHSTENS) {
      return { fehler: "ungueltig", einzelheiten: ["karten"] };
    }
    const datenpunkte = (k) => Object.values(k.teile).sort().join(" ");
    const angebot = new Map(
      (await this.vorschlaege(katalog, false)).vorschlaege.map((v) => [datenpunkte(v.karte), v])
    );
    const ergebnisse = [];
    for (const roheKarte of roh) {
      const antwort = await this.karten.speichere(katalog, void 0, roheKarte);
      const karte = "fehler" in antwort ? void 0 : katalog.karte(antwort.id);
      const vorschlag = karte && angebot.get(datenpunkte(karte));
      ergebnisse.push(
        karte && vorschlag && !await this.ordneZu(katalog, karte, vorschlag) ? { ...antwort, raum: "gescheitert" } : antwort
      );
    }
    return { ergebnisse, stand: this.stand(katalog) };
  }
  // Hat die Karte einen anderen Raum als den aus ioBroker, übernimmt ioBroker ihn. false, wenn das scheitert.
  async ordneZu(katalog, karte, vorschlag) {
    const raeume = katalog.raeume();
    const aendere = this.o.aendereRaum;
    if (!aendere || karte.raum === vorschlag.karte.raum || karte.raum && !raeume.some((r) => r.id === karte.raum)) {
      return true;
    }
    const zuordnung = vorschlag.zuordnung;
    const namen = new Map((0, import_eintraege.raeumeFuerSeiten)(katalog).map((r) => [r.id, r.name]));
    const betroffen = raeume.filter(
      (r) => r.id === karte.raum || r.mitglieder.some((m) => zuordnung.some((z) => (0, import_rechte.liegtUnter)(m, z)))
    );
    const geaendert = [];
    try {
      for (const r of betroffen) {
        if (await aendere(r.id, (m) => (0, import_erkennung.verschoben)(m, zuordnung, r.id === karte.raum))) {
          const name = namen.get(r.id);
          if (r.id === karte.raum) {
            geaendert.unshift(`jetzt in ${name}`);
          } else {
            geaendert.push(`nicht mehr in ${name}`);
          }
        }
      }
    } catch (fehler) {
      this.o.log.warn(
        `Raum f\xFCr \u201E${karte.name}\u201C in ioBroker nicht \xFCbernommen (${zuordnung.join(", ")}): ${fehler.message}`
      );
      return false;
    }
    if (geaendert.length > 0) {
      this.o.log.info(`\u201E${karte.name}\u201C in ioBroker ${geaendert.join(", ")} (${zuordnung.join(", ")})`);
    }
    return true;
  }
  namen(katalog, karten) {
    var _a;
    const namen = {};
    for (const dp of karten.flatMap((k) => Object.values(k.teile))) {
      const name = (_a = katalog.datenpunkt(dp)) == null ? void 0 : _a.name;
      if (typeof name === "string" && name !== dp) {
        namen[dp] = name;
      }
    }
    return namen;
  }
  stand(katalog) {
    const sprache = katalog.sprache;
    const karten = katalog.karten().map(([id, k]) => ({
      id,
      name: k.name,
      typ: k.typ,
      raum: k.raum,
      teile: { ...k.teile },
      ...k.bezeichnungen ? { bezeichnungen: { ...k.bezeichnungen } } : {},
      maengel: (0, import_rechte.maengelDerKarte)(k, (dp) => katalog.datenpunkt(dp))
    }));
    return {
      sprache,
      raeume: (0, import_eintraege.raeumeFuerSeiten)(katalog),
      arten: ARTEN,
      karten,
      namen: this.namen(katalog, karten),
      hoechstens: import_rechte.KARTEN_HOECHSTENS,
      laengen: { name: import_rechte.NAME_LAENGE, bezeichnung: import_rechte.BEZEICHNUNG_LAENGE }
    };
  }
  // Jedes Wort muss in ID oder Name stehen; nur Datenpunkte, deren Typ zum Teil passt, nie unter system
  suche(katalog, n) {
    var _a;
    const art = (_a = import_rechte.KARTENARTEN[n.typ]) == null ? void 0 : _a.teile[String(n.teil)];
    if (!art) {
      return { treffer: [], mehr: false };
    }
    const woerter = (typeof n.suche === "string" ? n.suche : "").toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8);
    const treffer = [];
    for (const [id, m] of katalog.alleDatenpunkte()) {
      if (!art.typen.includes(m.type) || (0, import_rechte.liegtUnter)(id, "system")) {
        continue;
      }
      const name = typeof m.name === "string" ? m.name : id;
      const heu = `${id}
${name}`.toLowerCase();
      if (woerter.every((w) => heu.includes(w))) {
        treffer.push({ id, name, typ: m.type, ...typeof m.unit === "string" ? { einheit: m.unit } : {} });
      }
    }
    treffer.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    return { treffer: treffer.slice(0, TREFFER), mehr: treffer.length > TREFFER };
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  KARTENBEFEHLE,
  Kartenseite
});
//# sourceMappingURL=kartenseite.js.map
