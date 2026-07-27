// Tips — region-specific first, then general, filterable by tag.

import { tipsFor } from '../data/index.js';
import { icon } from '../pixel.js';
import { esc } from '../ui.js';

export function render(ctx) {
  const tips = tipsFor(ctx.regionId);
  const tags = [...new Set(tips.flatMap((t) => t.tags || []))].sort();

  return `
    <section class="band band--violet">
      <div class="wrap">
        <p class="eyebrow">${esc(ctx.region.name)} &amp; general</p>
        <h1 class="display">Tips</h1>
        <p class="subtitle">Local knowledge and habits worth keeping. Edit these in <code>js/data/tips.js</code> and your region file.</p>
        <div class="card card--tight">
          <div class="chips" id="tagFilters">
            <button class="chip" data-tag="" aria-pressed="true">All (${tips.length})</button>
            ${tags.map((t) => `<button class="chip" data-tag="${esc(t)}" aria-pressed="false">${esc(t)}</button>`).join('')}
          </div>
        </div>
      </div>
    </section>

    <section class="band band--cream">
      <div class="wrap"><div id="tipList"></div></div>
    </section>`;
}

export function mount(root, ctx) {
  const tips = tipsFor(ctx.regionId);
  const listPane = root.querySelector('#tipList');
  const filters = root.querySelector('#tagFilters');
  let tag = '';

  function draw() {
    const shown = tag ? tips.filter((t) => (t.tags || []).includes(tag)) : tips;

    if (!shown.length) {
      listPane.innerHTML = `<div class="empty">${icon('book', { size: 96, palette: 'slate' })}<p>No tips with that tag yet.</p></div>`;
      return;
    }

    listPane.innerHTML = `<div class="grid grid--2">${shown
      .map(
        (t) => `
        <article class="card tip-card${t.scope === 'General' ? ' tip-card--general' : ''}">
          <div class="chips">
            <span class="chip ${t.scope === 'General' ? 'chip--family' : 'chip--local'}">${esc(t.scope)}</span>
          </div>
          <h3 class="card__title">${esc(t.title)}</h3>
          <p class="card__body">${esc(t.body)}</p>
          <div class="chips">
            ${(t.tags || []).map((x) => `<span class="chip chip--tag">${esc(x)}</span>`).join('')}
          </div>
        </article>`
      )
      .join('')}</div>`;
  }

  filters.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-tag]');
    if (!btn) return;
    tag = btn.dataset.tag;
    for (const b of filters.querySelectorAll('[data-tag]')) b.setAttribute('aria-pressed', String(b === btn));
    draw();
  });

  draw();
}
