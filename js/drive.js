/**
 * Sync der Tagebuchdaten über Google Drive. Läuft vollständig im Browser über
 * Google Identity Services (GIS) — kein eigener Server, kein Client-Secret.
 *
 * Die Daten landen im "appDataFolder": einem versteckten Ordner im Drive des
 * Nutzers, den weder er selbst in der Drive-Oberfläche sieht noch eine andere
 * App lesen kann. Genau eine Datei, die denselben JSON-Inhalt hat wie die
 * Sicherung zum Herunterladen.
 *
 * Zugriffstoken werden NICHT gespeichert: Sie laufen nach rund einer Stunde ab.
 * Beim Start wird ein stiller Token versucht (prompt: ''), was ohne Fenster
 * funktioniert, solange die Zustimmung schon einmal erteilt wurde.
 */

import * as store from './store.js';

const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const FILE_NAME = 'routinen-tagebuch.json';
const API = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';

let accessToken = null;
let tokenExpiresAt = 0;
let fileId = null;
let syncing = false;

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

/**
 * Fordert ein Zugriffstoken an. `silent` versucht es ohne Anmeldefenster —
 * das klappt nur, wenn die Zustimmung in diesem Browser schon erteilt wurde,
 * und schlägt sonst leise fehl. Für den ersten Verbindungsaufbau muss ein
 * Klick des Nutzers dahinterstehen, sonst blockt der Popup-Blocker.
 */
export async function connect({ silent = false } = {}) {
  const clientId = store.googleClientId();
  if (!clientId) throw new Error('Keine Google-Client-ID hinterlegt.');
  if (isConnected()) return;

  await loadScript('https://accounts.google.com/gsi/client');

  return new Promise((resolve, reject) => {
    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      // 'none' = ohne jede Rückfrage, schlägt fehl wenn Zustimmung nötig wäre.
      // '' = Google entscheidet, fragt also nur beim ersten Mal.
      prompt: silent ? 'none' : '',
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
  fileId = null;
}

async function api(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${accessToken}`, ...(options.headers || {}) },
  });
  if (!res.ok) {
    // 401 heißt fast immer: Token abgelaufen. Beim nächsten Versuch neu anfordern.
    if (res.status === 401) { accessToken = null; tokenExpiresAt = 0; }
    throw new Error(`Drive antwortete mit ${res.status}`);
  }
  return res;
}

/** Sucht die Datei im App-Ordner. Gibt null zurück, wenn es sie noch nicht gibt. */
async function findFile() {
  if (fileId) return fileId;
  const q = encodeURIComponent(`name='${FILE_NAME}'`);
  const res = await api(`${API}?spaces=appDataFolder&q=${q}&fields=files(id)`);
  const { files } = await res.json();
  fileId = files?.[0]?.id || null;
  return fileId;
}

async function download(id) {
  const res = await api(`${API}/${id}?alt=media`);
  return res.text();
}

async function upload(id, text) {
  const body = new Blob([text], { type: 'application/json' });
  if (id) {
    await api(`${UPLOAD}/${id}?uploadType=media`, { method: 'PATCH', body });
    return id;
  }
  // Neue Datei: Metadaten und Inhalt in einem mehrteiligen Request.
  const form = new FormData();
  form.append(
    'metadata',
    new Blob([JSON.stringify({ name: FILE_NAME, parents: ['appDataFolder'] })], {
      type: 'application/json',
    })
  );
  form.append('file', body);
  const res = await api(`${UPLOAD}?uploadType=multipart&fields=id`, { method: 'POST', body: form });
  fileId = (await res.json()).id;
  return fileId;
}

/**
 * Abgleich in beide Richtungen: erst herunterladen und zusammenführen, dann die
 * zusammengeführte Fassung hochladen — aber nur, wenn sie sich von der in Drive
 * unterscheidet. Dadurch gewinnt nie ein Gerät pauschal, sondern pro Tag und
 * pro Routine der jüngere Eintrag.
 */
export async function sync() {
  if (syncing) return { skipped: true };
  syncing = true;
  try {
    if (!isConnected()) await connect({ silent: true });

    const id = await findFile();
    let merged = {};
    let remoteText = null;

    if (id) {
      remoteText = await download(id);
      try {
        merged = store.importJSON(remoteText);
      } catch {
        throw new Error('Die Datei in Drive ist beschädigt und wurde nicht angerührt.');
      }
    }

    // Erst NACH dem Zusammenführen bilden - sonst fehlt das gerade Übernommene.
    const localText = store.syncJSON();
    const needsUpload = !id || localText !== remoteText;
    if (needsUpload) await upload(id, localText);

    store.markSync();
    return { ...merged, uploaded: needsUpload };
  } finally {
    syncing = false;
  }
}
