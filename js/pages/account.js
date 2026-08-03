// ---------------------------------------------------------------------------
// ACCOUNT — the skeleton
//
// The tab used to be an inert button that went nowhere, which was honest while
// nothing was designed. This is the shape of the screen, not the finished
// thing: it shows who you are, what your log adds up to, and the way out.
//
// THE DISPLAY NAME IS DELIBERATELY NOT WIRED. Gabriel wants users to choose one
// and asked for the skeleton only, so the row is present, visibly disabled, and
// says so. A control that looks live and silently does nothing is worse than no
// control — and worse than this one, which tells you it is coming.
// ---------------------------------------------------------------------------

import { currentUser, signOut, linkedProviders, cloudConfigured } from '../auth.js';
import { store, computeStats } from '../store.js';
import { esc, toast } from '../ui.js';

const PROVIDER_LABEL = {
  local: 'Username & password',
  username: 'Username & password',
  password: 'Username & password',
  'google.com': 'Google',
};

export function render(ctx) {
  const user = currentUser();

  if (!user) {
    return `
      <section class="band band--cream">
        <div class="wrap">
          <div class="acct-hero">
            <!-- currentColor, not an icon from the palette set: those carry a
                 gold accent slot and a gold hook on a blue app is the one thing
                 that would give the old palette away. -->
            <div class="acct-avatar acct-avatar--empty" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="30" height="30">
                <path fill="currentColor" d="M12 3a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9Zm0 11c4.4 0 8 2.5 8 5.5V21H4v-1.5C4 16.5 7.6 14 12 14Z"/>
              </svg>
            </div>
            <div>
              <h1 class="acct-name">Not signed in</h1>
              <p class="acct-sub">Your catches and spots live on this device</p>
            </div>
          </div>
          <div class="card">
            <p class="card__body">
              An account keeps your log yours on a shared phone, and carries it to
              another device. Nothing is lost by waiting — anything you record now
              is adopted by the first account you make.
            </p>
            <a class="btn btn--primary btn--block" href="#/log">Sign in or create an account</a>
          </div>
        </div>
      </section>`;
  }

  const providers = linkedProviders();
  return `
    <section class="band band--cream">
      <div class="wrap">
        <div class="acct-hero">
          <div class="acct-avatar">${esc(user.username.slice(0, 1).toUpperCase())}</div>
          <div class="acct-hero__who">
            <h1 class="acct-name">${esc(user.username)}</h1>
            <p class="acct-sub">${user.syncs ? 'Synced to the cloud' : 'On this device only'}</p>
          </div>
        </div>

        <!-- Filled by mount() once the log has been read. -->
        <div class="acct-stats" id="acctStats">
          <div class="acct-stat"><span class="acct-stat__v">&mdash;</span><span class="acct-stat__k">Catches</span></div>
          <div class="acct-stat"><span class="acct-stat__v">&mdash;</span><span class="acct-stat__k">Species</span></div>
          <div class="acct-stat"><span class="acct-stat__v">&mdash;</span><span class="acct-stat__k">Spots</span></div>
        </div>
      </div>
    </section>

    <section class="band band--cream">
      <div class="wrap">
        <div class="section-head"><h2>Profile</h2><p>How you appear in the app</p></div>
        <div class="card acct-rows">
          <div class="acct-row">
            <div>
              <p class="acct-row__k">Username</p>
              <p class="acct-row__v">${esc(user.username)}</p>
            </div>
            <span class="chip chip--family">Sign-in name</span>
          </div>

          <!-- Skeleton. Present so the shape of the screen is right, disabled
               so it cannot pretend to work. -->
          <div class="acct-row acct-row--soon">
            <div>
              <p class="acct-row__k">Display name</p>
              <p class="acct-row__v acct-row__v--muted">Not set</p>
            </div>
            <button class="btn btn--sm" disabled aria-disabled="true">Coming soon</button>
          </div>
          <p class="field__hint">
            A display name you pick for yourself, separate from the name you sign in
            with. Not built yet.
          </p>
        </div>
      </div>
    </section>

    <section class="band band--sky">
      <div class="wrap">
        <div class="section-head"><h2>Sign-in</h2><p>How you get back in</p></div>
        <div class="card acct-rows">
          ${
            providers.length
              ? providers
                  .map(
                    (p) => `
                <div class="acct-row">
                  <div>
                    <p class="acct-row__k">${esc(PROVIDER_LABEL[p] || p)}</p>
                    <p class="acct-row__v acct-row__v--muted">Connected</p>
                  </div>
                  <span class="chip chip--target">Active</span>
                </div>`
                  )
                  .join('')
              : `<div class="acct-row">
                   <div>
                     <p class="acct-row__k">Username &amp; password</p>
                     <p class="acct-row__v acct-row__v--muted">On this device</p>
                   </div>
                 </div>`
          }
          ${
            cloudConfigured() && !user.syncs
              ? `<p class="field__hint">This account is device-only. Signing in again with
                   the same name upgrades it and carries your catches across.</p>`
              : ''
          }
          <a class="btn btn--sm" href="#/settings">All settings &rarr;</a>
        </div>
      </div>
    </section>

    <section class="band band--cream">
      <div class="wrap">
        <div class="card">
          <button class="btn btn--block" id="acctSignOut">Sign out</button>
          <p class="field__hint">
            Signing out hides your catches rather than deleting them. They are still
            here when you sign back in.
          </p>
        </div>
      </div>
    </section>`;
}

export async function mount(root, ctx) {
  const user = currentUser();

  root.querySelector('#acctSignOut')?.addEventListener('click', async () => {
    await signOut();
    toast('Signed out');
    location.hash = '#/';
  });

  const box = root.querySelector('#acctStats');
  if (!box || !user) return;

  // Read after paint rather than blocking the screen on IndexedDB: the header
  // is the part you came for, and three numbers arriving a moment later is
  // better than the whole page waiting on them.
  const [catches, spots] = await Promise.all([
    store.allCatches(user.id),
    store.allSpots(user.id, ctx.regionId),
  ]);
  if (!box.isConnected) return;

  const stats = computeStats(catches);
  const values = [
    [catches.length, 'Catches'],
    [stats.species ?? new Set(catches.map((c) => c.speciesId)).size, 'Species'],
    [spots.length, 'Spots'],
  ];
  box.innerHTML = values
    .map(
      ([v, k]) => `
      <div class="acct-stat">
        <span class="acct-stat__v">${esc(String(v))}</span>
        <span class="acct-stat__k">${esc(k)}</span>
      </div>`
    )
    .join('');
}
