// Folder deck for the Info page.
//
// Swipe through a line of folders; tap the front one to open it. The swiping
// is a real scroller underneath (an invisible rail of viewport-high spacers
// with scroll snapping), so momentum and snapping come from the browser. Cards
// are positioned from the fractional scroll position on every frame, so they
// follow the finger rather than jumping between indices. The idle float
// animation is on an inner element so it doesn't fight the stack transform.

import { esc } from './ui.js';

// Vertical offset per upcoming card (px). Slightly more than the 38px tab so
// the idle float doesn't clip the label above.
const STEP = 42;
// Width reduction per step back.
const SHRINK = 0.022;
// How far a passed card slides down.
const EXIT = 170;
// Number of upcoming tabs shown.
const DEPTH = 3;

/** One folder. `images` are HTML strings (photos or icons) from the page. */
function cardHtml(item, i) {
  const shots = (item.images || []).slice(0, 4);
  return `
    <article class="dcard${item.tint == null ? ' dcard--all' : ''}"
             data-key="${esc(item.key)}" data-index="${i}"
             ${item.tint == null ? '' : `data-tint="${item.tint}"`}
             style="--i:${i}" aria-label="${esc(item.label)}">
      <div class="dcard__float">
        <div class="dcard__bill">
          <span class="dcard__k">${esc(item.label)}</span>
          <span class="dcard__n">${esc(String(item.count))}</span>
        </div>
        <div class="dcard__body">
          <div class="dcard__shots" data-n="${shots.length}">
            ${shots.map((h) => `<span class="dcard__shot">${h}</span>`).join('')}
          </div>
          <p class="dcard__sub">${esc(item.blurb || '')}</p>
        </div>
      </div>
    </article>`;
}

export function deckHtml(items) {
  return `
    <div class="deck" data-deck>
      <div class="deck__cards" data-deck-cards>
        ${items.map(cardHtml).join('')}
      </div>
      <div class="deck__rail" data-deck-rail tabindex="0" role="listbox"
           aria-label="Folders">
        ${items.map(() => '<i></i>').join('')}
      </div>
      <p class="deck__hint" data-deck-hint>
        <span class="deck__dots" data-deck-dots></span>
        Swipe &middot; tap to open
      </p>
    </div>`;
}

/**
 * Wire a deck.
 *
 * @param {Element} root  the element deckHtml() was rendered into
 * @param {object}  opts
 *   onOpen(key)  the front card was tapped
 *   startKey     which card to open the line on
 */
export function mountDeck(root, { onOpen = () => {}, startKey = '' } = {}) {
  const deck = root.querySelector('[data-deck]');
  if (!deck) return null;

  const rail = deck.querySelector('[data-deck-rail]');
  const cards = [...deck.querySelectorAll('.dcard')];
  const dots = deck.querySelector('[data-deck-dots]');
  if (!rail || !cards.length) return null;

  let queued = 0;
  let front = 0;

  const step = () => rail.clientHeight || 1;

  /** Position along the line, 0..n-1. */
  function progress() {
    // Inverted: cards come from above, so dragging down (scrolling up)
    // advances. The rail starts scrolled to the end.
    const max = Math.max(1, rail.scrollHeight - rail.clientHeight);
    return (max - rail.scrollTop) / step();
  }

  // Runs every scroll frame: one scrollTop read, then only transform/opacity/z-index writes.
  function paint() {
    queued = 0;
    const p = progress();

    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      const d = i - p;

      if (d > DEPTH || d < -1.15) {
        if (!card.hidden) card.hidden = true;
        continue;
      }
      card.hidden = false;

      // Upcoming cards stack upward; passed cards drop away downward.
      const y = d >= 0 ? -d * STEP : -d * EXIT;
      const sx = d >= 0 ? 1 - d * SHRINK : 1;
      // Passed cards fade out quickly so they don't overlap the next one.
      const fade = d >= 0 ? 1 : Math.max(0, 1 + d / 0.16);

      card.style.transform = `translate3d(0,${y.toFixed(2)}px,0) scaleX(${sx.toFixed(4)})`;
      card.style.opacity = fade.toFixed(3);
      // Based on fractional depth so the order never flips mid-drag.
      card.style.zIndex = String(Math.round(1000 - d * 10));
      card.classList.toggle('is-live', d > -0.5 && d < 0.5);
    }

    const next = Math.max(0, Math.min(cards.length - 1, Math.round(p)));
    if (next !== front) {
      front = next;
      if (dots) dots.textContent = `${front + 1} / ${cards.length}`;
    }
  }

  rail.addEventListener('scroll', () => {
    if (!queued) queued = requestAnimationFrame(paint);
  }, { passive: true });

  // The transparent rail sits on top and receives all taps (cards are
  // pointer-events: none), so opening is handled here.

  /**
   * Open the front folder with a flip: a clone grows to cover the screen while
   * rotating to its plain-coloured back, then the page content fades in.
   * Perspective is part of the inner transform because the wrapper is scaled.
   */
  function openFront() {
    // Recompute rather than trust the last rAF paint.
    front = Math.max(0, Math.min(cards.length - 1, Math.round(progress())));
    const card = cards[front];
    const key = card?.dataset.key || '';
    if (!card) return;

    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || typeof card.animate !== 'function') {
      onOpen(key);
      return;
    }

    const r = card.getBoundingClientRect();
    const bill = card.querySelector('.dcard__bill');
    const colour = bill ? getComputedStyle(bill).backgroundColor : '';

    // Put the clone inside a face element; .dcard's own positioning would
    // otherwise override the face styles.
    const clone = card.cloneNode(true);
    clone.removeAttribute('style');
    clone.setAttribute('aria-hidden', 'true');

    const face = document.createElement('div');
    face.className = 'deck-flip__face deck-flip__front';
    face.appendChild(clone);

    const back = document.createElement('div');
    back.className = 'deck-flip__face deck-flip__back';
    back.style.background = colour;

    const inner = document.createElement('div');
    inner.className = 'deck-flip__inner';
    inner.append(face, back);

    const wrap = document.createElement('div');
    wrap.className = 'deck-flip';
    wrap.style.left = `${r.left}px`;
    wrap.style.top = `${r.top}px`;
    wrap.style.width = `${r.width}px`;
    wrap.style.height = `${r.height}px`;
    wrap.appendChild(inner);
    document.body.appendChild(wrap);

    // Uniform scale (no stretching) big enough to cover the screen. The extra
    // 1.35 covers the foreshortening from rotateY mid-flip.
    const k = Math.max(innerWidth / r.width, innerHeight / r.height) * 1.35;
    // Card centre to screen centre.
    const dx = innerWidth / 2 - (r.left + r.width / 2);
    const dy = innerHeight / 2 - (r.top + r.height / 2);

    const grow = wrap.animate(
      [
        { transform: 'translate(0px,0px) scale(1)' },
        { transform: `translate(${dx.toFixed(1)}px,${dy.toFixed(1)}px) scale(${k.toFixed(3)})` },
      ],
      { duration: 520, easing: 'cubic-bezier(.42,0,.22,1)', fill: 'forwards' }
    );

    inner.animate(
      [
        { transform: 'perspective(1400px) rotateY(0deg)' },
        { transform: 'perspective(1400px) rotateY(180deg)' },
      ],
      { duration: 520, easing: 'cubic-bezier(.45,0,.25,1)', fill: 'forwards' }
    );

    // Fade the real deck out behind the clone by the halfway point.
    root.animate([{ opacity: 1 }, { opacity: 0 }],
      { duration: 240, easing: 'ease-in', fill: 'forwards' });

    grow.finished.catch(() => {}).then(() => {
      // Content renders underneath the card's back.
      onOpen(key);
      requestAnimationFrame(() => {
        // Also overrides the fill: 'forwards' opacity 0 from above.
        root.animate([{ opacity: 0 }, { opacity: 1 }],
          { duration: 280, easing: 'ease-out', fill: 'forwards' });
        const out = wrap.animate([{ opacity: 1 }, { opacity: 0 }],
          { duration: 260, easing: 'ease-out', fill: 'forwards' });
        out.finished.catch(() => {}).then(() => wrap.remove());
      });
    });
  }

  rail.addEventListener('click', openFront);
  rail.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openFront();
    }
  });

  // Card 0 is at the bottom of the rail.
  const restFor = (i) => Math.max(0, (cards.length - 1 - i) * step());
  const startAt = cards.findIndex((c) => c.dataset.key === startKey);
  if (startAt >= 0) front = startAt;
  rail.scrollTop = restFor(front);
  if (dots) dots.textContent = `${front + 1} / ${cards.length}`;
  paint();

  // Repaint if the rail's height changes (fonts/images loading late).
  const ro = typeof ResizeObserver === 'function'
    ? new ResizeObserver(() => paint())
    : null;
  ro?.observe(rail);

  return {
    current: () => cards[front]?.dataset.key || '',
    destroy: () => ro?.disconnect(),
  };
}
