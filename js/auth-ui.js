// Sign-in / sign-up card, used on the log gate, Account and Settings.
//
// The signin/signup view state lives here rather than in the router so the
// Back button leaves the screen instead of stepping back through the form.

import { CONFIG } from './config.js';
import { store, prefs } from './store.js';
import {
  signIn, signUp, signInWithGoogle, signInWithFacebook, listUsers,
  cloudConfigured, lastAuthError, clearAuthError,
} from './auth.js';
import { USERNAME_RULES } from './auth/local.js';
import { esc, toast } from './ui.js';

let gateView = 'signin';

/** 'signin' | 'signup' */
export const authView = () => gateView;

/** Heading for the page to show above the card. */
export const authHeading = () =>
  gateView === 'signup'
    ? { eyebrow: 'New angler', title: 'Create account',
        blurb: 'Pick a name for your logbook. Several people can share this device, each with their own.' }
    : { eyebrow: 'Your logbook', title: 'Sign in',
        blurb: 'Sign in so your catches stay yours.' };

// --- guest mode ------------------------------------------------------------
//
// Guests aren't a fake account: their catches get userId null and are adopted
// by the first account created (store.adoptOrphans). Map spots still need an
// account.

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

/** e.g. "Google" or "Google or Facebook", only for enabled providers. */
const providerNames = () => {
  const names = enabledProviders().map((n) => PROVIDER_LABELS[n]);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names.at(-1)}` : names[0] || '';
};

/** Offer cloud sign-in only if configured and a provider is enabled. */
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

export function authCardHtml() {
  return `<div class="card" id="authCard">${gateView === 'signup' ? signUpHtml() : signInHtml()}</div>`;
}

/**
 * Wire up the card. Returns false if there's no card in `root`.
 *
 * @param {object} opts
 *   onDone     called after sign-in, sign-up or choosing guest mode
 *   onSwap     called after switching between sign in and sign up, for pages
 *              whose heading is outside the card (they should re-render)
 *   allowGuest show the guest option (log page only)
 */
export function mountAuthCard(root, { onDone = () => {}, onSwap = null, allowGuest = true } = {}) {
  const card = root.querySelector('#authCard');
  if (!card) return false;

  // Delegated so they survive the card being re-rendered; wire() handles the rest.
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

  // Show/hide password.
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

  // Swap views in place without going through the router.
  function swapTo(view) {
    gateView = view;
    card.innerHTML = view === 'signup' ? signUpHtml() : signInHtml();
    if (onSwap) onSwap();
    else wire();
  }

  /** Bind handlers on elements that get replaced when the view swaps. */
  function wire() {
    const errorLine = card.querySelector('#authError');

    // Show the reason left by a failed redirect.
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
          // Redirected, or popup dismissed.
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
          // Give pre-account catches and spots to this user.
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
        // Clear guest mode so the gate comes back after a later sign-out.
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
