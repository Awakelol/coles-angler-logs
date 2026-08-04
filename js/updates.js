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

/**
 * Throw the cached copy away and fetch the app again. The manual version of
 * what watchForUpdates() does on its own.
 *
 * The automatic path is good but not instant: a new worker is noticed on load,
 * on focus, and every fifteen minutes. Someone who has just pushed a change and
 * is staring at the old one does not want to wait for any of those, and their
 * next move is otherwise to go hunting in DevTools.
 *
 * ORDER MATTERS. reg.update() first, so a NEW worker is in charge before the
 * caches go: clear them under the old worker and the old worker simply fills
 * them again from its own shell list, which looks like the button did nothing.
 *
 * REFUSES WHEN OFFLINE, and this is the important part — the cache IS the app
 * when there is no network. Deleting it offline leaves nothing to load and the
 * next reload is a blank screen, which is a far worse outcome than a stale one.
 */
export async function forceRefresh() {
  if (!navigator.onLine) return { ok: false, reason: 'offline' };
  if (!('caches' in window)) return { ok: false, reason: 'unsupported' };

  try {
    const reg = await navigator.serviceWorker?.getRegistration?.();
    // Never rejects usefully — a failed check should not stop the clear-out,
    // which is the part that actually fixes a stale page.
    await reg?.update?.().catch(() => {});
    // A worker that installed but is waiting behind this page would otherwise
    // take over only after every tab closed. sw.js calls skipWaiting() on
    // install so this is belt-and-braces, but it costs a line.
    reg?.waiting?.postMessage?.({ type: 'SKIP_WAITING' });

    const keys = await caches.keys();
    const mine = keys.filter((k) => k.startsWith('angler-log-'));
    await Promise.all(mine.map((k) => caches.delete(k)));
    return { ok: true, cleared: mine.length };
  } catch {
    return { ok: false, reason: 'failed' };
  }
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
