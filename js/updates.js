// ---------------------------------------------------------------------------
// LIVE UPDATES
//
// The service worker is network-first for code, so a page load always fetches
// fresh JS/CSS. That alone isn't enough for an installed PWA: if the app is
// already open on a phone it never reloads, so a push would sit unnoticed
// until the app was force-closed.
//
// This checks for a new worker on load, whenever the app regains focus, and
// every 15 minutes. sw.js calls skipWaiting(), so a new version takes control
// as soon as it installs, which fires `controllerchange` — the cue to reload.
//
// The one thing it must not do is reload while a form is open and lose a
// half-written catch, so a reload is deferred until any modal sheet is closed.
// ---------------------------------------------------------------------------

const CHECK_INTERVAL_MS = 15 * 60 * 1000;

function sheetOpen() {
  return Boolean(document.querySelector('.sheet-backdrop'));
}

/** Reload now, or as soon as the user closes whatever they have open. */
function reloadWhenIdle() {
  if (!sheetOpen()) {
    location.reload();
    return;
  }
  const observer = new MutationObserver(() => {
    if (!sheetOpen()) {
      observer.disconnect();
      location.reload();
    }
  });
  observer.observe(document.body, { childList: true, subtree: false });
}

export function watchForUpdates() {
  if (!('serviceWorker' in navigator) || !location.protocol.startsWith('http')) return;

  // Whether a worker was ALREADY in charge when this page loaded.
  //
  // This distinction is the whole game. On a first visit there is no
  // controller; the worker installs, calls clients.claim(), and that fires
  // controllerchange — which is not an update, it's the initial handover.
  // Reloading on it made every first load reload itself, and worse, it
  // reloaded the page mid-way through resolving a Google sign-in redirect,
  // consuming getRedirectResult() and dumping the user back on the login
  // screen with no error.
  const hadController = Boolean(navigator.serviceWorker.controller);

  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return; // first install, not an update
    if (reloading) return; // guard against a reload loop
    reloading = true;
    reloadWhenIdle();
  });

  navigator.serviceWorker
    .register('sw.js')
    .then((reg) => {
      const check = () => reg.update().catch(() => {});
      check();
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) check();
      });
      window.addEventListener('online', check);
      setInterval(check, CHECK_INTERVAL_MS);
    })
    .catch(() => {
      // No service worker (private mode, unsupported browser). The app still
      // works — it just loses offline support.
    });
}
