// Weather + tide dashboard for the selected region.

import { fetchWeather, describeCode, compass, windAdvice, isNight } from '../api/weather.js';
import { fetchTides, currentTideState, nextExtremes, tidesConfigured } from '../api/tides.js';
import { getLocation, roundCoords, distanceKm, nearestPlace, geolocationSupported } from '../api/geo.js';
import { prefs } from '../store.js';
import { icon } from '../pixel.js';
import { esc, fmtTime, fmtWeekday, round, errorBlock, loadingBlock, toast } from '../ui.js';

export function render(ctx) {
  const usingLocation = prefs.get('useMyLocation', false);
  return `
    <section class="band band--sky">
      <div class="wrap">
        <p class="eyebrow" id="condSource">${esc(ctx.region.name)}</p>
        <h1 class="display">Conditions</h1>
        <p class="subtitle">Live weather and tide movement for where you're fishing.</p>

        ${
          geolocationSupported()
            ? `<div class="chips" id="sourceToggle" style="justify-content:center;margin-bottom:20px">
                 <button class="chip" data-source="region" aria-pressed="${!usingLocation}">
                   ${esc(ctx.region.name)}
                 </button>
                 <button class="chip" data-source="device" aria-pressed="${usingLocation}">
                   Use my location
                 </button>
               </div>`
            : ''
        }

        <div id="weatherPane">${loadingBlock('Fetching weather…')}</div>
      </div>
    </section>

    <section class="band band--cream">
      <div class="wrap">
        <div class="section-head"><h2>Tides</h2><p>Next highs and lows</p></div>
        <div id="tidePane">${loadingBlock('Fetching tides…')}</div>
      </div>
    </section>

    <section class="band band--yellow">
      <div class="wrap">
        <div class="section-head"><h2>5-day outlook</h2></div>
        <div id="forecastPane"></div>
      </div>
    </section>`;
}

function weatherHtml(w, tz) {
  const night = isNight(w.current.time, w.daily);
  const [desc, iconKey] = describeCode(w.current.code, night);
  const advice = windAdvice(w.current.windKph);

  return `
    <div class="now-card">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap">
        <div>
          <div class="now-card__temp">${round(w.current.tempC, 0)}&deg;</div>
          <div class="now-card__desc">${esc(desc)} &middot; feels ${round(w.current.feelsC, 0)}&deg;</div>
        </div>
        <div style="flex:none">${icon(iconKey, { size: 96, palette: 'weather' })}</div>
      </div>

      <div class="stat-grid">
        <div class="stat"><div class="stat__k">Wind</div><div class="stat__v">${round(w.current.windKph, 0)}<small style="font-size:12px"> km/h</small></div></div>
        <div class="stat"><div class="stat__k">Direction</div><div class="stat__v">${esc(compass(w.current.windDeg || 0))}</div></div>
        <div class="stat"><div class="stat__k">Rain now</div><div class="stat__v">${round(w.current.precipMm, 1)}<small style="font-size:12px"> mm</small></div></div>
        <div class="stat"><div class="stat__k">Humidity</div><div class="stat__v">${round(w.current.humidity, 0)}<small style="font-size:12px">%</small></div></div>
      </div>

      <div class="advice advice--${advice.level}">${esc(advice.label)}</div>
    </div>
    <p class="field__hint" style="margin-top:10px">
      Source: ${esc(w.provider)} &middot; updated ${esc(fmtTime(w.current.time, tz))}
    </p>`;
}

function forecastHtml(w, tz) {
  if (!w.daily?.length) return '<p class="card__sub">No forecast available.</p>';
  return `
    <div class="card">
      <div class="forecast">
        ${w.daily
          .map((d) => {
            const [desc, iconKey] = describeCode(d.code);
            return `
            <div class="fc-day">
              <div class="fc-day__d">${esc(fmtWeekday(d.date, tz))}</div>
              <div style="display:grid;place-items:center;margin:6px 0">
                ${icon(iconKey, { size: 46, palette: 'weather' })}
              </div>
              <div class="fc-day__c">${esc(desc)}</div>
              <div class="fc-day__t">${round(d.maxC, 0)}&deg;<small> / ${round(d.minC, 0)}&deg;</small></div>
              <div class="fc-day__p">${d.pop != null ? `${round(d.pop, 0)}% rain` : `${round(d.precipMm, 1)} mm`}</div>
              <div class="fc-day__p" style="color:var(--ink-30)">${round(d.windKph, 0)} km/h</div>
              <div class="sr-only">${esc(desc)}</div>
            </div>`;
          })
          .join('')}
      </div>
    </div>`;
}

function tideSetupHtml() {
  return `
    <div class="notice notice--warn">
      <h3>Tide data needs an API key</h3>
      <p>
        Weather works with no signup, but every global tide service requires a key.
        Pick one, then paste the key into <a href="#/settings">Settings</a>.
      </p>
      <ol>
        <li><strong>WorldTides</strong> — <code>worldtides.info</code>. Free tier around 100 requests/month. Best default.</li>
        <li><strong>Stormglass</strong> — <code>stormglass.io</code>. Free tier around 10 requests/day.</li>
      </ol>
      <p style="margin-top:10px">
        Responses are cached for 6 hours, so normal daily use stays inside the free tiers.
      </p>
      <a class="btn btn--sm btn--primary" href="#/settings" style="margin-top:12px">Open Settings</a>
    </div>`;
}

function tideHtml(t, tz) {
  const upcoming = nextExtremes(t.extremes, 6);
  const state = currentTideState(t.extremes);

  if (!upcoming.length) {
    return `<div class="notice"><h3>No tide predictions returned</h3>
      <p>The provider responded but had nothing for these coordinates. Try a nearby coastal point.</p></div>`;
  }

  return `
    ${
      state
        ? `<div class="card" style="margin-bottom:16px">
            <div class="row-between">
              <div>
                <p class="card__sub">Right now</p>
                <h3 class="card__title" style="font-size:22px">
                  ${esc(state.direction)}${state.movingFast ? ' &middot; moving fast' : ''}
                </h3>
              </div>
              <div style="text-align:right">
                <p class="card__sub">Next ${esc(state.to.type)}</p>
                <div style="font-weight:900">${esc(fmtTime(state.to.time, tz))}</div>
              </div>
            </div>
            ${
              state.progress === null
                ? ''
                : `<div class="tide-bar"><div class="tide-bar__fill" style="width:${Math.round(
                    state.progress * 100
                  )}%"></div></div>`
            }
            <p class="card__sub">
              ${state.minutesToNext} min away${
                state.progress === null
                  ? '.'
                  : ` &middot; ${
                      state.movingFast
                        ? 'Mid-tide flow — usually the best bite window.'
                        : 'Near slack water — flow is easing off.'
                    }`
              }
            </p>
          </div>`
        : ''
    }

    <div class="card">
      <div class="tide-list">
        ${upcoming
          .map(
            (e) => `
          <div class="tide-row">
            <div class="tide-row__badge tide-row__badge--${esc(e.type)}">${e.type === 'high' ? 'HIGH' : 'LOW'}</div>
            <div class="tide-row__main">
              <div class="tide-row__time">${esc(fmtTime(e.time, tz))}</div>
              <div class="tide-row__meta">${esc(fmtWeekday(e.time, tz))} &middot; ${round(e.heightM, 2)} m</div>
            </div>
          </div>`
          )
          .join('')}
      </div>
    </div>
    <p class="field__hint" style="margin-top:10px">
      Source: ${esc(t.provider)}${t.station ? ` &middot; station ${esc(t.station)}` : ''}${t.cached ? ' &middot; cached' : ''}
    </p>`;
}

/**
 * Which coordinates to use, and a human label for them.
 * Falls back to the region whenever the device can't or won't report a fix —
 * the screen must never end up with nothing to show.
 */
async function resolveCoords(ctx) {
  if (!prefs.get('useMyLocation', false)) {
    return { coords: ctx.region.coords, label: ctx.region.name, source: 'region' };
  }
  try {
    const fix = await getLocation();
    // Snapped to a ~5 km grid so the tide API's monthly quota isn't spent on
    // GPS jitter. See js/api/geo.js.
    const coords = roundCoords(fix);
    const near = nearestPlace(ctx.region, fix);
    const away = Math.round(distanceKm(fix, ctx.region.coords));
    const label = near && near.km < 25
      ? `Near ${near.name} · ±${fix.accuracyM} m`
      : `Your location · ${away} km from ${ctx.region.name}`;
    return { coords, label, source: 'device' };
  } catch (err) {
    prefs.set('useMyLocation', false);
    return {
      coords: ctx.region.coords,
      label: ctx.region.name,
      source: 'region',
      warning: err.message,
    };
  }
}

export async function mount(root, ctx) {
  const tz = ctx.region.timezone;
  const weatherPane = root.querySelector('#weatherPane');
  const forecastPane = root.querySelector('#forecastPane');
  const tidePane = root.querySelector('#tidePane');
  const sourceLabel = root.querySelector('#condSource');
  const toggle = root.querySelector('#sourceToggle');

  if (toggle) {
    toggle.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-source]');
      if (!btn) return;
      const wanted = btn.dataset.source === 'device';
      if (wanted === prefs.get('useMyLocation', false)) return;
      prefs.set('useMyLocation', wanted);
      for (const b of toggle.querySelectorAll('[data-source]')) {
        b.setAttribute('aria-pressed', String(b === btn));
      }
      weatherPane.innerHTML = loadingBlock(wanted ? 'Getting your location…' : 'Fetching weather…');
      tidePane.innerHTML = loadingBlock('Fetching tides…');
      mount(root, ctx);
    });
  }

  const { coords, label, warning } = await resolveCoords(ctx);
  if (sourceLabel) {
    sourceLabel.textContent = `${label} · ${round(coords.lat, 2)}°, ${round(coords.lon, 2)}°`;
  }
  if (warning) {
    toast(warning);
    if (toggle) {
      for (const b of toggle.querySelectorAll('[data-source]')) {
        b.setAttribute('aria-pressed', String(b.dataset.source === 'region'));
      }
    }
  }

  // Weather and tides are independent — a failure in one must not blank the other.
  fetchWeather(coords, tz)
    .then((w) => {
      weatherPane.innerHTML = weatherHtml(w, tz);
      forecastPane.innerHTML = forecastHtml(w, tz);
    })
    .catch((err) => {
      console.error('[weather]', err);
      weatherPane.innerHTML = errorBlock('Could not load weather', err.message, 'Try again');
      forecastPane.innerHTML = '';
      weatherPane.querySelector('[data-retry]')?.addEventListener('click', () => mount(root, ctx));
    });

  if (!tidesConfigured()) {
    tidePane.innerHTML = tideSetupHtml();
    return;
  }

  try {
    const t = await fetchTides(coords);
    tidePane.innerHTML = t.unconfigured ? tideSetupHtml() : tideHtml(t, tz);
  } catch (err) {
    console.error('[tides]', err);
    tidePane.innerHTML = errorBlock('Could not load tides', err.message, 'Try again');
    tidePane.querySelector('[data-retry]')?.addEventListener('click', () => mount(root, ctx));
  }
}
