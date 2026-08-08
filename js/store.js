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
  const idx = data.routines.findIndex((r) => r.id === routine.id);
  if (idx >= 0) data.routines[idx] = { ...data.routines[idx], ...routine };
  else data.routines.push({ active: true, ...routine });
  return persist();
}

/**
 * Routinen werden nie gelöscht, nur deaktiviert — sonst verlieren vergangene
 * Einträge ihren Bezug und die Auswertung bekommt Lücken, die sie nicht erklären kann.
 */
export function deactivateRoutine(id) {
  const r = data.routines.find((x) => x.id === id);
  if (r) r.active = false;
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

/** Merkt sich, welcher Google-Kalendertermin zu einer Routine gehört - für Updates statt Duplikate. */
export function setRoutineEventId(routineId, eventId) {
  const r = data.routines.find((x) => x.id === routineId);
  if (r) r.googleEventId = eventId;
  return persist();
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
 * Import. Zusammenführen statt Ersetzen: vorhandene Tage bleiben, es sei denn
 * der importierte Eintrag ist neuer. So kann ein Backup nichts überschreiben,
 * was inzwischen frisch erfasst wurde.
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

  // Unbekannte Routinen ergänzen, bekannte unangetastet lassen.
  for (const r of incoming.routines || []) {
    if (!data.routines.some((x) => x.id === r.id)) data.routines.push(r);
  }

  persist();
  return { added, updated, skipped };
}

export function resetAll() {
  data = emptyData();
  persist();
}
