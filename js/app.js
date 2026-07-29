// ---------------------------------------------------------------------------
// App shell: hash router, region switching, page mounting.
//
// Routes are declared in ROUTES. Each page module exports
// `render(ctx) -> html` and optionally `mount(root, ctx)`.
// ---------------------------------------------------------------------------

import { loadOverrides, loadLocalConfig } from './config.js';
import { watchForUpdates } from './updates.js';
import { applyTheme, watchSystemTheme } from './theme.js';
import { init as initAuth } from './auth.js';
import { REGIONS, DEFAULT_REGION_ID, getRegion } from './data/index.js';
import { prefs } from './store.js';
import { icon } from './pixel.js';
import { esc } from './ui.js';

import * as home from './pages/home.js';
import * as mapPage from './pages/map.js';
import * as conditions from './pages/conditions.js';
import * as log from './pages/log.js';
import * as info from './pages/info.js';
import * as identify from './pages/identify.js';
import * as settings from './pages/settings.js';

// Untracked local keys first, then anything entered in Settings wins.
await loadLocalConfig();
loadOverrides();

// Finishes a Google sign-in redirect before the first render, so the app
// doesn't flash the signed-out gate on the way back from the provider.
await initAuth();

// Order here is incidental; the tab bar decides what the user sees.
const ROUTES = [
  { path: '/', page: home },
  { path: '/map', page: mapPage },
  { path: '/conditions', page: conditions },
  { path: '/log', page: log },
  { path: '/info', page: info },
  { path: '/identify', page: identify },
  { path: '/settings', page: settings },
];

// Species and Tips were merged into Info. Old links still exist in the wild —
// bookmarks, a home-screen shortcut, an app shell cached before the merge — so
// they are translated to the equivalent Info tab rather than falling through to
// Home. replaceState keeps the dead URL out of the back stack.
const LEGACY_ROUTES = { '/species': 'fishes', '/tips': 'zones' };

const main = document.getElementById('main');

function currentRegionId() {
  const saved = prefs.get('regionId', DEFAULT_REGION_ID);
  return REGIONS.some((r) => r.id === saved) ? saved : DEFAULT_REGION_ID;
}

/** "#/info?family=Lutjanidae" -> { path, params } */
function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, query = ''] = raw.split('?');
  return { path: path || '/', params: new URLSearchParams(query) };
}

function matchRoute(path) {
  return ROUTES.find((r) => r.path === path) || ROUTES[0];
}

function syncTabs(path) {
  for (const a of document.querySelectorAll('.tabbar a')) {
    const tab = a.dataset.tab;
    const active = tab === path || (tab !== '/' && path.startsWith(tab));
    if (active) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
}

/**
 * Whether to cross-fade between pages.
 *
 * Checked per navigation rather than once at start-up: the OS reduced-motion
 * setting can change while the app is open, and someone who turns it on
 * because motion is making them ill should not have to restart the app.
 */
function canAnimatePages() {
  if (typeof document.startViewTransition !== 'function') return false;
  return !matchMedia('(prefers-reduced-motion: reduce)').matches;
}

let renderToken = 0;

async function render() {
  const token = ++renderToken;
  let { path, params } = parseHash();

  if (LEGACY_ROUTES[path]) {
    params = new URLSearchParams(params);
    params.set('tab', LEGACY_ROUTES[path]);
    history.replaceState(null, '', `#/info?${params}`);
    path = '/info';
  }

  const route = matchRoute(path);
  const regionId = currentRegionId();
  const ctx = { regionId, region: getRegion(regionId), params, navigate };

  syncTabs(route.path);

  // A sheet left open when the route changes would float over the new page.
  // Removing it isn't enough: openSheet() locks the body with position:fixed
  // and a negative top to stop the page scrolling underneath, and only its own
  // close() undoes that. Navigating away bypassed it, leaving every subsequent
  // page pinned and scrolled to a stale offset.
  const stranded = document.querySelectorAll('.sheet-backdrop');
  if (stranded.length) {
    for (const sheet of stranded) sheet.remove();
    document.body.classList.remove('is-sheet-open');
    document.body.style.top = '';
  }

  try {
    const swap = () => {
      main.innerHTML = route.page.render(ctx);
    };

    // Cross-fade the page when the browser can do it. Only the markup swap is
    // wrapped — mount() often waits on the network, and holding the transition
    // open for a weather fetch would freeze the old page on screen for seconds.
    // updateCallbackDone resolves as soon as the DOM is updated, so mount()
    // proceeds while the animation finishes on its own.
    if (canAnimatePages()) {
      try {
        const transition = document.startViewTransition(swap);
        // `ready` and `finished` REJECT when a transition is skipped — which
        // is routine: tapping two tabs quickly, or navigating with the tab
        // hidden. Nothing needs doing about it, but leaving them unhandled
        // raises unhandledrejection and looks like a real fault.
        transition.ready?.catch(() => {});
        transition.finished?.catch(() => {});
        await transition.updateCallbackDone;
      } catch {
        swap(); // a transition already running, or the browser refused
      }
    } else {
      swap();
    }

    if (route.page.mount) await route.page.mount(main, ctx);
  } catch (err) {
    console.error('[render]', err);
    if (token !== renderToken) return;
    main.innerHTML = `
      <section class="band band--cream"><div class="wrap">
        <div class="notice notice--error">
          <h3>Something broke on this screen</h3>
          <p>${esc(err.message || String(err))}</p>
          <p>The details are in the browser console.</p>
        </div>
      </div></section>`;
  }

  // Don't fight the browser when it's restoring a scroll position.
  if (token === renderToken) {
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
    main.focus({ preventScroll: true });
  }
}

export function navigate(path) {
  if (location.hash === `#${path}`) render();
  else location.hash = path;
}

function buildRegionPicker() {
  const select = document.getElementById('regionSelect');
  const active = currentRegionId();
  select.innerHTML = REGIONS.map(
    (r) => `<option value="${esc(r.id)}"${r.id === active ? ' selected' : ''}>${esc(r.name)}</option>`
  ).join('');

  // A single region needs no picker.
  select.parentElement.hidden = REGIONS.length < 2;

  select.addEventListener('change', () => {
    prefs.set('regionId', select.value);
    render();
  });
}

/**
 * Publish the top bar's real height as --topbar-h.
 *
 * The map screen sizes itself to fill exactly what's left of the viewport, so
 * it needs this precisely. Hardcoding it breaks the moment the brand text
 * wraps at a narrow width — the map would either fall short or push the page
 * into scrolling, which is the one thing that layout is trying to avoid.
 */
function trackTopbarHeight() {
  const bar = document.querySelector('.topbar');
  if (!bar) return;
  const publish = () =>
    document.documentElement.style.setProperty('--topbar-h', `${bar.offsetHeight}px`);
  publish();
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(publish).observe(bar);
  } else {
    window.addEventListener('resize', publish);
  }
}

function buildBrandMark() {
  const mark = document.getElementById('brandMark');
  if (mark) mark.innerHTML = icon('hook', { size: 40, palette: 'sunset' });
}

window.addEventListener('hashchange', render);

// index.html already applied the theme before first paint; this re-asserts it
// and keeps 'system' following the OS while the app is open.
applyTheme();
watchSystemTheme();

trackTopbarHeight();
buildBrandMark();
buildRegionPicker();
render();
watchForUpdates();
