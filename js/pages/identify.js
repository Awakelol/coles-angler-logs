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
// The identification step is NOT built yet — see the notice this page renders.
// Everything up to and including the photo is real, because that half is the
// same whichever service ends up doing the recognising.
// ---------------------------------------------------------------------------

import { prepareMedia, LIMITS, fmtMB } from '../media.js';
import { icon } from '../pixel.js';
import { esc, toast } from '../ui.js';

export function render() {
  return `
    <section class="band band--sky">
      <div class="wrap">
        <p class="eyebrow">Species recognition</p>
        <h1 class="display">What did I catch?</h1>
        <p class="subtitle">
          Take a photo of the fish and get a name for it — with the local names
          people here actually use.
        </p>
      </div>
    </section>

    <section class="band band--cream">
      <div class="wrap">
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
        </div>
      </div>
    </section>`;
}

export function mount(root) {
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
      result.innerHTML = pendingHtml();
    } catch (err) {
      console.error('[identify]', err);
      toast(err.message || 'Could not read that photo');
      reset();
    } finally {
      take.disabled = false;
      take.textContent = 'Take a photo';
    }
  });

  window.addEventListener('hashchange', release, { once: true });
}

/**
 * What the user sees once a photo is ready.
 *
 * Says plainly that recognition isn't wired up yet rather than spinning
 * forever or inventing an answer — a screen that pretends to identify a fish
 * and doesn't is worse than one that admits it can't.
 */
function pendingHtml() {
  return `
    <div class="notice notice--warn" style="margin-top:18px">
      <h3>Recognition isn't connected yet</h3>
      <p>
        The photo is ready and the camera half works. What's missing is the
        service that looks at it — that's the next piece of work, and it needs
        a key kept off this device.
      </p>
      <p style="margin-bottom:0">
        In the meantime you can search by eye in
        <a href="#/info">Info &rsaquo; Fishes</a>, or attach this photo to a
        catch in <a href="#/log">the log</a>.
      </p>
    </div>`;
}
