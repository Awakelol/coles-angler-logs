// Photo identification: the "photo" mode of the Info page.
//
// Shows a live camera preview, but only sends a single still for
// identification. Running a model on every frame wouldn't help (the fish
// isn't moving), in-browser models don't know Indo-Pacific species, and a
// still can wait until there's signal.
//
// The camera often isn't available (no HTTPS, no camera, permission denied,
// in use), so the file picker is always shown as well.
//
// Recognition goes through /api/identify (the Cloudflare Worker in worker/) so
// API keys stay off the device. Fishial names the fish and the local catalogue
// checks it occurs here (identify-verdict.js). An LLM second opinion is
// optional; the result shows which path was used.

import { prepareMedia, LIMITS, fmtMB } from '../media.js';
import { getSpecies, localNames } from '../data/index.js';
import { speciesHero, icon } from '../art.js';
import { esc, toast, loadingBlock } from '../ui.js';

/** The panel markup; Info provides the surrounding page. */
export function identifyPanelHtml() {
  return `
    <div class="section-head" style="margin-top:8px">
      <h2>What did I catch?</h2>
      <p>Point the camera at a fish for a name — with the local ones people here use</p>
    </div>
    <div class="card identify">
      <div class="identify__stage" id="shot" data-mode="idle">
        <!-- muted + playsinline: otherwise iOS opens a fullscreen player -->
        <video id="camView" playsinline muted autoplay></video>
        <!-- framing guide -->
        <div class="identify__guide" aria-hidden="true"><span></span></div>
        <div class="identify__idle">
          ${icon('camera', { size: 108, palette: 'slate' })}
          <p class="card__sub" id="camMsg">Camera off</p>
        </div>
        <img id="camStill" alt="The fish you photographed" hidden>
      </div>

      <div class="identify__controls">
        <button class="btn btn--primary identify__start" id="camStart">Start camera</button>
        <button class="identify__shutter" id="camShoot" hidden
                aria-label="Take the photo"><span></span></button>
        <button class="btn btn--sm" id="clearPhoto" hidden>Retake</button>
      </div>

      <input type="file" id="fishPhoto" accept="image/*" hidden>
      <button class="identify__upload" id="uploadPhoto">
        ${icon('camera', { size: 18, palette: 'slate' })}
        Upload a photo instead
      </button>

      <p class="field__hint">
        Fill the frame with the fish, side-on, against a plain background if
        you can. Photos up to ${esc(fmtMB(LIMITS.imageBytes))}.
      </p>

      <div id="identifyResult"></div>
    </div>`;
}

/**
 * Wire up the panel. Returns a cleanup function that stops the camera and
 * revokes the preview URL. Info must call it when leaving photo mode, since
 * it switches modes with replaceState (no hashchange).
 */
export function mountIdentifyPanel(root) {
  const input = root.querySelector('#fishPhoto');
  const stage = root.querySelector('#shot');
  const video = root.querySelector('#camView');
  const still = root.querySelector('#camStill');
  const msg = root.querySelector('#camMsg');
  const start = root.querySelector('#camStart');
  const shoot = root.querySelector('#camShoot');
  const upload = root.querySelector('#uploadPhoto');
  const clear = root.querySelector('#clearPhoto');
  const result = root.querySelector('#identifyResult');

  let objectUrl = null;
  let stream = null;
  let dead = false;   // set by the cleanup, so a slow getUserMedia can't win

  const releaseUrl = () => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  };

  /** Stop all tracks (clearing the <video> alone leaves the camera on). */
  function stopCamera() {
    if (!stream) return;
    for (const track of stream.getTracks()) track.stop();
    stream = null;
    video.srcObject = null;
  }

  /** idle | live | still, exposed as a data attribute for CSS. */
  function setMode(mode) {
    stage.dataset.mode = mode;
    start.hidden = mode !== 'idle';
    shoot.hidden = mode !== 'live';
    clear.hidden = mode !== 'still';
    still.hidden = mode !== 'still';
  }

  async function openCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      // The upload button is still there; just explain why there's no preview.
      msg.textContent = 'No camera on this device — upload a photo below';
      start.hidden = true;
      return;
    }
    start.disabled = true;
    start.textContent = 'Starting…';
    try {
      // Prefer the rear camera, but don't require it (`exact` fails on laptops).
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } },
        audio: false,
      });
      if (dead) { stopCamera(); return; }   // unmounted while we waited
      video.srcObject = stream;
      await video.play().catch(() => {});
      setMode('live');
    } catch (err) {
      console.warn('[identify] camera', err);
      const denied = err?.name === 'NotAllowedError' || err?.name === 'SecurityError';
      msg.textContent = denied
        ? 'Camera blocked — allow it in your browser, or upload a photo below'
        : 'Camera unavailable — upload a photo below';
      setMode('idle');
    } finally {
      start.disabled = false;
      start.textContent = 'Start camera';
    }
  }

  /** Grab the current frame at the camera's native resolution. */
  function grabFrame() {
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) throw new Error('The camera is not ready yet.');
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(video, 0, 0, w, h);
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Could not read that frame.'))),
        'image/jpeg',
        0.92
      );
    });
  }

  function reset() {
    releaseUrl();
    still.removeAttribute('src');
    result.innerHTML = '';
    input.value = '';
    msg.textContent = 'Camera off';
    // Go straight back to the live preview if it's still running.
    setMode(stream ? 'live' : 'idle');
  }

  /** Shared by the shutter and the file picker. */
  async function handle(file, busyBtn, busyLabel) {
    const label = busyBtn?.textContent;
    if (busyBtn) { busyBtn.disabled = true; busyBtn.textContent = busyLabel; }
    shoot.disabled = true;
    try {
      // Same downscaling as catch photos.
      const media = await prepareMedia(file);
      releaseUrl();
      objectUrl = URL.createObjectURL(media.blob);
      still.src = objectUrl;
      setMode('still');
      await identify(media.blob, result);
    } catch (err) {
      console.error('[identify]', err);
      toast(err.message || 'Could not read that photo');
      reset();
    } finally {
      shoot.disabled = false;
      if (busyBtn) { busyBtn.disabled = false; busyBtn.textContent = label; }
    }
  }

  start.addEventListener('click', openCamera);
  clear.addEventListener('click', reset);
  upload.addEventListener('click', () => input.click());

  shoot.addEventListener('click', async () => {
    try {
      const frame = await grabFrame();
      // Keep the camera running so Retake is instant (and some browsers
      // re-prompt for permission after the track is released).
      await handle(new File([frame], 'catch.jpg', { type: 'image/jpeg' }), null, null);
    } catch (err) {
      toast(err.message || 'Could not take that photo');
    }
  });

  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file) handle(file, upload, 'Preparing…');
  });

  return () => {
    dead = true;
    stopCamera();
    releaseUrl();
  };
}

/** Blob -> base64 without the data: prefix. */
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
    // Offline is common on the water; not an error.
    pane.innerHTML = problemHtml(0, null);
    return;
  }

  pane.innerHTML = verdictHtml(data);
}

/** Colour by confidence so a weak guess doesn't look certain. */
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
