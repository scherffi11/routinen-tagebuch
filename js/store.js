/**
 * Datenhaltung. Alles liegt in localStorage unter EINEM Schlüssel.
 *
 * Tages-Konvention (wichtig für die spätere Auswertung):
 * Ein Eintrag für Datum X enthält
 *   - den Schlaf der Nacht von X-1 auf X ("letzte Nacht"),
 *   - Befinden und Routinen des Tages X.
 * Beim Abendeintrag ist beides gerade frisch im Kopf. Für die Auswertung heißt das:
 * Routinen von Tag X-1 wirken auf den Schlaf, der im Eintrag von Tag X steht.
 */

const KEY = 'routinen-tagebuch';
const SCHEMA_VERSION = 1;

/** Routinen, mit denen die App startet. Jederzeit änderbar unter "Routinen". */
const DEFAULT_ROUTINES = [
  { id: 'kein-handy',  name: 'Kein Handy mehr',                 type: 'daily', weekdays: [], time: '22:00' },
  { id: 'lesen',       name: 'Lesen vorm Schlafengehen',        type: 'daily', weekdays: [], time: '' },
  { id: 'fruehstueck', name: 'Tisch für Frühstück vorbereiten', type: 'daily', weekdays: [], time: '' },
  { id: 'notizbuch',   name: 'Notizbuch füllen',                type: 'daily', weekdays: [], time: '' },
];

function emptyData() {
  return {
    schemaVersion: SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    days: {},
    routines: DEFAULT_ROUTINES.map((r) => ({ ...r, active: true })),
    settings: { lastBackupAt: null, google: { clientId: '' } },
  };
}

let data = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyData();
    const parsed = JSON.parse(raw);
    return migrate(parsed);
  } catch (err) {
    // Kaputte Daten nicht stillschweigend überschreiben - lieber sichern und melden.
    console.error('Daten nicht lesbar:', err);
    const backupKey = `${KEY}-defekt-${Date.now()}`;
    try {
      localStorage.setItem(backupKey, localStorage.getItem(KEY) || '');
    } catch (_) { /* Speicher voll - dann eben nicht */ }
    alert(
      'Die gespeicherten Daten konnten nicht gelesen werden. ' +
      `Eine Kopie liegt unter "${backupKey}". Die App startet mit leeren Daten.`
    );
    return emptyData();
  }
}

/** Hebt ältere Datenstände auf die aktuelle Schemaversion. */
function migrate(d) {
  if (!d || typeof d !== 'object') return emptyData();
  if (!d.days) d.days = {};
  if (!Array.isArray(d.routines)) d.routines = emptyData().routines;
  if (!d.settings) d.settings = { lastBackupAt: null };
  if (!d.settings.google) d.settings.google = { clientId: '' };
  // awakenings war früher eine Zahl (0-20), jetzt eine Kategorie (none/once/multiple).
  for (const day of Object.values(d.days)) {
    const a = day?.sleep?.awakenings;
    if (typeof a === 'number') {
      day.sleep.awakenings = a === 0 ? 'none' : a === 1 ? 'once' : 'multiple';
    }
  }
  d.schemaVersion = SCHEMA_VERSION;
  return d;
}

function persist() {
  data.updatedAt = new Date().toISOString();
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch (err) {
    alert(
      'Speichern fehlgeschlagen — der Browserspeicher ist voll oder gesperrt.\n\n' +
      'Exportiere deine Daten über "Mehr → Daten sichern", bevor du weitermachst.'
    );
    console.error(err);
    return false;
  }
}

/* ---------- Datum ---------- */

/** ISO-Datum (YYYY-MM-DD) in lokaler Zeit — NICHT toISOString(), das rechnet in UTC um. */
export function isoDate(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d + n);
  return isoDate(date);
}

export function formatDate(iso, opts = { weekday: 'long', day: 'numeric', month: 'long' }) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('de-DE', opts);
}

/** "Heute", "Gestern" oder das ausgeschriebene Datum. */
export function relativeDate(iso) {
  const today = isoDate();
  if (iso === today) return 'Heute';
  if (iso === addDays(today, -1)) return 'Gestern';
  return formatDate(iso);
}

/* ---------- Tageseinträge ---------- */

export function emptyDay(date) {
  return {
    date,
    // sport: Sport-Intensität an Tag X-1, dem Tag vor dieser Nacht (nicht Tag X).
    sleep: { bedtime: '', onset: null, wakeAt: '', wakeUp: null, awakenings: null, rested: null, sport: null },
    mood: { mood: null, energy: null, stress: null, focus: null },
    routines: {},
    intake: { alcohol: null, lastCoffee: null, lastMeal: null },
    note: '',
    tags: [],
    updatedAt: null,
  };
}

export function getDay(date) {
  const stored = data.days[date];
  if (!stored) return emptyDay(date);
  // Über emptyDay legen, damit später ergänzte Felder auch in alten Einträgen existieren.
  const base = emptyDay(date);
  return {
    ...base,
    ...stored,
    sleep: { ...base.sleep, ...(stored.sleep || {}) },
    mood: { ...base.mood, ...(stored.mood || {}) },
    intake: { ...base.intake, ...(stored.intake || {}) },
    routines: { ...(stored.routines || {}) },
    tags: [...(stored.tags || [])],
  };
}

export function saveDay(day) {
  day.updatedAt = new Date().toISOString();
  data.days[day.date] = day;
  return persist();
}

export function deleteDay(date) {
  delete data.days[date];
  return persist();
}

export function hasEntry(date) {
  return Boolean(data.days[date]);
}

/** Alle Einträge, neueste zuerst. */
export function allDays() {
  return Object.keys(data.days)
    .sort()
    .reverse()
    .map((d) => getDay(d));
}

export function dayCount() {
  return Object.keys(data.days).length;
}

/**
 * Ein Eintrag zählt als ausgefüllt, sobald irgendetwas Substanzielles drinsteht.
 * Bewusst großzügig: ein Tag mit nur einer Stimmungsangabe ist besser als kein Tag.
 */
export function isFilled(day) {
  const s = day.sleep, m = day.mood, i = day.intake;
  return Boolean(
    s.rested || s.bedtime || s.wakeAt || s.onset || s.wakeUp || s.sport || s.awakenings ||
    m.mood || m.energy || m.stress || m.focus ||
    i.alcohol || i.lastCoffee || i.lastMeal ||
    day.note.trim() ||
    Object.values(day.routines).some(Boolean)
  );
}

/* ---------- Schlafdauer ---------- */

/** Geschätzte Minuten bis zum Einschlafen, je nach gewählter Geschwindigkeit. */
export const ONSET_MINUTES = { fast: 5, medium: 20, slow: 45 };

/**
 * Geschätzte Schlafdauer in Minuten: Zeit im Bett minus die für die gewählte
 * Einschlafgeschwindigkeit angenommene Einschlafzeit. Eine exakte Einschlafzeit
 * kennt ohnehin niemand - das war vorher auch nur eine Schätzung.
 * Über Mitternacht hinweg: Aufwachzeit vor Zubettgehzeit heißt "am nächsten Morgen".
 * Gibt null zurück, wenn eine Zeit fehlt.
 */
export function sleepMinutes(sleep) {
  if (!sleep.bedtime || !sleep.wakeAt) return null;
  const [sh, sm] = sleep.bedtime.split(':').map(Number);
  const [wh, wm] = sleep.wakeAt.split(':').map(Number);
  if ([sh, sm, wh, wm].some(Number.isNaN)) return null;
  let mins = wh * 60 + wm - (sh * 60 + sm);
  if (mins <= 0) mins += 24 * 60;
  const latency = ONSET_MINUTES[sleep.onset] ?? 0;
  return Math.max(0, mins - latency);
}

export function formatDuration(mins) {
  if (mins == null) return '—';
  return `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, '0')} h`;
}

/* ---------- Scores für den Verlauf ---------- */

/**
 * Fasst mehrere Teilangaben zu einer Zahl von 0-100 zusammen.
 *
 * Fehlende Angaben werden aus der Rechnung genommen statt als schlecht gewertet —
 * sonst bekäme ein halb ausgefüllter Tag automatisch einen miesen Score und der
 * Verlauf zeigte Einbrüche, die nur Lücken sind.
 */
function weightedScore(parts) {
  const usable = parts.filter(([, value]) => value != null);
  if (!usable.length) return null;
  const weight = usable.reduce((sum, [w]) => sum + w, 0);
  const points = usable.reduce((sum, [w, value]) => sum + w * value, 0);
  return Math.round((points / weight) * 100);
}

/** 1-5-Skala auf 0-1. Höher ist besser. */
const fromScale = (v) => (v ? (v - 1) / 4 : null);

const ONSET_SCORE = { fast: 1, medium: 0.6, slow: 0.2 };
const AWAKENINGS_SCORE = { none: 1, once: 0.6, multiple: 0.2 };
const WAKEUP_SCORE = { immediate: 1, snooze: 0.5 };

/** 7 bis 8,5 h zählen voll; darunter fällt es steil ab, zu viel Schlaf nur leicht. */
function durationScore(mins) {
  if (mins == null) return null;
  const h = mins / 60;
  if (h < 4) return 0;
  if (h < 7) return (h - 4) / 3;
  if (h <= 8.5) return 1;
  if (h <= 10) return 1 - ((h - 8.5) / 1.5) * 0.3;
  return 0.7;
}

/**
 * "Erholt aufgewacht" wiegt am schwersten: Zeiten und Häufigkeiten sind Indizien,
 * aber wie man sich morgens fühlt, ist das eigentliche Ergebnis.
 */
export function sleepScore(day) {
  const s = day.sleep;
  return weightedScore([
    [40, fromScale(s.rested)],
    [25, durationScore(sleepMinutes(s))],
    [15, s.awakenings ? AWAKENINGS_SCORE[s.awakenings] ?? null : null],
    [12, s.onset ? ONSET_SCORE[s.onset] ?? null : null],
    [8, s.wakeUp ? WAKEUP_SCORE[s.wakeUp] ?? null : null],
  ]);
}

/** Stress geht invertiert ein: viel Stress drückt das Gesamtbefinden. */
export function moodScore(day) {
  const m = day.mood;
  return weightedScore([
    [40, fromScale(m.mood)],
    [25, fromScale(m.energy)],
    [20, fromScale(m.focus)],
    [15, m.stress ? 1 - fromScale(m.stress) : null],
  ]);
}

/** Einträge mit Inhalt, älteste zuerst — so, wie ein Verlauf gelesen wird. */
export function trendDays() {
  return allDays().filter(isFilled).reverse();
}

/* ---------- Routinen ---------- */

export function routines({ activeOnly = true } = {}) {
  return data.routines.filter((r) => (activeOnly ? r.active !== false : true));
}

/** Routinen, die an diesem Wochentag anstehen. Anker-Routinen nur an ihren Tagen. */
export function routinesForDate(date) {
  const [y, m, d] = date.split('-').map(Number);
  const weekday = new Date(y, m - 1, d).getDay(); // 0 = Sonntag
  return routines().filter(
    (r) => r.type !== 'anchor' || !r.weekdays?.length || r.weekdays.includes(weekday)
  );
}

export function saveRoutine(routine) {
  const stamped = { ...routine, updatedAt: new Date().toISOString() };
  const idx = data.routines.findIndex((r) => r.id === routine.id);
  if (idx >= 0) data.routines[idx] = { ...data.routines[idx], ...stamped };
  else data.routines.push({ active: true, ...stamped });
  return persist();
}

/**
 * Routinen werden nie gelöscht, nur deaktiviert — sonst verlieren vergangene
 * Einträge ihren Bezug und die Auswertung bekommt Lücken, die sie nicht erklären kann.
 */
export function deactivateRoutine(id) {
  const r = data.routines.find((x) => x.id === id);
  if (r) {
    r.active = false;
    r.updatedAt = new Date().toISOString();
  }
  return persist();
}

export function newRoutineId(name) {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'routine';
  let id = base, n = 2;
  while (data.routines.some((r) => r.id === id)) id = `${base}-${n++}`;
  return id;
}

/* ---------- Einstellungen, Sicherung ---------- */

export function settings() {
  return data.settings;
}

export function googleClientId() {
  return data.settings.google?.clientId || '';
}

export function setGoogleClientId(id) {
  data.settings.google = { clientId: id.trim() };
  return persist();
}

export function lastSyncAt() {
  return data.settings.lastSyncAt || null;
}

export function markSync() {
  data.settings.lastSyncAt = new Date().toISOString();
  return persist();
}

/**
 * Zeitstempel der jüngsten Änderung im gesamten Bestand. Der Sync vergleicht ihn
 * mit dem Stand nach dem Zusammenführen, um zu erkennen, ob hochgeladen werden muss.
 */
export function latestChange() {
  let latest = '';
  for (const d of Object.values(data.days)) if ((d.updatedAt || '') > latest) latest = d.updatedAt;
  for (const r of data.routines) if ((r.updatedAt || '') > latest) latest = r.updatedAt;
  return latest;
}

export function markBackup() {
  data.settings.lastBackupAt = new Date().toISOString();
  persist();
}

/** Tage seit der letzten Sicherung, oder null wenn noch nie gesichert. */
export function daysSinceBackup() {
  const last = data.settings.lastBackupAt;
  if (!last) return null;
  return Math.floor((Date.now() - new Date(last).getTime()) / 86400000);
}

export function exportJSON() {
  return JSON.stringify(data, null, 2);
}

/**
 * Fassung für den Drive-Abgleich. Enthält bewusst nur Tage und Routinen:
 *
 * `settings` und `createdAt` sind geräteeigen (wann wurde die App HIER angelegt,
 * wann zuletzt abgeglichen) und unterscheiden sich zwischen zwei Geräten immer.
 * Wären sie enthalten, würde jeder Abgleich einen Unterschied sehen und ewig
 * hochladen. Die Schlüssel werden sortiert, damit derselbe Inhalt auch
 * denselben Text ergibt.
 */
export function syncJSON() {
  const days = {};
  for (const date of Object.keys(data.days).sort()) days[date] = data.days[date];
  const routines = [...data.routines].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return JSON.stringify({ schemaVersion: SCHEMA_VERSION, days, routines }, null, 2);
}

/**
 * Zusammenführen statt Ersetzen: pro Tag und pro Routine gewinnt die zuletzt
 * geänderte Fassung. So kann weder ein Backup noch ein zweites Gerät etwas
 * überschreiben, was inzwischen frisch erfasst wurde.
 *
 * `changed` sagt, ob am lokalen Bestand etwas verändert wurde — der Sync
 * entscheidet daran, ob er die zusammengeführte Fassung hochladen muss.
 */
export function importJSON(text) {
  const incoming = migrate(JSON.parse(text));
  if (!incoming.days) throw new Error('Keine Tageseinträge in der Datei gefunden.');

  let added = 0, updated = 0, skipped = 0;
  for (const [date, day] of Object.entries(incoming.days)) {
    const existing = data.days[date];
    if (!existing) {
      data.days[date] = day;
      added++;
    } else if ((day.updatedAt || '') > (existing.updatedAt || '')) {
      data.days[date] = day;
      updated++;
    } else {
      skipped++;
    }
  }

  let routinesChanged = 0;
  for (const r of incoming.routines || []) {
    const idx = data.routines.findIndex((x) => x.id === r.id);
    if (idx < 0) {
      data.routines.push(r);
      routinesChanged++;
    } else if ((r.updatedAt || '') > (data.routines[idx].updatedAt || '')) {
      data.routines[idx] = r;
      routinesChanged++;
    }
  }

  persist();
  return { added, updated, skipped, routines: routinesChanged, changed: added + updated + routinesChanged > 0 };
}

export function resetAll() {
  data = emptyData();
  persist();
}
