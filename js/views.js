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
/**
 * Vortag von currentDay, mitgeladen für den "Gestern"-Block im Schlaf-Modus:
 * Routinen und Konsum werden dort erfragt, gehören aber inhaltlich zum Vortag
 * und werden auch dort gespeichert - siehe Tages-Konvention in store.js.
 */
let previousDay = null;
/** Nur previousDay sichern, wenn dort wirklich etwas geändert wurde - sonst
 * würde jedes Speichern von currentDay auch den Vortag unnötig "berühren"
 * und dessen updatedAt verfälschen, was den Geräte-Abgleich durcheinanderbringt. */
let previousDayDirty = false;
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
  refreshModeBadges();
  saveTimer = setTimeout(() => {
    store.saveDay(currentDay);
    if (previousDayDirty) { store.saveDay(previousDay); previousDayDirty = false; }
    setStatus('Gespeichert');
    updateBackupHint();
  }, 400);
}

/** Speichert beide Tage sofort, falls etwas aussteht - für Navigation und Verlassen. */
function flushNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (currentDay) store.saveDay(currentDay);
  if (previousDayDirty) { store.saveDay(previousDay); previousDayDirty = false; }
}

/**
 * Zählt den Fortschritt an beiden Reitern nach. Nur die beiden Knöpfe werden neu
 * geschrieben, nicht die Maske — ein vollständiges Neu-Rendern würde am Handy
 * mitten im Tippen den Fokus aus dem Notizfeld reißen.
 */
function refreshModeBadges() {
  if (!currentDay) return;
  for (const btn of document.querySelectorAll('.mode-btn')) {
    const mode = btn.dataset.mode;
    const { done, total } = store.completeness(currentDay, mode, yesterdayExtra(mode));
    const old = btn.querySelector('.mode-badge');
    if (done === 0) { old?.remove(); continue; }
    const badge = old || btn.appendChild(h('<span class="mode-badge" aria-hidden="true"></span>'));
    badge.classList.toggle('done', done === total);
    badge.textContent = done === total ? '✓' : `${done}/${total}`;
    const label = mode === 'sleep' ? 'Schlaf' : 'Tag';
    btn.setAttribute('aria-label', `${label}, ${done === total ? 'vollständig' : `${done} von ${total} ausgefüllt`}`);
  }
}

function setStatus(text) {
  const el = document.querySelector('.save-status');
  if (el) el.textContent = text;
}

/* ---------- Bausteine ---------- */

/**
 * Bewertungsskala zum Antippen. Erneutes Antippen des gewählten Werts löscht ihn
 * wieder — "keine Angabe" muss erreichbar bleiben, sonst rät man irgendetwas hin.
 *
 * Die Stufenzahl kommt aus dem Eintrag (`scaleMax`), nicht aus einer festen Zahl:
 * Tage von vor der Umstellung zeigen weiter fünf Felder, neue sechs.
 *
 * `invert` für Skalen, bei denen niedrig das Gute ist (Stress) — sonst leuchtet
 * ein hoher Stresswert grün und die Farbe sagt das Gegenteil der Zahl.
 */
function scale(path, label, hint, low, high, value, max, { invert = false } = {}) {
  const mid = max / 2;
  const buttons = Array.from({ length: max }, (_, i) => i + 1)
    .map((n) => {
      const good = invert ? n <= mid : n > mid;
      // Luft zwischen der letzten negativen und der ersten positiven Stufe.
      const brk = n === Math.floor(mid) ? ' mid-break' : '';
      return `<button type="button" class="scale-btn ${good ? 'pos' : 'neg'}${brk}${value === n ? ' on' : ''}"
        data-scale="${path}" data-value="${n}"
        aria-label="${esc(label)}: ${n} von ${max}"
        aria-pressed="${value === n}">${n}</button>`;
    })
    .join('');
  return `
    <div class="field" data-field="${path}">
      <div class="field-head">
        <label>${esc(label)}</label>
        ${hint ? `<span class="hint">${esc(hint)}</span>` : ''}
      </div>
      <div class="scale" style="--steps:${max}">${buttons}</div>
      <div class="scale-ends"><span>${esc(low)}</span><span>${esc(high)}</span></div>
    </div>`;
}

/**
 * Zeitfeld mit Vorschlägen. Das native Drehrad bleibt darunter erhalten, ist aber
 * am Handy der langsamste Teil der ganzen Erfassung — vier Chips mit den eigenen
 * häufigsten Zeiten und zwei Viertelstunden-Schritte treffen den Normalfall mit
 * einem Tap.
 */
function timeField(path, label, value, hint = '', step = null) {
  const key = path.split('.').pop();
  // Solange wenig erfasst ist, gibt es weniger als vier eigene Zeiten. Dann sollen
  // die vorhandenen Chips die Breite füllen statt in einem halbleeren Raster zu stehen.
  const times = store.suggestedTimes(key);
  const chips = times
    .map(
      (t) => `<button type="button" class="time-chip${value === t ? ' on' : ''}"
        data-time="${path}" data-time-value="${t}" aria-pressed="${value === t}">${t}</button>`
    )
    .join('');
  return `
    <div class="field" data-field="${path}">
      <div class="field-head">
        <label for="f-${path}">${esc(label)}</label>
        ${hint ? `<span class="hint">${esc(hint)}</span>` : ''}
      </div>
      <div class="time-chips" style="--n:${times.length || 1}">${chips}</div>
      <div class="time-row">
        <button type="button" class="time-step" data-step="${path}" data-by="-15"
          aria-label="${esc(label)} 15 Minuten früher">−15</button>
        <input type="time" id="f-${path}" data-input="${path}" value="${esc(value || '')}"${step ? ` step="${step}"` : ''}>
        <button type="button" class="time-step" data-step="${path}" data-by="15"
          aria-label="${esc(label)} 15 Minuten später">+15</button>
      </div>
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

/** Kurzform für die Verlaufszeile, wo wenig Platz ist. */
const SPORT_LABELS = { light: 'Leichter Sport', hard: 'Sport (anstrengend)', intense: 'Sport (intensiv)' };

const AWAKENINGS_OPTIONS = [
  ['none', 'Durchgeschlafen'],
  ['once', '1x wach'],
  ['multiple', 'Mehrfach wach'],
];

/** Zeit im Freien — neben Sport der stärkste Taktgeber für den Schlafrhythmus. */
const OUTDOOR_OPTIONS = [
  ['none', 'Kaum'],
  ['some', 'Etwas'],
  ['much', 'Viel'],
];

/**
 * Nicht "Freunde ja/nein", sondern wie viel Kontakt: Ein Tag mit vier Terminen und
 * niemandem danach ist etwas anderes als ein Tag allein — und beides ist nicht
 * dasselbe wie ein Abend mit Freunden.
 */
const SOCIAL_OPTIONS = [
  ['none', 'Kaum jemanden'],
  ['some', 'Etwas'],
  ['much', 'Viel'],
];

/**
 * Bezieht sich auf den ganzen Tag, nicht auf die Nacht davor — deshalb steht das
 * Feld in der Tages-Maske. Kurz beschriftet, damit es auf drei Schaltflächen passt
 * und beim Ausfüllen niemand mitliest.
 */
const SEX_OPTIONS = [
  ['none', 'Nein'],
  ['solo', 'Solo'],
  ['partner', 'Zu zweit'],
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
  previousDay = store.getDay(store.addDays(date, -1));
  previousDayDirty = false;
  const d = currentDay;
  const nightFrom = store.formatDate(store.addDays(date, -1), { day: 'numeric', month: 'short' });
  const nightTo = store.formatDate(date, { day: 'numeric', month: 'short' });
  const isFuture = date > store.isoDate();
  const atToday = date >= store.isoDate();

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
      ${modeButton('sleep', 'Schlaf', d)}
      ${modeButton('day', 'Tag', d)}
    </div>

    ${currentMode === 'sleep' ? sleepSection(d, nightFrom, nightTo, previousDay) : daySection(d)}

    <p class="save-status">${d.updatedAt ? 'Gespeichert' : 'Wird automatisch gespeichert'}</p>
    <div class="backup-hint" hidden></div>
  `;

  updateBackupHint();
}

/** Konsum-Werte des Vortags für die Fortschrittszählung im Schlaf-Modus. */
function yesterdayExtra(mode) {
  if (mode !== 'sleep' || !previousDay) return [];
  const i = previousDay.intake;
  return [i.alcohol, i.lastCoffee, i.lastMeal];
}

/**
 * Umschalter mit Fortschritt. Der Punkt zeigt, dass in der anderen Maske noch
 * etwas offen ist — sonst blättert man abends beide durch, nur um zu sehen, ob
 * man morgens fertig geworden ist. Voll ausgefüllt: Haken statt Zähler.
 */
function modeButton(mode, label, d) {
  const { done, total } = store.completeness(d, mode, yesterdayExtra(mode));
  const on = currentMode === mode;
  const badge = done === total
    ? '<span class="mode-badge done" aria-hidden="true">✓</span>'
    : done > 0
      ? `<span class="mode-badge" aria-hidden="true">${done}/${total}</span>`
      : '';
  const state = done === total ? 'vollständig' : `${done} von ${total} ausgefüllt`;
  return `<button type="button" class="mode-btn${on ? ' on' : ''}"
    data-mode="${mode}" role="tab" aria-selected="${on}"
    aria-label="${esc(label)}, ${state}">${esc(label)}${badge}</button>`;
}

function sleepSection(d, nightFrom, nightTo, prev) {
  const max = d.scaleMax || store.SCALE_MAX;
  return `
    <section class="card">
      <h2>Letzte Nacht <span class="card-sub">${esc(nightFrom)} → ${esc(nightTo)}</span></h2>
      ${timeField('sleep.bedtime', 'Ins Bett', d.sleep.bedtime, '', 900)}
      ${timeField('sleep.wakeAt', 'Aufgewacht', d.sleep.wakeAt)}
      ${tapGroup('sleep.onset', 'Einschlafen', ONSET_OPTIONS, d.sleep.onset, 'wie schnell?')}
      ${tapGroup('sleep.wakeUp', 'Aufstehen', WAKEUP_OPTIONS, d.sleep.wakeUp)}
      ${tapGroup('sleep.awakenings', 'Nachts wach', AWAKENINGS_OPTIONS, d.sleep.awakenings)}
      <p class="duration">Schlafdauer (geschätzt): <strong data-duration>${store.formatDuration(store.sleepMinutes(d.sleep))}</strong></p>
      ${scale('sleep.rested', 'Erholt aufgewacht', '', 'wie gerädert', 'topfit', d.sleep.rested, max)}
    </section>

    ${yesterdaySection(prev, nightFrom)}`;
}

/**
 * Rückblick auf gestern: Routinen und Konsum. Bewusst hier im Schlaf-Block statt
 * abends — beides lässt sich erst rückblickend sicher beantworten ("hast du
 * gestern gelesen?" ist am nächsten Morgen eindeutig, um 21 Uhr noch nicht), und
 * wer es abends ausfüllt, holt sich mit der App genau das Handy zurück, das eine
 * der Routinen gerade vermeiden soll.
 *
 * Die Felder gehören zu `prev` (dem Vortag), nicht zu `d` — deshalb data-scope
 * auf der Karte: Die Event-Handler unten lesen daran ab, welches Tagesobjekt sie
 * anfassen müssen.
 */
function yesterdaySection(prev, nightFrom) {
  const routineList = store.routinesForDate(prev.date);
  return `
    <section class="card" data-scope="prev">
      <h2>Gestern <span class="card-sub">${esc(nightFrom)}</span></h2>
      <p class="lead">Am Ende des Tages sicherer zu beantworten als mittendrin.</p>
      ${
        routineList.length
          ? `<ul class="routine-list">${routineList
              .map(
                (r) => `
        <li>
          <label class="check">
            <input type="checkbox" data-routine="${esc(r.id)}" ${prev.routines[r.id] ? 'checked' : ''}>
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
      ${tapGroup('intake.alcohol', 'Alkohol', YESNO_OPTIONS, prev.intake.alcohol)}
      ${tapGroup('intake.lastCoffee', 'Letzter Kaffee', DAYTIME_OPTIONS, prev.intake.lastCoffee)}
      ${tapGroup('intake.lastMeal', 'Letzte große Mahlzeit', DAYTIME_OPTIONS, prev.intake.lastMeal)}
    </section>`;
}

function daySection(d) {
  const max = d.scaleMax || store.SCALE_MAX;
  return `
    <section class="card">
      <h2>Wie ging es dir heute?</h2>
      ${scale('mood.mood', 'Stimmung', '', 'mies', 'super', d.mood.mood, max)}
      ${scale('mood.energy', 'Energie', '', 'leer', 'voll da', d.mood.energy, max)}
      ${scale('mood.stress', 'Stress', 'hoch = viel Stress', 'entspannt', 'überdreht', d.mood.stress, max, { invert: true })}
      ${scale('mood.focus', 'Konzentration', '', 'zerstreut', 'klar', d.mood.focus, max)}
    </section>

    <section class="card">
      <h2>Aktivität</h2>
      ${tapGroup('sport', 'Sport', SPORT_OPTIONS, d.sport)}
      ${tapGroup('outdoor', 'Draußen', OUTDOOR_OPTIONS, d.outdoor, 'Zeit im Tageslicht')}
      ${tapGroup('social', 'Kontakt', SOCIAL_OPTIONS, d.social, 'Zeit mit Menschen')}
      ${tapGroup('sex', 'Sex', SEX_OPTIONS, d.sex, 'heute')}
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
        ${lineChart(values, { min: 1, max: store.SCALE_MAX, color, label: `${label}: Verlauf` })}
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
      <p class="chart-hint">Skala 1–${store.SCALE_MAX}, keine neutrale Mitte:
        1–3 negativ, 4–6 positiv. Bei Stress ist niedrig das Gute.</p>
    </section>

    <details class="history-details">
      <summary>Einzelne Einträge (${days.length})</summary>
      <ul class="history">${days.slice().reverse().map(historyRow).join('')}</ul>
    </details>`;
}

function historyRow(day) {
  const dur = store.sleepMinutes(day.sleep);
  const done = Object.values(day.routines).filter(Boolean).length;
  const max = day.scaleMax || store.SCALE_MAX;
  const bits = [];
  if (dur != null) bits.push(`${store.formatDuration(dur)} Schlaf`);
  if (day.sleep.rested) bits.push(`Erholt ${day.sleep.rested}/${max}`);
  if (day.mood.mood) bits.push(`Stimmung ${day.mood.mood}/${max}`);
  // Sonst steht bei Tagen, die nur eine Sportangabe haben, ein blankes "—".
  if (day.sport && day.sport !== 'none') bits.push(SPORT_LABELS[day.sport] || 'Sport');
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

/**
 * Zwischenstände im Browserspeicher. Ersetzt keine Sicherung — wer den Speicher
 * löscht, löscht sie mit. Hilft gegen den anderen Fall: versehentlich zerschossene
 * Daten, wo bisher nur ein Import von Hand blieb.
 */
function snapshotCard() {
  const snaps = store.snapshots();
  if (!snaps.length) return '';
  const rows = snaps
    .map(
      (s) => `
      <li>
        <span>${esc(store.formatDate(s.takenAt.slice(0, 10), { day: '2-digit', month: 'short' }))}
          · ${s.days} ${s.days === 1 ? 'Tag' : 'Tage'}</span>
        <button type="button" class="btn small" data-restore="${s.slot}">Einspielen</button>
      </li>`
    )
    .join('');
  return `
    <section class="card">
      <h2>Zwischenstände</h2>
      <p class="lead">Die App legt hier alle paar Tage automatisch einen Abzug ab, drei Stände
        rollierend. Beim Einspielen bleiben neuere Einträge erhalten.</p>
      <ul class="snapshot-list">${rows}</ul>
      <p class="hint-block">Das ist <strong>keine</strong> Sicherung: Diese Abzüge liegen im
        selben Browserspeicher wie die Einträge und verschwinden mit ihm.</p>
    </section>`;
}

export function renderMore() {
  const n = store.dayCount();
  const since = store.daysSinceBackup();
  const auto = store.autoBackupDays();
  const backupText =
    since == null ? 'Noch nie gesichert' : since === 0 ? 'Heute gesichert' : `Vor ${since} Tagen gesichert`;

  app.innerHTML = `
    <header class="view-head"><h1>Mehr</h1></header>

    ${driveCard()}

    <section class="card">
      <h2>Daten sichern</h2>
      <p class="lead">Die Einträge liegen nur in diesem Browser. Wird der Browserspeicher
        geleert oder das Gerät gewechselt, sind sie weg. Lege die Sicherung in dein
        <strong>privates</strong> Konto — nicht in das des Arbeitgebers.</p>
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
      <h2>Automatisch sichern</h2>
      <p class="lead">${
        auto
          ? `Alle ${auto} Tage legt die App beim nächsten Antippen von selbst eine Datei
             im Ordner <strong>Download</strong> ab. Eine Uhrzeit lässt sich dafür nicht
             festlegen — ein Browser darf nur schreiben, während du die App bedienst.`
          : 'Ausgeschaltet. Du sicherst dann nur von Hand.'
      }</p>
      <button type="button" class="btn${auto ? '' : ' primary'}" id="auto-backup-toggle">
        ${auto ? 'Automatik ausschalten' : 'Alle 3 Tage sichern'}</button>
      ${
        auto
          ? `<p class="hint-block">Beim zweiten Mal fragt Chrome einmalig, ob die Seite mehrere
             Dateien herunterladen darf — einmal zulassen, danach passiert es still. Der
             Ordner <em>Download</em> wird auf Android von anderen Apps mitgelesen: Wenn dir
             das zu offen ist, schalte das hier ab und richte stattdessen den Drive-Abgleich ein.</p>`
          : ''
      }
    </section>

    ${snapshotCard()}

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

/** Setzt einen Wert wie "sleep.quality" im übergebenen Tag. */
function setPath(day, path, value) {
  const parts = path.split('.');
  let obj = day;
  while (parts.length > 1) obj = obj[parts.shift()];
  obj[parts[0]] = value;
}

/**
 * Welcher Tag ist gemeint - der gerade angezeigte oder gestern? Felder im
 * "Gestern"-Block (siehe data-scope in yesterdaySection) schreiben in previousDay,
 * alles andere in currentDay. Setzt bei previousDay gleich das Dirty-Flag, damit
 * scheduleSave weiß, dass dort wirklich etwas zu sichern ist.
 */
function targetDay(el) {
  if (el.closest('[data-scope="prev"]')) {
    previousDayDirty = true;
    return previousDay;
  }
  return currentDay;
}

/** Verschiebt eine Uhrzeit um Minuten, über Mitternacht hinweg. */
function shiftTime(hhmm, by) {
  const [hr, mn] = String(hhmm || '').split(':').map(Number);
  if (Number.isNaN(hr) || Number.isNaN(mn)) return null;
  const total = (((hr * 60 + mn + by) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** Schreibt eine Uhrzeit ins Modell und hält Eingabefeld und Chips im Gleichstand. */
function applyTime(path, value) {
  setPath(currentDay, path, value);
  const field = document.querySelector(`[data-field="${path}"]`);
  if (field) {
    const input = field.querySelector('input[type="time"]');
    if (input) input.value = value || '';
    field.querySelectorAll('[data-time]').forEach((c) => {
      const on = c.dataset.timeValue === value;
      c.classList.toggle('on', on);
      c.setAttribute('aria-pressed', String(on));
    });
  }
  refreshDuration();
  scheduleSave();
}

/** Baut die Sicherungsdatei und stößt den Download an. */
function downloadBackup() {
  const blob = new Blob([store.exportJSON()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `routinen-tagebuch_${store.isoDate()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/**
 * Legt die fällige Sicherung ab — ausgelöst vom Fingertipp, nicht von einer Uhr.
 *
 * Ein Browser darf eine Datei nur aus einer laufenden Nutzergeste heraus schreiben;
 * eine echte Zeitsteuerung gibt es im Web nicht. Da jede Benutzung mit einem Tap
 * beginnt, passiert es faktisch beim ersten Öffnen nach Ablauf der Frist.
 */
function maybeAutoBackup() {
  if (!store.autoBackupDue()) return;
  downloadBackup();
  store.markBackup();
  updateBackupHint();
  toast('Sicherung im Ordner „Download" abgelegt');
}

document.addEventListener('click', maybeAutoBackup, true);

function refreshDuration() {
  const el = document.querySelector('[data-duration]');
  if (el) el.textContent = store.formatDuration(store.sleepMinutes(currentDay.sleep));
}

/**
 * Warnt, solange die Daten nur im Browserspeicher liegen.
 *
 * Bewusst aufdringlich und ab dem ersten Eintrag: Wer den Browserverlauf löscht,
 * löscht auch den localStorage - ohne Vorwarnung und ohne Papierkorb. Diese
 * Warnung ist einmal zu spät gekommen, das reicht.
 */
function updateBackupHint() {
  const box = document.querySelector('.backup-hint');
  if (!box) return;
  const count = store.dayCount();
  if (count === 0) { box.hidden = true; return; }

  const since = store.daysSinceBackup();
  const syncOn = Boolean(store.lastSyncAt());

  if (!store.hasAnyBackup()) {
    box.hidden = false;
    box.className = 'backup-hint urgent';
    box.innerHTML =
      `<strong>Diese Einträge sind noch nirgends gesichert.</strong> Sie liegen nur in
       diesem Browser und verschwinden, sobald du den Browserverlauf löschst.
       <button type="button" class="link" data-goto="more">Jetzt einrichten</button>`;
    return;
  }

  // Läuft der Drive-Abgleich, ist alles Weitere überflüssig - der sichert von selbst.
  if (syncOn) { box.hidden = true; return; }

  if (since >= 3) {
    box.hidden = false;
    box.className = 'backup-hint';
    box.innerHTML = `Letzte Sicherung vor ${since} Tagen.
      <button type="button" class="link" data-goto="more">Jetzt sichern</button>`;
    return;
  }
  box.hidden = true;
}

app.addEventListener('click', (e) => {
  const t = e.target.closest('[data-scale], [data-tap], [data-nav], [data-mode], [data-open], [data-edit], [data-deactivate], [data-goto], [data-time], [data-step], .wd');
  if (!t) return;

  if (t.dataset.time) {
    const path = t.dataset.time;
    const value = t.dataset.timeValue;
    const parts = path.split('.');
    const current = parts.reduce((o, k) => o?.[k], currentDay);
    // Erneutes Antippen löscht — wie bei allen anderen Tap-Feldern auch.
    applyTime(path, current === value ? '' : value);
    return;
  }

  if (t.dataset.step) {
    const path = t.dataset.step;
    const parts = path.split('.');
    const current = parts.reduce((o, k) => o?.[k], currentDay);
    // Ohne Ausgangswert gibt es nichts zu verschieben — dann zuerst eine Zeit wählen.
    const next = shiftTime(current, Number(t.dataset.by));
    if (next) applyTime(path, next);
    return;
  }

  if (t.dataset.tap) {
    const path = t.dataset.tap;
    const value = t.dataset.tapValue;
    const day = targetDay(t);
    const parts = path.split('.');
    const current = parts.reduce((o, k) => o?.[k], day);
    const next = current === value ? null : value;
    setPath(day, path, next);
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
    setPath(currentDay, path, next);
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
    flushNow();
    renderToday(next);
    return;
  }

  if (t.dataset.mode) {
    if (t.dataset.mode === currentMode) return;
    // Ausstehende Eingabe sichern, sonst überschreibt der Neu-Render mit altem Stand aus dem Store.
    flushNow();
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
    // Zeit- und Notizfelder gibt es nur bei "heute" (siehe applyTime), nie im
    // "Gestern"-Block - hier reicht currentDay.
    const path = el.dataset.input;
    let value = el.value;
    if (el.type === 'number') value = value === '' ? null : Number(value);
    setPath(currentDay, path, value);
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
    const day = targetDay(el);
    day.routines[el.dataset.routine] = el.checked;
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
    applyTime('sleep.bedtime', store.roundToQuarterHour(e.target.value));
    return;
  }

  // Von Hand eingetippte Zeit: Chips nachziehen, damit die Auswahl stimmt.
  if (e.target.dataset.input === 'sleep.wakeAt') applyTime('sleep.wakeAt', e.target.value);
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
    downloadBackup();
    store.markBackup();
    renderMore();
    toast('Sicherung erstellt');
  }

  if (id === 'auto-backup-toggle') {
    const off = store.autoBackupDays() > 0;
    store.setAutoBackupDays(off ? 0 : 3);
    renderMore();
    toast(off ? 'Automatische Sicherung aus' : 'Automatische Sicherung alle 3 Tage');
  }

  if (e.target.dataset.restore) {
    const slot = Number(e.target.dataset.restore);
    if (!confirm('Diesen Zwischenstand einspielen? Neuere Einträge bleiben erhalten.')) return;
    try {
      const r = store.restoreSnapshot(slot);
      renderMore();
      toast(`${r.added} neu, ${r.updated} aktualisiert, ${r.skipped} unverändert`);
    } catch (err) {
      alert(`Zwischenstand nicht lesbar:\n${err.message}`);
    }
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

/* ---------- Wischen zwischen Tagen ---------- */

/**
 * Quer wischen wechselt den Tag. Die Pfeile oben bleiben — die Geste ist eine
 * Abkürzung, kein Ersatz.
 *
 * Die Schwellen sind bewusst streng: erst ab 60 px waagerecht und nur, wenn die
 * Bewegung deutlich flacher als steil war. Sonst springt beim Scrollen durch eine
 * lange Maske versehentlich der Tag um, und man schreibt in den falschen Eintrag.
 */
let touchStart = null;

app.addEventListener('touchstart', (e) => {
  if (e.touches.length !== 1) return;
  touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
}, { passive: true });

app.addEventListener('touchend', (e) => {
  if (!touchStart || !document.querySelector('.day-nav')) return;
  const t = e.changedTouches[0];
  const dx = t.clientX - touchStart.x;
  const dy = t.clientY - touchStart.y;
  touchStart = null;
  if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.8) return;

  // Nach links wischen heißt vorwärts — wie beim Blättern.
  const next = store.addDays(currentDate, dx < 0 ? 1 : -1);
  if (next > store.isoDate()) return;
  flushNow();
  renderToday(next);
}, { passive: true });

/** Vor dem Verlassen der Seite den ausstehenden Speichervorgang erzwingen. */
export function flush() {
  flushNow();
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
