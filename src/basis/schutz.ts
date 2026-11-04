import net from 'node:net';
import { GRENZEN, type Grenzen } from './grenzen';

export class Eimer {
    private vorrat: number;
    private stand: number;

    public constructor(
        private readonly jeSekunde: number,
        private readonly stoss: number,
        jetzt: number,
    ) {
        this.vorrat = stoss;
        this.stand = jetzt;
    }

    public nimm(jetzt: number): boolean {
        this.vorrat = Math.min(this.stoss, this.vorrat + ((jetzt - this.stand) * this.jeSekunde) / 1000);
        this.stand = jetzt;
        if (this.vorrat < 1) {
            return false;
        }
        this.vorrat -= 1;
        return true;
    }
}

// Anhaltend heißt: Ablehnungen ohne Pause über ueberlastPauseMs, zusammen mindestens ueberlastMs. Nicht „ohne angenommene
// Nachricht“, weil der Eimer auch bei Dauerbeschuss immer wieder einzelne Nachrichten durchlässt.
export class Ueberlast {
    private beginn?: number;
    private letzte = 0;

    public constructor(private readonly grenzen: Grenzen = GRENZEN) {}

    public abgelehnt(jetzt: number): boolean {
        if (this.beginn === undefined || jetzt - this.letzte > this.grenzen.ueberlastPauseMs) {
            this.beginn = jetzt;
        }
        this.letzte = jetzt;
        return jetzt - this.beginn >= this.grenzen.ueberlastMs;
    }
}

interface Fehlversuche {
    zeiten: number[];
    gesperrtBis?: number;
}

// IPv6 je /64: Ein Gerät hat darin beliebig viele Adressen, eine Sperre je Adresse liefe ins Leere.
export function sperrbereich(adresse: string): string {
    const ohneZone = adresse.split('%')[0];
    if (!net.isIPv6(ohneZone)) {
        return adresse;
    }
    const [vorn, hinten] = ohneZone.split('::');
    const gruppen = (teil: string | undefined): string[] => (teil ? teil.split(':') : []);
    // Eine IPv4-Schreibweise am Ende belegt zwei Gruppen.
    const laenge = (g: string[]): number => g.length + (g.at(-1)?.includes('.') ? 1 : 0);
    const a = gruppen(vorn);
    const b = gruppen(hinten);
    const alle = hinten === undefined ? a : [...a, ...Array<string>(8 - laenge(a) - laenge(b)).fill('0'), ...b];
    return `${alle
        .slice(0, 4)
        .map(g => parseInt(g, 16).toString(16))
        .join(':')}::/64`;
}

// Größe begrenzt, damit viele wechselnde Adressen den Speicher nicht füllen.
export class Sperrliste {
    private readonly eintraege = new Map<string, Fehlversuche>();

    public constructor(private readonly grenzen: Grenzen = GRENZEN) {}

    public gesperrt(adresse: string, jetzt: number): boolean {
        return this.istGesperrt(this.eintraege.get(sperrbereich(adresse)), jetzt);
    }

    // true, wenn die Adresse durch diesen Versuch gesperrt wurde
    public fehlversuch(adresse: string, jetzt: number): boolean {
        const bereich = sperrbereich(adresse);
        const e = this.eintraege.get(bereich) ?? { zeiten: [] };
        if (this.istGesperrt(e, jetzt)) {
            return false;
        }
        this.eintraege.delete(bereich);
        e.zeiten = [...e.zeiten.filter(z => jetzt - z < this.grenzen.fehlversuchFensterMs), jetzt];
        e.gesperrtBis = undefined;
        const gesperrt = e.zeiten.length >= this.grenzen.fehlversuche;
        if (gesperrt) {
            e.zeiten = [];
            e.gesperrtBis = jetzt + this.grenzen.sperreMs;
        }
        this.eintraege.set(bereich, e);
        this.raeumeAuf(jetzt);
        return gesperrt;
    }

    private istGesperrt(e: Fehlversuche | undefined, jetzt: number): boolean {
        return e?.gesperrtBis !== undefined && e.gesperrtBis > jetzt;
    }

    private raeumeAuf(jetzt: number): void {
        if (this.eintraege.size <= this.grenzen.sperrlisteEintraege) {
            return;
        }
        for (const [bereich, e] of this.eintraege) {
            const aktiv =
                this.istGesperrt(e, jetzt) || e.zeiten.some(z => jetzt - z < this.grenzen.fehlversuchFensterMs);
            if (!aktiv) {
                this.eintraege.delete(bereich);
            }
        }
        // Map hält die Einfügereihenfolge, fehlversuch() fügt neu ein: vorne stehen die am längsten unberührten. Sperren
        // fallen erst zuletzt weg, sonst höbe eine Flut neuer Adressen sie auf.
        for (const auchGesperrte of [false, true]) {
            for (const [bereich, e] of this.eintraege) {
                if (this.eintraege.size <= this.grenzen.sperrlisteEintraege) {
                    return;
                }
                if (auchGesperrte || !this.istGesperrt(e, jetzt)) {
                    this.eintraege.delete(bereich);
                }
            }
        }
    }
}
