// ---------------------------------------------------------------------------
// IDENTIFY — photograph a fish, find out what it is.
//
// CAPTURE A STILL, don't run live detection. Deliberate, for four reasons:
//
//   1. A fish in a bucket or on the line is not moving. There is no moment to
//      catch, so per-frame inference buys nothing.
//   2. Live detection means a model running in the browser. The general-purpose
//      ones classify ImageNet categories — "coho salmon", "tench" — which is
//      useless for Indo-Pacific reef fish, and a model that isn't useless is
//      too large to ship to a phone on a boat.
//   3. It would eat the battery on the one device that has to last the trip.
//   4. A still can be taken now and identified later. That matters more than
//      anything else here: this app is used where there is no signal, and a
//      photo waits patiently for one.
//
// `capture="environment"` opens the rear camera directly on a phone, so the
// capture-a-still flow costs the user nothing versus a live viewfinder, while
// still allowing an existing photo to be picked on a desktop.
//
// Recognition goes through /api/identify, a Cloudflare Worker (worker/), so
// the API keys stay off this device. Fishial names the fish and the local
// catalogue checks whether that species occurs here at all — see
// js/identify-verdict.js. An AI second opinion is optional and costs money, so
// the response says which path ran and the screen repeats it: a free answer
// must never look like one that had a second opinion behind it.
//
// This is no longer a page of its own. It is the photo mode of Info, sitting
// beside the search box: naming a fish you are holding and looking one up by
// name are the same question asked two ways, so they belong behind the same
// control rather than on opposite sides of the app. `/identify` still resolves
// — it redirects to the mode. What lives here is the panel and its wiring;
// Info renders it.
// ---------------------------------------------------------------------------

import { prepareMedia, LIMITS, fmtMB } from '../media.js';
import { getSpecies, localNames } from '../data/index.js';
import { speciesHero, icon } from '../art.js';
import { esc, toast, loadingBlock } from '../ui.js';

/** The panel itself, with no page chrome — Info supplies that. */
export function identifyPanelHtml() {
  return `
    <div class="section-head" style="margin-top:8px">
      <h2>What did I catch?</h2>
      <p>Photograph a fish for a name — with the local ones people here use</p>
    </div>
    <div class="card identify">
      <div class="identify__shot" id="shot">
        ${icon('camera', { size: 120, palette: 'slate' })}
        <p class="card__sub">No photo yet</p>
      </div>

      <input type="file" id="fishPhoto" accept="image/*" capture="environment" hidden>
      <div class="btn-row">
        <button class="btn btn--primary" id="takePhoto">Take a photo</button>
        <button class="btn btn--sm" id="clearPhoto" hidden>Clear</button>
      </div>
      <p class="field__hint">
        Fill the frame with the fish, side-on, against a plain background if
        you can. Photos up to ${esc(fmtMB(LIMITS.imageBytes))}.
      </p>

      <div id="identifyResult"></div>
    </div>`;
}

/**
 * Wire the panel. Returns a cleanup that revokes the object URL.
 *
 * The caller has to invoke it. This used to lean on a one-shot `hashchange`
 * listener, which worked when leaving the page was the only way out — but Info
 * switches modes with replaceState, so no hashchange fires and the photo's
 * blob URL would be held until reload.
 */
export function mountIdentifyPanel(root) {
  const input = root.querySelector('#fishPhoto');
  const shot = root.querySelector('#shot');
  const take = root.querySelector('#takePhoto');
  const clear = root.querySelector('#clearPhoto');
  const result = root.querySelector('#identifyResult');

  let objectUrl = null;

  const release = () => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  };

  function reset() {
    release();
    shot.innerHTML = `${icon('camera', { size: 120, palette: 'slate' })}<p class="card__sub">No photo yet</p>`;
    result.innerHTML = '';
    clear.hidden = true;
    input.value = '';
  }

  take.addEventListener('click', () => input.click());
  clear.addEventListener('click', reset);

  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;

    take.disabled = true;
    take.textContent = 'Preparing…';

    try {
      // Same pipeline the catch log uses — downscales and re-encodes, so a
      // 12 MP phone photo becomes something an API call can actually carry.
      const media = await prepareMedia(file);
      release();
      objectUrl = URL.createObjectURL(media.blob);

      shot.innerHTML = `<img src="${objectUrl}" alt="The fish you photographed">`;
      clear.hidden = false;
      await identify(media.blob, result);
    } catch (err) {
      console.error('[identify]', err);
      toast(err.message || 'Could not read that photo');
      reset();
    } finally {
      take.disabled = false;
      take.textContent = 'Take a photo';
    }
  });

  return release;
}

/** Blob -> base64, without the data: prefix the API doesn't want. */
function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error('Could not read the photo.'));
    reader.readAsDataURL(blob);
  });
}

async function identify(blob, pane) {
  pane.innerHTML = loadingBlock('Looking at your photo…');

  let data;
  try {
    const res = await fetch('/api/identify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ image: await toBase64(blob), mime: blob.type || 'image/jpeg' }),
    });
    data = await res.json().catch(() => null);

    if (!res.ok) {
      pane.innerHTML = problemHtml(res.status, data);
      return;
    }
  } catch {
    // Offline is the normal case on the water, not an error worth shouting at.
    pane.innerHTML = problemHtml(0, null);
    return;
  }

  pane.innerHTML = verdictHtml(data);
}

/** Confidence drives the colour, so a low-confidence guess never looks certain. */
const TONE = { high: 'notice', medium: 'notice notice--warn', low: 'notice notice--warn' };

function verdictHtml(v) {
  if (!v || !v.answer) {
    return `
      <div class="notice notice--warn" style="margin-top:18px">
        <h3>No confident match</h3>
        <p style="margin:0">
          Nothing in the local catalogue matched well. Try a side-on shot
          with the whole fish in frame, or browse
          <a href="#/info">Info &rsaquo; Fishes</a>.
        </p>
      </div>`;
  }

  const species = v.speciesId ? getSpecies(v.speciesId) : null;
  const locals = species ? localNames(species).slice(0, 3) : [];

  return `
    <div class="verdict" style="margin-top:18px">
      <div class="${TONE[v.confidence] || 'notice notice--warn'}">
        <div class="verdict__head">
          ${species ? `<div class="verdict__art">${speciesHero(species, { size: 150 })}</div>` : ''}
          <div>
            <p class="eyebrow">${esc(v.confidence)} confidence${
              v.checkedBy ? ` &middot; ${esc(v.checkedBy)}` : ''
            }</p>
            <h3 style="margin:2px 0 4px">${esc(species ? species.common : v.answer)}</h3>
            <p class="card__sub species-card__sci">${esc(v.answer)}</p>
            ${
              locals.length
                ? `<div class="chips" style="margin-top:8px">${locals
                    .map((l) => `<span class="chip chip--local">${esc(l.name)}</span>`)
                    .join('')}</div>`
                : ''
            }
          </div>
        </div>

        ${v.note ? `<p class="card__body" style="margin:12px 0 0">${esc(v.note)}</p>` : ''}
        ${v.reasoning ? `<p class="card__body" style="margin:8px 0 0">${esc(v.reasoning)}</p>` : ''}
      </div>

      ${
        (v.alternatives || []).length
          ? `<h3 class="card__title" style="font-size:15px;margin:18px 0 8px">Could also be</h3>
             <ul class="provider-list">
               ${v.alternatives
                 .slice(0, 3)
                 .map(
                   (a) => `<li><span>${esc(a.scientific)}</span>
                     <span class="card__sub" style="text-align:right;max-width:60%">${esc(a.why)}</span></li>`
                 )
                 .join('')}
             </ul>`
          : ''
      }

      <div class="btn-row" style="margin-top:16px">
        ${
          v.speciesId
            ? `<a class="btn btn--primary" href="#/log?species=${esc(v.speciesId)}">Log this catch</a>
               <a class="btn btn--sm" href="#/info?open=${esc(v.speciesId)}">Species detail</a>`
            : '<a class="btn btn--sm" href="#/info">Browse the guide</a>'
        }
      </div>
      <p class="field__hint" style="margin-top:10px">
        A best guess from two models, not a determination. Check it against the
        species page before you record it.
      </p>
    </div>`;
}

function problemHtml(status, data) {
  const offline = status === 0;
  const unconfigured = status === 503;
  return `
    <div class="notice notice--warn" style="margin-top:18px">
      <h3>${offline ? 'No connection' : unconfigured ? 'Not set up yet' : "Couldn't identify that"}</h3>
      <p style="margin:0">
        ${
          offline
            ? 'The photo is fine — identification just needs a connection. Try again when you have signal.'
            : unconfigured
              ? 'The identification service has no API key configured yet. See README &rsaquo; Species identification.'
              : esc(data?.message || 'The service could not read that photo. Try another shot.')
        }
      </p>
    </div>`;
}
