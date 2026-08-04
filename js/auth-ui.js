// ---------------------------------------------------------------------------
// THE SIGN-IN CARD
//
// One card, three homes: the catch log's gate, the Account screen, and
// Settings. It used to live inside js/pages/log.js, which meant the only way
// to sign in was to visit the log — so Account and Settings, the two screens
// about your account, both had to send you somewhere else to get one.
//
// Extracted rather than copied. Three copies of an auth form is three places
// to fix a bug in, and the one that gets missed is the one someone is using.
//
// WHICH VIEW IS SHOWING lives here rather than in the router, so the browser
// Back button still means "leave this screen", not "go back a form step".
// ---------------------------------------------------------------------------

import { CONFIG } from './config.js';
import { store, prefs } from './store.js';
import {
  signIn, signUp, signInWithGoogle, signInWithFacebook, listUsers,
  cloudConfigured, lastAuthError, clearAuthError,
} from './auth.js';
import { USERNAME_RULES } from './auth/local.js';
import { esc, toast } from './ui.js';

let gateView = 'signin';

/** 'signin' | 'signup' — what the card is currently showing. */
export const authView = () => gateView;

/** The heading a page should put above the card. */
export const authHeading = () =>
  gateView === 'signup'
    ? { eyebrow: 'New angler', title: 'Create account',
        blurb: 'Pick a name for your logbook. Several people can share this device, each with their own.' }
    : { eyebrow: 'Your logbook', title: 'Sign in',
        blurb: 'Sign in so your catches stay yours.' };

// ---------------------------------------------------------------------------
// GUEST MODE
//
// Not a fake account - a catch saved without one gets `userId: null` and is
// adopted by the first account made (store.adoptOrphans). That behaviour has
// always been there; the gate was simply hiding it, which made "you can start
// now and keep it later" a promise the screen contradicted.
//
// Spots stay behind the account. They are filtered by userId with no orphan
// path, and that gate is deliberate.
// ---------------------------------------------------------------------------

const GUEST_KEY = 'guestMode';
export const isGuest = () => prefs.get(GUEST_KEY, false) === true;
export const setGuest = (on) => prefs.set(GUEST_KEY, on === true);

const PROVIDER_MARKUP = {
  google: `
  <button class="btn btn--block btn--provider" data-provider="google">
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path fill="#4285F4" d="M23 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.2a5.3 5.3 0 0 1-2.3 3.5v2.9h3.7C21.7 18.9 23 15.9 23 12.3z"/>
      <path fill="#34A853" d="M12 24c3.1 0 5.7-1 7.6-2.8l-3.7-2.9c-1 .7-2.3 1.1-3.9 1.1-3 0-5.5-2-6.4-4.7H1.8v3C3.7 21.4 7.6 24 12 24z"/>
      <path fill="#FBBC05" d="M5.6 14.7a7.2 7.2 0 0 1 0-4.6v-3H1.8a12 12 0 0 0 0 10.6l3.8-3z"/>
      <path fill="#EA4335" d="M12 4.8c1.7 0 3.2.6 4.4 1.7l3.3-3.3C17.7 1.2 15.1 0 12 0 7.6 0 3.7 2.6 1.8 6.1l3.8 3c.9-2.7 3.4-4.3 6.4-4.3z"/>
    </svg>
    Continue with Google
  </button>`,
  facebook: `
  <button class="btn btn--block btn--provider" data-provider="facebook">
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path fill="#1877F2" d="M24 12a12 12 0 1 0-13.9 11.9v-8.4H7v-3.5h3.1V9.4c0-3 1.8-4.7 4.6-4.7 1.3 0 2.7.2 2.7.2v3h-1.5c-1.5 0-2 .9-2 1.9v2.2h3.4l-.5 3.5h-2.9v8.4A12 12 0 0 0 24 12z"/>
    </svg>
    Continue with Facebook
  </button>`,
};

const enabledProviders = () =>
  Object.keys(PROVIDER_MARKUP).filter((name) => CONFIG.auth?.[name]);

const providerButtons = () => enabledProviders().map((n) => PROVIDER_MARKUP[n]).join('');

const PROVIDER_LABELS = { google: 'Google', facebook: 'Facebook' };

/** "Google" / "Google or Facebook" — never a provider we aren't showing. */
const providerNames = () => {
  const names = enabledProviders().map((n) => PROVIDER_LABELS[n]);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names.at(-1)}` : names[0] || '';
};

/** Cloud sign-in is offered only when it's configured AND has a live provider. */
const cloudSignInAvailable = () => cloudConfigured() && enabledProviders().length > 0;

function signInHtml() {
  return `
    <form id="authForm" autocomplete="on" class="auth-form">
      <div class="auth-field">
        <span class="auth-field__ico" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M12 3a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9Zm0 11c4.4 0 8 2.5 8 5.5V21H4v-1.5C4 16.5 7.6 14 12 14Z"/></svg>
        </span>
        <input type="text" id="a-user" name="username" required
               placeholder="Username" aria-label="Username"
               autocapitalize="none" autocorrect="off" spellcheck="false"
               autocomplete="username">
      </div>

      <div class="auth-field">
        <span class="auth-field__ico" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M12 2a5 5 0 0 1 5 5v2h1a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2h1V7a5 5 0 0 1 5-5Zm0 2a3 3 0 0 0-3 3v2h6V7a3 3 0 0 0-3-3Zm0 9a2 2 0 0 0-1 3.7V19h2v-2.3A2 2 0 0 0 12 13Z"/></svg>
        </span>
        <input type="password" id="a-pass" name="password" required
               placeholder="Password" aria-label="Password"
               autocomplete="current-password">
        <button type="button" class="auth-field__peek" data-peek="a-pass"
                aria-label="Show password" aria-pressed="false">
          <svg viewBox="0 0 24 24" width="19" height="19"><path fill="currentColor" d="M12 5c5 0 9 4.4 10 7-1 2.6-5 7-10 7S3 14.6 2 12c1-2.6 5-7 10-7Zm0 2.4c-3.4 0-6.4 2.9-7.6 4.6C5.6 13.7 8.6 16.6 12 16.6s6.4-2.9 7.6-4.6C18.4 10.3 15.4 7.4 12 7.4Zm0 1.8a2.8 2.8 0 1 1 0 5.6 2.8 2.8 0 0 1 0-5.6Z"/></svg>
        </button>
      </div>

      <p class="field__hint" id="authError" role="alert" style="color:#C1121F"></p>
      <button type="submit" class="btn btn--primary btn--block btn--tall">Log in</button>
    </form>

    ${cloudSignInAvailable() ? '<div class="rule"><span>or</span></div>' : ''}
    ${cloudSignInAvailable() ? providerButtons() : ''}

    <button class="btn btn--block btn--provider" data-goto="guest">
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path fill="currentColor" d="M12 3a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9Zm0 11c4.4 0 8 2.5 8 5.5V21H4v-1.5C4 16.5 7.6 14 12 14Z"/>
      </svg>
      Continue as guest
    </button>

    <p class="auth-swap">
      Need an account? <button class="linkish" data-goto="signup">Sign up</button>
    </p>`;
}

function signUpHtml() {
  return `
    <form id="authForm" autocomplete="on" class="auth-form">
      <div class="float">
        <input type="text" id="a-user" name="username" required placeholder=" "
               autocapitalize="none" autocorrect="off" spellcheck="false"
               autocomplete="username">
        <label for="a-user">Username</label>
      </div>
      <p class="field__hint" style="margin:-8px 0 14px">${esc(USERNAME_RULES.describe)}</p>

      <div class="float">
        <input type="email" id="a-email" name="email" placeholder=" "
               autocapitalize="none" autocorrect="off" spellcheck="false"
               autocomplete="email">
        <label for="a-email">Email (optional)</label>
      </div>
      <p class="field__hint" style="margin:-8px 0 14px">
        Nothing is sent to it. It only gives you a way to link this account to a
        real one later.
      </p>

      <div class="float">
        <input type="password" id="a-pass" name="password" required placeholder=" "
               autocomplete="new-password">
        <label for="a-pass">Password</label>
      </div>

      <div class="float">
        <input type="password" id="a-pass2" name="password2" required placeholder=" "
               autocomplete="new-password">
        <label for="a-pass2">Confirm password</label>
      </div>

      <p class="field__hint" id="authError" role="alert" style="color:#C1121F"></p>
      <button type="submit" class="btn btn--primary btn--block btn--tall">Create account</button>
    </form>

    <p class="auth-swap">
      Already have an account? <button class="linkish" data-goto="signin">Log in</button>
    </p>

    <div class="notice" style="margin-top:16px">
      <h3>Device-only accounts don&rsquo;t sync</h3>
      <p>
        A username and password works with no internet and no setup, but the log
        stays on this phone. ${
          cloudSignInAvailable()
            ? `Use ${providerNames()} if you want it on more than one device.`
            : 'Cloud sign-in will sync when it is set up.'
        }
        There is no server behind this yet, so
        <strong>don&rsquo;t reuse a password from elsewhere.</strong>
      </p>
    </div>`;
}

/** The card itself. Wrap it in whatever heading the page wants. */
export function authCardHtml() {
  return `<div class="card" id="authCard">${gateView === 'signup' ? signUpHtml() : signInHtml()}</div>`;
}

/**
 * Wire whichever view is showing. Returns false if there is no card here.
 *
 * @param {object} opts
 *   onDone     after a successful sign-in, sign-up, or guest choice. The page
 *              decides what that means — the log re-renders itself, Account and
 *              Settings re-render to show the account that now exists.
 *   onSwap     after switching between sign in and sign up, for a page whose
 *              heading sits OUTSIDE the card and has to follow it. A page that
 *              passes this is expected to re-render and remount.
 *   allowGuest the log offers it; Account and Settings do not. Choosing to look
 *              around without an account is something you do on the way to the
 *              log, not on the screen about your account.
 */
export function mountAuthCard(root, { onDone = () => {}, onSwap = null, allowGuest = true } = {}) {
  const card = root.querySelector('#authCard');
  if (!card) return false;

  // Delegated, so they survive the innerHTML swap below. The listeners inside
  // wire() are bound to elements that swap DOES destroy, which is why they are
  // in a function that can be run again.
  card.addEventListener('click', (e) => {
    const goto = e.target.closest('[data-goto]');
    if (!goto) return;
    if (goto.dataset.goto === 'guest') {
      if (!allowGuest) return;
      setGuest(true);
      toast('Looking around as a guest');
      onDone();
      return;
    }
    swapTo(goto.dataset.goto);
  });

  // Reveal the password rather than make people retype it. aria-pressed
  // carries the state, so a screen reader hears the toggle change too.
  card.addEventListener('click', (e) => {
    const peek = e.target.closest('[data-peek]');
    if (!peek) return;
    const field = card.querySelector(`#${peek.dataset.peek}`);
    if (!field) return;
    const showing = field.type === 'text';
    field.type = showing ? 'password' : 'text';
    peek.setAttribute('aria-pressed', String(!showing));
    peek.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
  });

  // Re-render the card in place rather than the whole route: switching between
  // sign in and sign up shouldn't scroll the page or touch the router.
  function swapTo(view) {
    gateView = view;
    card.innerHTML = view === 'signup' ? signUpHtml() : signInHtml();
    if (onSwap) onSwap();
    else wire();
  }

  /**
   * Everything bound to an element the swap replaces.
   *
   * Previously this ran once, because swapping re-navigated and remounted the
   * whole route. Sharing the card means a page can swap without a remount, so
   * the provider buttons and the form have to be re-found each time or the
   * second view comes up inert.
   */
  function wire() {
    const errorLine = card.querySelector('#authError');

    // A failed redirect from a previous page load leaves a reason behind.
    const priorError = lastAuthError();
    if (priorError && errorLine) {
      errorLine.textContent =
        `Sign-in failed (${priorError.code || priorError.stage}). ${priorError.message}`;
      clearAuthError();
    }

    // --- Google / Facebook ---
    for (const btn of card.querySelectorAll('[data-provider]')) {
      btn.addEventListener('click', async () => {
        const name = btn.dataset.provider;
        const label = btn.innerHTML;
        btn.disabled = true;
        btn.textContent = `Opening ${PROVIDER_LABELS[name] || name}…`;
        try {
          const profile = name === 'google' ? await signInWithGoogle() : await signInWithFacebook();
          if (profile) {
            setGuest(false);
            toast(`Signed in as ${profile.username}`);
            onDone();
            return;
          }
          // Redirect path, or the popup was dismissed.
          btn.disabled = false;
          btn.innerHTML = label;
        } catch (err) {
          btn.disabled = false;
          btn.innerHTML = label;
          if (errorLine) {
            errorLine.textContent = err.code ? `${err.message} (${err.code})` : err.message;
          }
        }
      });
    }

    // --- username + password ---
    const form = card.querySelector('#authForm');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (errorLine) errorLine.textContent = '';
      const fd = new FormData(form);
      const username = String(fd.get('username') || '').trim();
      const password = String(fd.get('password') || '');

      try {
        if (gateView === 'signup') {
          if (password !== String(fd.get('password2') || '')) {
            throw new Error("Passwords don't match.");
          }
          const isFirstAccount = listUsers().length === 0;
          const user = await signUp(username, password, String(fd.get('email') || ''));
          // Entries logged before profiles existed would otherwise appear lost —
          // and so would any spots dropped on the map in that time.
          const adopted = isFirstAccount ? await store.adoptOrphans(user.id) : 0;
          if (isFirstAccount) await store.adoptOrphanSpots(user.id);
          toast(
            adopted
              ? `Welcome, ${user.username} — ${adopted} earlier catches are yours`
              : `Welcome, ${user.username}`
          );
        } else {
          const user = await signIn(username, password);
          toast(`Signed in as ${user.username}`);
        }
        gateView = 'signin'; // so signing out later lands on the right screen
        // Whoever they were a moment ago, they have an account now. Leaving the
        // flag set would keep the gate hidden after a later sign-out, which is
        // the one moment it has to come back.
        setGuest(false);
        onDone();
      } catch (err) {
        if (errorLine) errorLine.textContent = err.message;
      }
    });
  }

  wire();
  return true;
}
