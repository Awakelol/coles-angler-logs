// ---------------------------------------------------------------------------
// AVATAR CROPPER — choose which part of the photo becomes the circle.
//
// The old flow centre-cropped a square and that was the whole story: hold the
// camera slightly off and your face ended up against the edge with a shoulder
// in the middle, and there was nothing you could do about it. Now you drag and
// zoom until it looks right.
//
// THE MASK IS A CIRCLE, NOT A SQUARE, because the avatar is round everywhere it
// appears. A square guide asks you to imagine the corners being cut off, and
// people frame for the square they can see rather than the circle they get —
// so hair and chins end up clipped. The circle is the promise; what is outside
// it is dimmed rather than hidden, because you still need to see what you are
// dragging.
//
// WHAT IT PRODUCES is exactly what prepareAvatar() produced: a square JPEG no
// larger than 256px. Only the choice of which square changed, so nothing
// downstream — storage, the manifest, sync — knows this exists.
//
// The maths is deliberately in stage pixels rather than image pixels. `scale`
// is how many screen pixels one image pixel occupies, `ox/oy` are the image's
// top-left corner in stage space, and the visible square is always [0,D]. That
// makes the clamp a two-line max/min instead of a coordinate-system argument,
// and the source rect falls out by dividing by scale.
// ---------------------------------------------------------------------------

import { LIMITS, fmtMB } from './media.js';
import { openSheet, toast } from './ui.js';

const OUT = 256; // matches prepareAvatar(), so nothing downstream changes
const MAX_ZOOM = 4;

/**
 * Load a File into an HTMLImageElement and hand back the object URL with it.
 *
 * THE URL IS NOT REVOKED HERE, and that is the whole point. Revoking on load
 * leaves a perfectly good decoded image whose `.src` is a dead reference — the
 * canvas still draws from it, so cropping worked and the saved avatar was
 * right, while the stage showed an empty circle. The caller revokes when the
 * sheet closes.
 */
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That image could not be read. Try saving it as JPEG first.'));
    };
    img.src = url;
  });
}

/**
 * Open the cropper. Resolves with a square JPEG Blob, or null if cancelled.
 *
 * Rejects only on a photo that cannot be used at all — too big, or not an
 * image. Cancelling is a normal outcome and resolves rather than throws, so
 * callers do not have to tell "changed their mind" apart from "broken file".
 */
export async function cropAvatar(file) {
  if (!file || !String(file.type || '').startsWith('image/')) {
    throw new Error('Choose a photo for your profile picture.');
  }
  if (file.size > LIMITS.imageBytes) {
    throw new Error(`That photo is ${fmtMB(file.size)}; the limit is ${fmtMB(LIMITS.imageBytes)}.`);
  }

  const { img, url } = await loadImage(file);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      resolve(value);
    };

    openSheet(
      'Position your photo',
      () => `
        <div class="crop">
          <div class="crop__stage" data-stage>
            <img class="crop__img" data-img alt="" draggable="false">
            <!-- Dim outside, ring on the line. The ring is what people frame
                 to, so it is drawn at full strength while everything outside
                 it is pushed back. -->
            <div class="crop__mask" aria-hidden="true"></div>
          </div>
          <label class="crop__zoom">
            <span class="crop__zoom-k">Zoom</span>
            <input type="range" data-zoom min="1" max="${MAX_ZOOM}" step="0.01" value="1"
                   aria-label="Zoom">
          </label>
          <p class="field__hint crop__hint">
            Drag the photo to move it. Pinch, scroll or use the slider to zoom.
          </p>
          <div class="crop__acts">
            <button type="button" class="btn btn--primary" data-use>Use photo</button>
            <button type="button" class="btn btn--sm" data-cancel>Cancel</button>
          </div>
        </div>`,
      (root, close) => {
        const stage = root.querySelector('[data-stage]');
        const el = root.querySelector('[data-img]');
        const zoom = root.querySelector('[data-zoom]');
        el.src = url;

        // D is read after layout: the stage is a CSS square whose size depends
        // on the viewport, and guessing it would put the circle off-centre on
        // a small phone.
        let D = 0;
        let base = 1; // scale at which the image exactly covers the stage
        let z = 1;
        let ox = 0;
        let oy = 0;

        const scale = () => base * z;

        /** Keep the image covering the stage — no empty corners, ever. */
        const clamp = () => {
          const w = img.naturalWidth * scale();
          const h = img.naturalHeight * scale();
          ox = Math.min(0, Math.max(D - w, ox));
          oy = Math.min(0, Math.max(D - h, oy));
        };

        const draw = () => {
          clamp();
          el.style.width = `${img.naturalWidth * scale()}px`;
          el.style.height = `${img.naturalHeight * scale()}px`;
          el.style.transform = `translate3d(${ox}px, ${oy}px, 0)`;
        };

        const layout = () => {
          const box = stage.getBoundingClientRect();
          if (!box.width) return;
          const prev = D;
          D = box.width;
          base = D / Math.min(img.naturalWidth, img.naturalHeight);
          // Keep the centre of the crop put when the stage resizes, rather
          // than snapping back to the middle of the photo.
          if (prev) {
            const k = D / prev;
            ox *= k;
            oy *= k;
          } else {
            ox = (D - img.naturalWidth * scale()) / 2;
            oy = (D - img.naturalHeight * scale()) / 2;
          }
          draw();
        };

        /** Zoom about a point in stage space, so the pixel under it stays put. */
        const zoomTo = (next, cx, cy) => {
          next = Math.min(MAX_ZOOM, Math.max(1, next));
          if (next === z) return;
          const before = scale();
          z = next;
          const k = scale() / before;
          ox = cx - (cx - ox) * k;
          oy = cy - (cy - oy) * k;
          zoom.value = String(z);
          draw();
        };

        // --- dragging, and pinching, from the same pointer book ------------
        const pts = new Map();
        let start = null;

        const centre = () => {
          const all = [...pts.values()];
          const x = all.reduce((s, p) => s + p.x, 0) / all.length;
          const y = all.reduce((s, p) => s + p.y, 0) / all.length;
          return { x, y };
        };
        const spread = () => {
          const [a, b] = [...pts.values()];
          return Math.hypot(a.x - b.x, a.y - b.y);
        };
        const local = (e) => {
          const box = stage.getBoundingClientRect();
          return { x: e.clientX - box.left, y: e.clientY - box.top };
        };

        stage.addEventListener('pointerdown', (e) => {
          stage.setPointerCapture(e.pointerId);
          pts.set(e.pointerId, local(e));
          start = { c: centre(), ox, oy, z, d: pts.size === 2 ? spread() : 0 };
        });

        stage.addEventListener('pointermove', (e) => {
          if (!pts.has(e.pointerId)) return;
          e.preventDefault();
          pts.set(e.pointerId, local(e));
          const c = centre();
          if (pts.size === 2 && start?.d) {
            // Pinch: scale about the midpoint, and pan with it in one gesture.
            const next = Math.min(MAX_ZOOM, Math.max(1, start.z * (spread() / start.d)));
            const before = scale();
            z = next;
            const k = scale() / before;
            ox = c.x - (c.x - ox) * k;
            oy = c.y - (c.y - oy) * k;
            zoom.value = String(z);
          } else {
            ox = start.ox + (c.x - start.c.x);
            oy = start.oy + (c.y - start.c.y);
          }
          draw();
        });

        const release = (e) => {
          if (!pts.delete(e.pointerId)) return;
          // Re-baseline, or lifting one finger of a pinch jumps the image.
          start = pts.size ? { c: centre(), ox, oy, z, d: pts.size === 2 ? spread() : 0 } : null;
        };
        stage.addEventListener('pointerup', release);
        stage.addEventListener('pointercancel', release);

        stage.addEventListener(
          'wheel',
          (e) => {
            e.preventDefault();
            const p = local(e);
            zoomTo(z * (e.deltaY < 0 ? 1.12 : 1 / 1.12), p.x, p.y);
          },
          { passive: false }
        );

        zoom.addEventListener('input', () => zoomTo(Number(zoom.value), D / 2, D / 2));

        // The stage is sized by CSS, so wait for layout before measuring it.
        requestAnimationFrame(layout);
        const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(layout) : null;
        ro?.observe(stage);

        root.querySelector('[data-cancel]').addEventListener('click', () => {
          ro?.disconnect();
          finish(null);
          close();
        });

        root.querySelector('[data-use]').addEventListener('click', () => {
          const s = scale();
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = OUT;
          const g = canvas.getContext('2d');
          // The visible square is [0,D] in stage space; dividing by the scale
          // puts it back in image pixels. Clamped because a fractional pixel
          // over the edge makes drawImage paint a transparent sliver.
          const side = Math.min(D / s, Math.min(img.naturalWidth, img.naturalHeight));
          const sx = Math.max(0, Math.min(img.naturalWidth - side, -ox / s));
          const sy = Math.max(0, Math.min(img.naturalHeight - side, -oy / s));
          g.drawImage(img, sx, sy, side, side, 0, 0, OUT, OUT);
          canvas.toBlob(
            (blob) => {
              ro?.disconnect();
              if (!blob) {
                toast('Could not process that image.');
                finish(null);
              } else {
                finish(blob);
              }
              close();
            },
            'image/jpeg',
            0.85
          );
        });

        // Closing by the grip, the X, Escape or the backdrop is a cancel. The
        // promise must settle either way or the caller waits forever.
        const seal = () => finish(null);
        root.addEventListener('sheet-closed', seal);
        const mo = new MutationObserver(() => {
          if (!root.isConnected) {
            mo.disconnect();
            ro?.disconnect();
            seal();
          }
        });
        mo.observe(document.body, { childList: true });
      }
    );
  });
}
