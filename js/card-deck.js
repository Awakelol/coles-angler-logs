// ---------------------------------------------------------------------------
// THE CARD DECK
//
// A hand of cards fanned downward. The top one is live: drag it up and it goes,
// tap it and it opens. The ones behind peek out below it, each a little lower
// and a little narrower, so you can see there are more.
//
// WHY THERE IS NO FRAMER MOTION HERE. It was the right suggestion for a React
// app and this is not one — no build step, no bundler, no framework. Pulling in
// React to get a spring would be a larger change than the feature. The spring
// is real all the same: `spring()` below solves a damped harmonic oscillator
// and emits it as a CSS `linear()` easing, which the Web Animations API runs on
// the compositor. That is the same curve Framer Motion would produce, without
// the 140 KB.
//
// GESTURES ARE SEPARATED BY INTENT, NOT BY ELEMENT. The same pointer sequence
// is a tap or a swipe depending on how far and how fast it moved, so both live
// on the top card and are told apart on release. A card that opened on the way
// to being swiped would make the deck feel like it was arguing with you.
// ---------------------------------------------------------------------------

import { esc } from './ui.js';

/** Past this many pixels upward, releasing throws the card away. */
const DISMISS_PX = 96;
/** Or past this speed, in px/ms — a flick that did not have far to go. */
const DISMISS_VELOCITY = 1.1;
/**
 * ...but a flick still has to have travelled this far first.
 *
 * Without the floor, a fast 20px nudge counts as a throw, because velocity over
 * a couple of frames is enormous however short the gesture was. The deck ends
 * up firing cards away from taps that wobbled, which reads as the app
 * misunderstanding you rather than as a sensitive control.
 */
const FLICK_FLOOR = 34;
/** Under this much movement, it was a tap. */
const TAP_SLOP = 10;
/** How far each card behind sits below the one in front. */
export const FAN_STEP = 15;
/** How many are worth drawing. Past this they are behind other cards anyway. */
const FAN_DEPTH = 4;

/**
 * A damped spring, as a CSS `linear()` easing string.
 *
 * Solves the ODE by steps and samples the position, which is the honest way to
 * get a curve that overshoots and settles. cubic-bezier CANNOT express that: it
 * is monotonic between its endpoints, so the "settle" in a bezier spring is
 * always a fake — it eases in hard and stops, and the eye reads the difference
 * even when it cannot name it.
 *
 * @param {number} stiffness  higher is snappier
 * @param {number} damping    higher settles sooner; below ~2*sqrt(k) it bounces
 */
export function spring(stiffness = 210, damping = 22, mass = 1, steps = 60) {
  const dt = 1 / 60;
  let x = -1; // displacement from the resting position
  let v = 0;
  const out = [];
  for (let i = 0; i <= steps; i++) {
    out.push(1 + x);
    const a = (-stiffness * x - damping * v) / mass;
    v += a * dt;
    x += v * dt;
  }
  // Land exactly on 1, or the animation ends a fraction short and the card
  // sits a pixel off where the CSS says it should be.
  out[out.length - 1] = 1;
  return `linear(${out.map((n) => n.toFixed(4)).join(',')})`;
}

const SETTLE = spring(210, 22);
const SETTLE_MS = 520;

/** Motion is a nicety; the deck must still work without it. */
const stillness = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * One card's face.
 *
 * `image` is html — a photograph where there is one, an icon where there is
 * not. The deck does not know or care which; it asks the page for a picture and
 * the page decides what a picture means for its own content.
 */
function cardHtml(item, i) {
  return `
    <article class="dcard" data-key="${esc(item.key)}" data-index="${i}"
             ${item.tint == null ? '' : `data-tint="${item.tint}"`}
             aria-label="${esc(item.label)}">
      <div class="dcard__face">
        <div class="dcard__head">
          <h3 class="dcard__k">${esc(item.label)}</h3>
          <p class="dcard__sub">${esc(item.blurb || '')}</p>
        </div>
        <div class="dcard__body">
          <div class="dcard__art">${item.image || ''}</div>
          <div class="dcard__count">
            <span class="dcard__n">${esc(String(item.count))}</span>
            <span class="dcard__unit">${esc(item.noun || '')}</span>
          </div>
        </div>
      </div>
    </article>`;
}

export function deckHtml(items, { emptyLabel = 'That is all of them' } = {}) {
  return `
    <div class="deck" data-deck>
      <div class="deck__done" data-deck-done hidden>
        <p class="deck__done-k">${esc(emptyLabel)}</p>
        <button class="btn btn--sm" data-deck-reset>Deal them again</button>
      </div>
      <div class="deck__cards" data-deck-cards>
        ${items.map(cardHtml).join('')}
      </div>
      <p class="deck__hint" data-deck-hint>Swipe up to skip &middot; tap to open</p>
    </div>`;
}

/**
 * Wire a deck.
 *
 * @param {Element} root      the element deckHtml() was rendered into
 * @param {object}  handlers
 *   onOpen(key)     a card was tapped
 *   onEmpty()       the last card has gone
 */
export function mountDeck(root, { onOpen = () => {}, onEmpty = () => {}, startKey = '' } = {}) {
  const deck = root.querySelector('[data-deck]');
  if (!deck) return null;

  const cards = [...deck.querySelectorAll('.dcard')];
  const done = deck.querySelector('[data-deck-done]');
  const hint = deck.querySelector('[data-deck-hint]');
  if (!cards.length) return null;

  // Where the hand opens. Closing an expanded card comes back here with its
  // key, so it lands back in its own place rather than at the top of the deck.
  const startAt = cards.findIndex((c) => c.dataset.key === startKey);
  let top = startAt >= 0 ? startAt : 0;
  let drag = null;          // { id, startY, y, t, lastY, lastT }

  const live = () => cards[top];

  /** Place every card by its distance from the top of the deck. */
  function layout(animate = true) {
    for (let i = 0; i < cards.length; i++) {
      const d = i - top;
      const card = cards[i];
      card.classList.toggle('is-live', d === 0);
      card.classList.toggle('is-gone', d < 0);
      card.style.setProperty('--d', String(Math.max(d, 0)));
      card.style.zIndex = String(cards.length - Math.max(d, 0));
      // Only the live card takes input; the rest are scenery until they aren't.
      card.style.pointerEvents = d === 0 ? 'auto' : 'none';
      card.setAttribute('aria-hidden', String(d !== 0));
      card.hidden = d < 0 || d > FAN_DEPTH;
      if (animate && d >= 0 && d <= FAN_DEPTH && !stillness()) {
        card.style.transition = `transform ${SETTLE_MS}ms ${SETTLE}`;
      } else {
        card.style.transition = '';
      }
    }
    const empty = top >= cards.length;
    if (done) done.hidden = !empty;
    if (hint) hint.hidden = empty;
    deck.classList.toggle('is-empty', empty);
  }

  /** Follow the finger. Straight transform writes — no transition in the way. */
  function follow(dy) {
    const card = live();
    if (!card) return;
    // Downward drag is resisted: the card has nowhere to go that way, and
    // rubber-banding says so more clearly than refusing to move at all.
    const y = dy < 0 ? dy : dy * 0.22;
    const tilt = (y / 26).toFixed(2);
    card.style.transition = '';
    card.style.transform =
      `translate3d(0, ${y.toFixed(1)}px, 0) rotate(${tilt}deg)`;
    card.style.opacity = String(Math.max(0.35, 1 - Math.abs(y) / 420));
  }

  function springBack() {
    const card = live();
    if (!card) return;
    card.style.opacity = '';
    if (stillness()) {
      card.style.transform = '';
      return;
    }
    card.animate(
      [{ transform: card.style.transform || 'none' }, { transform: 'none' }],
      { duration: SETTLE_MS, easing: SETTLE, fill: 'none' }
    );
    card.style.transform = '';
  }

  function dismiss() {
    const card = live();
    if (!card) return;
    const finish = () => {
      card.style.opacity = '';
      card.style.transform = '';
      top += 1;
      layout();
      if (top >= cards.length) onEmpty();
    };
    if (stillness()) return finish();

    const from = card.style.transform || 'none';
    const anim = card.animate(
      [
        { transform: from, opacity: card.style.opacity || '1' },
        { transform: 'translate3d(0, -130%, 0) rotate(-6deg)', opacity: 0 },
      ],
      { duration: 300, easing: 'cubic-bezier(.3,0,.2,1)', fill: 'forwards' }
    );
    anim.finished.catch(() => {}).then(() => {
      anim.cancel();
      finish();
    });
  }

  // --- gestures -------------------------------------------------------------

  deck.addEventListener('pointerdown', (e) => {
    const card = e.target.closest('.dcard');
    if (!card || card !== live()) return;
    // A drag already in flight from a DIFFERENT pointer means the last one
    // never ended — a lost pointerup, a cancelled touch, a tab that lost focus
    // mid-gesture. Taking over is right: refusing would wedge the deck for the
    // rest of the session, and there is no way for anyone to guess why.
    if (drag && drag.id !== e.pointerId) {
      drag = null;
      springBack();
    } else if (drag) {
      return;
    }
    drag = { id: e.pointerId, startY: e.clientY, lastY: e.clientY, lastT: e.timeStamp,
             v: 0, moved: false };
    // Capture keeps the drag alive if the finger leaves the card. It throws
    // NotFoundError for a pointer id the browser has no active pointer for —
    // which is every synthetic event, so anything driving this programmatically
    // would take the whole page down with it.
    try {
      card.setPointerCapture?.(e.pointerId);
    } catch {
      /* no real pointer to capture; the drag still works via the deck's own
         move and up handlers. */
    }
  });

  deck.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = e.clientY - drag.startY;
    if (!drag.moved && Math.abs(dy) < TAP_SLOP) return;
    drag.moved = true;
    // Velocity from the last sample rather than the whole gesture: a flick at
    // the end of a slow drag should still throw the card.
    const dt = Math.max(1, e.timeStamp - drag.lastT);
    drag.v = (e.clientY - drag.lastY) / dt;
    drag.lastY = e.clientY;
    drag.lastT = e.timeStamp;
    follow(dy);
  });

  function release(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = e.clientY - drag.startY;
    const card = live();
    const wasDrag = drag.moved;
    const velocity = drag.v;
    drag = null;

    if (!wasDrag) {
      // A tap. Opening is the page's business.
      onOpen(card?.dataset.key || '');
      return;
    }
    const thrown = dy < -DISMISS_PX
                || (dy < -FLICK_FLOOR && velocity < -DISMISS_VELOCITY);
    if (thrown) dismiss();
    else springBack();
  }

  deck.addEventListener('pointerup', release);
  deck.addEventListener('pointercancel', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    springBack();
  });

  // Keyboard: the deck is a list of things you can open, and a gesture nobody
  // can perform with a keyboard is a feature that only some people have.
  deck.addEventListener('keydown', (e) => {
    const card = live();
    if (!card) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onOpen(card.dataset.key || '');
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      dismiss();
    }
  });

  deck.querySelector('[data-deck-reset]')?.addEventListener('click', () => {
    top = 0;
    layout();
  });

  layout(false);
  return {
    /** Which card is live, so a caller can come back to it. */
    current: () => cards[top]?.dataset.key || '',
  };
}
