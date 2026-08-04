/**
 * Google-Kalender-Anbindung für Routinen. Läuft vollständig im Browser über
 * Google Identity Services (GIS) - kein eigener Server, kein Client-Secret.
 *
 * Die Google-Client-ID ist keine geheime Zugangsdaten (Google-Client-IDs sind
 * für den Einsatz im Browser gedacht und stehen offen im Seitenquelltext).
 * Sie liegt trotzdem in localStorage statt im Quellcode, weil sie projekt-
 * abhängig ist - wer die App selbst betreibt, braucht eine eigene.
 *
 * Zugriffstoken werden NICHT gespeichert: Sie laufen nach rund einer Stunde
 * ab und werden bei Bedarf per Anmeldefenster neu angefordert.
 */

import * as store from './store.js';

const SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const WEEKDAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const EVENT_MINUTES = 30; // Vorbelegte Termindauer - im Kalender selbst jederzeit änderbar

let tokenClient = null;
let accessToken = null;
let tokenExpiresAt = 0;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Konnte ${src} nicht laden`));
    document.head.appendChild(s);
  });
}

export function isConfigured() {
  return Boolean(store.googleClientId());
}

export function isConnected() {
  return Boolean(accessToken) && Date.now() < tokenExpiresAt;
}

/** Öffnet die Google-Anmeldung des Nutzers und fordert Kalenderzugriff an. */
export async function connect() {
  const clientId = store.googleClientId();
  if (!clientId) throw new Error('Keine Google-Client-ID hinterlegt.');

  await loadScript('https://accounts.google.com/gsi/client');

  return new Promise((resolve, reject) => {
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (resp) => {
        if (resp.error) return reject(new Error(resp.error));
        accessToken = resp.access_token;
        tokenExpiresAt = Date.now() + (Number(resp.expires_in) || 3600) * 1000 - 30000;
        resolve();
      },
      error_callback: (err) => reject(new Error(err?.message || 'Anmeldung abgebrochen')),
    });
    tokenClient.requestAccessToken();
  });
}

export function disconnect() {
  if (accessToken && window.google?.accounts?.oauth2) {
    window.google.accounts.oauth2.revoke(accessToken);
  }
  accessToken = null;
  tokenExpiresAt = 0;
}

/** Nächstes Datum (ISO) ab heute, das auf einen der angegebenen Wochentage fällt. */
function nextOccurrence(weekdays) {
  const today = store.isoDate();
  if (!weekdays?.length) return today;
  for (let i = 0; i < 7; i++) {
    const d = store.addDays(today, i);
    const [y, m, day] = d.split('-').map(Number);
    if (weekdays.includes(new Date(y, m - 1, day).getDay())) return d;
  }
  return today;
}

function buildEvent(routine) {
  const date = routine.type === 'anchor' ? nextOccurrence(routine.weekdays) : store.isoDate();
  const [y, m, day] = date.split('-').map(Number);
  const [h, min] = routine.time.split(':').map(Number);
  const start = new Date(y, m - 1, day, h, min);
  const end = new Date(start.getTime() + EVENT_MINUTES * 60000);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const toLocalIso = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` +
    `T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:00`;

  const recurrence =
    routine.type === 'anchor'
      ? [`RRULE:FREQ=WEEKLY;BYDAY=${routine.weekdays.map((w) => WEEKDAY_CODES[w]).join(',')}`]
      : ['RRULE:FREQ=DAILY'];

  return {
    summary: routine.name,
    start: { dateTime: toLocalIso(start), timeZone: tz },
    end: { dateTime: toLocalIso(end), timeZone: tz },
    recurrence,
  };
}

async function callApi(method, path, body) {
  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/${path}`, {
    method,
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw Object.assign(new Error(detail.error?.message || `Kalender-API: ${res.status}`), { status: res.status });
  }
  return res.status === 204 ? null : res.json();
}

/**
 * Trägt alle übergebenen Routinen mit Uhrzeit als wiederkehrende Termine in den
 * primären Google-Kalender ein. Routinen ohne Uhrzeit werden übersprungen - ohne
 * Zeit gibt es keinen Termin. Ein erneuter Aufruf aktualisiert bestehende Termine,
 * statt sie zu verdoppeln (Zuordnung über die im Routinendatensatz gespeicherte
 * Google-Termin-ID).
 */
export async function syncRoutines(routines) {
  const result = { created: 0, updated: 0, skipped: [], failed: [] };

  for (const routine of routines) {
    if (!routine.time) {
      result.skipped.push(routine.name);
      continue;
    }
    const event = buildEvent(routine);
    try {
      if (routine.googleEventId) {
        await callApi('PATCH', `events/${routine.googleEventId}`, event);
        result.updated++;
      } else {
        const created = await callApi('POST', 'events', event);
        store.setRoutineEventId(routine.id, created.id);
        result.created++;
      }
    } catch (err) {
      // Termin wurde im Kalender gelöscht -> Verknüpfung vergessen und neu anlegen,
      // statt bei jedem weiteren Sync erneut zu scheitern.
      if (err.status === 404 || err.status === 410) {
        try {
          const created = await callApi('POST', 'events', event);
          store.setRoutineEventId(routine.id, created.id);
          result.created++;
          continue;
        } catch (err2) {
          result.failed.push({ name: routine.name, message: err2.message });
          continue;
        }
      }
      result.failed.push({ name: routine.name, message: err.message });
    }
  }
  return result;
}
