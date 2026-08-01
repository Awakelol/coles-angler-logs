// Settings — API keys, data export/import, storage info.

import { CONFIG, saveOverrides } from '../config.js';
import { store, exportJson, importJson } from '../store.js';
import { REGIONS } from '../data/index.js';
import { APP_VERSION, CHANGELOG } from '../data/changelog.js';
import { THEMES, getTheme, setTheme, resolvedTheme } from '../theme.js';
import {
  currentUser, signOut, cloudConfigured, linkProvider, unlinkProvider, linkedProviders,
} from '../auth.js';
import { syncNow, lastSyncedAt } from '../sync.js';
import { esc, toast } from '../ui.js';


// --- connected accounts ------------------------------------------------------

const PROVIDER_LABEL = {
  // 'local' and 'username' are the same thing to the person using it — one
  // has met the network and the other hasn't. Both must have a label, or the
  // internal name leaks onto the screen.
  local: 'Username & password',
  username: 'Username & password',
  google: 'Google',
  facebook: 'Facebook',
};

/**
 * What this account is, what it syncs, and how else you can get into it.
 *
 * Linking is the part worth explaining on screen rather than in a tooltip:
 * people reasonably assume connecting Google means starting again, and will
 * not press a button they think might cost them their log.
 */
function connectedHtml() {
  const user = currentUser();
  const linked = linkedProviders();
  const canLink = cloudConfigured() && user.syncs;
  const when = lastSyncedAt();

  return `
    <div class="connected">
      <div class="row-between" style="margin-bottom:10px">
        <h3 class="card__title" style="font-size:16px">Sync</h3>
        <span class="chip ${user.syncs ? 'chip--target' : 'chip--tag'}">
          ${user.syncs ? 'On' : 'This device only'}
        </span>
      </div>
      <p class="card__body" style="margin-bottom:12px">
        ${
          user.syncs
            ? `Your catches are saved to your account, so signing in on another phone brings them with you.${
                when ? ` Last checked ${esc(fmtWhen(when))}.` : ''
              } Photos and clips stay on the device that took them.`
            : 'This account was made without a connection, so it lives only on this phone. Sign in again while online and it will start syncing on its own — nothing to do, and no catches are lost.'
        }
      </p>
      ${
        user.syncs
          ? '<button class="btn btn--sm" id="syncNowBtn" style="align-self:flex-start">Sync now</button>'
          : ''
      }

      <h3 class="card__title" style="font-size:16px;margin:18px 0 6px">Ways to sign in</h3>
      <p class="field__hint" style="margin-bottom:10px">
        All of these open the same log. Connecting another one adds a way in — it
        never creates a second account and never moves your catches.
      </p>
      <ul class="provider-list" id="providerList">
        ${(linked.length ? linked : [user.provider])
          .map(
            (p) => `
          <li>
            <span>${esc(PROVIDER_LABEL[p] || p)}</span>
            <span class="chip chip--target">Connected</span>
          </li>`
          )
          .join('')}
        ${
          canLink && !linked.includes('google') && CONFIG.auth?.google
            ? `<li>
                 <span>${esc(PROVIDER_LABEL.google)}</span>
                 <button class="btn btn--sm" data-link="google">Connect</button>
               </li>`
            : ''
        }
      </ul>
      <p class="field__hint" id="linkStatus" role="status" style="margin-top:10px"></p>
    </div>`;
}

/** "today", "yesterday", or a date — a timestamp to the second helps nobody. */
function fmtWhen(iso) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return new Date(iso).toLocaleDateString();
}

export function render() {
  const t = CONFIG.tides;
  const w = CONFIG.weather;

  return `
    <section class="band band--cream">
      <div class="wrap">
        <p class="eyebrow">Configuration</p>
        <h1 class="display">Settings</h1>
        <p class="subtitle">Keys are stored only in this browser and are never sent anywhere except the provider you choose.</p>
      </div>
    </section>

    <section class="band band--green">
      <div class="wrap">
        <div class="section-head"><h2>Account</h2><p>Who this device's log belongs to</p></div>
        <div class="card">
          ${
            currentUser()
              ? `<div class="row-between">
                   <div>
                     <p class="card__sub">Signed in as</p>
                     <h3 class="card__title" style="font-size:20px">${esc(currentUser().username)}</h3>
                   </div>
                   <button class="btn btn--sm" id="signOutBtn">Sign out</button>
                 </div>
                 <p class="field__hint">
                   Catches are kept per account, so signing out hides yours rather than deleting them.
                 </p>`
              : `<p class="card__body">Not signed in. The catch log asks you to sign in or create an account.</p>
                 <a class="btn btn--sm btn--primary" href="#/log" style="align-self:flex-start">Go to the log</a>`
          }
          ${currentUser() ? connectedHtml() : ''}
        </div>
      </div>
    </section>

    <section class="band band--violet">
      <div class="wrap">
        <div class="section-head"><h2>Appearance</h2><p>Follows your phone unless you choose</p></div>
        <div class="card">
          <div class="field">
            <label>Theme</label>
            <div class="chips" id="themePicker">
              ${THEMES.map(
                (t) => `
                <button class="chip" data-theme-choice="${esc(t)}"
                        aria-pressed="${t === getTheme()}">
                  ${t === 'system' ? 'Match phone' : t[0].toUpperCase() + t.slice(1)}
                </button>`
              ).join('')}
            </div>
            <p class="field__hint" id="themeHint"></p>
          </div>
        </div>
      </div>
    </section>

    <section class="band band--sky">
      <div class="wrap">
        <div class="section-head"><h2>Weather</h2><p>Works with no key by default</p></div>
        <div class="card">
          <div class="field">
            <label for="w-provider">Provider</label>
            <select id="w-provider">
              <option value="open-meteo"${w.provider === 'open-meteo' ? ' selected' : ''}>Open-Meteo — no key needed</option>
              <option value="openweather"${w.provider === 'openweather' ? ' selected' : ''}>OpenWeather — needs a key</option>
            </select>
          </div>
          <div class="field" id="ow-key-wrap"${w.provider === 'openweather' ? '' : ' hidden'}>
            <label for="w-key">OpenWeather API key</label>
            <input type="password" id="w-key" value="${esc(w.openWeatherKey)}" placeholder="paste key here" autocomplete="off">
            <p class="field__hint">
              Free at <code>openweathermap.org/api</code> → sign up → API keys.
              New keys take about 10 minutes to activate.
            </p>
          </div>
          <button class="btn btn--primary" id="saveWeather">Save weather settings</button>
        </div>
      </div>
    </section>

    <section class="band band--yellow">
      <div class="wrap">
        <div class="section-head"><h2>Tides</h2><p>Requires a key from one of these providers</p></div>
        <div class="card">
          <div class="field">
            <label for="t-provider">Provider</label>
            <select id="t-provider">
              <option value="none"${t.provider === 'none' ? ' selected' : ''}>Not configured</option>
              <option value="worldtides"${t.provider === 'worldtides' ? ' selected' : ''}>WorldTides</option>
              <option value="stormglass"${t.provider === 'stormglass' ? ' selected' : ''}>Stormglass</option>
            </select>
          </div>

          <div class="field" data-key-for="worldtides"${t.provider === 'worldtides' ? '' : ' hidden'}>
            <label for="t-wt">WorldTides key</label>
            <input type="password" id="t-wt" value="${esc(t.worldTidesKey)}" placeholder="paste key here" autocomplete="off">
            <p class="field__hint">
              Sign up at <code>worldtides.info</code> → Account → API key.
              Free tier is roughly 100 requests/month; this app caches for 6 hours.
            </p>
          </div>

          <div class="field" data-key-for="stormglass"${t.provider === 'stormglass' ? '' : ' hidden'}>
            <label for="t-sg">Stormglass key</label>
            <input type="password" id="t-sg" value="${esc(t.stormglassKey)}" placeholder="paste key here" autocomplete="off">
            <p class="field__hint">
              Sign up at <code>stormglass.io</code> → Dashboard → API key.
              Free tier is roughly 10 requests/day.
            </p>
          </div>

          <button class="btn btn--primary" id="saveTides">Save tide settings</button>
        </div>
      </div>
    </section>

    <section class="band band--cream">
      <div class="wrap">
        <div class="section-head"><h2>Your data</h2><p>Everything lives on this device</p></div>
        <div class="card">
          <p class="card__body">
            Catches are stored in this browser's IndexedDB. Clearing site data — or uninstalling
            the app from your home screen — deletes them. Export regularly if the log matters to you.
          </p>
          <div class="btn-row">
            <button class="btn btn--sm" id="exportBtn">Export JSON</button>
            <label class="btn btn--sm" style="cursor:pointer">
              Import JSON
              <input type="file" id="importInput" accept="application/json,.json" hidden>
            </label>
            <button class="btn btn--sm" id="clearBtn" style="color:#C1121F">Delete all catches</button>
          </div>
          <p class="field__hint">Export omits photos — JSON can't carry image data. Photos stay on the device only.</p>
          <div id="storageInfo" class="field__hint"></div>
        </div>
      </div>
    </section>

    <section class="band band--green">
      <div class="wrap">
        <div class="section-head"><h2>Regions</h2><p>${REGIONS.length} loaded</p></div>
        <div class="card">
          <ul style="margin:0;padding-left:20px;line-height:1.8;font-weight:700">
            ${REGIONS.map((r) => `<li>${esc(r.name)}, ${esc(r.country)} — ${(r.species || []).length} species, ${(r.spots || []).length} spots</li>`).join('')}
          </ul>
          <p class="card__body" style="margin-top:12px">
            To add a region, copy <code>js/data/regions/leyte.js</code>, edit it, then import it in
            <code>js/data/index.js</code>. The picker in the header appears automatically once there is
            more than one.
          </p>
        </div>
      </div>
    </section>

    <!-- Which build is this? A fair question on a PWA, where a stale service
         worker can leave a phone a week behind the site and say nothing. The
         cache name is read from the browser rather than printed from a
         constant, so it is evidence rather than a claim. -->
    <section class="band band--cream">
      <div class="wrap">
        <div class="section-head">
          <h2>Version</h2>
          <p>What this device is running</p>
        </div>
        <div class="card">
          <p class="version-line">
            Cole&rsquo;s Angler Log <strong id="appVersion">v${esc(APP_VERSION)}</strong>
          </p>
          <p class="field__hint" id="buildInfo">Checking what&rsquo;s cached&hellip;</p>

          <details class="version-history">
            <summary>Version history (${CHANGELOG.length} releases)</summary>
            <ol class="version-list">
              ${CHANGELOG.map(
                (r) => `
                <li class="version-item">
                  <div class="version-item__head">
                    <span class="chip chip--target">v${esc(r.version)}</span>
                    <span class="version-item__date">${esc(r.date)}</span>
                  </div>
                  <h3 class="version-item__title">${esc(r.title)}</h3>
                  <ul class="version-item__changes">
                    ${r.changes.map((c) => `<li>${esc(c)}</li>`).join('')}
                  </ul>
                </li>`
              ).join('')}
            </ol>
          </details>
        </div>
      </div>
    </section>`;
}

export function mount(root) {
  // --- account ---
  root.querySelector('#signOutBtn')?.addEventListener('click', () => {
    signOut();
    toast('Signed out');
    location.hash = '#/log';
  });

  // --- connected accounts ---
  const linkStatus = root.querySelector('#linkStatus');
  const say = (msg) => {
    if (linkStatus) linkStatus.textContent = msg;
  };

  root.querySelector('#syncNowBtn')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = 'Syncing…';
    const result = await syncNow();
    btn.disabled = false;
    btn.textContent = 'Sync now';

    if (result.ok) {
      const moved = (result.pushed || 0) + (result.pulled || 0);
      toast(moved ? `Synced ${moved} catch${moved === 1 ? '' : 'es'}` : 'Already up to date');
    } else if (result.reason === 'permission-denied') {
      // Worth naming rather than shrugging: it means Firestore was never set
      // up, which is a five-minute fix and not a bug in the app.
      toast('Cloud storage is not set up on the Firebase project yet');
    } else if (result.reason === 'offline') {
      toast('No connection — will sync later');
    } else {
      toast('Could not reach the cloud — will retry');
    }
  });

  for (const btn of root.querySelectorAll('[data-link]')) {
    btn.addEventListener('click', async () => {
      const name = btn.dataset.link;
      btn.disabled = true;
      btn.textContent = 'Opening…';
      say('');
      try {
        const profile = await linkProvider(name);
        if (!profile) {
          // Popup closed, or we've been sent off on a redirect.
          btn.disabled = false;
          btn.textContent = 'Connect';
          return;
        }
        toast(`${PROVIDER_LABEL[name] || name} connected`);
        location.hash = '#/settings';
        location.reload();
      } catch (err) {
        btn.disabled = false;
        btn.textContent = 'Connect';
        // credential-already-in-use is the one people actually hit: that
        // Google account is already its own separate account here.
        say(
          err?.code === 'auth/credential-already-in-use'
            ? 'That Google account already has its own log here. Sign in with it directly instead.'
            : err?.message || 'Could not connect that account.'
        );
      }
    });
  }

  // --- theme ---
  const themePicker = root.querySelector('#themePicker');
  const themeHint = root.querySelector('#themeHint');

  const describeTheme = () => {
    const choice = getTheme();
    themeHint.textContent =
      choice === 'system'
        ? `Following your phone — currently ${resolvedTheme()}.`
        : `Always ${choice}, whatever your phone is set to.`;
  };
  describeTheme();

  themePicker.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-theme-choice]');
    if (!btn) return;
    setTheme(btn.dataset.themeChoice);
    for (const b of themePicker.querySelectorAll('[data-theme-choice]')) {
      b.setAttribute('aria-pressed', String(b === btn));
    }
    describeTheme();
  });

  // --- weather ---
  const wProvider = root.querySelector('#w-provider');
  const owWrap = root.querySelector('#ow-key-wrap');
  wProvider.addEventListener('change', () => {
    owWrap.hidden = wProvider.value !== 'openweather';
  });

  root.querySelector('#saveWeather').addEventListener('click', () => {
    saveOverrides({
      weather: {
        provider: wProvider.value,
        openWeatherKey: root.querySelector('#w-key').value.trim(),
      },
    });
    toast('Weather settings saved');
  });

  // --- tides ---
  const tProvider = root.querySelector('#t-provider');
  const syncTideFields = () => {
    for (const f of root.querySelectorAll('[data-key-for]')) {
      f.hidden = f.dataset.keyFor !== tProvider.value;
    }
  };
  tProvider.addEventListener('change', syncTideFields);

  root.querySelector('#saveTides').addEventListener('click', () => {
    saveOverrides({
      tides: {
        provider: tProvider.value,
        worldTidesKey: root.querySelector('#t-wt').value.trim(),
        stormglassKey: root.querySelector('#t-sg').value.trim(),
      },
    });
    toast('Tide settings saved');
  });

  // --- data ---
  root.querySelector('#exportBtn').addEventListener('click', async () => {
    const json = await exportJson();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `angler-log-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast('Exported');
  });

  root.querySelector('#importInput').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const n = await importJson(await file.text());
      toast(`Imported ${n} catches`);
    } catch (err) {
      toast(err.message);
    }
    e.target.value = '';
  });

  root.querySelector('#clearBtn').addEventListener('click', async () => {
    if (!confirm('Delete every logged catch? This cannot be undone.')) return;
    await store.clearCatches();
    toast('All catches deleted');
  });

  // --- which build is actually installed ---
  //
  // The app version is a constant and only says what the code THINKS it is.
  // The cache name comes from the service worker that is really serving this
  // device, so the two disagreeing is exactly the situation worth seeing.
  const build = root.querySelector('#buildInfo');
  if (build) {
    (async () => {
      const bits = [];
      try {
        const names = (await caches.keys()).filter((n) => n.startsWith('angler-log-'));
        bits.push(names.length ? `cache ${names.sort().pop().replace('angler-log-', '')}` : 'not cached yet');
      } catch {
        bits.push('cache unavailable');
      }
      const reg = await navigator.serviceWorker?.getRegistration?.();
      bits.push(reg ? 'offline ready' : 'no service worker');
      build.textContent = bits.join(' · ');
    })();
  }

  // --- storage estimate ---
  const info = root.querySelector('#storageInfo');
  if (navigator.storage?.estimate) {
    navigator.storage.estimate().then(({ usage, quota }) => {
      if (!usage && !quota) return;
      const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;
      info.textContent = `Using ${mb(usage || 0)} of about ${mb(quota || 0)} available.`;
    });
  }
}
