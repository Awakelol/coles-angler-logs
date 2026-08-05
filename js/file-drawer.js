// ---------------------------------------------------------------------------
// THE FILE DRAWER
//
// Hanging folders in a cabinet, seen from the front. Every folder is present
// from the start and every label is readable at once: the bodies overlap, but
// each folder sits one tab-height below the one behind it, so the tabs form a
// legible column down the drawer.
//
// Tapping a tab opens that folder IN PLACE. The folders above it do not move,
// the ones below are pushed down as far as the content needs and no further,
// and nothing is ever removed. Closing puts it back exactly where it was.
//
// WHY THERE IS NO FRAMER MOTION. Same as before: it needs React, and this app
// has no build step or framework. `spring()` solves a damped oscillator and
// emits a CSS `linear()` easing, which is the same curve the Web Animations API
// can run directly.
//
// TWO SPRINGS, ON PURPOSE. The height uses a nearly-critically-damped one —
// height that overshoots means content clipped and then revealed, which reads
// as a glitch rather than as bounce. The folder's own lift is bouncier, because
// that IS the bit that should feel like it was pulled out of the drawer.
// ---------------------------------------------------------------------------

import { esc } from './ui.js';

/** How much of each folder shows when it is closed: the tab. */
export const TAB_H = 52;

/** Solve a damped spring and emit it as a CSS `linear()` easing. */
export function spring(stiffness = 210, damping = 22, mass = 1, steps = 60) {
  const dt = 1 / 60;
  let x = -1;
  let v = 0;
  const out = [];
  for (let i = 0; i <= steps; i++) {
    out.push(1 + x);
    const a = (-stiffness * x - damping * v) / mass;
    v += a * dt;
    x += v * dt;
  }
  out[out.length - 1] = 1;
  return `linear(${out.map((n) => n.toFixed(4)).join(',')})`;
}

/** Settles without overshooting — for anything whose size is animating. */
const SIZE = spring(190, 27);
/** Overshoots a little — for the folder coming forward. */
const LIFT = spring(240, 18);
const OPEN_MS = 480;

const stillness = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * One folder.
 *
 * The shape — wide body, narrower tab protruding from the top — is a single
 * clip-path polygon on one element. Drawn as a tab element plus a body element
 * it would be two shapes to line up and a seam along the join that shows at
 * every zoom level.
 */
function folderHtml(item, i) {
  return `
    <section class="ffold" data-key="${esc(item.key)}" data-i="${i}"
             ${item.tint == null ? '' : `data-tint="${item.tint}"`}>
      <h3 class="ffold__tab">
        <button class="ffold__grip" data-open="${esc(item.key)}"
                aria-expanded="false" aria-controls="fold-${i}">
          <span class="ffold__pic" aria-hidden="true">${item.image || ''}</span>
          <span class="ffold__label">${esc(item.label)}</span>
          <span class="ffold__n">${esc(String(item.count))}</span>
        </button>
        <button class="ffold__x" data-close aria-label="Close ${esc(item.label)}" hidden>
          <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
            <path fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"
                  d="M6 6l12 12M18 6L6 18"/>
          </svg>
        </button>
      </h3>
      <div class="ffold__inner" id="fold-${i}" role="region"
           aria-labelledby="" hidden></div>
    </section>`;
}

export function drawerHtml(items) {
  return `
    <div class="drawer" data-drawer>
      ${items.map(folderHtml).join('')}
    </div>`;
}

/**
 * Wire a drawer.
 *
 * @param {Element} root
 * @param {object}  o
 *   onOpen(key, paneEl)  fill the folder — the pane is where its content goes
 *   onClose(key)
 *   openKey              which folder to start open, if any
 */
export function mountDrawer(root, { onOpen = () => {}, onClose = () => {}, openKey = '' } = {}) {
  const drawer = root.querySelector('[data-drawer]');
  if (!drawer) return null;

  const folders = [...drawer.querySelectorAll('.ffold')];
  if (!folders.length) return null;

  let open = null; // the open <section>, or null

  const paneOf = (f) => f.querySelector('.ffold__inner');
  const gripOf = (f) => f.querySelector('.ffold__grip');
  const xOf = (f) => f.querySelector('.ffold__x');

  function markState(folder, isOpen) {
    folder.classList.toggle('is-open', isOpen);
    gripOf(folder)?.setAttribute('aria-expanded', String(isOpen));
    const x = xOf(folder);
    if (x) x.hidden = !isOpen;
    const pane = paneOf(folder);
    if (pane) pane.hidden = !isOpen;
  }

  /** Grow the pane from nothing to whatever its content needs. */
  function growOpen(folder) {
    const pane = paneOf(folder);
    if (!pane) return;
    if (stillness()) return;

    const target = pane.scrollHeight;
    pane.animate(
      [{ height: '0px', opacity: 0 }, { height: `${target}px`, opacity: 1 }],
      { duration: OPEN_MS, easing: SIZE, fill: 'none' }
    );
    // The folder itself comes forward with a bouncier curve — that is the part
    // that should feel like it was pulled out of the drawer.
    folder.animate(
      [{ transform: 'scale(.985)' }, { transform: 'scale(1)' }],
      { duration: OPEN_MS, easing: LIFT, fill: 'none' }
    );
  }

  function shrinkShut(folder, after) {
    const pane = paneOf(folder);
    if (!pane || stillness()) return after();
    const from = pane.scrollHeight;
    const anim = pane.animate(
      [{ height: `${from}px`, opacity: 1 }, { height: '0px', opacity: 0 }],
      { duration: 300, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' }
    );
    anim.finished.catch(() => {}).then(() => {
      anim.cancel();
      after();
    });
  }

  function close({ silent = false } = {}) {
    if (!open) return;
    const folder = open;
    const key = folder.dataset.key;
    open = null;
    shrinkShut(folder, () => {
      markState(folder, false);
      paneOf(folder).innerHTML = '';
      if (!silent) onClose(key);
    });
  }

  function openFolder(key) {
    const folder = folders.find((f) => f.dataset.key === key);
    if (!folder) return;
    // Only one at a time: two open folders in a drawer is a list, and the
    // point of the drawer is that you can see everything else while you read
    // one thing.
    if (open && open !== folder) {
      const prev = open;
      open = null;
      markState(prev, false);
      paneOf(prev).innerHTML = '';
    }
    if (open === folder) return;

    open = folder;
    markState(folder, true);
    onOpen(key, paneOf(folder));
    // After the caller has filled it, so scrollHeight is a real number.
    requestAnimationFrame(() => growOpen(folder));
  }

  drawer.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) {
      close();
      return;
    }
    const grip = e.target.closest('[data-open]');
    if (!grip) return;
    const key = grip.dataset.open;
    if (open && open.dataset.key === key) close();
    else openFolder(key);
  });

  drawer.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && open) {
      e.preventDefault();
      gripOf(open)?.focus();
      close();
    }
  });

  if (openKey) openFolder(openKey);

  return {
    open: openFolder,
    close,
    current: () => open?.dataset.key || '',
  };
}
