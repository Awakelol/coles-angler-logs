// Catch log + personal records.

import { store, computeStats } from '../store.js';
import { allSpecies, getSpecies, getRegion } from '../data/index.js';
import { speciesSprite, icon, SPRITES } from '../pixel.js';
import { esc, el, openSheet, toast, fmtDate, todayISO, round } from '../ui.js';

const METHODS = ['Hand line', 'Rod & reel', 'Jigging', 'Casting lure', 'Trolling', 'Fly', 'Spearfishing', 'Net', 'Trap / pot', 'Other'];

// Photos are downscaled before storage — a modern phone photo is 3–8 MB and
// would fill the origin's storage quota within a couple of dozen catches.
const PHOTO_MAX_PX = 1280;
const PHOTO_QUALITY = 0.8;

function resizePhoto(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, PHOTO_MAX_PX / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Could not process that image'))),
        'image/jpeg',
        PHOTO_QUALITY
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That file is not a readable image'));
    };
    img.src = url;
  });
}

function speciesLabel(speciesId) {
  return getSpecies(speciesId)?.common || speciesId || 'Unknown species';
}

function thumbFor(entry) {
  if (entry.photo) {
    const url = URL.createObjectURL(entry.photo);
    return `<img src="${url}" alt="" data-objurl="${url}">`;
  }
  const species = getSpecies(entry.speciesId);
  return species ? speciesSprite(species, { size: 52 }) : icon('hook', { size: 40, palette: 'slate' });
}

function formHtml(ctx, entry) {
  const region = getRegion(entry?.regionId || ctx.regionId);
  const list = allSpecies(region.id);
  const preselect = entry?.speciesId || ctx.params.get('species') || '';

  return `
    <form id="catchForm">
      <div class="field">
        <label for="f-species">Species</label>
        <select id="f-species" name="speciesId" required>
          <option value="">Choose a species…</option>
          ${list
            .map(
              (s) =>
                `<option value="${esc(s.id)}"${s.id === preselect ? ' selected' : ''}>${esc(s.common)}${
                  s.local?.war?.[0] ? ` — ${esc(s.local.war[0])}` : ''
                }</option>`
            )
            .join('')}
          <option value="__other"${preselect === '__other' ? ' selected' : ''}>Other / not listed</option>
        </select>
      </div>

      <div class="field" id="otherWrap" hidden>
        <label for="f-other">Species name</label>
        <input type="text" id="f-other" name="speciesOther" value="${esc(entry?.speciesOther || '')}"
               placeholder="What did you catch?">
      </div>

      <div class="field-row">
        <div class="field">
          <label for="f-date">Date</label>
          <input type="date" id="f-date" name="date" required value="${esc(entry?.date || todayISO())}">
        </div>
        <div class="field">
          <label for="f-spot">Spot</label>
          <select id="f-spot" name="spotId">
            <option value="">Not specified</option>
            ${(region.spots || [])
              .map(
                (sp) =>
                  `<option value="${esc(sp.id)}"${sp.id === entry?.spotId ? ' selected' : ''}>${esc(sp.name)}</option>`
              )
              .join('')}
          </select>
        </div>
      </div>

      <div class="field-row">
        <div class="field">
          <label for="f-length">Length (cm)</label>
          <input type="number" id="f-length" name="lengthCm" min="0" step="0.1"
                 inputmode="decimal" value="${esc(entry?.lengthCm ?? '')}">
        </div>
        <div class="field">
          <label for="f-weight">Weight (kg)</label>
          <input type="number" id="f-weight" name="weightKg" min="0" step="0.01"
                 inputmode="decimal" value="${esc(entry?.weightKg ?? '')}">
        </div>
      </div>

      <div class="field-row">
        <div class="field">
          <label for="f-method">Method</label>
          <select id="f-method" name="method">
            <option value="">Not specified</option>
            ${METHODS.map(
              (m) => `<option value="${esc(m)}"${m === entry?.method ? ' selected' : ''}>${esc(m)}</option>`
            ).join('')}
          </select>
        </div>
        <div class="field">
          <label for="f-bait">Bait / lure</label>
          <input type="text" id="f-bait" name="bait" value="${esc(entry?.bait || '')}" placeholder="e.g. live tamban">
        </div>
      </div>

      <div class="field">
        <label for="f-notes">Notes</label>
        <textarea id="f-notes" name="notes" placeholder="Tide state, weather, what worked…">${esc(entry?.notes || '')}</textarea>
      </div>

      <div class="field">
        <label for="f-photo">Photo</label>
        <input type="file" id="f-photo" name="photo" accept="image/*">
        <p class="field__hint">Optional. Stored only on this device and resized to ${PHOTO_MAX_PX}px.</p>
        <div id="photoPreview"></div>
      </div>

      <div class="btn-row">
        <button type="submit" class="btn btn--primary btn--block">${entry ? 'Save changes' : 'Add catch'}</button>
      </div>
      ${entry ? '<button type="button" class="btn btn--ghost btn--block" data-delete style="margin-top:10px;color:#C1121F">Delete this catch</button>' : ''}
    </form>`;
}

function openCatchForm(ctx, entry, onDone) {
  openSheet(entry ? 'Edit catch' : 'New catch', () => formHtml(ctx, entry), (rootEl, close) => {
    const form = rootEl.querySelector('#catchForm');
    const speciesSel = form.querySelector('#f-species');
    const otherWrap = form.querySelector('#otherWrap');
    const photoInput = form.querySelector('#f-photo');
    const preview = form.querySelector('#photoPreview');

    let photoBlob = entry?.photo || null;
    let removePhoto = false;

    const syncOther = () => {
      otherWrap.hidden = speciesSel.value !== '__other';
    };
    speciesSel.addEventListener('change', syncOther);
    syncOther();

    function drawPreview() {
      if (!photoBlob) {
        preview.innerHTML = '';
        return;
      }
      const url = URL.createObjectURL(photoBlob);
      preview.innerHTML = `
        <div style="margin-top:10px;display:flex;gap:10px;align-items:center">
          <img src="${url}" alt="Catch photo preview"
               style="width:84px;height:84px;object-fit:cover;border:3px solid var(--line);border-radius:14px">
          <button type="button" class="btn btn--sm" data-drop-photo>Remove photo</button>
        </div>`;
      preview.querySelector('[data-drop-photo]').addEventListener('click', () => {
        URL.revokeObjectURL(url);
        photoBlob = null;
        removePhoto = true;
        photoInput.value = '';
        drawPreview();
      });
    }
    drawPreview();

    photoInput.addEventListener('change', async () => {
      const file = photoInput.files?.[0];
      if (!file) return;
      try {
        photoBlob = await resizePhoto(file);
        removePhoto = false;
        drawPreview();
      } catch (err) {
        toast(err.message);
        photoInput.value = '';
      }
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const speciesId = fd.get('speciesId');

      if (!speciesId) {
        toast('Pick a species first');
        return;
      }

      const record = {
        ...(entry || {}),
        regionId: entry?.regionId || ctx.regionId,
        speciesId,
        speciesOther: speciesId === '__other' ? String(fd.get('speciesOther') || '').trim() : '',
        date: fd.get('date') || todayISO(),
        spotId: fd.get('spotId') || '',
        lengthCm: fd.get('lengthCm') ? Number(fd.get('lengthCm')) : null,
        weightKg: fd.get('weightKg') ? Number(fd.get('weightKg')) : null,
        method: fd.get('method') || '',
        bait: String(fd.get('bait') || '').trim(),
        notes: String(fd.get('notes') || '').trim(),
      };

      if (photoBlob) record.photo = photoBlob;
      else if (removePhoto) delete record.photo;

      try {
        await store.saveCatch(record);
        close();
        toast(entry ? 'Catch updated' : 'Catch logged');
        onDone();
      } catch (err) {
        console.error('[saveCatch]', err);
        toast('Could not save — storage may be full');
      }
    });

    form.querySelector('[data-delete]')?.addEventListener('click', async () => {
      if (!confirm('Delete this catch? This cannot be undone.')) return;
      await store.deleteCatch(entry.id);
      close();
      toast('Catch deleted');
      onDone();
    });
  });
}

export function render(ctx) {
  return `
    <section class="band band--green">
      <div class="wrap">
        <p class="eyebrow">Personal records</p>
        <h1 class="display">Catch log</h1>
        <p class="subtitle">Every fish you log sharpens the pattern for the next trip.</p>
        <div class="center"><button class="btn btn--dark" id="addCatch">+ Log a catch</button></div>
      </div>
    </section>

    <section class="band band--cream">
      <div class="wrap">
        <div id="statsPane"></div>
      </div>
    </section>

    <section class="band band--sky">
      <div class="wrap">
        <div class="section-head row-between">
          <div><h2>Your catches</h2><p id="catchCount"></p></div>
        </div>
        <div id="catchList"></div>
      </div>
    </section>

    <section class="band band--cream">
      <div class="wrap">
        <div class="section-head"><h2>Biggest by species</h2><p>Your personal best for each fish</p></div>
        <div id="recordsPane"></div>
      </div>
    </section>`;
}

export async function mount(root, ctx) {
  const statsPane = root.querySelector('#statsPane');
  const listPane = root.querySelector('#catchList');
  const recordsPane = root.querySelector('#recordsPane');
  const countLabel = root.querySelector('#catchCount');

  // Object URLs created for thumbnails must be released on redraw.
  let liveUrls = [];
  function releaseUrls() {
    for (const u of liveUrls) URL.revokeObjectURL(u);
    liveUrls = [];
  }

  async function refresh() {
    releaseUrls();
    const catches = await store.allCatches();
    const stats = computeStats(catches);

    statsPane.innerHTML = `
      <div class="grid grid--4">
        <div class="card kpi"><div class="kpi__v">${stats.total}</div><div class="kpi__k">Catches</div></div>
        <div class="card kpi"><div class="kpi__v">${stats.speciesCount}</div><div class="kpi__k">Species</div></div>
        <div class="card kpi"><div class="kpi__v">${
          stats.heaviest ? round(stats.heaviest.weightKg, 2) : '—'
        }</div><div class="kpi__k">Heaviest (kg)</div></div>
        <div class="card kpi"><div class="kpi__v">${
          stats.longest ? round(stats.longest.lengthCm, 1) : '—'
        }</div><div class="kpi__k">Longest (cm)</div></div>
      </div>`;

    countLabel.textContent = catches.length ? `${catches.length} logged` : '';

    if (!catches.length) {
      listPane.innerHTML = `
        <div class="card empty">
          ${icon('boat', { size: 110, palette: 'ocean' })}
          <p>No catches logged yet. Your first entry starts the record.</p>
          <button class="btn btn--primary" data-add>Log your first catch</button>
        </div>`;
      listPane.querySelector('[data-add]').addEventListener('click', () => openCatchForm(ctx, null, refresh));
      recordsPane.innerHTML = '<p class="card__sub">Personal bests appear once you have logged a catch.</p>';
      return;
    }

    listPane.innerHTML = `<div class="grid grid--2">${catches
      .map((c) => {
        const region = getRegion(c.regionId);
        const spot = (region.spots || []).find((s) => s.id === c.spotId);
        const name = c.speciesId === '__other' ? c.speciesOther || 'Unlisted species' : speciesLabel(c.speciesId);
        const bits = [
          fmtDate(c.date),
          spot?.name,
          c.weightKg ? `${round(c.weightKg, 2)} kg` : null,
          c.lengthCm ? `${round(c.lengthCm, 1)} cm` : null,
          c.method,
        ].filter(Boolean);
        return `
          <button class="card catch-row" data-edit="${esc(c.id)}">
            <div class="catch-row__thumb">${thumbFor(c)}</div>
            <div class="catch-row__main">
              <div class="catch-row__name">${esc(name)}</div>
              <div class="catch-row__meta">${esc(bits.join(' · '))}</div>
              ${c.bait ? `<div class="catch-row__meta">Bait: ${esc(c.bait)}</div>` : ''}
            </div>
          </button>`;
      })
      .join('')}</div>`;

    for (const img of listPane.querySelectorAll('img[data-objurl]')) liveUrls.push(img.dataset.objurl);

    for (const btn of listPane.querySelectorAll('[data-edit]')) {
      btn.addEventListener('click', async () => {
        const entry = await store.getCatch(btn.dataset.edit);
        if (entry) openCatchForm(ctx, entry, refresh);
      });
    }

    const records = [...stats.biggestBySpecies.entries()];
    recordsPane.innerHTML = records.length
      ? `<div class="grid grid--3">${records
          .map(([speciesId, c]) => {
            const species = getSpecies(speciesId);
            const name = speciesId === '__other' ? c.speciesOther || 'Unlisted' : speciesLabel(speciesId);
            const art = species ? speciesSprite(species, { size: 120 }) : icon('trophy', { size: 90, palette: 'gold' });
            return `
              <div class="card">
                <div class="species-card__art">${art}</div>
                <h3 class="card__title">${esc(name)}</h3>
                <p class="card__sub">
                  ${c.weightKg ? `${round(c.weightKg, 2)} kg` : ''}${c.weightKg && c.lengthCm ? ' · ' : ''}${
              c.lengthCm ? `${round(c.lengthCm, 1)} cm` : ''
            }${!c.weightKg && !c.lengthCm ? 'No measurements recorded' : ''}
                </p>
                <p class="card__sub">${esc(fmtDate(c.date))} · ${stats.bySpecies.get(speciesId)} caught</p>
              </div>`;
          })
          .join('')}</div>`
      : '<p class="card__sub">Add a weight or length to a catch to start tracking bests.</p>';
  }

  root.querySelector('#addCatch').addEventListener('click', () => openCatchForm(ctx, null, refresh));

  await refresh();

  // Deep link from a species card: #/log?species=<id>&new=1
  if (ctx.params.get('species')) openCatchForm(ctx, null, refresh);
}
