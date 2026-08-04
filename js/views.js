/**
 * Ansichten. Bewusst ohne Framework und ohne komplettes Neu-Rendern bei jeder
 * Eingabe: einmal aufbauen, danach punktuell aktualisieren. Sonst springt am
 * Handy mitten im Tippen der Fokus aus dem Notizfeld.
 */

import * as store from './store.js';
import * as calendar from './calendar.js';

const app = document.getElementById('app');

/** Aktuell bearbeiteter Tag in der Erfassung. */
let currentDate = store.isoDate();
let currentDay = null;
let saveTimer = null;

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

function timeField(path, label, value, hint = '') {
  return `
    <div class="field">
      <div class="field-head">
        <label for="f-${path}">${esc(label)}</label>
        ${hint ? `<span class="hint">${esc(hint)}</span>` : ''}
      </div>
      <input type="time" id="f-${path}" data-input="${path}" value="${esc(value || '')}">
    </div>`;
}

const ONSET_OPTIONS = [
  ['fast', 'Schnell'],
  ['medium', 'Mittel'],
  ['slow', 'Langsam'],
];

function onsetField(value) {
  const buttons = ONSET_OPTIONS.map(
    ([val, label]) => `<button type="button" class="onset-btn${value === val ? ' on' : ''}"
      data-onset="${val}" aria-pressed="${value === val}">${label}</button>`
  ).join('');
  return `
    <div class="field">
      <div class="field-head">
        <label>Einschlafen</label>
        <span class="hint">wie schnell?</span>
      </div>
      <div class="onset-group">${buttons}</div>
    </div>`;
}

function numberField(path, label, value, hint = '', max = 20) {
  return `
    <div class="field">
      <div class="field-head">
        <label for="f-${path}">${esc(label)}</label>
        ${hint ? `<span class="hint">${esc(hint)}</span>` : ''}
      </div>
      <input type="number" inputmode="numeric" min="0" max="${max}" id="f-${path}"
             data-input="${path}" value="${value ?? ''}">
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

    <section class="card">
      <h2>Letzte Nacht <span class="card-sub">${esc(nightFrom)} → ${esc(nightTo)}</span></h2>
      <div class="grid-2">
        ${timeField('sleep.bedtime', 'Ins Bett', d.sleep.bedtime)}
        ${timeField('sleep.wakeAt', 'Aufgewacht', d.sleep.wakeAt)}
      </div>
      ${onsetField(d.sleep.onset)}
      ${numberField('sleep.awakenings', 'Nachts wach', d.sleep.awakenings, 'wie oft', 20)}
      <p class="duration">Schlafdauer (geschätzt): <strong data-duration>${store.formatDuration(store.sleepMinutes(d.sleep))}</strong></p>
      ${scale('sleep', 'sleep.quality', 'Schlafqualität', '', 'schlecht', 'sehr gut', d.sleep.quality)}
      ${scale('sleep', 'sleep.rested', 'Erholt aufgewacht', '', 'wie gerädert', 'topfit', d.sleep.rested)}
    </section>

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
      <div class="grid-2">
        ${numberField('intake.caffeine', 'Koffein', d.intake.caffeine, 'Tassen/Dosen', 20)}
        ${timeField('intake.lastCaffeine', 'Letztes davon', d.intake.lastCaffeine, 'Uhrzeit')}
        ${numberField('intake.alcohol', 'Alkohol', d.intake.alcohol, 'Gläser', 30)}
      </div>
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
    </section>

    <p class="save-status">${d.updatedAt ? 'Gespeichert' : 'Wird automatisch gespeichert'}</p>
    <div class="backup-hint" hidden></div>
  `;

  updateBackupHint();
}

/* ---------- Ansicht: Historie ---------- */

export function renderHistory() {
  const days = store.allDays().filter(store.isFilled);

  app.innerHTML = `
    <header class="view-head"><h1>Verlauf</h1>
      <span class="count">${days.length} ${days.length === 1 ? 'Eintrag' : 'Einträge'}</span>
    </header>
    ${
      days.length
        ? `<ul class="history">${days.map(historyRow).join('')}</ul>`
        : `<p class="empty">Noch keine Einträge. Trage heute Abend den ersten ein —
           die Auswertung braucht ein paar Wochen Daten, also je früher desto besser.</p>`
    }`;
}

function historyRow(day) {
  const dur = store.sleepMinutes(day.sleep);
  const done = Object.values(day.routines).filter(Boolean).length;
  const bits = [];
  if (dur != null) bits.push(`${store.formatDuration(dur)} Schlaf`);
  if (day.sleep.quality) bits.push(`Schlaf ${day.sleep.quality}/5`);
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

export function renderRoutines() {
  const list = store.routines();

  app.innerHTML = `
    <header class="view-head"><h1>Routinen</h1></header>
    <p class="lead">Täglich heißt: zählt jeden Tag. Fester Rhythmus heißt: zählt nur an den
      gewählten Wochentagen — nur dann taucht die Routine in der Erfassung auf.</p>

    <ul class="routine-admin">
      ${list.map(routineAdminRow).join('') || '<li class="empty">Keine aktiven Routinen.</li>'}
    </ul>

    <section class="card">
      <h2>Neue Routine</h2>
      <div class="field">
        <div class="field-head"><label for="new-routine-name">Name</label></div>
        <input type="text" id="new-routine-name" placeholder="z. B. Meditation" maxlength="60">
      </div>
      <div class="field">
        <div class="field-head"><label for="new-routine-type">Rhythmus</label></div>
        <select id="new-routine-type">
          <option value="daily">täglich</option>
          <option value="anchor">fester Wochenrhythmus</option>
        </select>
      </div>
      <div class="field" id="new-routine-days" hidden>
        <div class="field-head"><label>Wochentage</label></div>
        <div class="weekdays">
          ${[1, 2, 3, 4, 5, 6, 0]
            .map(
              (n) => `<button type="button" class="wd" data-wd="${n}" aria-pressed="false">${WEEKDAYS[n]}</button>`
            )
            .join('')}
        </div>
      </div>
      <div class="field">
        <div class="field-head"><label for="new-routine-time">Uhrzeit</label>
          <span class="hint">optional</span></div>
        <input type="time" id="new-routine-time">
      </div>
      <button type="button" class="btn primary" id="add-routine">Routine hinzufügen</button>
    </section>`;
}

function routineAdminRow(r) {
  const rhythm =
    r.type === 'anchor'
      ? (r.weekdays?.length ? r.weekdays.map((n) => WEEKDAYS[n]).join(', ') : 'kein Tag gewählt')
      : 'täglich';
  return `
    <li>
      <div>
        <strong>${esc(r.name)}</strong>
        <span class="routine-meta">${esc(rhythm)}${r.time ? ` · ${esc(r.time)}` : ''}</span>
      </div>
      <button type="button" class="btn small ghost" data-deactivate="${esc(r.id)}">Ausblenden</button>
    </li>`;
}

/* ---------- Ansicht: Mehr ---------- */

export function renderMore() {
  const n = store.dayCount();
  const since = store.daysSinceBackup();
  const backupText =
    since == null ? 'Noch nie gesichert' : since === 0 ? 'Heute gesichert' : `Vor ${since} Tagen gesichert`;
  const clientId = store.googleClientId();
  const connected = calendar.isConnected();

  app.innerHTML = `
    <header class="view-head"><h1>Mehr</h1></header>

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

    <section class="card">
      <h2>Google Kalender</h2>
      <p class="lead">Trägt deine aktiven Routinen mit Uhrzeit als wiederkehrende Termine in
        deinen Google Kalender ein. Die Anmeldung läuft direkt bei Google über dein eigenes
        Konto — ich bekomme deine Zugangsdaten nie zu sehen. Jeder Termin bekommt erstmal
        30 Minuten; die Länge kannst du danach im Kalender selbst anpassen.</p>
      ${
        !clientId
          ? `
        <div class="field">
          <div class="field-head"><label for="google-client-id">Google-Client-ID</label></div>
          <input type="text" id="google-client-id" placeholder="123-abc.apps.googleusercontent.com">
        </div>
        <button type="button" class="btn primary" id="google-save-id">Client-ID speichern</button>
        <p class="hint-block">Die Client-ID legst du einmalig selbst in der
          <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener">
            Google Cloud Console</a> an. Sie ist nicht geheim, bleibt aber nur auf diesem Gerät.</p>`
          : `
        <p class="status-line">Client-ID hinterlegt · ${esc(clientId.slice(0, 14))}…</p>
        <div class="btn-row">
          <button type="button" class="btn primary" id="google-connect">
            ${connected ? 'Verbunden ✓' : 'Mit Google verbinden'}
          </button>
          <button type="button" class="btn" id="google-sync" ${connected ? '' : 'disabled'}>
            Routinen eintragen
          </button>
        </div>
        <button type="button" class="btn small ghost google-forget-btn" id="google-forget">Client-ID entfernen</button>`
      }
    </section>

    <section class="card danger">
      <h2>Alles löschen</h2>
      <p class="lead">Löscht alle Einträge und Routinen in diesem Browser. Nicht umkehrbar.</p>
      <button type="button" class="btn danger" id="reset">Alle Daten löschen</button>
    </section>

    <p class="version">Stufe 1 · Daten bleiben auf diesem Gerät</p>`;
}

/* ---------- Ereignisse ---------- */

/** Setzt einen Wert wie "sleep.quality" im aktuellen Tag. */
function setPath(path, value) {
  const parts = path.split('.');
  let obj = currentDay;
  while (parts.length > 1) obj = obj[parts.shift()];
  obj[parts[0]] = value;
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
  const t = e.target.closest('[data-scale], [data-onset], [data-nav], [data-open], [data-deactivate], [data-goto], .wd');
  if (!t) return;

  if (t.dataset.onset) {
    const value = t.dataset.onset;
    const next = currentDay.sleep.onset === value ? null : value;
    currentDay.sleep.onset = next;
    t.closest('.onset-group').querySelectorAll('[data-onset]').forEach((b) => {
      const on = b.dataset.onset === next;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    refreshDuration();
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

  if (t.dataset.open) {
    window.dispatchEvent(new CustomEvent('goto', { detail: { view: 'today', date: t.dataset.open } }));
    return;
  }

  if (t.dataset.goto) {
    window.dispatchEvent(new CustomEvent('goto', { detail: { view: t.dataset.goto } }));
    return;
  }

  if (t.dataset.deactivate) {
    const r = store.routines().find((x) => x.id === t.dataset.deactivate);
    if (confirm(`„${r?.name}" ausblenden? Vergangene Einträge bleiben erhalten.`)) {
      store.deactivateRoutine(t.dataset.deactivate);
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
  if (e.target.id === 'new-routine-type') {
    document.getElementById('new-routine-days').hidden = e.target.value !== 'anchor';
  }
  if (e.target.id === 'import-file') handleImport(e.target);
});

app.addEventListener('click', (e) => {
  const id = e.target.id;

  if (id === 'add-routine') {
    const name = document.getElementById('new-routine-name').value.trim();
    if (!name) return toast('Bitte einen Namen eingeben');
    const type = document.getElementById('new-routine-type').value;
    const weekdays = [...document.querySelectorAll('.wd[aria-pressed="true"]')].map((b) => Number(b.dataset.wd));
    if (type === 'anchor' && !weekdays.length) return toast('Bitte mindestens einen Wochentag wählen');
    store.saveRoutine({
      id: store.newRoutineId(name),
      name,
      type,
      weekdays,
      time: document.getElementById('new-routine-time').value,
      active: true,
    });
    renderRoutines();
    toast('Routine hinzugefügt');
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
    calendar.disconnect();
    store.setGoogleClientId('');
    renderMore();
    toast('Client-ID entfernt');
  }

  if (id === 'google-connect') {
    calendar
      .connect()
      .then(() => {
        renderMore();
        toast('Mit Google verbunden');
      })
      .catch((err) => toast(`Verbindung fehlgeschlagen: ${err.message}`));
  }

  if (id === 'google-sync') {
    toast('Trage Routinen ein …');
    calendar
      .syncRoutines(store.routines())
      .then((r) => {
        const parts = [];
        if (r.created) parts.push(`${r.created} neu`);
        if (r.updated) parts.push(`${r.updated} aktualisiert`);
        if (r.skipped.length) parts.push(`${r.skipped.length} ohne Uhrzeit übersprungen`);
        if (r.failed.length) parts.push(`${r.failed.length} fehlgeschlagen`);
        toast(parts.join(' · ') || 'Keine aktiven Routinen');
      })
      .catch((err) => toast(`Fehler: ${err.message}`));
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

export { toast };
