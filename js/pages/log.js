// Catch log + personal records.

import { store, computeStats } from '../store.js';
import {
  isSignedIn, currentUser, listUsers, signUp, signIn, signInWithGoogle,
  cloudConfigured, lastAuthError, clearAuthError, USERNAME_RULES,
} from '../auth.js';
import { allSpecies, getSpecies, getRegion } from '../data/index.js';
import { speciesSprite, icon, SPRITES } from '../pixel.js';
import { prepareMedia, ACCEPT_ATTR, LIMITS, fmtMB } from '../media.js';
import { esc, el, openSheet, toast, fmtDate, todayISO, round } from '../ui.js';

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

/** The sign-in / sign-up gate shown when nobody is signed in. */
function gateHtml() {
  const hasAccounts = listUsers().length > 0;
  return `
    <section class="band band--green">
      <div class="wrap">
        <p class="eyebrow">Your logbook</p>
        <h1 class="display">Catch log</h1>
        <p class="subtitle">Sign in so your catches stay yours. Several people can share this device, each with their own log.</p>
      </div>
    </section>

    <section class="band band--cream">
      <div class="wrap" style="max-width:460px">
        <div class="card">
          ${
            cloudConfigured()
              ? `<button class="btn btn--block" id="googleBtn" style="margin-bottom:6px">
                   <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                     <path fill="#4285F4" d="M23 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.2a5.3 5.3 0 0 1-2.3 3.5v2.9h3.7C21.7 18.9 23 15.9 23 12.3z"/>
                     <path fill="#34A853" d="M12 24c3.1 0 5.7-1 7.6-2.8l-3.7-2.9c-1 .7-2.3 1.1-3.9 1.1-3 0-5.5-2-6.4-4.7H1.8v3C3.7 21.4 7.6 24 12 24z"/>
                     <path fill="#FBBC05" d="M5.6 14.7a7.2 7.2 0 0 1 0-4.6v-3H1.8a12 12 0 0 0 0 10.6l3.8-3z"/>
                     <path fill="#EA4335" d="M12 4.8c1.7 0 3.2.6 4.4 1.7l3.3-3.3C17.7 1.2 15.1 0 12 0 7.6 0 3.7 2.6 1.8 6.1l3.8 3c.9-2.7 3.4-4.3 6.4-4.3z"/>
                   </svg>
                   Continue with Google
                 </button>
                 <p class="field__hint" style="text-align:center;margin-bottom:10px">
                   Syncs across your devices. Or use a device-only account below.
                 </p>
                 <hr style="border:0;border-top:var(--border-w-sm) solid var(--line);margin:0 0 14px">`
              : ''
          }
          <div class="chips" id="authTabs" style="margin-bottom:6px">
            <button class="chip" data-mode="signin" aria-pressed="${hasAccounts}">Sign in</button>
            <button class="chip" data-mode="signup" aria-pressed="${!hasAccounts}">Create account</button>
          </div>

          <form id="authForm" autocomplete="off">
            <div class="field">
              <label for="a-user">Username</label>
              <input type="text" id="a-user" name="username" required
                     autocapitalize="none" autocorrect="off" spellcheck="false"
                     placeholder="e.g. cole">
              <p class="field__hint" data-user-hint></p>
            </div>

            <div class="field">
              <label for="a-pass">Password</label>
              <input type="password" id="a-pass" name="password" required
                     placeholder="at least 4 characters">
            </div>

            <div class="field" data-confirm hidden>
              <label for="a-pass2">Confirm password</label>
              <input type="password" id="a-pass2" name="password2" placeholder="type it again">
            </div>

            <p class="field__hint" id="authError" role="alert" style="color:#C1121F"></p>
            <button type="submit" class="btn btn--primary btn--block" id="authSubmit">Sign in</button>
          </form>

          <div class="notice" style="margin-top:16px">
            <h3>Device-only accounts don't sync</h3>
            <p>
              A username and password here works with no internet and no setup,
              but the log stays on this phone. ${
                cloudConfigured()
                  ? 'Sign in with Google if you want it on more than one device.'
                  : 'Google sign-in is planned and will sync.'
              }
            </p>
            <h3 style="margin-top:10px">Read this before you pick a password</h3>
            <p>
              There's no server yet — accounts live only in this browser. This keeps
              logs separate between people sharing a phone; it is <strong>not</strong>
              security, and anyone with the unlocked device can get past it.
              <strong>Don't reuse a password from anywhere else.</strong>
            </p>
          </div>
        </div>
      </div>
    </section>`;
}

export function render(ctx) {
  if (!isSignedIn()) return gateHtml();

  const user = currentUser();
  return `
    <section class="band band--green">
      <div class="wrap">
        <p class="eyebrow">Signed in as ${esc(user.username)}</p>
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

/** Wires the sign-in / sign-up form. Returns true if it handled the mount. */
function mountGate(root, ctx) {
  const form = root.querySelector('#authForm');
  if (!form) return false;

  const tabs = root.querySelector('#authTabs');
  const confirmField = root.querySelector('[data-confirm]');
  const errorLine = root.querySelector('#authError');
  const submit = root.querySelector('#authSubmit');
  const userHint = root.querySelector('[data-user-hint]');

  let mode = listUsers().length ? 'signin' : 'signup';

  const applyMode = () => {
    confirmField.hidden = mode !== 'signup';
    submit.textContent = mode === 'signup' ? 'Create account' : 'Sign in';
    userHint.textContent = mode === 'signup' ? USERNAME_RULES.describe : '';
    errorLine.textContent = '';
    for (const b of tabs.querySelectorAll('[data-mode]')) {
      b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
    }
  };
  applyMode();

  // A failed redirect from a previous page load leaves a reason behind.
  const priorError = lastAuthError();
  if (priorError) {
    errorLine.textContent =
      `Google sign-in failed (${priorError.code || priorError.stage}). ${priorError.message}`;
    clearAuthError();
  }

  root.querySelector('#googleBtn')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const label = btn.innerHTML;
    btn.disabled = true;
    btn.textContent = 'Opening Google…';
    try {
      const profile = await signInWithGoogle();
      if (profile) {
        // Popup path: we're signed in without ever leaving the page.
        toast(`Signed in as ${profile.username}`);
        ctx.navigate('/log');
        return;
      }
      // Redirect path, or the popup was closed. Restore the button either way.
      btn.disabled = false;
      btn.innerHTML = label;
    } catch (err) {
      btn.disabled = false;
      btn.innerHTML = label;
      errorLine.textContent = err.code ? `${err.message} (${err.code})` : err.message;
    }
  });

  tabs.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-mode]');
    if (!btn || btn.dataset.mode === mode) return;
    mode = btn.dataset.mode;
    applyMode();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorLine.textContent = '';
    const fd = new FormData(form);
    const username = String(fd.get('username') || '').trim();
    const password = String(fd.get('password') || '');

    try {
      if (mode === 'signup') {
        if (password !== String(fd.get('password2') || '')) {
          throw new Error("Passwords don't match.");
        }
        const isFirstAccount = listUsers().length === 0;
        const user = await signUp(username, password);
        // Entries logged before profiles existed would otherwise vanish.
        if (isFirstAccount) {
          const adopted = await store.adoptOrphans(user.id);
          if (adopted) toast(`Welcome, ${user.username} — ${adopted} earlier catches are yours`);
          else toast(`Welcome, ${user.username}`);
        } else {
          toast(`Welcome, ${user.username}`);
        }
      } else {
        const user = await signIn(username, password);
        toast(`Signed in as ${user.username}`);
      }
      ctx.navigate('/log');
    } catch (err) {
      errorLine.textContent = err.message;
    }
  });

  return true;
}

export async function mount(root, ctx) {
  if (mountGate(root, ctx)) return;

  const user = currentUser();
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
    const catches = await store.allCatches(user.id);
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
