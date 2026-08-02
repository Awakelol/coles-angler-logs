// ---------------------------------------------------------------------------
// SHARED WEATHER UI
//
// The current-conditions card, the five-day strip, and the logic for deciding
// WHICH coordinates to show them for. Extracted so the Map and Conditions
// screens render identical weather from one implementation — two copies would
// drift the moment either changed.
// ---------------------------------------------------------------------------

import { describeCode, compass, windAdvice, isNight } from './api/weather.js';
import {
  getLocation, roundCoords, distanceKm, nearestPlace, geolocationSupported, withinBounds,
} from './api/geo.js';
import { prefs } from './store.js';
import { icon } from './art.js';
import { esc, fmtTime, fmtWeekday, round } from './ui.js';

export function weatherHtml(w, tz) {
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

/**
 * Five-day strip.
 * @param {boolean} compact drops the condition label and wind row and shrinks
 *        the icon — the map screen splits the viewport with the map itself and
 *        cannot afford the full-height version.
 */
export function forecastHtml(w, tz, { compact = false } = {}) {
  if (!w.daily?.length) return '<p class="card__sub">No forecast available.</p>';
  return `
    <div class="card${compact ? ' card--tight' : ''}">
      <div class="forecast${compact ? ' forecast--compact' : ''}">
        ${w.daily
          .map((d) => {
            const [desc, iconKey] = describeCode(d.code);
            return `
            <div class="fc-day">
              <div class="fc-day__d">${esc(fmtWeekday(d.date, tz))}</div>
              <div style="display:grid;place-items:center;margin:6px 0">
                ${icon(iconKey, { size: compact ? 28 : 46, palette: 'weather' })}
              </div>
              ${compact ? '' : `<div class="fc-day__c">${esc(desc)}</div>`}
              <div class="fc-day__t">${round(d.maxC, 0)}&deg;<small> / ${round(d.minC, 0)}&deg;</small></div>
              <div class="fc-day__p">${d.pop != null ? `${round(d.pop, 0)}% rain` : `${round(d.precipMm, 1)} mm`}</div>
              ${compact ? '' : `<div class="fc-day__p" style="color:var(--ink-30)">${round(d.windKph, 0)} km/h</div>`}
              <div class="sr-only">${esc(desc)}</div>
            </div>`;
          })
          .join('')}
      </div>
    </div>`;
}

/**
 * Which coordinates to use, and a human label for them.
 * Falls back to the region whenever the device can't or won't report a fix —
 * the screen must never end up with nothing to show.
 */
export async function resolveCoords(ctx) {
  // Tri-state on purpose. null means "never asked", so the first visit
  // prompts automatically, matching the map. Once the user has chosen — or
  // been refused — the stored true/false is respected and we stop asking.
  const choice = prefs.get('useMyLocation', null);
  if (choice === false || (choice === null && !geolocationSupported())) {
    return { coords: ctx.region.coords, label: ctx.region.name, source: 'region' };
  }
  try {
    const fix = await getLocation();

    // A fix from outside the country this region belongs to is a real
    // location and still the wrong one to show. Someone opening the app from
    // abroad wants to know what it's doing at home, not the weather where
    // they are standing — and a five-day forecast for another hemisphere is
    // worse than useless next to a map of Leyte. Being merely far from the
    // zones is fine: Manila is 600 km away and still somewhere this app can
    // sensibly answer for.
    if (!withinBounds(fix, ctx.region.map?.panBounds)) {
      return {
        coords: ctx.region.coords,
        label: `${ctx.region.name} · you're outside ${ctx.region.country || 'the region'}`,
        source: 'region',
        outsideCountry: true,
      };
    }

    // Snapped to a ~5 km grid so the tide API's monthly quota isn't spent on
    // GPS jitter. See js/api/geo.js.
    const coords = roundCoords(fix);
    prefs.set('useMyLocation', true);
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
      // Only nag when the user actively asked for location. On the automatic
      // first-visit attempt a refusal is an answer, not an error.
      warning: choice === true ? err.message : null,
    };
  }
}
