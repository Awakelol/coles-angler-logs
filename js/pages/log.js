// Catch log + personal records.

import { store, computeStats } from '../store.js';
import { currentUser } from '../auth.js';
import { allSpecies, getSpecies, getRegion } from '../data/index.js';
import { speciesSprite, icon, SPRITES } from '../art.js';
import { prepareMedia, ACCEPT_ATTR, LIMITS, fmtMB } from '../media.js';
import { syncNow, syncSoon, lastSyncedAt } from '../sync.js';
import { esc, el, openSheet, toast, fmtDate, todayISO, round } from '../ui.js';
import { authCardHtml, mountAuthCard, authHeading, isGuest, setGuest } from '../auth-ui.js';

const METHODS = ['Hand line', 'Rod & reel', 'Jigging', 'Casting lure', 'Trolling', 'Fly', 'Spearfishing', 'Net', 'Trap / pot', 'Other'];

function speciesLabel(speciesId) {
  return getSpecies(speciesId)?.common || speciesId || 'Unknown species';
}

function thumbFor(entry) {
  if (entry.photo) {
    const url = URL.createObjectURL(entry.photo);
    return `<img src="${url}" alt="" data-objurl="${url}">`;
  }
  if (entry.video) {
    // Poster frame, not a <video> — a list of decoding clips is brutal on a phone.
    if (entry.poster) {
      const url = URL.createObjectURL(entry.poster);
      return `<img src="${url}" alt="" data-objurl="${url}" class="is-video">`;
    }
    return icon('boat', { size: 40, palette: 'ocean' });
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
        <label for="f-photo">Photo or clip</label>
        <label class="btn btn--sm" style="cursor:pointer;align-self:flex-start">
          Choose a file
          <input type="file" id="f-photo" name="photo" accept="${ACCEPT_ATTR}" hidden>
        </label>
        <p class="field__hint">
          Optional, kept on this device only. Photos are resized to ${LIMITS.imageMaxPx}px.
          Clips must be ${LIMITS.videoSeconds}s or shorter and under ${fmtMB(LIMITS.videoBytes)} —
          video can't be compressed in a browser, so longer ones have to be trimmed first.
        </p>
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

    // Existing entries may carry a photo, a clip, or neither.
    let media = entry?.video
      ? { kind: 'video', blob: entry.video, poster: entry.poster || null }
      : entry?.photo
        ? { kind: 'image', blob: entry.photo, poster: null }
        : null;
    let removeMedia = false;

    const syncOther = () => {
      otherWrap.hidden = speciesSel.value !== '__other';
    };
    speciesSel.addEventListener('change', syncOther);
    syncOther();

    function drawPreview() {
      preview.innerHTML = '';
      if (!media) return;

      // Video shows its poster frame rather than a live <video>, which keeps
      // the form light; the clip itself plays from the saved entry.
      const shown = media.kind === 'video' ? media.poster : media.blob;
      const url = shown ? URL.createObjectURL(shown) : null;

      const box = el(`
        <div style="margin-top:10px;display:flex;gap:10px;align-items:center">
          <div class="media-thumb${media.kind === 'video' ? ' media-thumb--video' : ''}">
            ${url ? `<img src="${url}" alt="Attached ${media.kind}">` : ''}
          </div>
          <div>
            <p class="card__sub" style="margin-bottom:6px">
              ${media.kind === 'video' ? 'Clip' : 'Photo'} · ${fmtMB(media.blob.size)}
            </p>
            <button type="button" class="btn btn--sm" data-drop-photo>Remove</button>
          </div>
        </div>`);

      preview.appendChild(box);
      box.querySelector('[data-drop-photo]').addEventListener('click', () => {
        if (url) URL.revokeObjectURL(url);
        media = null;
        removeMedia = true;
        photoInput.value = '';
        drawPreview();
      });
    }
    drawPreview();

    photoInput.addEventListener('change', async () => {
      const file = photoInput.files?.[0];
      if (!file) return;
      try {
        media = await prepareMedia(file);
        removeMedia = false;
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
        // Stamped on write so a catch always belongs to whoever logged it.
        userId: entry?.userId || currentUser()?.id || null,
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

      // Only one attachment per catch, so switching kinds clears the other.
      if (media?.kind === 'image') {
        record.photo = media.blob;
        delete record.video;
        delete record.poster;
      } else if (media?.kind === 'video') {
        record.video = media.blob;
        record.poster = media.poster || null;
        delete record.photo;
      } else if (removeMedia) {
        delete record.photo;
        delete record.video;
        delete record.poster;
      }

      try {
        await store.saveCatch(record);
        close();
        toast(entry ? 'Catch updated' : 'Catch logged');
        onDone();
        syncSoon();
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
      syncSoon();
    });
  });
}

// --- sign-in / sign-up gate --------------------------------------------------
//
// Two screens rather than tabs: signing in is the common case and should be
// the shortest path, while creating an account asks more and deserves its own
// page. Which one is showing lives here rather than in the router, so the
// browser Back button still means "leave the log", not "go back a form step".

function gateHtml() {
  const { eyebrow, title, blurb } = authHeading();
  return `
    <section class="band band--green">
      <div class="wrap">
        <p class="eyebrow">${esc(eyebrow)}</p>
        <h1 class="display">${esc(title)}</h1>
        <p class="subtitle">${esc(blurb)}</p>
      </div>
    </section>

    <section class="band band--cream">
      <div class="wrap" style="max-width:440px">
        ${authCardHtml()}
      </div>
    </section>`;
}

export function render(ctx) {
  const user = currentUser();
  if (!user && !isGuest()) return gateHtml();

  return `
    <section class="band band--green">
      <div class="wrap">
        <p class="eyebrow">${user ? `Signed in as ${esc(user.username)}` : 'Guest'}</p>
        <h1 class="display">Catch log</h1>
        <p class="subtitle">Every fish you log sharpens the pattern for the next trip.</p>
        <div class="center"><button class="btn btn--dark" id="addCatch">+ Log a catch</button></div>
        <p class="sync-line" id="syncLine" data-state="${user?.syncs ? 'idle' : 'local'}">${
          !user
            ? 'Logging as a guest — these catches join the first account you make'
            : user.syncs
              ? 'Backed up to your account'
              : 'On this device only — sign in with a connection to back it up'
        }</p>
        ${
          user
            ? ''
            : '<div class="center" style="margin-top:12px"><button class="btn btn--sm" id="leaveGuest">Sign in or create an account</button></div>'
        }
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
  // The heading lives in the band above the card, so a swap between sign in
  // and sign up has to re-render the route rather than just the card.
  if (mountAuthCard(root, {
    onDone: () => ctx.navigate('/log'),
    onSwap: () => ctx.navigate('/log'),
  })) return;

  // Signing in is what ends guest mode — the flag would otherwise keep the
  // gate hidden after a sign-out, which is the one time it must come back.
  root.querySelector('#leaveGuest')?.addEventListener('click', () => {
    setGuest(false);
    ctx.navigate('/log');
  });

  const user = currentUser();
  const statsPane = root.querySelector('#statsPane');
  const listPane = root.querySelector('#catchList');
  const recordsPane = root.querySelector('#recordsPane');
  const countLabel = root.querySelector('#catchCount');
  const syncLine = root.querySelector('#syncLine');

  /**
   * Say what sync is doing, in words about the log rather than the network.
   * Silence is the wrong answer here: a person who signed in expecting their
   * catches to follow them deserves to know when they haven't.
   */
  function showSync(state, text) {
    if (!syncLine) return;
    syncLine.dataset.state = state;
    syncLine.textContent = text;
  }

  const SYNC_TROUBLE = {
    offline: 'No connection — your catches are saved here and will upload later',
    'permission-denied': 'Cloud storage is not set up yet — saved on this device',
    'signed-out': 'Saved on this device',
    unconfigured: 'Saved on this device',
    'sdk-unavailable': 'Could not reach the cloud — saved here and will retry',
    failed: 'Could not reach the cloud — saved here and will retry',
  };

  // Object URLs created for thumbnails must be released on redraw.
  let liveUrls = [];
  function releaseUrls() {
    for (const u of liveUrls) URL.revokeObjectURL(u);
    liveUrls = [];
  }

  async function refresh() {
    releaseUrls();
    const catches = await store.allCatches(user ? user.id : null);
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

  // Pull anything logged on another device. After the first render, so the
  // catches already here appear immediately rather than behind a round trip.
  if (user?.syncs) {
    showSync('busy', 'Checking for catches from your other devices…');
    const result = await syncNow();

    if (!result.ok) {
      showSync('warn', SYNC_TROUBLE[result.reason] || SYNC_TROUBLE.failed);
      return;
    }

    if (result.pulled) await refresh();

    const when = lastSyncedAt();
    showSync(
      'idle',
      result.pulled
        ? `Added ${result.pulled} catch${result.pulled === 1 ? '' : 'es'} from your other devices`
        : `Backed up to your account${when ? ` · ${fmtDate(when.slice(0, 10))}` : ''}`
    );
  }
}
