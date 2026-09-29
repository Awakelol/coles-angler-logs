// App shell: hash router, region switching, page mounting.
//
// Each page module exports `render(ctx) -> html` and optionally
// `mount(root, ctx)`.

import { loadOverrides, loadLocalConfig } from './config.js';
import { watchForUpdates } from './updates.js';
import { applyTheme, watchSystemTheme } from './theme.js';
import { applyArtMode, onArtModeChange } from './art-mode.js';
import { init as initAuth } from './auth.js';
import { REGIONS, DEFAULT_REGION_ID, getRegion } from './data/index.js';
import { prefs } from './store.js';
import { brandMark } from './art.js';
import { esc } from './ui.js';

import * as home from './pages/home.js';
import * as mapPage from './pages/map.js';
import * as conditions from './pages/conditions.js';
import * as log from './pages/log.js';
import * as info from './pages/info.js';
import * as account from './pages/account.js';
import * as settings from './pages/settings.js';

// config.local.js first, then anything saved in Settings on top.
await loadLocalConfig();
loadOverrides();

// Finish any pending Google sign-in redirect before the first render.
await initAuth();

const ROUTES = [
  { path: '/', page: home },
  { path: '/map', page: mapPage },
  { path: '/conditions', page: conditions },
  { path: '/log', page: log },
  { path: '/info', page: info },
  { path: '/account', page: account },
  { path: '/settings', page: settings },
];

// Old routes that now live as tabs under Info. Kept so bookmarks still work.
const LEGACY_ROUTES = { '/species': 'fishes', '/tips': 'zones', '/identify': 'photo' };

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

// Checked on every navigation since reduced-motion can change at runtime.
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
  syncNavRoll(route.path);

  // Only the home screen shows the brand bar; other pages have their own heading.
  document.body.classList.toggle('no-topbar', route.path !== '/');
  // Picks the per-page background glow (painted on <html>, so set it there).
  document.documentElement.dataset.page =
    route.path === '/' ? 'home' : route.path.slice(1);
    // Info locks page scroll while its deck is open; clear that on the way out.
  document.body.classList.remove('deck-locked');
  document.documentElement.classList.remove('deck-locked');
  publishTopbarHeight();

  // Close any sheet left open by the previous page. openSheet() pins the body
  // with position:fixed, so undo that here as well.
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

    // Only the markup swap goes inside the view transition. mount() can wait
    // on the network and we don't want the old page frozen on screen meanwhile.
    if (canAnimatePages()) {
      try {
        const transition = document.startViewTransition(swap);
        // These reject when a transition is skipped (e.g. fast tab switching).
        transition.ready?.catch(() => {});
        transition.finished?.catch(() => {});
        await transition.updateCallbackDone;
      } catch {
        swap();
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

  select.parentElement.hidden = REGIONS.length < 2;

  select.addEventListener('change', () => {
    prefs.set('regionId', select.value);
    render();
  });
}

// Exposes the top bar's height as --topbar-h. The map fills the rest of the
// viewport and needs the exact value (the brand text can wrap on narrow screens).
let publishTopbarHeight = () => {};

function trackTopbarHeight() {
  const bar = document.querySelector('.topbar');
  if (!bar) return;
  const publish = () =>
    document.documentElement.style.setProperty('--topbar-h', `${bar.offsetHeight}px`);
  // Called directly on route change so the map doesn't jump for a frame
  // while waiting on the ResizeObserver.
  publishTopbarHeight = publish;
  publish();
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(publish).observe(bar);
  } else {
    window.addEventListener('resize', publish);
  }
}

function buildBrandMark() {
  const mark = document.getElementById('brandMark');
  if (mark) mark.innerHTML = brandMark({ size: 40 });
  const rail = document.getElementById('railMark');
  if (rail) rail.innerHTML = brandMark({ size: 34 });
}

// --- nav bar ---------------------------------------------------------------
//
// On phones the bar is hidden on the map so the map gets the full screen; the
// map page has its own back row instead. Hiding is done with a body class
// because --tab-space (the room every page leaves for the nav) keys off it.

const NAV_HIDES = new Set(['/map']);

export function navHidden() {
  return document.body.classList.contains('is-nav-hidden');
}

const PHONE = () => matchMedia('(max-width: 899px)').matches;

function setNavHidden(hide) {
  const bar = document.querySelector('.tabbar');
  if (!bar) return;
  // Desktop keeps the rail visible everywhere.
  hide = hide && PHONE();
  document.body.classList.toggle('is-nav-hidden', hide);
  // inert also drops focus that's currently inside the bar.
  bar.toggleAttribute('inert', hide);
  if (hide && bar.contains(document.activeElement)) document.activeElement.blur();
  // Close the quick-action menu if it was open.
  const btn = document.getElementById('quickBtn');
  if (hide && btn?.getAttribute('aria-expanded') === 'true') btn.click();
}

function syncNavRoll(path) {
  setNavHidden(NAV_HIDES.has(path));
}

// Re-check when the window crosses the breakpoint.
matchMedia('(max-width: 899px)').addEventListener?.('change', () => {
  syncNavRoll(parseHash().path);
});

// --- collapsible desktop rail ------------------------------------------------

const RAIL_PREF = 'railCollapsed';

function setRailCollapsed(collapsed) {
  const bar = document.querySelector('.tabbar');
  const btn = document.getElementById('railToggle');
  if (!bar || !btn) return;
  document.body.classList.toggle('rail-collapsed', collapsed);
  btn.setAttribute('aria-expanded', String(!collapsed));
  btn.setAttribute('aria-label', collapsed ? 'Expand navigation' : 'Collapse navigation');

  // Icons only when collapsed, so give them native tooltips.
  for (const el of bar.querySelectorAll('a[data-tab], #quickBtn')) {
    const label = el.getAttribute('aria-label');
    if (collapsed && label) el.setAttribute('title', label);
    else el.removeAttribute('title');
  }
}

function wireRailToggle() {
  const btn = document.getElementById('railToggle');
  if (!btn) return;
  setRailCollapsed(prefs.get(RAIL_PREF, false) === true);
  btn.addEventListener('click', () => {
    const next = !document.body.classList.contains('rail-collapsed');
    prefs.set(RAIL_PREF, next);
    setRailCollapsed(next);
  });
}

// --- the + button and its quick actions ------------------------------------
// Lives here because the nav sits outside the router's view.

function wireQuickActions() {
  const btn = document.getElementById('quickBtn');
  const menu = document.getElementById('quickMenu');
  const veil = document.getElementById('quickVeil');
  if (!btn || !menu || !veil) return;

  const setOpen = (open) => {
    btn.setAttribute('aria-expanded', String(open));
    btn.setAttribute('aria-label', open ? 'Close' : 'Add');
    // Unhide first, then add the class next frame so the transition runs.
    if (open) {
      menu.hidden = false;
      veil.hidden = false;
      placeMenu();
      requestAnimationFrame(() => {
        menu.classList.add('is-open');
        veil.classList.add('is-open');
      });
    } else {
      menu.classList.remove('is-open');
      veil.classList.remove('is-open');
      setTimeout(() => {
        if (btn.getAttribute('aria-expanded') === 'false') {
          menu.hidden = true;
          veil.hidden = true;
        }
      }, 260);
    }
  };

  // Phone: CSS positions the menu above the +. Desktop: open it beside the
  // rail, level with the button.
  const wide = () => matchMedia('(min-width: 900px)').matches;
  function placeMenu() {
    if (!wide()) {
      menu.style.cssText = '';
      return;
    }
    const r = btn.getBoundingClientRect();
    const rail = btn.closest('.tabbar').getBoundingClientRect();
    menu.style.left = `${Math.round(rail.right + 12)}px`;
    menu.style.top = `${Math.round(r.top)}px`;
    menu.style.bottom = 'auto';
    menu.style.transform = 'none';
    menu.style.width = '260px';
  }
  addEventListener('resize', () => {
    if (btn.getAttribute('aria-expanded') === 'true') placeMenu();
  });

  btn.addEventListener('click', () => {
    setOpen(btn.getAttribute('aria-expanded') !== 'true');
  });
  veil.addEventListener('click', () => setOpen(false));
  for (const a of menu.querySelectorAll('[data-quick]')) {
    a.addEventListener('click', () => setOpen(false));
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && btn.getAttribute('aria-expanded') === 'true') setOpen(false);
  });
  window.addEventListener('hashchange', () => setOpen(false));
}

wireQuickActions();
wireRailToggle();

window.addEventListener('hashchange', render);

// index.html sets the theme before first paint; this keeps 'system' in sync.
applyTheme();
watchSystemTheme();

// The brand mark is outside the router's view, so redraw it explicitly.
applyArtMode();
onArtModeChange(() => {
  buildBrandMark();
  render();
});

trackTopbarHeight();
buildBrandMark();
buildRegionPicker();
render();
watchForUpdates();
