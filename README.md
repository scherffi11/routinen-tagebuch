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
| `js/app.js` | Navigation, Service Worker |
| `js/calendar.js` | Google-Kalender-Anbindung für Routinen (OAuth über Google Identity Services) |
| `sw.js` | Cacht die App-Hülle für den Offline-Start |
| `serve.ps1` | Testserver für die Entwicklung |

## Wo die Daten liegen

Ausschließlich im `localStorage` des jeweiligen Geräts. **Nichts wird übertragen,
nichts landet im Repo.** Es gibt keinen Server und keine Konten.

Daraus folgt: Wird der Browserspeicher geleert, sind die Daten weg. Deshalb
regelmäßig über *Mehr → Sicherung herunterladen* exportieren und die Datei ins
**private** OneDrive legen — nicht in das des Arbeitgebers. Gesundheits- und
Stimmungsdaten sind besondere Daten nach Art. 9 DSGVO.

**Auf dem iPhone:** Die App muss zum Startbildschirm hinzugefügt werden. Safari löscht
die Daten von normalen Websites nach etwa sieben Tagen ohne Benutzung; bei installierten
Apps nicht.

## Tages-Konvention

Ein Eintrag für Datum X enthält

- den Schlaf der Nacht **X-1 → X** ("letzte Nacht") und
- Befinden und Routinen **des Tages X**.

Beim Abendeintrag ist beides frisch im Kopf. Für die spätere Auswertung heißt das:
Routinen von Tag X-1 wirken auf den Schlaf, der im Eintrag von Tag X steht.

## Stand

**Stufe 1** — Erfassung, Verlauf, Routinenverwaltung, Sicherung.

**Vorgezogen aus Stufe 4:** Google-Kalender-Anbindung für Routinen. Aktive Routinen mit
Uhrzeit lassen sich unter *Mehr → Google Kalender* als wiederkehrende Termine in den
primären Google-Kalender eintragen (30 Minuten Standarddauer, danach im Kalender frei
änderbar). Voraussetzung ist eine eigene Google-Client-ID — siehe Abschnitt unten.

Noch offen: Stufe 2 Wochenplanung, Stufe 3 Auswertung, Stufe 4 Sync der Tagebuchdaten
über Google Drive und ein geteilter Kalender für Haushaltsaufgaben.

### Google-Kalender einrichten

Einmalig, ca. 15 Minuten, nur du selbst kannst das tun (dein Google-Account):

1. [console.cloud.google.com/projectcreate](https://console.cloud.google.com/projectcreate)
   — neues Projekt anlegen, z. B. „Routinen-Tagebuch"
2. *APIs & Dienste → Bibliothek* — „Google Calendar API" suchen, **aktivieren**
3. *APIs & Dienste → OAuth-Zustimmungsbildschirm* — Nutzertyp „Extern", App-Name und
   eigene Mailadresse eintragen. Unter „Testnutzer" **deine eigene Google-Mailadresse
   hinzufügen** — ohne diesen Schritt lehnt Google die Anmeldung ab, solange die App
   im Testmodus ist.
4. *APIs & Dienste → Anmeldedaten → + Anmeldedaten erstellen → OAuth-Client-ID*,
   Anwendungstyp „Webanwendung". Unter „Autorisierte JavaScript-Quellen" die
   GitHub-Pages-URL eintragen, exakt, ohne Pfad und ohne Slash am Ende
   (z. B. `https://scherffi11.github.io`). Redirect-URIs werden nicht gebraucht.
5. Die angezeigte Client-ID (endet auf `.apps.googleusercontent.com`) kopieren und in
   der App unter *Mehr → Google Kalender* einfügen und speichern.

Die Client-ID ist kein Geheimnis — Google-Client-IDs sind für den Einsatz im Browser
gedacht. Sie bleibt trotzdem nur lokal auf dem jeweiligen Gerät gespeichert.

## Änderungen veröffentlichen

Nach jeder Änderung an den Dateien in `sw.js` die Zeile `const CACHE = 'routinen-tagebuch-vN'`
hochzählen — sonst serviert das Handy weiter die alte Version aus dem Cache.
