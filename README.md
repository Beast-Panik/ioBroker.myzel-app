# ioBroker.myzel-app

Adapter, der die Myzel-App (Android) mit ioBroker verbindet. Nur für den Eigenbetrieb, nicht im offiziellen ioBroker-Repository. Fertige Stände samt `build/` liegen auf GitHub unter `Beast-Panik/ioBroker.myzel-app`; von dort installiert ioBroker den Adapter.

Konzept und Entscheidungen: KONZEPT-APP.md, DETAILENTWURF-APP.md.
Protokoll: [protokoll/v1/](protokoll/v1/), eine Quelle für Adapter und App.

## Stand

Seit K1 (0.2.0) bekommen Apps keine einzelnen Datenpunkte mehr, nur fertige Karten. A3, A4 und G1 beschreiben den früheren Stand.

A2: Der Adapter erzeugt beim ersten Start Adapter-ID, Schlüssel und Zertifikat (Objekt `identitaet`) und öffnet den TLS-Server für Apps im Heimnetz. Kopplung und Anmeldung laufen nach Protokoll, mit Ratenbegrenzung und Sperren. Den Kopplungsdialog im Admin gibt es erst mit A7; bis dahin rufen nur Tests die Kopplung auf.

A3: Angemeldete Apps sehen die Datenpunkte ihres Profils (Räume, Einzelfreigaben, Sperren), gegliedert nach Räumen und Funktionen, abonnieren Werte und setzen sie. Profile liegen als Objekte `profile.<id>` und werden bis A7 von Hand angelegt.

A4: Ändern sich Profil, Räume, Funktionen, Datenpunkte, Systemsprache oder die Profilzuordnung einer App, bekommen verbundene Apps nach rund 2 s neue Rechte; entfallene Datenpunkte fallen sofort aus dem Abo. Wird eine App gelöscht oder ihr Zugang geändert, endet ihre Verbindung (4008). Datenpunkte, Räume und Profile hält der Adapter dafür in einem Katalog im Speicher.

A5: Apps melden Akku, Anrufe und Benachrichtigungen, soweit sie im Objekt der App unter `handydaten` eingeschaltet sind (bis A7 von Hand), sonst `fehler aus`. `anwesend` ist `true`, solange die App über das Heimnetz verbunden ist, und wird erst nach dem Nachlauf `false`. Rufnummern, Namen und Inhalte stehen nie im Log.

A6: Ein Skript schreibt Text oder JSON (`titel`, `text`, `wichtigkeit`) in `apps.<id>.hinweis.senden`. Der Adapter schickt den Hinweis an die App oder hält ihn bis zur nächsten Anmeldung, höchstens 20 je App und bis zur eingestellten Frist. `apps.<id>.hinweis.status` zeigt `wartet`, `gesendet`, `angezeigt`, `abgelaufen`, `voll` oder `ungueltig`.

A7: Gerätemanager im Admin: Apps per QR-Code koppeln, Profile bearbeiten, je App Profil und Handydaten wählen, Apps entfernen. Läuft der Admin ohne Anmeldung, warnt der Kopplungsdialog.

A8: App-Simulator und Sicherheitsprüfung. Der Adapter nimmt nur Verbindungen aus dem Heimnetz an: private Bereiche und die Netze der eigenen Schnittstellen. CGNAT-Adressen wie bei Tailscale gelten nicht als Heimnetz. Die Datenpunkte der Apps (Anrufe, Benachrichtigungen) gibt nur eine Einzelfreigabe frei, kein Raum. Sperren und `system.*` gelten auch für das Ziel eines Alias.

G1: Geräte als Kacheln (KONZEPT-GERAETE.md). Die Aktion „Geräte“ im Gerätemanager legt Lampen als Objekte `geraete.<id>` an, je Teil (An und aus, Helligkeit, Farbe RGB, Lichtfarbe) ein Datenpunkt. Geräte geben keine Rechte: Eine App bekommt ein Gerät nur mit den Teilen, die ihr Profil freigibt und deren Typ passt. Ein Datenpunkt gehört zu höchstens einem Gerät. Geräte gehen nur an Apps mit Protokoll 2; der Adapter antwortet in der Version der App. Geprüft im Test-ioBroker mit Admin und Simulator in Protokoll 1 und 2.

K1: Karten statt Datenpunkte (KONZEPT-KARTEN.md). Die Aktion „Karten“ im Gerätemanager legt Karten als Objekte `karten.<id>` an: Lampe, Schalter, Messwert mit bis zu vier Werten und Thermostat, jede mit Raum und je Teil einem Datenpunkt. Die Karten stehen im Gerätemanager neben den Apps und lassen sich dort bedienen. Profile geben Räume frei (alle Karten des Raums) und einzelne Karten, auch mit anderem Recht; gesperrte Karten fehlen. Seit K3 liegen Karten und Profile in eigenen Reitern der Instanzeinstellungen, siehe dort. Karten mit Datenpunkten der Apps gibt nur eine Einzelfreigabe frei. Apps bekommen die Karten mit Einheit, Bereich und Schritt für Regler in Protokoll 3; Apps mit Protokoll 1 oder 2 bekommen `fehler version`. `abo` und `setze` gehen weiter je Datenpunkt, nur für Teile freigegebener Karten. Beim ersten Start werden Geräte zu Lampenkarten im Raum ihres ersten Teils, Profile verlieren die Freigaben und Sperren von Datenpunkten, mit Warnung im Log.

K3: Karten und Profile haben je einen eigenen Reiter in den Instanzeinstellungen: Apps, Karten, Profile, Einstellungen. Der Gerätemanager im Reiter Apps und damit der Reiter „Geräte“ des Admins zeigen nur noch Apps. Karten und Profile stehen in `native.karten` und `native.profile`; neue bekommen eine feste ID aus der Zeit. Die Auswahllisten im Profil zeigen Räume und Karten mit Namen. Speichern startet die Instanz neu, verbundene Apps sind wenige Sekunden getrennt. Beim Start meldet der Adapter unbrauchbare Zeilen und unpassende Datenpunkte im Log. Die Karten ordnet er nach Räumen wie in der App (0.2.1). Geräte, Karten- und Profilobjekte früherer Stände übernimmt der Start in die Einstellungen und löscht die Objekte.

Karten- und Profilseite (0.4.0): Die Reiter Karten und Profile sind je eine eigene Seite. Karten stehen je Raum als Kacheln, ohne Raum zuletzt; das Zahnrad öffnet sie zum Bearbeiten, „Neue Karte“ legt eine an. Je Teil sucht ein Feld nur Datenpunkte des passenden Typs, nach ID und Name. Der Adapter prüft jede Karte beim Speichern und zeigt Mängel je Teil an der Kachel und im Dialog. Profile stehen als Kacheln mit dem, was eine App damit sieht, und den Apps, die sie haben; im Dialog je Raum Nein, Ansehen oder Bedienen, je Karte Wie Raum, Ansehen, Bedienen oder Gesperrt, mit einer Vorschau, die der Adapter bei jeder Wahl rechnet. Karten und Profile sind Objekte `karten.<id>` und `profile.<id>` und wirken sofort, ohne Neustart der Instanz: Verbundene Apps bekommen nach rund 2 s neue Rechte und bleiben verbunden. Die Seiten verbinden sich über die Bibliothek, die der Admin selbst ausliefert, und gehen nur bei laufender Instanz. Karten und Profile aus den Instanzeinstellungen zieht der Start in Objekte um und leert die Listen; ein brauchbares Objekt mit derselben ID gewinnt.

Etagen (0.5.0): Der Reiter Räume legt Etagen mit Name und Kurzname an, als Objekte `etagen.<id>`. Räume zieht man in eine Etage und ordnet sie dort, auch mit Alt und Pfeiltasten; das Zahnrad ändert Name, Kurzname und Position oder löscht die Etage. Apps ab Protokoll 5 bekommen die Etagen mit den sichtbaren Räumen und die Räume in dieser Folge, Räume ohne Etage danach nach Namen. Die App zeigt Überschriften nur, wenn die sichtbaren Räume auf mehr als einer Etage liegen. Apps mit Protokoll 3 oder 4 sehen keinen Unterschied. Die Reiter Karten und Profile nennen die Räume in derselben Folge. Etagen wirken sofort, ohne Neustart der Instanz.

Vorschläge (0.6.0): Der Knopf „Vorschläge“ im Reiter Karten zeigt, wie viele Geräte aus ioBroker eine Karte werden können, erkannt mit `@iobroker/type-detector` (MIT) an Rollen und Aufbau. Im Dialog stehen sie nach Räumen; angehakte werden mit derselben Prüfung wie „Neue Karte“ angelegt. Lichter werden Lampen, Steckdosen Schalter, Thermostate Thermostate, Fühler und Kontakte Messwerte. Name und Raum kommen aus ioBroker. Seit 0.7.0 werden Teile mit gleichem Namen aus einer Instanz eins, wo sie sich ergänzen, etwa An, Helligkeit und Farbe einer Lampe als einzelne Datenpunkte. Seit 0.7.1 auch Teile eines Geräts über seine ID; Einstellungen eines Geräts, etwa die Farboptionen einer Zigbee-Lampe, kommen nicht als Schalter. Je Vorschlag lässt sich der Raum wählen; weicht er von ioBroker ab, verschiebt der Adapter beim Anlegen Gerät, Kanal oder Datenpunkte dorthin, auch das ganze Gerät, wenn nur dieser Vorschlag daraus kommt. Nie vorgeschlagen werden Geräte, deren Datenpunkte schon in einer Karte stehen, auch über einen Alias, `system.*`, die Handydaten der Apps und Adapter, die keine Geräte steuern. Erkannt wird nur, wenn der Reiter danach fragt (KONZEPT-KARTEN.md, Abschnitt 14).

Fernzugang (0.8.0): Unterwegs erreicht die App den Adapter über einen eigenen Vermittler (vermittler/, KONZEPT-FERNZUGANG.md). Der Adapter wählt sich selbst beim Vermittler ein, zu Hause öffnet sich kein Port. TLS geht wie im Heimnetz von der App bis in den Adapter; der Vermittler reicht nur verschlüsselte Bytes weiter und kann sich weder als App noch als Adapter ausgeben. Der Reiter „Fernzugang“ nimmt die Adresse des Vermittlers, zeigt den Stand der Verbindung und die Zeile für die `.env` des Vermittlers, gibt den Fernzugang je App frei (Vorgabe aus) und erzeugt nach einer Rückfrage einen neuen Schlüssel; danach braucht der Vermittler die neue Zeile. Adresse und Geheimnis liegen im Objekt `fernzugang`, das Geheimnis verschlüsselt. Freigegebene Apps ab Protokoll 6 bekommen Adresse und Schlüssel beim Verbinden im Heimnetz; Ausschalten trennt eine Sitzung über den Vermittler sofort (4010). Über den Vermittler steht `apps.<id>.weg` auf `fern`, im Heimnetz auf `lokal`, ohne Verbindung leer; die Karte der App im Reiter Apps zeigt das als „Heimnetz“, „Vermittler“ oder „Getrennt“ (0.8.1); `anwesend` setzt weiter nur das Heimnetz, gekoppelt wird nur dort. `info.fernzugang` zeigt, ob die Verbindung zum Vermittler steht. Lebenszeichen über den Vermittler alle 10 Minuten, Schluss nach 25 Minuten ohne Antwort. Zum Schutz des Heimanschlusses wächst der Abstand zwischen Versuchen und beginnt erst nach einer Minute stabiler Verbindung wieder bei 1 s; höchstens 30 Sitzungen je 10 Minuten. Braucht Myzel Home ab 0.7.0; ältere Apps verbinden sich weiter nur im Heimnetz.

Zonen (in Arbeit, Z1 aus KONZEPT-ZONEN.md, Abschnitt 16): Der Reiter „Zonen“ legt Orte an, je mit Name, fester ID für Skripte, Mittelpunkt als „Breite, Länge“ und Radius von 100 bis 10 000 m, höchstens 20, als Objekte `zonen.<id>`. Im Dialog „Handydaten“ des Reiters Apps gibt es zwei neue Datenarten, „Zonen“ mit der Wahl der Zonen je App und „Standort“, beide aus als Vorgabe. Apps ab Protokoll 7 bekommen nur ihre Zonen und melden Betreten und Verlassen nach `apps.<id>.zonen.<zone>` und `zonen.letzte`, ob sie Zonen erkennen können nach `zonen.aktiv` und `zonen.grund`, den Standort nach `standort.*`. Höchstens 60 Zonenmeldungen je Stunde und ein Standort je Minute; Koordinaten nie im Log. Umbenennen gilt sofort für die Datenpunkte; eine gelöschte oder entzogene Zone verliert ihren Datenpunkt bei allen Apps, ausgeschaltet bleibt er. Die App kann das noch nicht.

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
```

Danach Befehle je Zeile, etwa `abo 0_userdata.0.lampe`, `setze 0_userdata.0.lampe true`, `akku 80 laedt`,
`anruf klingelt eingehend +49301234 "Anna B"`, ab Protokoll 7 `zone zuhause rein`, `zonenstand an zuhause`,
`zonenstand aus hintergrund`, `standort 50.9413 6.9583 12`, dazu `angezeigt <id>`, `roh {"t":"x"}`, `ende`; `hilfe`
zeigt alle.
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
docker exec -u iobroker myzel-iobroker-dev-iobroker-1 iobroker url /opt/projekt/ioBroker.myzel-app/iobroker.myzel-app-0.2.0.tgz
docker exec -u iobroker myzel-iobroker-dev-iobroker-1 iobroker add myzel-app
docker exec -u iobroker myzel-iobroker-dev-iobroker-1 iobroker start myzel-app.0
```

Test-ioBroker: siehe `dev/docker-compose.yml` im Hauptrepository.

## Changelog

### 0.9.0-alpha.1

Vorabversion, nur über den Zweig `vorab` auf GitHub. Zonenwechsel und geänderte Zonenstände stehen im Log, etwa „Zone „Zuhause“ betreten um 17:42:10“ oder „Zonen nicht aktiv um 09:15:03: Standort am Handy aus“. Die Uhrzeit ist die vom Handy, die Zeile selbst trägt die Ankunft; Nachgeliefertes erkennt man so. Nur Namen, nie ein Ort. Den Stand, den jede neue Verbindung wieder schickt, nennt das Log nur, wenn er sich geändert hat

### 0.9.0-alpha.0

Vorabversion für den Alltagstest der Zonen, nur über den Zweig `vorab` auf GitHub (`iobroker url https://github.com/Beast-Panik/ioBroker.myzel-app/tree/vorab`)

Zonen, Teil Adapter (Z1): Reiter „Zonen“ zum Anlegen, Ändern und Löschen von Orten; Datenarten „Zonen“ mit Wahl der Zonen und „Standort“ im Dialog „Handydaten“. Protokoll 7 mit `zonen` in `willkommen` und `rechte` und den Nachrichten `zone`, `zonenstand` und `standort`; Apps bis Protokoll 6 merken davon nichts. Datenpunkte `apps.<id>.zonen.*` und `apps.<id>.standort.*`. Der Simulator kennt die neuen Nachrichten

Zonen, Teil App (Z2): Grund `aus` für „in der App ausgeschaltet“; Nachricht `vorschlag` mit einem Standort vom Handy, der im Dialog einer Zone 15 Minuten lang als „Vom Handy übernehmen“ steht. Gespeichert wird er nur im Speicher und nur, wenn jemand ihn übernimmt und die Zone speichert

Ein beschädigtes Objekt `apps.<id>`, etwa nach einem fehlerhaften `iobroker object set`, hebt die Kopplung nicht mehr auf. Der Adapter trennt die App mit 1011 statt 4008 oder 4001; sie behält ihren Zugang, versucht es weiter und ist wieder verbunden, sobald das Objekt heil ist. Anmelden kann sie sich ohne gültiges Objekt weiterhin nicht. Fehlt das Objekt oder steht darin ein anderer Zugang, ist die Kopplung wie bisher aufgehoben. Gewarnt wird einmal je App, nicht bei jedem Versuch. Gilt auch für alle schon installierten Apps

Sicherheitsprüfung der Zonen (Z4): Zonen im Admin auszuschalten wirkt sofort, ein Stand danach setzt `zonen.aktiv` nicht wieder auf `true`. Eine neue Zone unter der ID einer gelöschten geht nicht ungefragt an deren Apps. Höchstens 20 Zonen je App. Die Mengen gelten je App über alle Sitzungen. Nach „Entfernen“ und bei Apps mit Protokoll 6 steht `zonen.aktiv` auf `false` mit Grund. Umbenennen außerhalb des Reiters behält die übrigen Einstellungen des Datenpunkts, eine kurz unbrauchbare Zone löscht ihn nicht

### 0.8.1

Die Karte jeder App im Reiter Apps zeigt live, wie sie verbunden ist: „Heimnetz“ oder „Vermittler“ in Grün, „Getrennt“ in Rot, mit Erklärung beim Darüberfahren; der Akku steht daneben in derselben Zeile. Solange eine App nicht verbunden ist, ist `apps.<id>.weg` leer; bisher blieb dort der letzte Weg stehen. Die Anzeigen braucht einen Admin, der eigene Anzeigen im Gerätemanager kennt (geprüft mit 8.3.5); ältere zeigen dort nichts mehr, der Stand steht dann weiter in `online` und `weg`

Sicherheitsprüfung F4 (KONZEPT-FERNZUGANG.md, Abschnitt 15): Eine fehlerhafte Nachricht des Vermittlers bringt den Adapter nicht mehr zum Absturz, `/info` wird höchstens 1 KiB weit gelesen, auch gepackt. Über den Vermittler meldet sich nur eine freigegebene App an; Verbindungen ohne Anmeldung über ihn sind begrenzt (2 je App, 10 insgesamt), Sitzungen je App ebenso (10 je 10 Minuten). Ersetzt eine Verbindung über den Vermittler eine noch offene im Heimnetz, wird die App nach dem Nachlauf abwesend. `setze` hält den Bereich der Karte ein, auch wenn der Datenpunkt keinen nennt, und Farben nur als `#RRGGBB`. Benachrichtigungen legen Ordner nur noch für Apps aus der Auswahl an. Die Erkennung braucht in großen Installationen Sekunden statt Minuten. Ein Raumwechsel aus einem Vorschlag verschiebt keinen Ordner mehr, in dem noch Fremdes liegt. Handydaten anderer Instanzen gelten als persönlich. Eine App, die sich in einer Schleife anmeldet, wird gebremst

### 0.8.0

Fernzugang über einen eigenen Vermittler (vermittler/): Der Adapter wählt sich selbst ein, TLS geht von der App bis in den Adapter. Neuer Reiter „Fernzugang“ mit Adresse des Vermittlers, Stand, Zeile für die `.env` des Vermittlers, Freigabe je App und neuem Schlüssel mit Rückfrage. Protokoll 6 mit `fern` in `willkommen` und `rechte`, Schließcode 4010 beim Ausschalten; `apps.<id>.weg` zeigt `fern`, `info.fernzugang` die Verbindung zum Vermittler. Braucht Myzel Home ab 0.7.0

### 0.7.1

Räume mit gleichem Namen zeigen in den Reitern Karten, Räume und Profile ihre ID hinter dem Namen, etwa „Wohnzimmer (living_room)“ und „Wohnzimmer (wohnzimmer)“

Vorschläge fassen auch Teile eines Geräts über seine ID zusammen, etwa An und Helligkeit aus zwei Kanälen, unter dem Namen des Geräts; zwei Geräte nie, auch nicht mit gleichem Namen. Einstellungen eines Geräts, die der Erkenner für Schalter hält, etwa die Farboptionen einer Zigbee-Lampe oder die Fenstererkennung eines Thermostats, kommen nicht mehr als eigener Schalter

### 0.7.0

Vorschläge fassen Teile mit gleichem Namen aus einer Instanz zusammen, etwa An, Helligkeit und Farbe einer Lampe, die ioBroker nicht als ein Gerät kennt. Ein Schalter mit dem Namen einer Lampe wird ihr An, ein Temperaturfühler mit dem Namen eines Thermostats seine Isttemperatur. Teile in verschiedenen Räumen, aus zwei Instanzen oder doppelte Teile bleiben getrennt. Im Dialog hat jeder Vorschlag eine Raumauswahl; ein geänderter Raum wird beim Anlegen in ioBroker übernommen, das Gerät, der Kanal oder die Datenpunkte wandern in den neuen Raum und aus den anderen heraus

### 0.6.0

Vorschläge aus der Erkennung: Im Reiter Karten zeigt ein Knopf „Vorschläge“, wie viele Geräte aus ioBroker eine Karte werden können. Der Dialog listet sie nach Räumen, angehakte werden Karten. Erkannt mit `@iobroker/type-detector` 6.2.0, nur auf Anfrage der Seite. Neue Befehle `vorschlaege` und `legeKartenAn`

### 0.5.0

Etagen: Ein neuer Reiter Räume legt Etagen mit Name und Kurzname an und ordnet die Räume durch Ziehen oder mit der Tastatur. Protokoll 5 bringt `etagen` im Rechteinhalt und `etage` am Raum; die Räume kommen in der Folge der Etagen. Apps mit Protokoll 3 oder 4 bekommen beides nicht. Die Reiter Karten und Profile nennen die Räume in derselben Folge

### 0.4.0

Eigene Seiten in den Reitern Karten und Profile statt der aufklappbaren Listen. Karten je Raum als Kacheln, Zahnrad zum Bearbeiten, ein Knopf „Neue Karte“, Datenpunktsuche je Teil nur mit passendem Typ, Prüfung beim Speichern mit Mängeln je Teil. Profile als Kacheln mit Sicht und Apps, im Dialog je Raum und je Karte eine Wahl, Vorschau bei jeder Wahl, Löschen mit Rückfrage, die die betroffenen Apps nennt. Karten und Profile liegen als Objekte unter `karten` und `profile` und wirken ohne Neustart der Instanz; der Start zieht sie aus den Instanzeinstellungen dorthin um. Die Auswahllisten `raeume` und `karten` des alten Profilreiters entfallen

### 0.3.0

Benachrichtigungen im eigenen Ordner `apps.<id>.benachrichtigungen`: je App ein Unterordner, benannt nach dem Paketnamen mit `-` statt Punkt (`org-signal`), mit `app`, `paket`, `titel`, `text`, `zeit` und `json`; dazu `letzte` mit der neuesten Benachrichtigung aller Apps. Geschrieben wird erst der Ordner der App, dann `letzte`, je mit `json` zuletzt. Protokoll 4 bringt die Nachricht `auswahl`: Die App meldet, welche Apps sie weitergibt, der Adapter legt deren Ordner sofort an und entfernt die Ordner abgewählter Apps. Apps mit Protokoll 3 laufen weiter, ihre Ordner entstehen mit der ersten Benachrichtigung. Der Kanal `benachrichtigung` von 0.2.x wird beim Start entfernt

### 0.2.2

Fehler behoben: Nach schnellem Schalten blieb in der App der falsche Stand stehen, wenn der Geräteadapter mit einem älteren Zeitstempel bestätigte, etwa der Zeit seines Gateways. Der Adapter verwarf solche Änderungen. Jetzt gilt immer die zuletzt gemeldete Änderung; ioBroker meldet in Reihenfolge

### 0.2.1

Karten im Reiter „Karten“ nach Räumen geordnet wie in der App, Karten ohne Raum zuletzt, im Raum nach Namen. Der Adapter ordnet beim Start und schreibt nur, wenn sich die Reihenfolge geändert hat; dann startet die Instanz einmal mehr neu

### 0.2.0

Karten statt Datenpunkte: Lampen, Schalter, Messwerte mit bis zu vier Werten und Thermostate mit Raum, im eigenen Reiter „Karten“ der Instanzeinstellungen. Profile im Reiter „Profile“ geben Räume und einzelne Karten frei und sperren Karten. Der Gerätemanager im Reiter „Apps“ zeigt nur Apps. Speichern startet die Instanz neu; unbrauchbare Karten und unpassende Datenpunkte stehen beim Start im Log. Protokoll 3 mit `karten` und `raeume`, ohne `datenpunkte`, `funktionen` und `geraete`; Apps mit Protokoll 1 oder 2 bekommen `fehler version`. Der Adapter liefert Bereich und Schritt für Regler. Beim ersten Start werden Geräte zu Lampenkarten und Profile auf Karten umgestellt, beides in die Instanzeinstellungen

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
