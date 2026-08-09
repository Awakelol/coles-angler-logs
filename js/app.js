// ---------------------------------------------------------------------------
// App shell: hash router, region switching, page mounting.
//
// Routes are declared in ROUTES. Each page module exports
// `render(ctx) -> html` and optionally `mount(root, ctx)`.
// ---------------------------------------------------------------------------

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
  { path: '/account', page: account },
  { path: '/settings', page: settings },
];

// Species, Tips and Identify were folded into Info. Old links still exist in
// the wild — bookmarks, a home-screen shortcut, an app shell cached before the
// merge — so they are translated to the equivalent Info tab rather than
// falling through to Home. replaceState keeps the dead URL out of the back
// stack.
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
  syncNavRoll(route.path);

  // The brand bar earns its space on the home screen and nowhere else: every
  // other page opens with its own name in a heading twice the size, so the bar
  // is a second title above the real one, costing 68px of a phone screen.
  document.body.classList.toggle('no-topbar', route.path !== '/');
  // Info pins the page while its deck is up. Leaving that set on the way out
  // would lock every other screen at one viewport with no way to scroll.
  document.body.classList.remove('deck-locked');
  document.documentElement.classList.remove('deck-locked');
  publishTopbarHeight();

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
let publishTopbarHeight = () => {};

function trackTopbarHeight() {
  const bar = document.querySelector('.topbar');
  if (!bar) return;
  const publish = () =>
    document.documentElement.style.setProperty('--topbar-h', `${bar.offsetHeight}px`);
  // Kept so a route change can republish immediately. A hidden bar measures 0,
  // which is what the map's height and the folder pile's sticky offsets need —
  // but waiting for the observer to notice leaves one frame at the old height,
  // and on the map that frame is a visible jump.
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
  // The rail carries the brand at desktop widths, where the top bar's copy is
  // hidden. Drawn regardless of width — it costs one small SVG, and building it
  // on a resize handler instead would leave the rail blank for a frame every
  // time someone drags a window across the breakpoint.
  const rail = document.getElementById('railMark');
  if (rail) rail.innerHTML = brandMark({ size: 34 });
}

// --- the + and its quick actions -------------------------------------------
//
// Lives here rather than in a page module: the nav is outside the router's
// view, so a page that owned this would take it down on every navigation.
// ---------------------------------------------------------------------------
// THE HIDDEN NAV
//
// On the map the bar goes away completely and the map takes the whole screen.
// Only on the map: it is the one screen where the content IS the viewport and
// every pixel of chrome is taken from it.
//
// It used to retract into the +, which kept a 58px puck and its clear space
// parked over the map for no return — a bar shrunk to a button is still a bar
// in the way. Going means going. What replaces it is the map's own top strip
// (see map.js), a back-to-home row that is smaller than the puck was and, un-
// like it, tells you where the button leads.
//
// The state is a class on <body>, not a style on the bar, because --tab-space
// is what every screen leaves clear for the nav — the map's height and margin
// both derive from it, so zeroing that one token is what actually gives the
// room away. Leaflet notices via the ResizeObserver map.js already has.
// ---------------------------------------------------------------------------

const NAV_HIDES = new Set(['/map']);

/** Whether the bar is currently hidden. */
export function navHidden() {
  return document.body.classList.contains('is-nav-hidden');
}

const PHONE = () => matchMedia('(max-width: 899px)').matches;

function setNavHidden(hide) {
  const bar = document.querySelector('.tabbar');
  if (!bar) return;
  // The hiding is phone-only. Above 899px the bar is a side rail on a window
  // with room to spare, and taking the primary navigation away to buy space
  // that is not scarce is a trade in the wrong direction.
  hide = hide && PHONE();
  document.body.classList.toggle('is-nav-hidden', hide);
  // display:none already takes it out of the tab order, but `inert` also drops
  // any focus that is currently INSIDE it — without that, hiding the bar while
  // a tab is focused leaves the focus ring on an element that no longer
  // renders, and the next Tab starts from nowhere.
  bar.toggleAttribute('inert', hide);
  if (hide && bar.contains(document.activeElement)) document.activeElement.blur();
  // The + lives in the bar, so hiding it hides the quick actions with it. An
  // open menu would otherwise be left floating over the map with no button.
  const btn = document.getElementById('quickBtn');
  if (hide && btn?.getAttribute('aria-expanded') === 'true') btn.click();
}

/** Called on every render: the map hides the bar, everything else restores it. */
function syncNavRoll(path) {
  setNavHidden(NAV_HIDES.has(path));
}

// Dragging a window across the breakpoint has to re-decide, or a bar hidden on
// a narrow window stays hidden — and unreachable — once it is a rail.
matchMedia('(max-width: 899px)').addEventListener?.('change', () => {
  syncNavRoll(parseHash().path);
});


// ---------------------------------------------------------------------------
// THE COLLAPSED RAIL
//
// Desktop only, and remembered. Narrowing to icons is a preference about how
// you want to work, not a response to the window, so it outlives the session.
//
// The labels are hidden by CLIPPING rather than display:none — the rail's width
// is what animates, and a label that vanishes on the first frame makes the
// panel look like it emptied before it moved.
// ---------------------------------------------------------------------------

const RAIL_PREF = 'railCollapsed';

function setRailCollapsed(collapsed) {
  const bar = document.querySelector('.tabbar');
  const btn = document.getElementById('railToggle');
  if (!bar || !btn) return;
  document.body.classList.toggle('rail-collapsed', collapsed);
  btn.setAttribute('aria-expanded', String(!collapsed));
  btn.setAttribute('aria-label', collapsed ? 'Expand navigation' : 'Collapse navigation');

  // With the labels clipped away, the icons are the only thing left to read.
  // A native title rather than a styled tooltip because the rail scrolls, and
  // anything drawn inside it would be cut off at the panel's edge — which is
  // the one place a tooltip must not be.
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
    const next = document.body.classList.contains('rail-collapsed') ? false : true;
    prefs.set(RAIL_PREF, next);
    setRailCollapsed(next);
  });
}

function wireQuickActions() {
  const btn = document.getElementById('quickBtn');
  const menu = document.getElementById('quickMenu');
  const veil = document.getElementById('quickVeil');
  if (!btn || !menu || !veil) return;

  const setOpen = (open) => {
    btn.setAttribute('aria-expanded', String(open));
    btn.setAttribute('aria-label', open ? 'Close' : 'Add');
    // `hidden` has to come off before the class goes on, or the browser has
    // nothing to animate from and the items simply appear.
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
      // Wait for the fade before hiding, so it does not vanish mid-transition.
      setTimeout(() => {
        if (btn.getAttribute('aria-expanded') === 'false') {
          menu.hidden = true;
          veil.hidden = true;
        }
      }, 260);
    }
  };

  // On a phone the stack rises from the bottom centre, which is where the + is.
  // On the rail the + is top-left, and a menu that opened at the far corner of
  // the window would look like it belonged to something else — so it is
  // measured off the button rather than positioned by a second set of rules
  // that would have to be kept in step with the rail's padding.
  const wide = () => matchMedia('(min-width: 900px)').matches;
  function placeMenu() {
    if (!wide()) {
      menu.style.cssText = '';
      return;
    }
    const r = btn.getBoundingClientRect();
    const rail = btn.closest('.tabbar').getBoundingClientRect();
    // Beside the rail rather than below the button: dropped straight down it
    // covers the navigation it belongs to, and you choose an action while the
    // thing that opened it is hidden behind the choice.
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
  // Choosing an action navigates; the menu must not still be up when you land.
  for (const a of menu.querySelectorAll('[data-quick]')) {
    a.addEventListener('click', () => setOpen(false));
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && btn.getAttribute('aria-expanded') === 'true') setOpen(false);
  });
  // Navigating any other way closes it too.
  window.addEventListener('hashchange', () => setOpen(false));
}

wireQuickActions();
wireRailToggle();

window.addEventListener('hashchange', render);

// index.html already applied the theme before first paint; this re-asserts it
// and keeps 'system' following the OS while the app is open.
applyTheme();
watchSystemTheme();

// Which art set is in force. Re-drawn on change rather than reloaded: the mark
// lives outside the router's view, so a re-render alone would leave the old
// one in the top bar.
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
