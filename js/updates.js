// Live updates for an installed PWA that never gets reloaded.
//
// Checks for a new service worker on load, on focus, and every 15 minutes.
// sw.js calls skipWaiting(), so a new version fires controllerchange and we
// reload, but not while a sheet is open (don't lose a half-filled form).

const CHECK_INTERVAL_MS = 15 * 60 * 1000;

function sheetOpen() {
  return Boolean(document.querySelector('.sheet-backdrop'));
}

/** Reload now, or once the open sheet is closed. */
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
 * Manual "clear cache and reload" for the Settings screen.
 *
 * Updates the worker before deleting caches, otherwise the old worker just
 * refills them. Refuses offline, since the cache is the only copy of the app
 * then.
 */
export async function forceRefresh() {
  if (!navigator.onLine) return { ok: false, reason: 'offline' };
  if (!('caches' in window)) return { ok: false, reason: 'unsupported' };

  try {
    const reg = await navigator.serviceWorker?.getRegistration?.();
    await reg?.update?.().catch(() => {});
    // sw.js already skips waiting on install; this is just in case.
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

  // On a first visit clients.claim() fires controllerchange too. That isn't an
  // update, and reloading then can interrupt a Google sign-in redirect.
  const hadController = Boolean(navigator.serviceWorker.controller);

  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return; // first install, not an update
    if (reloading) return;
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
      // No service worker (private mode etc.); just no offline support.
    });
}
