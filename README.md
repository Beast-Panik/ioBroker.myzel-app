# ioBroker.myzel-app

Adapter, der die Myzel-App (Android) mit ioBroker verbindet. Nur für den Eigenbetrieb, nicht im offiziellen ioBroker-Repository. Fertige Stände samt `build/` liegen auf GitHub unter `Beast-Panik/ioBroker.myzel-app`; von dort installiert ioBroker den Adapter.

Konzept und Entscheidungen: KONZEPT-APP.md, DETAILENTWURF-APP.md.
Protokoll: [protokoll/v1/](protokoll/v1/), eine Quelle für Adapter und App.

## Stand

A2: Der Adapter erzeugt beim ersten Start Adapter-ID, Schlüssel und Zertifikat (Objekt `identitaet`) und öffnet den TLS-Server für Apps im Heimnetz. Kopplung und Anmeldung laufen nach Protokoll, mit Ratenbegrenzung und Sperren. Den Kopplungsdialog im Admin gibt es erst mit A7; bis dahin rufen nur Tests die Kopplung auf.

A3: Angemeldete Apps sehen die Datenpunkte ihres Profils (Räume, Einzelfreigaben, Sperren), gegliedert nach Räumen und Funktionen, abonnieren Werte und setzen sie. Profile liegen als Objekte `profile.<id>` und werden bis A7 von Hand angelegt.

A4: Ändern sich Profil, Räume, Funktionen, Datenpunkte, Systemsprache oder die Profilzuordnung einer App, bekommen verbundene Apps nach rund 2 s neue Rechte; entfallene Datenpunkte fallen sofort aus dem Abo. Wird eine App gelöscht oder ihr Zugang geändert, endet ihre Verbindung (4008). Datenpunkte, Räume und Profile hält der Adapter dafür in einem Katalog im Speicher.

A5: Apps melden Akku, Anrufe und Benachrichtigungen, soweit sie im Objekt der App unter `handydaten` eingeschaltet sind (bis A7 von Hand), sonst `fehler aus`. `anwesend` ist `true`, solange die App über das Heimnetz verbunden ist, und wird erst nach dem Nachlauf `false`. Rufnummern, Namen und Inhalte stehen nie im Log.

A6: Ein Skript schreibt Text oder JSON (`titel`, `text`, `wichtigkeit`) in `apps.<id>.hinweis.senden`. Der Adapter schickt den Hinweis an die App oder hält ihn bis zur nächsten Anmeldung, höchstens 20 je App und bis zur eingestellten Frist. `apps.<id>.hinweis.status` zeigt `wartet`, `gesendet`, `angezeigt`, `abgelaufen`, `voll` oder `ungueltig`.

A7: Gerätemanager im Admin: Apps per QR-Code koppeln, Profile bearbeiten, je App Profil und Handydaten wählen, Apps entfernen. Läuft der Admin ohne Anmeldung, warnt der Kopplungsdialog.

A8: App-Simulator und Sicherheitsprüfung. Der Adapter nimmt nur Verbindungen aus dem Heimnetz an: private Bereiche und die Netze der eigenen Schnittstellen. CGNAT-Adressen wie bei Tailscale gelten nicht als Heimnetz. Die Datenpunkte der Apps (Anrufe, Benachrichtigungen) gibt nur eine Einzelfreigabe frei, kein Raum. Sperren und `system.*` gelten auch für das Ziel eines Alias.

G1: Geräte als Kacheln (KONZEPT-GERAETE.md). Die Aktion „Geräte“ im Gerätemanager legt Lampen als Objekte `geraete.<id>` an, je Teil (An und aus, Helligkeit, Farbe RGB, Lichtfarbe) ein Datenpunkt. Geräte geben keine Rechte: Eine App bekommt ein Gerät nur mit den Teilen, die ihr Profil freigibt und deren Typ passt. Ein Datenpunkt gehört zu höchstens einem Gerät. Geräte gehen nur an Apps mit Protokoll 2; der Adapter antwortet in der Version der App. Geprüft im Test-ioBroker mit Admin und Simulator in Protokoll 1 und 2.

## Entwickeln

```
npm ci
npm run build
npm run check      # Typen
npm run lint
npm test           # Unit-Tests, Ablauf über TLS, Paketprüfung
npm run test:integration
```

Der Integrationstest legt sein ioBroker in `/tmp/test-iobroker.myzel-app` an und behält es. Das Instanzobjekt darin
stammt vom ersten Lauf und übernimmt spätere Änderungen an `common` in `io-package.json` nicht (etwa
`supportedMessages`). Nach solchen Änderungen den Ordner löschen.

## App-Simulator

Verhält sich wie die App, für Tests ohne Handy und als Vorlage für die App-Entwicklung. Den Inhalt des QR-Codes
zeigt der Admin nur als Bild; zum Testen im Browser aus den Eigenschaften der QR-Komponente lesen oder mit einem
QR-Leser als Text scannen.

```
npm run simulator -- koppeln "myzelapp://koppeln?v=1&a=…" --name "Tablet Flur"
npm run simulator -- verbinden --bestaetigen
npm run simulator -- verbinden --adresse 127.0.0.1:18095    # Test-ioBroker in Docker über die Portweiterleitung
npm run simulator -- verbinden --version 1                  # wie eine App mit Protokoll 1, ohne Geräte
```

Danach Befehle je Zeile, etwa `abo 0_userdata.0.lampe`, `setze 0_userdata.0.lampe true`, `akku 80 laedt`,
`anruf klingelt eingehend +49301234 "Anna B"`, `angezeigt <id>`, `roh {"t":"x"}`, `ende`; `hilfe` zeigt alle.
Die Kopplung samt Zugang liegt in `app-simulator.local.json`, nur für den Eigentümer lesbar und von git ignoriert.
Der Simulator prüft den Fingerabdruck im TLS-Handshake, jede Nachricht des Adapters und jede eigene am Schema.

`werkzeuge/gegenprobe.ts` ist die Gegenstelle für die Tests der Android-App (`android/kern`): Adapter mit dem ioBroker
im Speicher, gesteuert über JSON-Zeilen auf stdin.

## Installieren aus GitHub

Voraussetzungen: Node.js ab 20, js-controller ab 7.2.2, Admin ab 8.0.11. Auf der Kommandozeile des ioBroker-Rechners:

```
iobroker url https://github.com/Beast-Panik/ioBroker.myzel-app
iobroker add myzel-app
```

Im Admin geht es im Expertenmodus (Schalter unten links): „Adapter“, GitHub-Symbol „Installieren aus eigener URL“, Reiter
„Benutzerdefiniert“, dieselbe Adresse. Der Dialog legt die Instanz gleich mit an. Im Test-ioBroker dauerte das rund
50 s. Läuft ioBroker in Docker, in den Einstellungen der Instanz unter „Adressen für Apps“ die Adresse des
Rechners mit Port 8095 eintragen; sonst ermittelt der Adapter sie selbst. Ein Update holt derselbe Befehl `iobroker url`,
danach die Instanz neu starten.

Nach GitHub überträgt `dev/adapter-auf-github.sh` im Hauptrepository den committeten Stand.

## Installieren im Test-ioBroker

```
npm run paket
docker exec -u iobroker myzel-iobroker-dev-iobroker-1 iobroker url /opt/projekt/ioBroker.myzel-app/iobroker.myzel-app-0.1.0.tgz
docker exec -u iobroker myzel-iobroker-dev-iobroker-1 iobroker add myzel-app
docker exec -u iobroker myzel-iobroker-dev-iobroker-1 iobroker start myzel-app.0
```

Test-ioBroker: siehe `dev/docker-compose.yml` im Hauptrepository.

## Changelog

### 0.1.0

Geräte als Kacheln: Aktion „Geräte“ im Gerätemanager legt Lampen aus An und aus, Helligkeit, Farbe RGB und Lichtfarbe an. Protokoll 2 mit dem Feld `geraete`; der Adapter antwortet in der Version der App, Apps mit Protokoll 1 sehen weiter einzelne Datenpunkte. Geräte geben keine Rechte. Simulator mit `--version`

### 0.0.9

Sicherheitsprüfung: Verbindungen nur aus dem Heimnetz, Pings nur mit Pufferprüfung, Grenzen für Verbindungen ohne Anmeldung und für Nachrichten in Arbeit, `werte` und `aenderung` in Teilen, Sperren je IPv6-/64, abgelaufene Anmeldefristen zählen als Fehlversuch, falsche Geheimnisse machen den QR-Code nicht mehr ungültig, Alias-Ziele geprüft, App-Daten nur über Einzelfreigaben, Rückfrage beim Koppeln mit Adresse und Gerät, Warnung bei Admin ohne Anmeldung, robuster Katalog und Gerätemanager, eine entfernte App ist sofort abwesend

### 0.0.8

Gerätemanager im Admin: Apps per QR-Code koppeln, Profile anlegen, bearbeiten und löschen, je App Profil und Handydaten wählen, Apps entfernen

### 0.0.7

Katalog hält Namen der Datenpunkte nur in der Systemsprache: etwa ein Drittel des Speichers

### 0.0.6

Hinweise ans Handy mit Warteschlange, Frist und Status

### 0.0.5

Handydaten: Anwesenheit, Akku, Anrufe und Benachrichtigungen

### 0.0.4

Rechte folgen Änderungen an Profilen, Räumen, Funktionen und Objekten, während Apps verbunden sind

### 0.0.3

Datenpunkte lesen und schreiben nach Profil, Räumen und Funktionen

### 0.0.2

TLS-Server für Apps, Kopplung, Anmeldung, Ratenbegrenzung

### 0.0.1

Gerüst
