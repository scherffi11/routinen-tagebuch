/**
 * Datenhaltung. Alles liegt in localStorage unter EINEM Schlüssel.
 *
 * Tages-Konvention (wichtig für die spätere Auswertung):
 * Ein Eintrag für Datum X enthält
 *   - den Schlaf der Nacht von X-1 auf X ("letzte Nacht"),
 *   - Befinden, Aktivität und Routinen des Tages X.
 * Beim Abendeintrag ist beides gerade frisch im Kopf. Für die Auswertung heißt das:
 * Routinen und Sport von Tag X-1 wirken auf den Schlaf, der im Eintrag von Tag X steht.
 *
 * Alles, was tagsüber passiert (Sport, Tageslicht, sozialer Kontakt), steht im Tag.
 * Alles, was zur Nacht gehört (auch Sex), steht im Schlaf desselben Eintrags.
 */

const KEY = 'routinen-tagebuch';
const SCHEMA_VERSION = 4;

/**
 * Stufen der Bewertungsskala. Sechs statt fünf, weil eine gerade Anzahl keine
 * neutrale Mitte hat: 1-3 ist die negative Hälfte, 4-6 die positive. Man muss
 * sich also entscheiden, statt bei "3" nichts zu sagen.
 */
export const SCALE_MAX = 6;

/**
 * Alte 1-5-Werte auf die 1-6-Skala. Die Zahl bleibt stehen, nur die alte Mitte
 * bekommt dadurch ein Vorzeichen: Eine 3 von 5 war unentschieden und zählt jetzt
 * als 3 von 6, also zur negativen Hälfte - so gewollt.
 *
 * Einzige Ausnahme ist die 5: Sie war der Höchstwert und muss der Höchstwert
 * bleiben. Bliebe sie stehen, hätte kein einziger alter Eintrag je die oberste
 * Stufe, und ein damaliges "topfit" wäre nachträglich abgewertet.
 */
const SCALE_5_TO_6 = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 6 };

/** Nach so vielen Tagen ohne Sicherung legt die App von selbst eine Datei ab. 0 schaltet ab. */
const AUTO_BACKUP_DAYS = 3;

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
    settings: { lastBackupAt: null, autoBackupDays: AUTO_BACKUP_DAYS, google: { clientId: '' } },
  };
}

/**
 * Wurde beim Laden auf ein neues Schema gehoben? Dann muss das Ergebnis sofort
 * geschrieben werden: migrate() arbeitet nur im Arbeitsspeicher, und die
 * Sport-Verschiebung legt fehlende Vortage neu an. Ohne dieses Festschreiben
 * wären sie beim nächsten Start wieder weg.
 */
let migratedOnLoad = false;

let data = load();
if (migratedOnLoad) persist();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyData();
    const parsed = JSON.parse(raw);
    migratedOnLoad = !(parsed?.schemaVersion >= SCHEMA_VERSION);
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
  if (d.settings.autoBackupDays == null) d.settings.autoBackupDays = AUTO_BACKUP_DAYS;
  // awakenings war früher eine Zahl (0-20), jetzt eine Kategorie (none/once/multiple).
  for (const day of Object.values(d.days)) {
    const a = day?.sleep?.awakenings;
    if (typeof a === 'number') {
      day.sleep.awakenings = a === 0 ? 'none' : a === 1 ? 'once' : 'multiple';
    }
  }
  if (!(d.schemaVersion >= 2)) migrateToV2(d);
  if (!(d.schemaVersion >= 4)) migrateToV4(d);
  migrateScaleTo6(d);
  d.schemaVersion = SCHEMA_VERSION;
  return d;
}

/**
 * Schema 4: Sex aus der Schlaf- in die Tages-Maske.
 *
 * Als `sleep.sex` meinte das Feld "gestern Abend / nachts", also die Nacht vor
 * dem Eintrag. Gefragt ist aber der ganze Tag - und den kann man morgens nicht
 * beurteilen. Jetzt steht es wie Sport im Tag, an dem es passiert ist, und die
 * alten Werte wandern entsprechend einen Tag zurück.
 */
function migrateToV4(d) {
  for (const [date, day] of Object.entries(d.days)) {
    const sex = day.sleep?.sex;
    if (sex) {
      const prev = addDays(date, -1);
      if (!d.days[prev]) d.days[prev] = { ...emptyDay(prev), updatedAt: day.updatedAt || null };
      d.days[prev].sex = sex;
    }
    if (day.sleep) delete day.sleep.sex;
  }
}

/**
 * Hebt Einträge der alten 1-5-Skala auf 1-6. Hängt bewusst an `scaleMax` des
 * einzelnen Tages statt an der Schemaversion: So erwischt es auch Einträge, die
 * später aus einer alten Sicherungsdatei dazukommen, und lässt bereits
 * umgerechnete Tage in Ruhe.
 */
function migrateScaleTo6(d) {
  for (const day of Object.values(d.days)) {
    if ((day.scaleMax || 5) >= SCALE_MAX) { day.scaleMax = SCALE_MAX; continue; }
    for (const [obj, key] of [
      [day.sleep, 'rested'],
      [day.mood, 'mood'], [day.mood, 'energy'], [day.mood, 'stress'], [day.mood, 'focus'],
    ]) {
      const v = obj?.[key];
      if (v) obj[key] = SCALE_5_TO_6[v] ?? v;
    }
    day.scaleMax = SCALE_MAX;
  }
}

/**
 * Schema 2: Skala auf sechs Stufen, Sport aus der Schlaf- in die Tages-Maske.
 *
 * Sport lag als `sleep.sport` im Eintrag von Tag X, meinte aber die Aktivität an
 * Tag X-1 - eine Sonderregel, die man beim Ausfüllen jedes Mal mitdenken musste.
 * Jetzt steht er als `sport` in dem Tag, an dem er stattgefunden hat. Inhaltlich
 * ändert sich nichts, nur die Ablage stimmt wieder mit der Beschriftung überein.
 *
 * Läuft genau einmal, danach steht schemaVersion auf 2. Object.entries liefert
 * eine Kopie, das Anlegen fehlender Vortage während der Schleife ist also sicher.
 */
function migrateToV2(d) {
  for (const [date, day] of Object.entries(d.days)) {
    // Noch auf der alten Skala - die Umrechnung übernimmt migrateScaleTo6.
    if (day.scaleMax == null) day.scaleMax = 5;

    const sport = day.sleep?.sport;
    if (sport) {
      const prev = addDays(date, -1);
      if (!d.days[prev]) d.days[prev] = { ...emptyDay(prev), updatedAt: day.updatedAt || null };
      d.days[prev].sport = sport;
    }
    if (day.sleep) delete day.sleep.sport;
  }
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

function emptyDay(date) {
  return {
    date,
    // Mit wie vielen Stufen wurde dieser Tag bewertet? Alte Einträge stehen auf 5.
    scaleMax: SCALE_MAX,
    sleep: { bedtime: '', onset: null, wakeAt: '', wakeUp: null, awakenings: null, rested: null },
    mood: { mood: null, energy: null, stress: null, focus: null },
    // Tagsüber passiert: gehört zu Tag X und wirkt auf die Nacht X -> X+1.
    sport: null,
    outdoor: null,
    social: null,
    sex: null,
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

export function dayCount() {
  return Object.keys(data.days).length;
}

/** Alle Einträge, neueste zuerst. */
function allDays() {
  return Object.keys(data.days)
    .sort()
    .reverse()
    .map((d) => getDay(d));
}

/**
 * Ein Eintrag zählt als ausgefüllt, sobald irgendetwas Substanzielles drinsteht.
 * Bewusst großzügig: ein Tag mit nur einer Stimmungsangabe ist besser als kein Tag.
 */
function isFilled(day) {
  const s = day.sleep, m = day.mood, i = day.intake;
  return Boolean(
    s.rested || s.bedtime || s.wakeAt || s.onset || s.wakeUp || s.awakenings ||
    m.mood || m.energy || m.stress || m.focus ||
    day.sport || day.outdoor || day.social || day.sex ||
    i.alcohol || i.lastCoffee || i.lastMeal ||
    day.note.trim() ||
    Object.values(day.routines).some(Boolean)
  );
}

/**
 * Wie viele Felder einer Maske sind ausgefüllt? Für den Fortschrittspunkt am
 * Umschalter - man soll sehen, ob noch etwas offen ist, ohne beide Masken
 * durchzublättern. Notiz und Schlagworte zählen bewusst nicht mit: sie sind
 * freiwillig, und ein Tag ohne Notiz ist kein unvollständiger Tag.
 */
export function completeness(day, mode) {
  const s = day.sleep, m = day.mood, i = day.intake;
  const fields =
    mode === 'sleep'
      ? [s.bedtime, s.wakeAt, s.onset, s.wakeUp, s.awakenings, s.rested]
      : [m.mood, m.energy, m.stress, m.focus, day.sport, day.outdoor, day.social, day.sex,
         i.alcohol, i.lastCoffee, i.lastMeal];
  const done = fields.filter((v) => v !== null && v !== undefined && v !== '').length;
  return { done, total: fields.length };
}

/* ---------- Schlafdauer ---------- */

/** Geschätzte Minuten bis zum Einschlafen, je nach gewählter Geschwindigkeit. */
const ONSET_MINUTES = { fast: 5, medium: 20, slow: 45 };

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

/* ---------- Zeit-Vorschläge ---------- */

/** "HH:MM" auf das nächste 15-Minuten-Raster, Mitternacht inklusive. */
export function roundToQuarterHour(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return hhmm;
  const total = (((h * 60 + Math.round(m / 15) * 15) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

const DEFAULT_TIMES = {
  bedtime: ['22:30', '23:00', '23:30', '00:00'],
  wakeAt: ['06:00', '06:30', '07:00', '07:30'],
};

/**
 * Die vier Zeiten, die am häufigsten vorkamen - als Chips über dem Zeitfeld.
 *
 * Bewusst die eigenen bisherigen Werte statt fester Vorgaben: Wer regelmäßig um
 * 23:15 ins Bett geht, trifft das mit einem Tap, statt am Drehrad zu scrollen.
 * Solange zu wenig Einträge da sind, stehen Allerweltszeiten drin.
 */
export function suggestedTimes(field, lookback = 30) {
  const recent = Object.keys(data.days).sort().reverse().slice(0, lookback);
  const counts = new Map();
  for (const date of recent) {
    const raw = data.days[date]?.sleep?.[field];
    if (!raw) continue;
    const t = roundToQuarterHour(raw);
    counts.set(t, (counts.get(t) || 0) + 1);
  }
  if (counts.size < 2) return DEFAULT_TIMES[field] || [];

  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([t]) => t);

  // Chronologisch anzeigen. Beim Zubettgehen zählt nach Mitternacht als "später",
  // sonst stünde 00:15 vor 23:00 und die Reihe läse sich rückwärts.
  const rank = (t) => {
    const [h, m] = t.split(':').map(Number);
    const mins = h * 60 + m;
    return field === 'bedtime' && mins < 12 * 60 ? mins + 1440 : mins;
  };
  return top.sort((a, b) => rank(a) - rank(b));
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

/**
 * Skalenwert auf 0-1. Höher ist besser.
 *
 * Die Spannweite kommt aus dem Eintrag selbst. Nach der Umrechnung stehen zwar
 * alle Tage auf sechs Stufen, aber der Parameter bleibt: Eine Sicherungsdatei von
 * vor der Umstellung landet über importJSON wieder in der Migration, und bis die
 * durch ist, darf hier nichts falsch gerechnet werden.
 */
const fromScale = (v, max = SCALE_MAX) => (v ? (v - 1) / (max - 1) : null);

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
  const max = day.scaleMax || SCALE_MAX;
  return weightedScore([
    [40, fromScale(s.rested, max)],
    [25, durationScore(sleepMinutes(s))],
    [15, s.awakenings ? AWAKENINGS_SCORE[s.awakenings] ?? null : null],
    [12, s.onset ? ONSET_SCORE[s.onset] ?? null : null],
    [8, s.wakeUp ? WAKEUP_SCORE[s.wakeUp] ?? null : null],
  ]);
}

/**
 * Stress geht invertiert ein: viel Stress drückt das Gesamtbefinden.
 *
 * Sport, Tageslicht und sozialer Kontakt gehen bewusst NICHT ein - genauso wenig
 * wie Sex in den Schlafscore. Das sind Einflussgrößen, keine Bestandteile des
 * Befindens. Wären sie im Score, hieße "mehr Sport" automatisch "besser gefühlt",
 * und die spätere Auswertung könnte den Zusammenhang nicht mehr prüfen: sie würde
 * nur noch die eigene Formel wiederfinden.
 */
export function moodScore(day) {
  const m = day.mood;
  const max = day.scaleMax || SCALE_MAX;
  return weightedScore([
    [40, fromScale(m.mood, max)],
    [25, fromScale(m.energy, max)],
    [20, fromScale(m.focus, max)],
    [15, m.stress ? 1 - fromScale(m.stress, max) : null],
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

export function markBackup() {
  data.settings.lastBackupAt = new Date().toISOString();
  persist();
}

/**
 * Ist überhaupt irgendeine Sicherung eingerichtet? Entweder ein laufender
 * Drive-Abgleich oder mindestens ein Export. Ist beides nie passiert, liegen
 * die Daten ausschließlich im Browserspeicher — und der ist mit dem Löschen
 * des Browserverlaufs weg.
 */
export function hasAnyBackup() {
  return Boolean(data.settings.lastBackupAt || data.settings.lastSyncAt);
}

/** Tage seit der letzten Sicherung, oder null wenn noch nie gesichert. */
export function daysSinceBackup() {
  const last = data.settings.lastBackupAt;
  if (!last) return null;
  return Math.floor((Date.now() - new Date(last).getTime()) / 86400000);
}

/* ---------- Automatische Sicherung ---------- */

export function autoBackupDays() {
  return data.settings.autoBackupDays ?? AUTO_BACKUP_DAYS;
}

export function setAutoBackupDays(n) {
  data.settings.autoBackupDays = Number(n) || 0;
  return persist();
}

/**
 * Ist eine automatische Sicherung fällig?
 *
 * Ausgelöst wird sie nicht von einer Uhr, sondern vom nächsten Fingertipp in der
 * App: Ein Browser darf nur aus einer laufenden Nutzergeste heraus eine Datei
 * ablegen. Da jeder Eintrag mit Tippen beginnt, fällt der Unterschied zu "läuft
 * von selbst" nicht auf - eine echte Zeitsteuerung ist im Web nicht baubar.
 *
 * Läuft der Drive-Abgleich, ist die Datei überflüssig; der sichert schon.
 */
export function autoBackupDue() {
  const every = autoBackupDays();
  if (!every || !dayCount()) return false;
  if (lastSyncAt()) return false;
  const since = daysSinceBackup();
  return since == null || since >= every;
}

/* ---------- Zwischenstände im Browserspeicher ---------- */

const SNAP_PREFIX = `${KEY}-snap-`;
const SNAP_SLOTS = 3;
/** Frühestens nach so vielen Stunden ein neuer Zwischenstand - sonst schreibt jedes Öffnen einen. */
const SNAP_MIN_HOURS = 20;

function snapshotSlot(i) {
  try {
    const raw = localStorage.getItem(SNAP_PREFIX + i);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

/** Vorhandene Zwischenstände, neuester zuerst. */
export function snapshots() {
  return Array.from({ length: SNAP_SLOTS }, (_, i) => {
    const s = snapshotSlot(i);
    return s ? { slot: i, takenAt: s.takenAt, days: s.days } : null;
  })
    .filter(Boolean)
    .sort((a, b) => (a.takenAt < b.takenAt ? 1 : -1));
}

/**
 * Legt reihum einen Abzug im Browserspeicher ab, drei Stände rollierend.
 *
 * Das ersetzt KEINE Sicherung: Wer den Browserspeicher löscht, löscht die Abzüge
 * gleich mit. Es hilft gegen den anderen Fall - versehentlich überschriebene oder
 * unlesbar gewordene Daten, wo bisher nichts als ein Import von Hand half.
 */
export function takeSnapshot() {
  if (!dayCount()) return false;
  const existing = snapshots();
  if (existing.length) {
    const ageH = (Date.now() - new Date(existing[0].takenAt).getTime()) / 3600000;
    if (ageH < SNAP_MIN_HOURS) return false;
  }
  // Freier Platz zuerst, sonst der älteste.
  const used = new Set(existing.map((s) => s.slot));
  const free = Array.from({ length: SNAP_SLOTS }, (_, i) => i).find((i) => !used.has(i));
  const slot = free ?? existing.at(-1).slot;

  try {
    localStorage.setItem(
      SNAP_PREFIX + slot,
      JSON.stringify({ takenAt: new Date().toISOString(), days: dayCount(), payload: syncJSON() })
    );
    return true;
  } catch (_) {
    // Speicher voll: Zwischenstände sind das Erste, was weichen darf.
    for (let i = 0; i < SNAP_SLOTS; i++) localStorage.removeItem(SNAP_PREFIX + i);
    return false;
  }
}

/**
 * Spielt einen Zwischenstand zurück - zusammenführend, nicht ersetzend. Ein alter
 * Stand kann damit nichts überschreiben, was seither erfasst wurde.
 */
export function restoreSnapshot(slot) {
  const s = snapshotSlot(slot);
  if (!s?.payload) throw new Error('Dieser Zwischenstand ist leer.');
  return importJSON(s.payload);
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
  return { added, updated, skipped, routines: routinesChanged };
}

export function resetAll() {
  data = emptyData();
  persist();
}
