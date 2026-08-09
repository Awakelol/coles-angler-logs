// ---------------------------------------------------------------------------
// IDENTIFY — point the camera at a fish, find out what it is.
//
// A LIVE VIEWFINDER, but still a STILL sent for identification. Those are two
// different questions and only the first one changed:
//
//   * Live PREVIEW: yes. `capture="environment"` handed the whole job to the
//     OS camera app — you left the page, shot, came back, and the app had no
//     say in framing. In-page you can see the guide, hold the fish where it
//     belongs and shoot when it looks right.
//
//   * Live DETECTION, a model running per frame: still no, for the reasons
//     that have not changed. A fish in a bucket or on the line is not moving,
//     so per-frame inference buys nothing; the general-purpose browser models
//     classify ImageNet categories — "coho salmon", "tench" — which is useless
//     for Indo-Pacific reef fish, and one that isn't useless is too large to
//     ship to a phone on a boat; it would eat the battery on the one device
//     that has to last the trip. Above all a still can be taken now and
//     identified later, which matters more than anything else here: this app
//     is used where there is no signal, and a photo waits for one.
//
// So the shutter draws the current frame to a canvas and that still goes down
// the same pipeline the file picker always used.
//
// THE CAMERA CAN ALWAYS FAIL and it is not an edge case — no HTTPS, no camera,
// permission denied, or another app holding the device. Every one of those
// lands on the file picker, which is why the picker is a permanent control at
// the bottom rather than a fallback that appears in trouble. A photo already
// in the roll is a first-class way in: the good shot of the fish is often the
// one taken an hour ago on the boat.
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
      <p>Point the camera at a fish for a name — with the local ones people here use</p>
    </div>
    <div class="card identify">
      <div class="identify__stage" id="shot" data-mode="idle">
        <!-- muted + playsinline are not optional: without them iOS refuses to
             play inline and opens a fullscreen player over the app instead. -->
        <video id="camView" playsinline muted autoplay></video>
        <!-- Framing guide. The single biggest thing separating a photo that
             identifies from one that doesn't is the fish filling the frame
             side-on, so the app says so where you are looking rather than in
             help text under the button. -->
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

      <!-- Always here, never only in trouble: an existing photo is a normal
           way to use this, not a consolation for a camera that failed. -->
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
 * Wire the panel. Returns a cleanup that stops the camera and revokes the URL.
 *
 * The caller HAS to invoke it, and it matters more now than it did: a camera
 * left running is a light on the user's phone and a drain on the battery they
 * need for the trip. This used to lean on a one-shot `hashchange` listener,
 * which worked when leaving the page was the only way out — but Info switches
 * modes with replaceState, so no hashchange fires.
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

  /** Stop every track. Releasing the <video> alone leaves the light on. */
  function stopCamera() {
    if (!stream) return;
    for (const track of stream.getTracks()) track.stop();
    stream = null;
    video.srcObject = null;
  }

  /** idle | live | still — one attribute the CSS reads, so no class juggling. */
  function setMode(mode) {
    stage.dataset.mode = mode;
    start.hidden = mode !== 'idle';
    shoot.hidden = mode !== 'live';
    clear.hidden = mode !== 'still';
    still.hidden = mode !== 'still';
  }

  async function openCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      // Not a failure worth a toast: the upload button below does the job and
      // is already on screen. Say why the viewfinder isn't there and stop.
      msg.textContent = 'No camera on this device — upload a photo below';
      start.hidden = true;
      return;
    }
    start.disabled = true;
    start.textContent = 'Starting…';
    try {
      // The rear camera by preference, not by requirement: `exact` throws
      // outright on a laptop with only a front camera, and a webcam pointed at
      // a fish on the desk is a perfectly good photo.
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

  /** The current frame, at the camera's real resolution rather than the CSS box. */
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
    // Straight back to the viewfinder if it is still running — a retake that
    // makes you press "start camera" again is a retake you won't bother with.
    setMode(stream ? 'live' : 'idle');
  }

  /** The one path both the shutter and the file picker end in. */
  async function handle(file, busyBtn, busyLabel) {
    const label = busyBtn?.textContent;
    if (busyBtn) { busyBtn.disabled = true; busyBtn.textContent = busyLabel; }
    shoot.disabled = true;
    try {
      // Same pipeline the catch log uses — downscales and re-encodes, so a
      // 12 MP photo becomes something an API call can actually carry.
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
      // Keep the camera RUNNING through the identify. Stopping it here made
      // "Retake" a two-step cold start, and the permission prompt can come
      // back a second time on some browsers once the track is released.
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
