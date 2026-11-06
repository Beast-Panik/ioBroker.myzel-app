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
var werte_exports = {};
__export(werte_exports, {
  Abostelle: () => Abostelle,
  Werteversand: () => Werteversand,
  alsWert: () => alsWert,
  alsZustand: () => alsZustand,
  inTeilen: () => inTeilen,
  pruefeSetzen: () => pruefeSetzen
});
module.exports = __toCommonJS(werte_exports);
const SAMMELN_MS = 100;
const TEXT_HOECHSTENS = 65536;
function alsWert(val) {
  if (typeof val === "boolean" || val === null) {
    return val;
  }
  if (typeof val === "number") {
    return Number.isFinite(val) ? val : null;
  }
  const text = typeof val === "string" ? val : val === void 0 ? void 0 : JSON.stringify(val);
  return text !== void 0 && text.length <= TEXT_HOECHSTENS ? text : null;
}
function alsZustand(state) {
  if (!state) {
    return null;
  }
  return {
    val: alsWert(state.val),
    ack: state.ack === true,
    ts: Number.isFinite(state.ts) && state.ts > 0 ? Math.round(state.ts) : 0
  };
}
const JSON_TYPEN = /* @__PURE__ */ new Set(["json", "array", "object"]);
function pruefeSetzen(common, val) {
  var _a;
  if (common.write === false) {
    return { code: "rechte", grund: "Datenpunkt ist nicht beschreibbar" };
  }
  const typ = (_a = common.type) != null ? _a : "mixed";
  if (typ === "mixed") {
    return void 0;
  }
  if (typ === "file") {
    return { code: "ungueltig", grund: "Datenpunkte vom Typ file werden nicht gesetzt" };
  }
  const erwartet = JSON_TYPEN.has(typ) ? "string" : typ;
  if (typeof val !== erwartet || val === null) {
    return { code: "ungueltig", grund: `Typ ${typ} erwartet` };
  }
  if (typeof val === "number") {
    if (typeof common.min === "number" && val < common.min || typeof common.max === "number" && val > common.max) {
      return { code: "ungueltig", grund: "Zahl au\xDFerhalb von min und max" };
    }
  }
  if (JSON_TYPEN.has(typ)) {
    try {
      JSON.parse(val);
    } catch {
      return { code: "ungueltig", grund: `Typ ${typ} erwartet g\xFCltiges JSON` };
    }
  }
  return void 0;
}
function inTeilen(werte, hoechstens) {
  const teile = [];
  let teil = [];
  let groesse = 0;
  for (const eintrag of werte) {
    const g = Buffer.byteLength(JSON.stringify(eintrag));
    if (teil.length > 0 && groesse + g > hoechstens) {
      teile.push(teil);
      teil = [];
      groesse = 0;
    }
    teil.push(eintrag);
    groesse += g;
  }
  if (teil.length > 0 || teile.length === 0) {
    teile.push(teil);
  }
  return teile.map((t) => Object.fromEntries(t));
}
class Abostelle {
  constructor(quelle) {
    this.quelle = quelle;
  }
  empfaenger = /* @__PURE__ */ new Map();
  async ersetze(e, alt, neu) {
    var _a;
    const abonnieren = [];
    const kuendigen = [];
    for (const id of neu) {
      if (alt.has(id)) {
        continue;
      }
      const liste = (_a = this.empfaenger.get(id)) != null ? _a : /* @__PURE__ */ new Set();
      if (liste.size === 0) {
        abonnieren.push(id);
      }
      this.empfaenger.set(id, liste.add(e));
    }
    for (const id of alt) {
      const liste = this.empfaenger.get(id);
      if (neu.has(id) || !(liste == null ? void 0 : liste.delete(e)) || liste.size > 0) {
        continue;
      }
      this.empfaenger.delete(id);
      kuendigen.push(id);
    }
    if (abonnieren.length > 0) {
      await this.quelle.abonniere(abonnieren);
    }
    if (kuendigen.length > 0) {
      await this.quelle.kuendige(kuendigen);
    }
  }
  geaendert(id, state) {
    var _a;
    for (const e of (_a = this.empfaenger.get(id)) != null ? _a : []) {
      e.geaendert(id, state);
    }
  }
  get abonniert() {
    return this.empfaenger.size;
  }
}
class Werteversand {
  constructor(o) {
    this.o = o;
    this.rechte_ = o.rechte;
  }
  rechte_;
  ids = /* @__PURE__ */ new Set();
  offen = /* @__PURE__ */ new Map();
  sammeln;
  reihe = Promise.resolve();
  wartendesAbo;
  beendet = false;
  get rechte() {
    return this.rechte_;
  }
  // Ein wartendes Abo wird ersetzt, nicht eingereiht: Jedes Abo ersetzt das vorige ganz, so bleibt die Reihe kurz.
  abo(ids) {
    if (this.wartendesAbo) {
      this.wartendesAbo.ids = ids;
      return this.wartendesAbo.fertig;
    }
    const abo = { ids, fertig: Promise.resolve() };
    abo.fertig = this.nacheinander(() => {
      this.wartendesAbo = void 0;
      return this.ersetzeAbo(abo.ids);
    });
    this.wartendesAbo = abo;
    return abo.fertig;
  }
  // Wirkt sofort auf Setzen und Versand; das Abo verliert die IDs ohne Recht danach.
  neueRechte(rechte) {
    this.rechte_ = rechte;
    return this.nacheinander(async () => {
      if (!this.beendet) {
        await this.ersetze(new Set([...this.ids].filter((id) => this.erlaubt(id))));
      }
    });
  }
  async setze(n, id, val) {
    const v = this.o.verbindung;
    const ablehnen = (fehler, grund) => {
      this.o.log.debug(`App ${this.o.appId}: setze ${id} abgelehnt, ${grund}`);
      v.sende({ t: "quittung", n, ok: false, fehler });
    };
    if (this.rechte_.recht(id) !== "schreiben") {
      ablehnen("rechte", "kein Recht schreiben");
      return;
    }
    try {
      const common = await this.o.quelle.objekt(id);
      if (!common) {
        ablehnen("rechte", "Datenpunkt gibt es nicht mehr");
        return;
      }
      if (this.rechte_.recht(id) !== "schreiben") {
        ablehnen("rechte", "kein Recht schreiben");
        return;
      }
      if (!this.rechte_.passt(id, val)) {
        ablehnen("ungueltig", "Wert passt nicht zum Bereich der Karte");
        return;
      }
      const fehler = pruefeSetzen(common, val);
      if (fehler) {
        ablehnen(fehler.code, fehler.grund);
        return;
      }
      await this.o.quelle.schreibe(id, val, `App ${this.o.appId}`);
    } catch {
      this.o.log.warn(`App ${this.o.appId}: setze ${id} fehlgeschlagen`);
      v.sende({ t: "quittung", n, ok: false, fehler: "intern" });
      return;
    }
    v.sende({ t: "quittung", n, ok: true });
  }
  geaendert(id, state) {
    var _a;
    if (this.beendet || !this.erlaubt(id)) {
      return;
    }
    this.offen.set(id, alsZustand(state));
    (_a = this.sammeln) != null ? _a : this.sammeln = setTimeout(() => {
      this.nacheinander(() => this.versende()).catch(
        (fehler) => this.o.log.error(`App ${this.o.appId}, aenderung: ${fehler.message}`)
      );
    }, SAMMELN_MS);
  }
  async beende() {
    this.beendet = true;
    clearTimeout(this.sammeln);
    await this.nacheinander(() => this.ersetze(/* @__PURE__ */ new Set()));
  }
  erlaubt(id) {
    return this.ids.has(id) && this.rechte_.recht(id) !== void 0;
  }
  // Nacheinander, sonst überholt ein späterer Schritt den früheren beim Zählen in der Abostelle.
  nacheinander(schritt) {
    this.reihe = this.reihe.catch(() => void 0).then(schritt);
    return this.reihe;
  }
  // Eigener Stand vor der Abostelle: Scheitert das Abonnieren in ioBroker, zählt die Abostelle trotzdem schon um,
  // und beide müssen beim nächsten Mal vom selben Stand ausgehen.
  async ersetze(neu) {
    const alt = this.ids;
    this.ids = neu;
    for (const id of this.offen.keys()) {
      if (!neu.has(id)) {
        this.offen.delete(id);
      }
    }
    await this.o.stelle.ersetze(this, alt, neu);
  }
  async ersetzeAbo(ids) {
    if (this.beendet) {
      return;
    }
    const ohneRecht = ids.filter((id) => !this.rechte_.recht(id));
    if (ohneRecht.length > 0) {
      this.o.verbindung.sendeFehler("rechte", {
        text: `${ohneRecht.length} IDs ohne Recht, nicht abonniert: ${ohneRecht.join(", ")}`
      });
    }
    const neu = new Set(ids.filter((id) => this.rechte_.recht(id)));
    await this.ersetze(neu);
    const states = await this.o.quelle.lies([...neu]);
    const werte = [...neu].filter((i) => this.erlaubt(i)).map((id) => [id, alsZustand(states[id])]);
    await this.sendeInTeilen("werte", werte);
  }
  async versende() {
    this.sammeln = void 0;
    const werte = [...this.offen].filter(([id]) => this.erlaubt(id));
    this.offen.clear();
    if (werte.length === 0 || this.beendet) {
      return;
    }
    await this.sendeInTeilen("aenderung", werte);
  }
  async sendeInTeilen(t, werte) {
    for (const teil of inTeilen(werte, this.o.teilBytes)) {
      await this.o.verbindung.sendeUndWarte({ t, werte: teil });
    }
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Abostelle,
  Werteversand,
  alsWert,
  alsZustand,
  inTeilen,
  pruefeSetzen
});
//# sourceMappingURL=werte.js.map
