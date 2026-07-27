// ---------------------------------------------------------------------------
// App shell: hash router, region switching, page mounting.
//
// Routes are declared in ROUTES. Each page module exports
// `render(ctx) -> html` and optionally `mount(root, ctx)`.
// ---------------------------------------------------------------------------

import { loadOverrides, loadLocalConfig } from './config.js';
import { REGIONS, DEFAULT_REGION_ID, getRegion } from './data/index.js';
import { prefs } from './store.js';
import { icon } from './pixel.js';
import { esc } from './ui.js';

import * as home from './pages/home.js';
import * as species from './pages/species.js';
import * as mapPage from './pages/map.js';
import * as conditions from './pages/conditions.js';
import * as log from './pages/log.js';
import * as tips from './pages/tips.js';
import * as settings from './pages/settings.js';

// Untracked local keys first, then anything entered in Settings wins.
await loadLocalConfig();
loadOverrides();

const ROUTES = [
  { path: '/', page: home },
  { path: '/species', page: species },
  { path: '/map', page: mapPage },
  { path: '/conditions', page: conditions },
  { path: '/log', page: log },
  { path: '/tips', page: tips },
  { path: '/settings', page: settings },
];

const main = document.getElementById('main');

function currentRegionId() {
  const saved = prefs.get('regionId', DEFAULT_REGION_ID);
  return REGIONS.some((r) => r.id === saved) ? saved : DEFAULT_REGION_ID;
}

/** "#/species?family=Lutjanidae" -> { path, params } */
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

let renderToken = 0;

async function render() {
  const token = ++renderToken;
  const { path, params } = parseHash();
  const route = matchRoute(path);
  const regionId = currentRegionId();
  const ctx = { regionId, region: getRegion(regionId), params, navigate };

  syncTabs(route.path);

  // A sheet left open when the route changes would float over the new page.
  for (const sheet of document.querySelectorAll('.sheet-backdrop')) sheet.remove();

  try {
    main.innerHTML = route.page.render(ctx);
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

function buildBrandMark() {
  const mark = document.getElementById('brandMark');
  if (mark) mark.innerHTML = icon('hook', { size: 40, palette: 'sunset' });
}

window.addEventListener('hashchange', render);

buildBrandMark();
buildRegionPicker();
render();
