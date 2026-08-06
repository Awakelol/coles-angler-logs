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
 * A little more than the bill's height (38px), so every upcoming folder shows
 * its whole tab and nothing else. The few pixels of slack are for the idle
 * float: the front card drifts up to 4px, and at exactly one bill per step it
 * would clip the name of the one above it at the top of every drift.
 */
const STEP = 42;
/** How much narrower each card behind is, per step. Barely — labels must stay legible. */
const SHRINK = 0.022;
/** How far a card that has gone past the front travels — downward, out of the way. */
const EXIT = 170;
/**
 * How many upcoming bills to show.
 *
 * Three rather than four: the fourth bill was 42px the front folder's body did
 * not have, and its four photographs were the thing being squeezed for it.
 */
const DEPTH = 3;

/**
 * One folder.
 *
 * The bill is cut from the card by clip-path, so the title sits ON the tab the
 * way a hanging folder's does. `image` is html the page supplies — a photograph
 * where there is one, an icon where there is not.
 */
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

  /**
   * Place every card from the scroll position.
   *
   * Called on every scroll frame, so it does no layout reads beyond one
   * scrollTop and writes only transform/opacity/z-index — the three things the
   * compositor can do without touching the main thread again.
   */
  /** How far along the line we are, 0..n-1. */
  function progress() {
    // INVERTED. The folders come from above, so the gesture that brings the
    // next one down is a downward drag — which is a scroll UP. The rail starts
    // at its end and works back, so pulling down advances the line. Mapping it
    // the other way round meant swiping up to fetch something from above, and
    // the hand and the eye disagreed about which way the stack was moving.
    const max = Math.max(1, rail.scrollHeight - rail.clientHeight);
    return (max - rail.scrollTop) / step();
  }

  function paint() {
    queued = 0;
    const p = progress();

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
      // A card you have passed goes fully invisible almost at once rather than
      // fading across the whole step. Half-transparent, it sat over the folder
      // arriving behind it and you read both at the same time, which is worse
      // than either — the point of the swipe is to look at ONE thing.
      const fade = d >= 0 ? 1 : Math.max(0, 1 + d / 0.16);

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
  /**
   * Open the front folder by FLIPPING it.
   *
   * A card turning over is the one gesture that makes a card-sized thing
   * becoming a page-sized thing feel like one object rather than two. It also
   * solves the problem the plain grow had: stretching a card to fill a screen
   * distorts everything printed on it, and here the stretch happens while the
   * BACK is facing you — a flat panel of one colour, which cannot look
   * distorted. By the time it is full-screen you are looking at the back of the
   * card, and the content fades in onto it.
   *
   * Standard CSS 3D: two faces, one rotated 180deg behind the other, both with
   * backface-visibility hidden so only the one facing you paints.
   *
   * The perspective is written INTO the inner element's own transform rather
   * than set on a parent, because the parent is being scaled by six and a
   * scaled perspective is not the perspective you asked for.
   */
  function openFront() {
    // Recomputed, not read off the last paint. paint() runs on a rAF, so a tap
    // that lands between a scroll and its frame would open whichever folder was
    // in front one frame ago — which on a fast flick is not the one you are
    // looking at.
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

    // The clone goes INSIDE a face rather than being one. A .dcard carries its
    // own absolute positioning and height from the deck, which beat anything
    // the face needed — the front stayed pinned to the bottom of the box and
    // never turned, while the back grew over the page on its own. A plain
    // wrapper is a face this file fully controls.
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

    const sx = innerWidth / r.width;
    const sy = innerHeight / r.height;

    // The growth is back-loaded on purpose: while the front is still readable
    // it barely moves, and the scaling happens once the back has taken over.
    const grow = wrap.animate(
      [
        { transform: 'translate(0px,0px) scale(1,1)', offset: 0 },
        { transform: `translate(${(-r.left) * 0.18}px,${(-r.top) * 0.18}px) ` +
                     `scale(${1 + (sx - 1) * 0.14},${1 + (sy - 1) * 0.14})`, offset: 0.45 },
        { transform: `translate(${-r.left}px,${-r.top}px) scale(${sx},${sy})`, offset: 1 },
      ],
      { duration: 520, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' }
    );

    inner.animate(
      [
        { transform: 'perspective(1400px) rotateY(0deg)' },
        { transform: 'perspective(1400px) rotateY(180deg)' },
      ],
      { duration: 520, easing: 'cubic-bezier(.45,0,.25,1)', fill: 'forwards' }
    );

    // THE REST OF THE DECK GOES WITH IT. The flip is a fixed clone over the
    // live deck, so without this the card you tapped turns while its twin and
    // the whole line sit there behind it — the growing panel then covers a
    // scene that is still moving, which is the part that read as a mess. Timed
    // to be gone by the halfway point, where the card is edge-on and there is
    // nothing to see through anyway.
    root.animate([{ opacity: 1 }, { opacity: 0 }],
      { duration: 240, easing: 'ease-in', fill: 'forwards' });

    grow.finished.catch(() => {}).then(() => {
      // Built underneath the back of the card, so the swap is never on screen.
      onOpen(key);
      requestAnimationFrame(() => {
        // fill: 'forwards' above left it at 0; this both clears that and is the
        // fade-in the content arrives on.
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

  // Where the line opens. Card 0 lives at the BOTTOM of the rail now, so the
  // resting position is the end of the scroller, not the start.
  const restFor = (i) => Math.max(0, (cards.length - 1 - i) * step());
  const startAt = cards.findIndex((c) => c.dataset.key === startKey);
  if (startAt >= 0) front = startAt;
  // Instant: this is a restore, not a journey. Animating it would look like
  // the deck scrolling away from you the moment you closed a folder.
  rail.scrollTop = restFor(front);
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
