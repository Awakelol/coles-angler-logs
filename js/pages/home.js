// Home — orientation, conditions teaser, quick stats, featured species.

import { allSpecies, tipsFor } from '../data/index.js';
import { store, computeStats } from '../store.js';
import { speciesHero, icon } from '../pixel.js';
import { esc, round, fmtDate } from '../ui.js';

export function render(ctx) {
  const species = allSpecies(ctx.regionId);
  const featured = species.filter((s) => s.target).slice(0, 4);
  const tip = tipsFor(ctx.regionId)[0];

  return `
    <section class="band band--sky">
      <div class="wrap">
        <p class="eyebrow">A gift with a story &middot; ${esc(ctx.region.country)}</p>
        <h1 class="display">${esc(ctx.region.name)}</h1>
        <p class="subtitle">${esc(ctx.region.blurb || '')}</p>

        <div class="grid grid--3">
          <a class="card" href="#/map">
            <div class="row-between">
              <div>
                <h2 class="card__title">Fishing map</h2>
                <p class="card__sub">${(ctx.region.zones || []).length} zones &middot; species &amp; lures</p>
              </div>
              ${icon('boat', { size: 76, palette: 'ocean' })}
            </div>
            <span class="btn btn--sm btn--primary" style="align-self:flex-start">Open map</span>
          </a>

          <a class="card" href="#/conditions">
            <div class="row-between">
              <div>
                <h2 class="card__title">Conditions today</h2>
                <p class="card__sub">Wind, rain and tide movement</p>
              </div>
              ${icon('wave', { size: 76, palette: 'ocean' })}
            </div>
            <span class="btn btn--sm btn--primary" style="align-self:flex-start">Open dashboard</span>
          </a>

          <a class="card" href="#/log">
            <div class="row-between">
              <div>
                <h2 class="card__title">Log a catch</h2>
                <p class="card__sub">Build your personal records</p>
              </div>
              ${icon('hook', { size: 76, palette: 'sunset' })}
            </div>
            <span class="btn btn--sm btn--primary" style="align-self:flex-start">Add entry</span>
          </a>

        </div>
      </div>
    </section>

    <section class="band band--cream">
      <div class="wrap">
        <p class="eyebrow">Your season so far</p>
        <h2 class="display" style="font-size:clamp(26px,8vw,42px)">Records</h2>
        <div id="homeStats"></div>
      </div>
    </section>

    <section class="band band--yellow">
      <div class="wrap">
        <p class="eyebrow">${esc(ctx.region.name)}</p>
        <h2 class="display" style="font-size:clamp(28px,9vw,46px)">Target species</h2>
        <p class="subtitle">${species.length} species catalogued for this region.</p>
        <div class="grid grid--4">
          ${featured
            .map(
              (s) => `
            <a class="card species-card" href="#/info?open=${esc(s.id)}">
              <div class="species-card__art">${speciesHero(s, { size: 170 })}</div>
              <h3 class="card__title">${esc(s.common)}</h3>
              <p class="card__sub species-card__sci">${esc(s.scientific)}</p>
              ${
                s.local?.war?.[0]
                  ? `<div class="chips"><span class="chip chip--local">${esc(s.local.war[0])}</span></div>`
                  : ''
              }
            </a>`
            )
            .join('')}
        </div>
        <div class="center" style="margin-top:24px">
          <a class="btn btn--dark" href="#/info">Browse the full guide</a>
        </div>
      </div>
    </section>

    ${
      tip
        ? `<section class="band band--cream">
            <div class="wrap">
              <p class="eyebrow">Tip of the day</p>
              <article class="card tip-card" style="max-width:680px;margin:0 auto">
                <h3 class="card__title" style="font-size:20px">${esc(tip.title)}</h3>
                <p class="card__body">${esc(tip.body)}</p>
                <a class="btn btn--sm" href="#/info?tab=zones" style="align-self:flex-start">More tips</a>
              </article>
            </div>
          </section>`
        : ''
    }`;
}

export async function mount(root) {
  const pane = root.querySelector('#homeStats');
  const catches = await store.allCatches();
  const stats = computeStats(catches);

  if (!catches.length) {
    pane.innerHTML = `
      <div class="card empty">
        ${icon('trophy', { size: 100, palette: 'gold' })}
        <p>No catches logged yet — your records will build here.</p>
        <a class="btn btn--primary" href="#/log">Log your first catch</a>
      </div>`;
    return;
  }

  const recent = catches[0];
  pane.innerHTML = `
    <div class="grid grid--4">
      <div class="card kpi"><div class="kpi__v">${stats.total}</div><div class="kpi__k">Catches</div></div>
      <div class="card kpi"><div class="kpi__v">${stats.speciesCount}</div><div class="kpi__k">Species</div></div>
      <div class="card kpi"><div class="kpi__v">${
        stats.heaviest ? round(stats.heaviest.weightKg, 2) : '—'
      }</div><div class="kpi__k">Heaviest (kg)</div></div>
      <div class="card kpi"><div class="kpi__v">${esc(fmtDate(recent.date, { day: 'numeric', month: 'short' }))}</div><div class="kpi__k">Last trip</div></div>
    </div>`;
}
