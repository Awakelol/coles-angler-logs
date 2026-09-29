// Avatar cropper: drag and zoom a photo inside a circular mask (avatars are
// shown round everywhere). The area outside the circle is dimmed, not hidden.
//
// Output matches prepareAvatar(): a square JPEG up to 256px.
//
// Coordinates are in stage pixels: `scale` is screen px per image px, `ox/oy`
// is the image's top-left in stage space, and the visible square is [0,D].

import { LIMITS, fmtMB } from './media.js';
import { openSheet, toast } from './ui.js';

const OUT = 256; // matches prepareAvatar(), so nothing downstream changes
const MAX_ZOOM = 4;

/**
 * Load a File into an Image. The object URL is returned rather than revoked
 * here; revoking on load leaves the <img> in the stage blank. The caller
 * revokes it when the sheet closes.
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
 * Rejects only if the file can't be used (too big, not an image).
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

        // Measure D after layout; the stage size comes from CSS.
        let D = 0;
        let base = 1; // scale at which the image exactly covers the stage
        let z = 1;
        let ox = 0;
        let oy = 0;

        const scale = () => base * z;

        /** Keep the image covering the whole stage. */
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
          // Keep the crop centred on the same spot when the stage resizes.
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

        /** Zoom around a stage point, keeping that point fixed. */
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

        // --- drag and pinch ---------------------------------------------------
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
            // Pinch: zoom around the midpoint and pan with it.
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
          // Re-baseline so lifting one finger doesn't make the image jump.
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
          // Convert the visible square back to image pixels, clamped so drawImage
          // doesn't paint a transparent sliver at the edge.
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

        // Any other way of closing counts as cancel; always settle the promise.
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
