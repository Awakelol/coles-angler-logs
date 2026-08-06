// ---------------------------------------------------------------------------
// THE CARD DECK
//
// A line of folders you swipe through. Nothing is ever dismissed: swiping moves
// you ALONG the line, one card per swipe, and every card is still there when you
// come back. Tap the front one to open it.
//
// TWO THINGS MAKE IT FEEL SMOOTH, and they are both about not fighting the
// browser.
//
//   1. A REAL SCROLLER DOES THE SCROLLING. An invisible rail with one
//      viewport-height spacer per card and `scroll-snap-type: y mandatory`.
//      Momentum, rubber-banding at the ends, snap-to-card and the exact feel of
//      the platform come free. Hand-rolling that on touch means reimplementing
//      a physics engine you cannot test from a desktop, and getting it 90%
//      right reads as broken.
//
//   2. THE CARDS FOLLOW THE SCROLL CONTINUOUSLY, not on release. `--d` is a
//      card's distance from the front and it is FRACTIONAL — 2.37, not 2. Every
//      frame of the drag repositions the whole stack, so the card under your
//      thumb tracks it exactly and the one behind is already rising to meet you.
//      Snapping to an index and animating between them is what makes a carousel
//      feel like a slideshow.
//
// AND ONE THAT MAKES IT FEEL ALIVE: the idle float. A card sitting still looks
// printed on the screen. A card breathing looks like an object. The float lives
// on an INNER element so it composes with the stack transform instead of
// fighting it — two transforms on one element is a fight one of them loses.
//
// WHY NO FRAMER MOTION. It was the right suggestion for a React app and this is
// not one: no build step, no bundler, no framework. And the physics that
// matters here is the platform's own scroller — its momentum, its rubber-band,
// its snap. No library beats that, because no library IS that: they all
// reimplement it and land somewhere close. An earlier version of this file did
// carry a hand-rolled spring solver for a swipe-to-dismiss gesture; the gesture
// went, and the solver went with it rather than sitting here unused.
// ---------------------------------------------------------------------------

import { esc } from './ui.js';

/**
 * How far each upcoming card sits ABOVE the one in front, in px.
 *
 * Tied to the bill's height on purpose: at exactly one bill per step, each card
 * still to come shows its whole tab and nothing else — its name and its picture,
 * readable, with its body hidden behind the card you are reading. A smaller step
 * would show a slice of a label, which is worse than showing none.
 */
const STEP = 38;
/** How much narrower each card behind is, per step. Barely — labels must stay legible. */
const SHRINK = 0.022;
/** How far a card that has gone past the front travels — downward, out of the way. */
const EXIT = 170;
/** Cards further ahead than this are behind other bills anyway. */
const DEPTH = 4;

/**
 * One folder.
 *
 * The bill is cut from the card by clip-path, so the title sits ON the tab the
 * way a hanging folder's does. `image` is html the page supplies — a photograph
 * where there is one, an icon where there is not.
 */
function cardHtml(item, i) {
  return `
    <article class="dcard${item.tint == null ? ' dcard--all' : ''}"
             data-key="${esc(item.key)}" data-index="${i}"
             ${item.tint == null ? '' : `data-tint="${item.tint}"`}
             style="--i:${i}" aria-label="${esc(item.label)}">
      <div class="dcard__float">
        <div class="dcard__bill">
          <span class="dcard__art">${item.image || ''}</span>
          <span class="dcard__k">${esc(item.label)}</span>
        </div>
        <div class="dcard__body">
          <p class="dcard__sub">${esc(item.blurb || '')}</p>
          <p class="dcard__count">
            <span class="dcard__n">${esc(String(item.count))}</span>
            <span class="dcard__unit">${esc(item.noun || '')}</span>
          </p>
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

  /**
   * Place every card from the scroll position.
   *
   * Called on every scroll frame, so it does no layout reads beyond one
   * scrollTop and writes only transform/opacity/z-index — the three things the
   * compositor can do without touching the main thread again.
   */
  function paint() {
    queued = 0;
    const p = rail.scrollTop / step();

    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      const d = i - p;

      // Behind the last visible layer, or already gone past the top.
      if (d > DEPTH || d < -1.15) {
        if (!card.hidden) card.hidden = true;
        continue;
      }
      card.hidden = false;

      // THE LINE COMES FROM THE TOP. Cards still to come stack UPWARD, each
      // showing its bill above the one in front, so you can read what is
      // coming. A card you have passed drops away downward.
      const y = d >= 0 ? -d * STEP : -d * EXIT;
      const sx = d >= 0 ? 1 - d * SHRINK : 1;
      const fade = d >= 0 ? 1 : Math.max(0, 1 + d / 1.15);

      card.style.transform = `translate3d(0,${y.toFixed(2)}px,0) scaleX(${sx.toFixed(4)})`;
      card.style.opacity = fade.toFixed(3);
      // Fractional depth, so the order never flips mid-drag the way rounding
      // to an integer index would.
      card.style.zIndex = String(Math.round(1000 - d * 10));
      // Only the card at the front is worth reading aloud; the rest are edges.
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

  // The rail is on top and transparent, so a touch starting anywhere in the
  // deck reaches the scroller. That makes the cards pointer-events: none, so
  // the tap is handled here and reported by calling back — not by firing a
  // click at a card that cannot receive one.
  const openFront = () => onOpen(cards[front]?.dataset.key || '');
  rail.addEventListener('click', openFront);
  rail.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openFront();
    }
  });

  // Where the line opens. Closing a folder comes back with its key so it lands
  // on the card you were reading rather than at the start.
  const startAt = cards.findIndex((c) => c.dataset.key === startKey);
  if (startAt > 0) {
    front = startAt;
    // Instant: this is a restore, not a journey. Animating it would look like
    // the deck scrolling away from you the moment you closed a folder.
    rail.scrollTop = startAt * step();
  }
  if (dots) dots.textContent = `${front + 1} / ${cards.length}`;
  paint();

  // A late layout pass — fonts, images — changes clientHeight and with it the
  // meaning of every scroll offset.
  const ro = typeof ResizeObserver === 'function'
    ? new ResizeObserver(() => paint())
    : null;
  ro?.observe(rail);

  return {
    current: () => cards[front]?.dataset.key || '',
    destroy: () => ro?.disconnect(),
  };
}
