# Routinen-Tagebuch

Schlaf, Befinden und Routinen festhalten — um zu verstehen, wann es einem gut geht
und was den Schlaf beeinflusst.

Web-App ohne Build-Schritt: reines HTML, CSS und ES-Module. Kein Node, kein npm,
keine Abhängigkeiten. Läuft als installierbare PWA auf dem Handy.

## Lokal starten

ES-Module und Service Worker funktionieren nicht über `file://` — es braucht einen Server:

```powershell
.\serve.ps1
```

Dann `http://localhost:8080/` öffnen. Anderer Port: `.\serve.ps1 -Port 8081`.

## Aufbau

| Datei | Zweck |
|---|---|
| `index.html` | Eine Seite, Ansichten werden per JS getauscht |
| `js/store.js` | Datenmodell, localStorage, Schemaversion, Export/Import |
| `js/views.js` | Erfassung, Verlauf, Routinen, Mehr |
| `js/app.js` | Navigation, Service Worker, automatischer Abgleich |
| `js/drive.js` | Abgleich über den Google-Drive-App-Ordner (OAuth über Google Identity Services) |
| `sw.js` | Cacht die App-Hülle für den Offline-Start |
| `serve.ps1` | Testserver für die Entwicklung |

## Wo die Daten liegen

Im `localStorage` des jeweiligen Geräts — und, sobald der Drive-Abgleich eingerichtet
ist, zusätzlich in **einer** JSON-Datei im `appDataFolder` des eigenen Google-Kontos.
Das ist ein versteckter Ordner: in der Drive-Oberfläche nicht sichtbar, für andere
Apps nicht lesbar. **Nichts landet im Repo**, es gibt weiterhin keinen eigenen Server.

Ohne Abgleich gilt: Wird der Browserspeicher geleert, sind die Daten weg. Dann
regelmäßig über *Mehr → Sicherung herunterladen* exportieren und die Datei ins
**private** OneDrive legen — nicht in das des Arbeitgebers. Gesundheits-, Stimmungs-
und Sexualdaten sind besondere Daten nach Art. 9 DSGVO.

### Wie der Abgleich zusammenführt

Kein Gerät gewinnt pauschal. Verglichen wird pro Tageseintrag und pro Routine der
Zeitstempel `updatedAt`; die jüngere Fassung setzt sich durch. Dadurch kann ein Gerät,
das eine Woche offline war, beim Wiederanschluss nichts überschreiben, was inzwischen
woanders erfasst wurde.

Hochgeladen wird nur, wenn sich der Inhalt tatsächlich unterscheidet. Die Sync-Fassung
(`store.syncJSON`) enthält deshalb bewusst **nur Tage und Routinen** — `settings` und
`createdAt` sind geräteeigen und würden sonst bei jedem Abgleich einen Unterschied
vortäuschen und endlos Uploads auslösen.

### Google Drive einrichten

Einmalig, ca. 15 Minuten, nur du selbst kannst das tun (dein Google-Konto):

1. [console.cloud.google.com/projectcreate](https://console.cloud.google.com/projectcreate)
   — neues Projekt anlegen, z. B. „Routinen-Tagebuch"
2. *APIs & Dienste → Bibliothek* — „Google Drive API" suchen, **aktivieren**
3. *APIs & Dienste → OAuth-Zustimmungsbildschirm* — Nutzertyp „Extern", App-Name und
   eigene Mailadresse eintragen. Unter „Testnutzer" **die eigene Google-Mailadresse
   hinzufügen** — ohne diesen Schritt lehnt Google die Anmeldung ab, solange die App
   im Testmodus ist.
4. *APIs & Dienste → Anmeldedaten → + Anmeldedaten erstellen → OAuth-Client-ID*,
   Anwendungstyp „Webanwendung". Unter „Autorisierte JavaScript-Quellen" die
   GitHub-Pages-URL eintragen, exakt, ohne Pfad und ohne Slash am Ende
   (z. B. `https://scherffi11.github.io`). Redirect-URIs werden nicht gebraucht.
5. Die angezeigte Client-ID (endet auf `.apps.googleusercontent.com`) kopieren und in
   der App unter *Mehr → Google Drive* einfügen und speichern.

Die App fordert ausschließlich `drive.appdata` an — sie kann damit **nur** ihren eigenen
versteckten Ordner sehen, nicht die übrigen Dateien in Drive.

Die Client-ID ist kein Geheimnis — Google-Client-IDs sind für den Einsatz im Browser
gedacht. Sie muss auf jedem Gerät einmal eingetragen werden.

**Auf dem iPhone:** Die App muss zum Startbildschirm hinzugefügt werden. Safari löscht
die Daten von normalen Websites nach etwa sieben Tagen ohne Benutzung; bei installierten
Apps nicht.

## Tages-Konvention

Ein Eintrag für Datum X enthält

- den Schlaf der Nacht **X-1 → X** ("letzte Nacht") und
- Befinden, Aktivität und Routinen **des Tages X**.

Beim Abendeintrag ist beides frisch im Kopf. Für die spätere Auswertung heißt das:
Routinen und Sport von Tag X-1 wirken auf den Schlaf, der im Eintrag von Tag X steht.

Die Faustregel für neue Felder: Was **tagsüber** passiert (Sport, Tageslicht, sozialer
Kontakt, Sex), steht im Tag. Nur was sich auf die zurückliegende Nacht bezieht, steht im
Schlaf. Entscheidend ist, ob man die Frage morgens schon beantworten kann — bei allem,
was den ganzen Tag umfasst, geht das nicht.

Bis August 2026 lag das Sport-Feld in der Schlaf-Maske und meinte trotzdem den Vortag.
Diese Sonderregel ist weg; die Migration auf Schema 2 hat die Werte in den Tag verschoben,
an dem der Sport stattgefunden hat.

Die Erfassung ist in zwei Masken geteilt — **Schlaf** (morgens ausfüllbar, sobald man
aufgewacht ist) und **Tag** (abends, für Stimmung/Aktivität/Routinen/Konsum/Notiz). Ein
Umschalter oben in der Erfassung wechselt zwischen beiden; welche zuerst angezeigt wird,
richtet sich nach der Tageszeit (vor 12 Uhr Schlaf, sonst Tag). Beide Masken schreiben in
denselben Tageseintrag, es gibt keine getrennte Datenstruktur dafür. Am Umschalter zeigt ein
kleiner Zähler, wie viel in der jeweiligen Maske noch offen ist.

Quer wischen wechselt den Tag; die Pfeile oben bleiben. Die Schwellen sind streng gesetzt
(60 px waagerecht, deutlich flacher als steil), damit beim Scrollen durch eine lange Maske
nicht versehentlich der Tag umspringt.

## Bewertungsskala

Sechs Stufen, **keine neutrale Mitte**: 1–3 ist die negative Hälfte, 4–6 die positive.
Bei fünf Stufen war die 3 ein Ausweg, mit dem ein Tag ohne Vorzeichen blieb.

Einträge von vor August 2026 wurden umgerechnet: die Zahl bleibt stehen (eine alte 3 zählt
jetzt zur negativen Hälfte), nur die 5 wird zur 6 — sie war der Höchstwert und muss der
Höchstwert bleiben. Jeder Eintrag trägt sein `scaleMax` mit, damit eine alte Sicherungsdatei
beim Einlesen dieselbe Umrechnung durchläuft.

## Sicherung

Drei Ebenen, absteigend nach Verlässlichkeit:

1. **Google-Drive-Abgleich** — das einzige echte automatische Backup, siehe oben.
2. **Automatische Datei alle 3 Tage** — die App legt eine JSON-Datei im Ordner *Download*
   ab. Ausgelöst wird sie vom nächsten Fingertipp, nicht von einer Uhr: Ein Browser darf
   nur aus einer laufenden Nutzergeste heraus schreiben, zeitgesteuerte Downloads gibt es
   im Web nicht. Chrome fragt beim zweiten Mal einmalig nach der Erlaubnis für mehrere
   Dateien. Abschaltbar unter *Mehr → Automatisch sichern*.
3. **Zwischenstände** — drei rollierende Abzüge im localStorage, höchstens einer pro Tag.
   Das ist **keine** Sicherung: Sie liegen im selben Speicher wie die Daten. Sie helfen
   gegen zerschossene Einträge, nicht gegen einen geleerten Browser.

Achtung beim Ordner *Download*: Auf Android lesen ihn andere Apps mit. Wer Schlaf-, Stimmungs-
und Intimdaten dort nicht liegen haben will, schaltet Ebene 2 ab und nutzt den Drive-Abgleich.

## Stand

**Stufe 1** — Erfassung, Verlauf, Routinenverwaltung, Sicherung.

Der Verlauf zeigt Schlafscore und Befinden als Kurven; die Eintragsliste liegt darunter
in einem aufklappbaren Bereich.

Sport, Tageslicht, sozialer Kontakt und Sex gehen **nicht** in die Scores ein. Sie sind
Einflussgrößen, keine Bestandteile von Schlafqualität oder Befinden — stünden sie in der
Formel, fände die spätere Auswertung nur noch die eigene Gewichtung wieder.

**Routinen** sind bewusst nur Verhaltensweisen, die nachgehalten werden — keine
Haushaltsaufgaben mit Terminen. Die Google-Kalender-Anbindung gab es bis August 2026
und wurde wieder entfernt, weil sie ungenutzt blieb.

Noch offen: Sync der Tagebuchdaten über Google Drive (App-Ordner), Stufe 2 Wochenplanung,
Stufe 3 tiefere Auswertung.

## Änderungen veröffentlichen

Nach jeder Änderung an den Dateien in `sw.js` die Zeile `const CACHE = 'routinen-tagebuch-vN'`
hochzählen — sonst serviert das Handy weiter die alte Version aus dem Cache.
