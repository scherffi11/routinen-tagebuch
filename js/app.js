/** Einstieg: Navigation zwischen den Ansichten, Service Worker, Speichern beim Verlassen. */

import * as views from './views.js';
import { isoDate } from './store.js';

const VIEWS = {
  today: views.renderToday,
  history: views.renderHistory,
  routines: views.renderRoutines,
  more: views.renderMore,
};

function show(view, arg) {
  if (!VIEWS[view]) view = 'today';
  views.flush();
  VIEWS[view](arg);
  document.querySelectorAll('.tab').forEach((b) => {
    const on = b.dataset.view === view;
    b.classList.toggle('on', on);
    b.setAttribute('aria-current', on ? 'page' : 'false');
  });
  window.scrollTo(0, 0);
}

document.querySelector('.tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('.tab');
  if (!btn) return;
  // Der Eintrags-Tab landet immer auf heute. Bliebe hier ein über den Verlauf
  // geöffneter Tag stehen, würde man abends ahnungslos in den falschen Tag schreiben.
  show(btn.dataset.view, btn.dataset.view === 'today' ? isoDate() : undefined);
});

window.addEventListener('goto', (e) => show(e.detail.view, e.detail.date));

// Der Browser kann die Seite jederzeit einfrieren - vorher schreiben.
window.addEventListener('pagehide', views.flush);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    views.flush();
    views.autoSync();
  } else {
    // Zurück in der App: erst holen, was auf dem anderen Gerät entstanden ist.
    views.autoSync();
  }
});

show('today');
views.autoSync();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('SW:', err));
  });
}
