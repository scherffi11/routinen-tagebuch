/**
 * Ansichten. Bewusst ohne Framework und ohne komplettes Neu-Rendern bei jeder
 * Eingabe: einmal aufbauen, danach punktuell aktualisieren. Sonst springt am
 * Handy mitten im Tippen der Fokus aus dem Notizfeld.
 */

import * as store from './store.js';
import * as drive from './drive.js';

const app = document.getElementById('app');

/** Aktuell bearbeiteter Tag in der Erfassung. */
let currentDate = store.isoDate();
let currentDay = null;
let saveTimer = null;
/** Schlaf-Maske morgens, Tages-Maske abends — je nachdem, wann man reinschaut. */
let currentMode = new Date().getHours() < 12 ? 'sleep' : 'day';

/* ---------- kleine Helfer ---------- */

const h = (html) => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
};

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );

function toast(msg) {
  document.querySelector('.toast')?.remove();
  const el = h(`<div class="toast">${esc(msg)}</div>`);
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, 2200);
}

/** Speichert verzögert, damit Tippen im Notizfeld nicht jeden Anschlag schreibt. */
function scheduleSave() {
  clearTimeout(saveTimer);
  setStatus('…');
  saveTimer = setTimeout(() => {
    store.saveDay(currentDay);
    setStatus('Gespeichert');
    updateBackupHint();
  }, 400);
}

function setStatus(text) {
  const el = document.querySelector('.save-status');
  if (el) el.textContent = text;
}

/* ---------- Bausteine ---------- */

/**
 * Skala 1–5 zum Antippen. Erneutes Antippen des gewählten Werts löscht ihn wieder —
 * "keine Angabe" muss erreichbar bleiben, sonst rät man irgendetwas hin.
 */
function scale(field, path, label, hint, low, high, value) {
  const buttons = [1, 2, 3, 4, 5]
    .map(
      (n) => `<button type="button" class="scale-btn${value === n ? ' on' : ''}"
        data-scale="${path}" data-value="${n}"
        aria-label="${esc(label)}: ${n} von 5"
        aria-pressed="${value === n}">${n}</button>`
    )
    .join('');
  return `
    <div class="field" data-field="${path}">
      <div class="field-head">
        <label>${esc(label)}</label>
        ${hint ? `<span class="hint">${esc(hint)}</span>` : ''}
      </div>
      <div class="scale">${buttons}</div>
      <div class="scale-ends"><span>${esc(low)}</span><span>${esc(high)}</span></div>
    </div>`;
}

function timeField(path, label, value, hint = '', step = null) {
  return `
    <div class="field">
      <div class="field-head">
        <label for="f-${path}">${esc(label)}</label>
        ${hint ? `<span class="hint">${esc(hint)}</span>` : ''}
      </div>
      <input type="time" id="f-${path}" data-input="${path}" value="${esc(value || '')}"${step ? ` step="${step}"` : ''}>
    </div>`;
}

const ONSET_OPTIONS = [
  ['fast', 'Schnell'],
  ['medium', 'Mittel'],
  ['slow', 'Langsam'],
];

const DAYTIME_OPTIONS = [
  ['morning', 'Morgens'],
  ['forenoon', 'Vormittags'],
  ['afternoon', 'Nachmittags'],
  ['evening', 'Abends'],
];

const YESNO_OPTIONS = [
  ['yes', 'Ja'],
  ['no', 'Nein'],
];

const WAKEUP_OPTIONS = [
  ['immediate', 'Sofort aufgestanden'],
  ['snooze', 'Snooze'],
];

const SPORT_OPTIONS = [
  ['none', 'Kein Sport'],
  ['light', 'Leichte Aktivität'],
  ['hard', 'Anstrengend'],
  ['intense', 'Intensiv'],
];

const AWAKENINGS_OPTIONS = [
  ['none', 'Durchgeschlafen'],
  ['once', '1x wach'],
  ['multiple', 'Mehrfach wach'],
];

/** Tap-Auswahl aus wenigen Optionen, z. B. Ja/Nein oder Tageszeiten. Erneutes Antippen löscht die Wahl. */
function tapGroup(path, label, options, value, hint = '') {
  const buttons = options
    .map(
      ([val, lbl]) => `<button type="button" class="tap-btn${value === val ? ' on' : ''}"
        data-tap="${esc(path)}" data-tap-value="${esc(val)}" aria-pressed="${value === val}">${esc(lbl)}</button>`
    )
    .join('');
  return `
    <div class="field">
      <div class="field-head">
        <label>${esc(label)}</label>
        ${hint ? `<span class="hint">${esc(hint)}</span>` : ''}
      </div>
      <div class="tap-group cols-${options.length}">${buttons}</div>
    </div>`;
}

/* ---------- Ansicht: Erfassung ---------- */

export function renderToday(date = currentDate) {
  currentDate = date;
  currentDay = store.getDay(date);
  const d = currentDay;
  const nightFrom = store.formatDate(store.addDays(date, -1), { day: 'numeric', month: 'short' });
  const nightTo = store.formatDate(date, { day: 'numeric', month: 'short' });
  const isFuture = date > store.isoDate();
  const atToday = date >= store.isoDate();

  const routineList = store.routinesForDate(date);

  app.innerHTML = `
    <header class="day-nav">
      <button type="button" class="nav-btn" data-nav="-1" aria-label="Vorheriger Tag">‹</button>
      <div class="day-title">
        <h1>${esc(store.relativeDate(date))}</h1>
        <span class="day-sub">${esc(store.formatDate(date))}</span>
      </div>
      <button type="button" class="nav-btn" data-nav="1" aria-label="Nächster Tag"
        ${atToday ? 'disabled' : ''}>›</button>
    </header>

    ${isFuture ? '<p class="notice">Dieser Tag liegt in der Zukunft.</p>' : ''}

    <div class="mode-switch" role="tablist">
      <button type="button" class="mode-btn${currentMode === 'sleep' ? ' on' : ''}"
        data-mode="sleep" role="tab" aria-selected="${currentMode === 'sleep'}">Schlaf</button>
      <button type="button" class="mode-btn${currentMode === 'day' ? ' on' : ''}"
        data-mode="day" role="tab" aria-selected="${currentMode === 'day'}">Tag</button>
    </div>

    ${currentMode === 'sleep' ? sleepSection(d, nightFrom, nightTo) : daySection(d, routineList)}

    <p class="save-status">${d.updatedAt ? 'Gespeichert' : 'Wird automatisch gespeichert'}</p>
    <div class="backup-hint" hidden></div>
  `;

  updateBackupHint();
}

function sleepSection(d, nightFrom, nightTo) {
  return `
    <section class="card">
      <h2>Letzte Nacht <span class="card-sub">${esc(nightFrom)} → ${esc(nightTo)}</span></h2>
      <div class="grid-2">
        ${timeField('sleep.bedtime', 'Ins Bett', d.sleep.bedtime, '', 900)}
        ${timeField('sleep.wakeAt', 'Aufgewacht', d.sleep.wakeAt)}
      </div>
      ${tapGroup('sleep.onset', 'Einschlafen', ONSET_OPTIONS, d.sleep.onset, 'wie schnell?')}
      ${tapGroup('sleep.wakeUp', 'Aufstehen', WAKEUP_OPTIONS, d.sleep.wakeUp)}
      ${tapGroup('sleep.awakenings', 'Nachts wach', AWAKENINGS_OPTIONS, d.sleep.awakenings)}
      <p class="duration">Schlafdauer (geschätzt): <strong data-duration>${store.formatDuration(store.sleepMinutes(d.sleep))}</strong></p>
      ${scale('sleep', 'sleep.rested', 'Erholt aufgewacht', '', 'wie gerädert', 'topfit', d.sleep.rested)}
      ${tapGroup('sleep.sport', 'Sport', SPORT_OPTIONS, d.sleep.sport, `Vortag · ${nightFrom}`)}
    </section>`;
}

function daySection(d, routineList) {
  return `
    <section class="card">
      <h2>Wie ging es dir heute?</h2>
      ${scale('mood', 'mood.mood', 'Stimmung', '', 'mies', 'super', d.mood.mood)}
      ${scale('mood', 'mood.energy', 'Energie', '', 'leer', 'voll da', d.mood.energy)}
      ${scale('mood', 'mood.stress', 'Stress', 'hoch = viel Stress', 'entspannt', 'überdreht', d.mood.stress)}
      ${scale('mood', 'mood.focus', 'Konzentration', '', 'zerstreut', 'klar', d.mood.focus)}
    </section>

    <section class="card">
      <h2>Routinen</h2>
      ${
        routineList.length
          ? `<ul class="routine-list">${routineList
              .map(
                (r) => `
        <li>
          <label class="check">
            <input type="checkbox" data-routine="${esc(r.id)}" ${d.routines[r.id] ? 'checked' : ''}>
            <span class="box" aria-hidden="true"></span>
            <span class="check-label">${esc(r.name)}${
                  r.time ? `<span class="routine-time">${esc(r.time)}</span>` : ''
                }</span>
          </label>
        </li>`
              )
              .join('')}</ul>`
          : '<p class="empty">Noch keine Routinen angelegt. Unter „Routinen" hinzufügen.</p>'
      }
    </section>

    <section class="card">
      <h2>Konsum</h2>
      ${tapGroup('intake.alcohol', 'Alkohol', YESNO_OPTIONS, d.intake.alcohol)}
      ${tapGroup('intake.lastCoffee', 'Letzter Kaffee', DAYTIME_OPTIONS, d.intake.lastCoffee)}
      ${tapGroup('intake.lastMeal', 'Letzte große Mahlzeit', DAYTIME_OPTIONS, d.intake.lastMeal)}
    </section>

    <section class="card">
      <h2>Notiz</h2>
      <textarea data-input="note" rows="5"
        placeholder="Was war heute los? Was hat dich beschäftigt?">${esc(d.note)}</textarea>
      <div class="field">
        <div class="field-head">
          <label for="f-tags">Schlagworte</label>
          <span class="hint">mit Komma getrennt</span>
        </div>
        <input type="text" id="f-tags" data-tags value="${esc(d.tags.join(', '))}"
          placeholder="arbeit, krank, reise">
      </div>
    </section>`;
}

/* ---------- Ansicht: Historie ---------- */

const CHART_W = 300, CHART_H = 72, CHART_PAD = 7;

/**
 * Kleines Liniendiagramm als Inline-SVG — keine Bibliothek, passend zum Rest der App.
 * Lücken werden nicht überbrückt, sondern trennen die Linie: eine durchgezogene Linie
 * über einen Tag ohne Eintrag hinweg würde Daten suggerieren, die es nicht gibt.
 */
function lineChart(values, { min, max, color, label }) {
  const n = values.length;
  const innerW = CHART_W - CHART_PAD * 2;
  const innerH = CHART_H - CHART_PAD * 2;
  const px = (i) => (n === 1 ? CHART_W / 2 : CHART_PAD + (i / (n - 1)) * innerW);
  const py = (v) => CHART_PAD + (1 - (v - min) / (max - min)) * innerH;

  const segments = [];
  let run = [];
  values.forEach((v, i) => {
    if (v == null) { if (run.length) segments.push(run); run = []; return; }
    run.push(`${px(i).toFixed(1)},${py(v).toFixed(1)}`);
  });
  if (run.length) segments.push(run);

  const lines = segments
    .filter((s) => s.length > 1)
    .map((s) => `<polyline points="${s.join(' ')}" fill="none" stroke="${color}"
       stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`)
    .join('');

  const dots = values
    .map((v, i) => (v == null ? '' : `<circle cx="${px(i).toFixed(1)}" cy="${py(v).toFixed(1)}" r="2.4" fill="${color}"/>`))
    .join('');

  return `<svg class="chart" viewBox="0 0 ${CHART_W} ${CHART_H}" role="img"
    aria-label="${esc(label)}">${lines}${dots}</svg>`;
}

/**
 * Letzter Wert plus Veränderung zum vorletzten — die Zahl, die man zuerst sucht.
 * Die Sparklines zeigen nur den Wert: auf der 1–5-Skala wäre ein "▲ 1" mehr
 * Balken als Aussage.
 */
function trendBadge(values, withDelta = true) {
  const seen = values.filter((v) => v != null);
  if (!seen.length) return '<span class="chart-value">—</span>';
  const last = seen.at(-1);
  const delta = seen.length > 1 ? last - seen.at(-2) : 0;
  const arrow = !withDelta || delta === 0 ? '' :
    `<span class="chart-delta ${delta > 0 ? 'up' : 'down'}">${delta > 0 ? '▲' : '▼'} ${Math.abs(delta)}</span>`;
  return `<span class="chart-value">${last}</span>${arrow}`;
}

function chartCard(title, hint, values, dates, opts) {
  return `
    <section class="card chart-card">
      <div class="chart-head">
        <div>
          <h2>${esc(title)}</h2>
          ${hint ? `<p class="chart-hint">${esc(hint)}</p>` : ''}
        </div>
        <div class="chart-figures">${trendBadge(values)}</div>
      </div>
      ${lineChart(values, { ...opts, label: `${title}: Verlauf über ${values.length} Tage` })}
      <div class="chart-axis">
        <span>${esc(store.formatDate(dates[0], { day: '2-digit', month: 'short' }))}</span>
        <span>${esc(store.formatDate(dates.at(-1), { day: '2-digit', month: 'short' }))}</span>
      </div>
    </section>`;
}

const MOOD_SPARKS = [
  ['mood', 'Stimmung', 'var(--accent)'],
  ['energy', 'Energie', 'var(--ok)'],
  ['stress', 'Stress', 'var(--danger)'],
  ['focus', 'Konzentration', 'var(--accent)'],
];

export function renderHistory() {
  const days = store.trendDays();

  if (!days.length) {
    app.innerHTML = `
      <header class="view-head"><h1>Verlauf</h1></header>
      <p class="empty">Noch keine Einträge. Trage heute Abend den ersten ein —
        die Auswertung braucht ein paar Wochen Daten, also je früher desto besser.</p>`;
    return;
  }

  const dates = days.map((d) => d.date);
  const sleep = days.map(store.sleepScore);
  const mood = days.map(store.moodScore);

  const sparks = MOOD_SPARKS.map(([key, label, color]) => {
    const values = days.map((d) => d.mood[key]);
    return `
      <div class="spark">
        <div class="spark-head">
          <span>${esc(label)}</span>
          ${trendBadge(values, false)}
        </div>
        ${lineChart(values, { min: 1, max: 5, color, label: `${label}: Verlauf` })}
      </div>`;
  }).join('');

  app.innerHTML = `
    <header class="view-head"><h1>Verlauf</h1>
      <span class="count">${days.length} ${days.length === 1 ? 'Tag' : 'Tage'}</span>
    </header>

    ${chartCard('Schlafscore', 'aus Erholung, Dauer, Durchschlafen, Einschlafen und Aufstehen',
      sleep, dates, { min: 0, max: 100, color: 'var(--accent)' })}

    ${chartCard('Befinden', 'Stimmung, Energie und Konzentration; Stress zieht herunter',
      mood, dates, { min: 0, max: 100, color: 'var(--ok)' })}

    <section class="card">
      <h2>Einzelwerte</h2>
      <div class="spark-grid">${sparks}</div>
      <p class="chart-hint">Skala 1–5. Bei Stress ist niedrig das Gute.</p>
    </section>

    <details class="history-details">
      <summary>Einzelne Einträge (${days.length})</summary>
      <ul class="history">${days.slice().reverse().map(historyRow).join('')}</ul>
    </details>`;
}

function historyRow(day) {
  const dur = store.sleepMinutes(day.sleep);
  const done = Object.values(day.routines).filter(Boolean).length;
  const bits = [];
  if (dur != null) bits.push(`${store.formatDuration(dur)} Schlaf`);
  if (day.sleep.rested) bits.push(`Erholt ${day.sleep.rested}/5`);
  if (day.mood.mood) bits.push(`Stimmung ${day.mood.mood}/5`);
  if (done) bits.push(`${done} ${done === 1 ? 'Routine' : 'Routinen'}`);

  return `
    <li>
      <button type="button" class="history-row" data-open="${day.date}">
        <div class="history-date">
          <strong>${esc(store.relativeDate(day.date))}</strong>
          <span>${esc(store.formatDate(day.date, { day: '2-digit', month: '2-digit', year: '2-digit' }))}</span>
        </div>
        <div class="history-body">
          <div class="history-facts">${esc(bits.join(' · ')) || '—'}</div>
          ${day.note ? `<div class="history-note">${esc(day.note.slice(0, 90))}${day.note.length > 90 ? '…' : ''}</div>` : ''}
        </div>
      </button>
    </li>`;
}

/* ---------- Ansicht: Routinen ---------- */

const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

/** Routinen-ID, die gerade bearbeitet wird; NEW_ROUTINE für eine noch nicht angelegte. */
const NEW_ROUTINE = '__neu__';
let editingRoutine = null;

export function renderRoutines() {
  const list = store.routines();

  app.innerHTML = `
    <header class="view-head"><h1>Routinen</h1></header>
    <p class="lead">Verhaltensweisen, die du regelmäßig nachhalten willst.
      Tippe eine an, um Name, Rhythmus oder Uhrzeit zu ändern.</p>

    <ul class="routine-admin">
      ${list.map((r) => (editingRoutine === r.id ? routineEditRow(r) : routineAdminRow(r))).join('')
        || '<li class="empty">Keine aktiven Routinen.</li>'}
    </ul>

    ${
      editingRoutine === NEW_ROUTINE
        ? `<section class="card">${routineForm({}, true)}</section>`
        : `<button type="button" class="btn" id="new-routine">＋ Neue Routine</button>`
    }`;
}

function rhythmLabel(r) {
  if (r.type !== 'anchor') return 'täglich';
  return r.weekdays?.length ? r.weekdays.map((n) => WEEKDAYS[n]).join(', ') : 'kein Tag gewählt';
}

function routineAdminRow(r) {
  return `
    <li>
      <button type="button" class="routine-row" data-edit="${esc(r.id)}">
        <strong>${esc(r.name)}</strong>
        <span class="routine-meta">${esc(rhythmLabel(r))}${r.time ? ` · ${esc(r.time)}` : ''}</span>
      </button>
    </li>`;
}

function routineEditRow(r) {
  return `<li class="routine-editing">${routineForm(r, false)}</li>`;
}

/**
 * Dasselbe Formular für Anlegen und Ändern — sonst driften die beiden Wege
 * auseinander und eine Änderung muss zweimal gemacht werden.
 */
function routineForm(r, isNew) {
  const type = r.type || 'daily';
  const days = r.weekdays || [];
  return `
    <div class="field">
      <div class="field-head"><label for="rf-name">Name</label></div>
      <input type="text" id="rf-name" maxlength="60" placeholder="z. B. Meditation"
        value="${esc(r.name || '')}">
    </div>
    <div class="field">
      <div class="field-head"><label for="rf-type">Rhythmus</label></div>
      <select id="rf-type">
        <option value="daily"${type === 'daily' ? ' selected' : ''}>täglich</option>
        <option value="anchor"${type === 'anchor' ? ' selected' : ''}>fester Wochenrhythmus</option>
      </select>
    </div>
    <div class="field" id="rf-days"${type === 'anchor' ? '' : ' hidden'}>
      <div class="field-head"><label>Wochentage</label>
        <span class="hint">nur dann zählt sie</span></div>
      <div class="weekdays">
        ${[1, 2, 3, 4, 5, 6, 0]
          .map((n) => {
            const on = days.includes(n);
            return `<button type="button" class="wd${on ? ' on' : ''}" data-wd="${n}"
              aria-pressed="${on}">${WEEKDAYS[n]}</button>`;
          })
          .join('')}
      </div>
    </div>
    <div class="field">
      <div class="field-head"><label for="rf-time">Uhrzeit</label><span class="hint">optional</span></div>
      <input type="time" id="rf-time" value="${esc(r.time || '')}">
    </div>
    <div class="btn-row">
      <button type="button" class="btn primary" id="rf-save" data-id="${esc(isNew ? '' : r.id)}">
        ${isNew ? 'Hinzufügen' : 'Speichern'}</button>
      <button type="button" class="btn" id="rf-cancel">Abbrechen</button>
      ${isNew ? '' : `<button type="button" class="btn small ghost" data-deactivate="${esc(r.id)}">Ausblenden</button>`}
    </div>`;
}

/* ---------- Ansicht: Mehr ---------- */

export function renderMore() {
  const n = store.dayCount();
  const since = store.daysSinceBackup();
  const backupText =
    since == null ? 'Noch nie gesichert' : since === 0 ? 'Heute gesichert' : `Vor ${since} Tagen gesichert`;

  app.innerHTML = `
    <header class="view-head"><h1>Mehr</h1></header>

    ${driveCard()}

    <section class="card">
      <h2>Daten sichern</h2>
      <p class="lead">Die Einträge liegen nur in diesem Browser. Wird der Browserspeicher
        geleert oder das Gerät gewechselt, sind sie weg. Lade die Sicherung in dein
        <strong>privates</strong> OneDrive — nicht in das des Arbeitgebers.</p>
      <p class="status-line">${esc(backupText)} · ${n} ${n === 1 ? 'Tag' : 'Tage'} erfasst</p>
      <div class="btn-row">
        <button type="button" class="btn primary" id="export">Sicherung herunterladen</button>
        <button type="button" class="btn" id="import-btn">Sicherung einlesen</button>
        <input type="file" id="import-file" accept="application/json,.json" hidden>
      </div>
      <p class="hint-block">Beim Einlesen bleiben vorhandene Einträge erhalten; nur neuere
        aus der Datei ersetzen sie. Ein Backup kann also nichts überschreiben, was du
        seither erfasst hast.</p>
    </section>

    <section class="card">
      <h2>Auf dem Handy behalten</h2>
      <p class="lead">Füge die App zum Startbildschirm hinzu. Auf dem iPhone ist das keine
        Bequemlichkeit, sondern Pflicht: Safari löscht die Daten von Websites nach etwa
        sieben Tagen ohne Benutzung — bei einer installierten App nicht.</p>
    </section>

    <section class="card danger">
      <h2>Alles löschen</h2>
      <p class="lead">Löscht alle Einträge und Routinen in diesem Browser. Nicht umkehrbar.</p>
      <button type="button" class="btn danger" id="reset">Alle Daten löschen</button>
    </section>

    <p class="version">Stufe 1 · Daten bleiben auf diesem Gerät</p>`;
}

/** "vor 3 Minuten" / "vor 2 Stunden" — für den Sync-Status verständlicher als eine Uhrzeit. */
function sinceText(iso) {
  if (!iso) return 'noch nie abgeglichen';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'gerade eben abgeglichen';
  if (mins < 60) return `vor ${mins} ${mins === 1 ? 'Minute' : 'Minuten'} abgeglichen`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `vor ${hours} ${hours === 1 ? 'Stunde' : 'Stunden'} abgeglichen`;
  const days = Math.floor(hours / 24);
  return `vor ${days} ${days === 1 ? 'Tag' : 'Tagen'} abgeglichen`;
}

function driveCard() {
  const clientId = store.googleClientId();

  if (!clientId) {
    return `
      <section class="card">
        <h2>Google Drive</h2>
        <p class="lead">Gleicht die Einträge über einen versteckten App-Ordner in deinem
          eigenen Google Drive ab — damit sie ein Gerätewechsel überleben und du am Handy
          wie am Rechner denselben Stand hast. Niemand außer dir kommt an den Ordner,
          auch keine andere App.</p>
        <div class="field">
          <div class="field-head"><label for="google-client-id">Google-Client-ID</label></div>
          <input type="text" id="google-client-id" placeholder="123-abc.apps.googleusercontent.com">
        </div>
        <button type="button" class="btn primary" id="google-save-id">Client-ID speichern</button>
        <p class="hint-block">Die Client-ID legst du einmalig selbst in der
          <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener">
            Google Cloud Console</a> an — die Anleitung steht im Code-Repo unter
          „Google Drive einrichten". Sie ist nicht geheim, bleibt aber nur auf diesem Gerät.</p>
      </section>`;
  }

  const connected = drive.isConnected();
  return `
    <section class="card">
      <h2>Google Drive</h2>
      <p class="status-line">${connected ? 'Verbunden' : 'Nicht verbunden'} · ${esc(sinceText(store.lastSyncAt()))}</p>
      <div class="btn-row">
        <button type="button" class="btn primary" id="drive-sync">Jetzt abgleichen</button>
        ${connected ? '' : '<button type="button" class="btn" id="drive-connect">Mit Google verbinden</button>'}
      </div>
      <p class="hint-block">Der Abgleich läuft auch automatisch beim Öffnen der App und kurz
        nach jeder Änderung. Zusammengeführt wird pro Tag und pro Routine der jeweils
        neuere Stand — kein Gerät überschreibt das andere.</p>
      <button type="button" class="btn small ghost" id="google-forget">Verbindung lösen</button>
    </section>`;
}

/* ---------- Ereignisse ---------- */

/** Setzt einen Wert wie "sleep.quality" im aktuellen Tag. */
function setPath(path, value) {
  const parts = path.split('.');
  let obj = currentDay;
  while (parts.length > 1) obj = obj[parts.shift()];
  obj[parts[0]] = value;
}

/** Rundet "HH:MM" auf das nächste 15-Minuten-Raster, Mitternacht inklusive. */
function roundToQuarterHour(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return hhmm;
  const total = (((h * 60 + Math.round(m / 15) * 15) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function refreshDuration() {
  const el = document.querySelector('[data-duration]');
  if (el) el.textContent = store.formatDuration(store.sleepMinutes(currentDay.sleep));
}

function updateBackupHint() {
  const box = document.querySelector('.backup-hint');
  if (!box) return;
  const since = store.daysSinceBackup();
  const count = store.dayCount();
  // Erst ab ein paar Einträgen nerven - vorher gibt es nichts zu verlieren.
  if (count >= 3 && (since == null || since >= 7)) {
    box.hidden = false;
    box.innerHTML = `Deine letzte Sicherung ist ${
      since == null ? 'noch nie erfolgt' : `${since} Tage her`
    }. <button type="button" class="link" data-goto="more">Jetzt sichern</button>`;
  } else {
    box.hidden = true;
  }
}

app.addEventListener('click', (e) => {
  const t = e.target.closest('[data-scale], [data-tap], [data-nav], [data-mode], [data-open], [data-edit], [data-deactivate], [data-goto], .wd');
  if (!t) return;

  if (t.dataset.tap) {
    const path = t.dataset.tap;
    const value = t.dataset.tapValue;
    const parts = path.split('.');
    const current = parts.reduce((o, k) => o?.[k], currentDay);
    const next = current === value ? null : value;
    setPath(path, next);
    t.closest('.tap-group').querySelectorAll('[data-tap]').forEach((b) => {
      const on = b.dataset.tapValue === next;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    if (path === 'sleep.onset') refreshDuration();
    scheduleSave();
    return;
  }

  if (t.dataset.scale) {
    const path = t.dataset.scale;
    const value = Number(t.dataset.value);
    const parts = path.split('.');
    const current = parts.reduce((o, k) => o?.[k], currentDay);
    const next = current === value ? null : value;
    setPath(path, next);
    // Nur die betroffene Skala anfassen, damit kein Re-Render den Fokus klaut.
    t.closest('.field').querySelectorAll('.scale-btn').forEach((b) => {
      const on = Number(b.dataset.value) === next;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    scheduleSave();
    return;
  }

  if (t.dataset.nav) {
    const next = store.addDays(currentDate, Number(t.dataset.nav));
    if (next > store.isoDate()) return;
    clearTimeout(saveTimer);
    store.saveDay(currentDay);
    renderToday(next);
    return;
  }

  if (t.dataset.mode) {
    if (t.dataset.mode === currentMode) return;
    // Ausstehende Eingabe sichern, sonst überschreibt der Neu-Render mit altem Stand aus dem Store.
    clearTimeout(saveTimer);
    store.saveDay(currentDay);
    currentMode = t.dataset.mode;
    renderToday(currentDate);
    return;
  }

  if (t.dataset.open) {
    window.dispatchEvent(new CustomEvent('goto', { detail: { view: 'today', date: t.dataset.open } }));
    return;
  }

  if (t.dataset.goto) {
    window.dispatchEvent(new CustomEvent('goto', { detail: { view: t.dataset.goto } }));
    return;
  }

  if (t.dataset.edit) {
    editingRoutine = t.dataset.edit;
    renderRoutines();
    return;
  }

  if (t.dataset.deactivate) {
    const r = store.routines().find((x) => x.id === t.dataset.deactivate);
    if (confirm(`„${r?.name}" ausblenden? Vergangene Einträge bleiben erhalten.`)) {
      store.deactivateRoutine(t.dataset.deactivate);
      editingRoutine = null;
      renderRoutines();
      toast('Routine ausgeblendet');
    }
    return;
  }

  if (t.classList.contains('wd')) {
    const on = t.getAttribute('aria-pressed') === 'true';
    t.setAttribute('aria-pressed', String(!on));
    t.classList.toggle('on', !on);
  }
});

app.addEventListener('input', (e) => {
  const el = e.target;

  if (el.dataset.input) {
    const path = el.dataset.input;
    let value = el.value;
    if (el.type === 'number') value = value === '' ? null : Number(value);
    setPath(path, value);
    if (path.startsWith('sleep.')) refreshDuration();
    scheduleSave();
    return;
  }

  if (el.dataset.tags !== undefined) {
    currentDay.tags = el.value.split(',').map((s) => s.trim().replace(/^#/, '')).filter(Boolean);
    scheduleSave();
    return;
  }

  if (el.dataset.routine) {
    currentDay.routines[el.dataset.routine] = el.checked;
    scheduleSave();
  }
});

app.addEventListener('change', (e) => {
  if (e.target.id === 'rf-type') {
    document.getElementById('rf-days').hidden = e.target.value !== 'anchor';
  }
  if (e.target.id === 'import-file') handleImport(e.target);

  // Erst beim Verlassen des Feldes runden (nicht bei jedem Tastendruck) - sonst
  // reißt es dem Nutzer mitten in der Eingabe die Uhrzeit unter der Hand weg.
  if (e.target.dataset.input === 'sleep.bedtime' && e.target.value) {
    const rounded = roundToQuarterHour(e.target.value);
    if (rounded !== e.target.value) {
      e.target.value = rounded;
      setPath('sleep.bedtime', rounded);
      refreshDuration();
      scheduleSave();
    }
  }
});

app.addEventListener('click', (e) => {
  const id = e.target.id;

  if (id === 'new-routine') {
    editingRoutine = NEW_ROUTINE;
    renderRoutines();
    document.getElementById('rf-name')?.focus();
  }

  if (id === 'rf-cancel') {
    editingRoutine = null;
    renderRoutines();
  }

  if (id === 'rf-save') {
    const name = document.getElementById('rf-name').value.trim();
    if (!name) return toast('Bitte einen Namen eingeben');
    const type = document.getElementById('rf-type').value;
    // Wochentage nur bei festem Rhythmus - sonst bleibt eine alte Auswahl unsichtbar hängen.
    const weekdays =
      type === 'anchor'
        ? [...document.querySelectorAll('.wd[aria-pressed="true"]')].map((b) => Number(b.dataset.wd))
        : [];
    if (type === 'anchor' && !weekdays.length) return toast('Bitte mindestens einen Wochentag wählen');

    const existingId = e.target.dataset.id;
    store.saveRoutine({
      id: existingId || store.newRoutineId(name),
      name,
      type,
      weekdays,
      time: document.getElementById('rf-time').value,
      active: true,
    });
    editingRoutine = null;
    renderRoutines();
    toast(existingId ? 'Routine geändert' : 'Routine hinzugefügt');
  }

  if (id === 'export') {
    const stamp = store.isoDate();
    const blob = new Blob([store.exportJSON()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `routinen-tagebuch_${stamp}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    store.markBackup();
    renderMore();
    toast('Sicherung erstellt');
  }

  if (id === 'import-btn') document.getElementById('import-file').click();

  if (id === 'google-save-id') {
    const val = document.getElementById('google-client-id').value.trim();
    if (!val) return toast('Bitte eine Client-ID eingeben');
    store.setGoogleClientId(val);
    renderMore();
    toast('Client-ID gespeichert');
  }

  if (id === 'google-forget') {
    if (!confirm('Verbindung lösen? Die Daten in Drive bleiben erhalten, dieses Gerät gleicht nur nicht mehr ab.')) return;
    drive.disconnect();
    store.setGoogleClientId('');
    renderMore();
    toast('Verbindung gelöst');
  }

  if (id === 'drive-connect') {
    drive
      .connect()
      .then(() => {
        renderMore();
        toast('Mit Google verbunden');
      })
      .catch((err) => toast(`Verbindung fehlgeschlagen: ${err.message}`));
  }

  if (id === 'drive-sync') {
    toast('Gleiche ab …');
    drive
      .sync()
      .then((r) => {
        renderMore();
        const parts = [];
        if (r.added) parts.push(`${r.added} neu`);
        if (r.updated) parts.push(`${r.updated} aktualisiert`);
        if (r.routines) parts.push(`${r.routines} Routinen`);
        if (r.uploaded) parts.push('hochgeladen');
        toast(parts.length ? `Abgeglichen · ${parts.join(' · ')}` : 'Alles schon aktuell');
      })
      .catch((err) => toast(`Abgleich fehlgeschlagen: ${err.message}`));
  }

  if (id === 'reset') {
    if (!confirm('Wirklich ALLE Einträge löschen? Das lässt sich nicht rückgängig machen.')) return;
    if (!confirm('Sicher? Ohne Sicherung sind die Daten endgültig weg.')) return;
    store.resetAll();
    renderMore();
    toast('Alle Daten gelöscht');
  }
});

function handleImport(input) {
  const file = input.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const r = store.importJSON(reader.result);
      renderMore();
      toast(`${r.added} neu, ${r.updated} aktualisiert, ${r.skipped} unverändert`);
    } catch (err) {
      alert(`Die Datei konnte nicht gelesen werden:\n${err.message}`);
    }
    input.value = '';
  };
  reader.readAsText(file);
}

/** Vor dem Verlassen der Seite den ausstehenden Speichervorgang erzwingen. */
export function flush() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (currentDay) store.saveDay(currentDay);
  }
}

/**
 * Abgleich im Hintergrund. Fehler bleiben absichtlich stumm: Wer gerade einen
 * Eintrag tippt, soll nicht von einer Fehlermeldung über eine fehlende
 * Internetverbindung unterbrochen werden. Sichtbar wird der Zustand unter "Mehr".
 */
export function autoSync() {
  if (!drive.isConfigured()) return;
  drive
    .sync()
    .then(() => {
      // Nur neu zeichnen, wenn die Sync-Ansicht gerade offen ist.
      if (document.getElementById('drive-sync')) renderMore();
    })
    .catch(() => {});
}

export { toast };
