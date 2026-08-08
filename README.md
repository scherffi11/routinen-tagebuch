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
**private** OneDrive legen — nicht in das des Arbeitgebers. Gesundheits- und
Stimmungsdaten sind besondere Daten nach Art. 9 DSGVO.

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
- Befinden und Routinen **des Tages X**.

Beim Abendeintrag ist beides frisch im Kopf. Für die spätere Auswertung heißt das:
Routinen von Tag X-1 wirken auf den Schlaf, der im Eintrag von Tag X steht. Aus demselben
Grund bezieht sich das Sport-Feld in der Schlaf-Maske auf Tag X-1, nicht auf Tag X.

Die Erfassung ist in zwei Masken geteilt — **Schlaf** (morgens ausfüllbar, sobald man
aufgewacht ist) und **Tag** (abends, für Stimmung/Routinen/Konsum/Notiz). Ein Umschalter
oben in der Erfassung wechselt zwischen beiden; welche zuerst angezeigt wird, richtet sich
nach der Tageszeit (vor 12 Uhr Schlaf, sonst Tag). Beide Masken schreiben in denselben
Tageseintrag, es gibt keine getrennte Datenstruktur dafür.

## Stand

**Stufe 1** — Erfassung, Verlauf, Routinenverwaltung, Sicherung.

Der Verlauf zeigt Schlafscore und Befinden als Kurven; die Eintragsliste liegt darunter
in einem aufklappbaren Bereich.

**Routinen** sind bewusst nur Verhaltensweisen, die nachgehalten werden — keine
Haushaltsaufgaben mit Terminen. Die Google-Kalender-Anbindung gab es bis August 2026
und wurde wieder entfernt, weil sie ungenutzt blieb.

Noch offen: Sync der Tagebuchdaten über Google Drive (App-Ordner), Stufe 2 Wochenplanung,
Stufe 3 tiefere Auswertung.

## Änderungen veröffentlichen

Nach jeder Änderung an den Dateien in `sw.js` die Zeile `const CACHE = 'routinen-tagebuch-vN'`
hochzählen — sonst serviert das Handy weiter die alte Version aus dem Cache.
