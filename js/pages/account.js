// Account / profile page.
//
// The handle (username) is the sign-in identity; the display name is an
// optional label shown instead of it. The avatar and display name are stored
// per account in IndexedDB and don't sync yet (Firestore rules only allow
// users/{uid}/catches).

import { currentUser, signOut, linkedProviders, cloudConfigured,
         renameHandle, handleAvailableAt, USERNAME_RULES } from '../auth.js';
import { store, computeStats, profiles, shownName } from '../store.js';
import { cropAvatar } from '../avatar-crop.js';
import { esc, toast } from '../ui.js';
import { authCardHtml, mountAuthCard, authHeading } from '../auth-ui.js';

const PROVIDER_LABEL = {
  local: 'Username & password',
  username: 'Username & password',
  password: 'Username & password',
  'google.com': 'Google',
};

const DISPLAY_NAME_MAX = 30;

/** Blob URL currently on screen, released when replaced. */
let avatarUrl = null;

function releaseAvatar() {
  if (avatarUrl) {
    URL.revokeObjectURL(avatarUrl);
    avatarUrl = null;
  }
}

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Profile header (cover, avatar, name, stats). Same layout signed in or out.
 * The cover is just the page's glow colour, not an uploaded image.
 */
function profileHeaderHtml({ name, handle, sub, avatar, editable, edit }) {
  return `
    <div class="prof">
      <div class="prof__cover">
        <a class="icon-btn acct-cog" href="#/settings" aria-label="Settings"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="currentColor"><g><rect x="10.7" y="1.7" width="2.6" height="4.6" rx="1.1"/><rect x="10.7" y="1.7" width="2.6" height="4.6" rx="1.1" transform="rotate(45 12 12)"/><rect x="10.7" y="1.7" width="2.6" height="4.6" rx="1.1" transform="rotate(90 12 12)"/><rect x="10.7" y="1.7" width="2.6" height="4.6" rx="1.1" transform="rotate(135 12 12)"/><rect x="10.7" y="1.7" width="2.6" height="4.6" rx="1.1" transform="rotate(180 12 12)"/><rect x="10.7" y="1.7" width="2.6" height="4.6" rx="1.1" transform="rotate(225 12 12)"/><rect x="10.7" y="1.7" width="2.6" height="4.6" rx="1.1" transform="rotate(270 12 12)"/><rect x="10.7" y="1.7" width="2.6" height="4.6" rx="1.1" transform="rotate(315 12 12)"/></g><path fill-rule="evenodd" d="M12 5.4a6.6 6.6 0 1 0 0 13.2 6.6 6.6 0 0 0 0-13.2Zm0 3.9a2.7 2.7 0 1 1 0 5.4 2.7 2.7 0 0 1 0-5.4Z"/></svg></a>
      </div>
      <div class="prof__row">
        ${
          editable
            ? `<button type="button" class="acct-photo prof__pic" id="avatarBtn"
                       aria-label="Change your profile photo">
                 <span class="acct-photo__fill" id="avatarFill">${esc(avatar)}</span>
                 <span class="acct-photo__edit" aria-hidden="true">
                   <svg viewBox="0 0 24 24" width="15" height="15">
                     <path fill="currentColor" d="M9 3h6l1.5 2H20a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h3.5Zm3 5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11Zm0 2.2a3.3 3.3 0 1 1 0 6.6 3.3 3.3 0 0 1 0-6.6Z"/>
                   </svg>
                 </span>
               </button>
               <input type="file" id="avatarInput" accept="image/*" hidden>`
            : // Not editable here, but still show the avatar.
              `<div class="acct-photo prof__pic">
                 <span class="acct-photo__fill${avatar ? '' : ' acct-photo__fill--empty'}"
                       id="avatarFill">${
                         avatar
                           ? esc(avatar)
                           : `<svg viewBox="0 0 24 24" width="34" height="34" aria-hidden="true">
                                <path fill="currentColor" d="M12 3a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9Zm0 11c4.4 0 8 2.5 8 5.5V21H4v-1.5C4 16.5 7.6 14 12 14Z"/>
                              </svg>`
                       }</span>
               </div>`
        }
      </div>
      <div class="prof__who">
        ${
          edit
            ? `<a class="btn btn--sm prof__edit" href="#/account?edit=1">Edit profile</a>`
            : ''
        }
        <h1 class="acct-name" id="acctName">${esc(name)}</h1>
        ${handle ? `<p class="acct-handle">@${esc(handle)}</p>` : ''}
        <p class="acct-sub">${esc(sub)}</p>
      </div>

      <div class="prof__stats" id="acctStats">
        ${['Catches', 'Species', 'Spots', 'Days']
          .map((k) => `<div class="prof__stat"><span class="prof__v">&mdash;</span><span class="prof__k">${k}</span></div>`)
          .join('')}
      </div>
    </div>`;
}

/**
 * Handle field. Changeable once every 30 days and never for synced accounts
 * (see renameHandle() in auth.js). While locked it's shown disabled with the
 * date it unlocks.
 */
function handleFieldHtml(user) {
  if (user.syncs) {
    return `
      <div class="acct-row">
        <div>
          <p class="acct-row__k">Handle</p>
          <p class="acct-row__v">@${esc(user.username)}</p>
        </div>
        <span class="chip chip--family">Sign-in name</span>
      </div>
      <p class="field__hint">
        This account signs in to the cloud, so its handle is fixed here for now.
      </p>`;
  }

  const until = handleAvailableAt(user.id);
  const when = until
    ? until.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
    : null;
  const past = (user.handleHistory || []).slice().reverse();

  return `
    <div class="field">
      <label for="handle">Handle</label>
      <div class="field__count-wrap">
        <input type="text" id="handle" name="handle" value="${esc(user.username)}"
               maxlength="${USERNAME_RULES.max}" autocapitalize="off" autocorrect="off"
               spellcheck="false" autocomplete="username"
               ${until ? 'disabled' : ''}>
        <span class="field__count" id="handleCount" aria-hidden="true">
          ${esc(String(user.username.length))}/${USERNAME_RULES.max}</span>
      </div>
      <p class="field__hint">
        ${
          when
            ? `This is the name you sign in with. You can change it again on
               <strong>${esc(when)}</strong>.`
            : `This is the name you sign in with. ${esc(USERNAME_RULES.describe)}
               You can change it once every 30 days.`
        }
      </p>
      ${
        past.length
          ? `<details class="acct-past">
               <summary>Previously known as</summary>
               <ul class="acct-past__list">
                 ${past
                   .map(
                     (h) => `<li><span>@${esc(h.username)}</span>
                       <span class="acct-past__when">until ${esc(
                         new Date(h.until).toLocaleDateString(undefined, {
                           day: 'numeric', month: 'short', year: 'numeric',
                         })
                       )}</span></li>`
                   )
                   .join('')}
               </ul>
             </details>`
          : ''
      }
    </div>`;
}

/** The edit-profile screen (#/account?edit=1). */
function editHtml(user) {
  return `
    <section class="band band--cream">
      <div class="wrap wrap--narrow">
        <a class="set-back" href="#/account">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"
                  stroke-linejoin="round" d="m14.5 5.5-6.5 6.5 6.5 6.5"/>
          </svg>
          Profile
        </a>
        <h1 class="display display--sm">Edit profile</h1>
        <p class="subtitle subtitle--tight">Your photo and what the app calls you</p>

        <form id="profileForm">
          <div class="edit-photo">
            <button type="button" class="acct-photo" id="avatarBtn"
                    aria-label="Change your profile photo">
              <span class="acct-photo__fill" id="avatarFill">${esc(initials(user.username))}</span>
              <span class="acct-photo__edit" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="15" height="15">
                  <path fill="currentColor" d="M9 3h6l1.5 2H20a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h3.5Zm3 5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11Zm0 2.2a3.3 3.3 0 1 1 0 6.6 3.3 3.3 0 0 1 0-6.6Z"/>
                </svg>
              </span>
            </button>
            <input type="file" id="avatarInput" accept="image/*" hidden>
            <div class="edit-photo__acts">
              <button type="button" class="btn btn--sm" id="pickAvatar">Change photo</button>
              <button type="button" class="btn btn--sm btn--danger" id="removeAvatar" hidden>Remove</button>
            </div>
          </div>

          <div class="card acct-rows">
            <div class="field">
              <label for="displayName">Display name</label>
              <div class="field__count-wrap">
                <input type="text" id="displayName" name="displayName"
                       maxlength="${DISPLAY_NAME_MAX}" autocomplete="nickname"
                       placeholder="${esc(user.username)}">
                <span class="field__count" id="nameCount" aria-hidden="true">0/${DISPLAY_NAME_MAX}</span>
              </div>
              <p class="field__hint">
                What the app calls you. Leave it empty to go by your handle.
              </p>
            </div>

            ${handleFieldHtml(user)}
          </div>

          ${
            cloudConfigured() && user.syncs
              ? `<p class="field__hint">Your photo and display name stay on this device
                   for now &mdash; only catches sync.</p>`
              : ''
          }

          <div class="edit-save">
            <button type="submit" class="btn btn--primary btn--block" id="saveProfile">Save</button>
          </div>
        </form>
      </div>
    </section>`;
}

export function render(ctx) {
  const user = currentUser();

  if (!user) {
    return `
      <section class="band band--cream">
        <div class="wrap">
          ${profileHeaderHtml({
            name: 'Your log',
            handle: '',
            sub: 'On this device · not signed in',
            avatar: '',
            editable: false,
          })}

          <div class="section-head" style="margin-top:22px">
            <h2>Keep it yours</h2>
            <p>An account keeps this log yours on a shared phone, and carries it
               to another device. Nothing is lost by waiting &mdash; everything
               above is adopted by the first account you make.</p>
          </div>

          ${authCardHtml()}
        </div>
      </section>`;
  }

  // Editing is a separate screen (?edit=1) opened from the Edit button.
  if (ctx?.params?.get('edit')) return editHtml(user);

  const providers = linkedProviders();
  return `
    <section class="band band--cream">
      <div class="wrap">
        ${profileHeaderHtml({
          name: shownName(user) || user.username,
          handle: user.username,
          sub: user.syncs ? 'Synced to the cloud' : 'On this device only',
          avatar: initials(user.username),
          editable: false,
          edit: true,
        })}
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
          <button class="btn btn--block btn--danger" id="acctSignOut">Sign out</button>
          <p class="field__hint">
            Signing out hides your catches rather than deleting them. They are still
            here when you sign back in.
          </p>
        </div>
      </div>
    </section>`;
}

/** Fill the stat strip. Signed out, this shows the guest log. */
async function paintStats(root, userId, regionId) {
  const box = root.querySelector('#acctStats');
  if (!box) return;
  const [catches, spots] = await Promise.all([
    store.catchesFor(userId),
    userId ? store.allSpots(userId, regionId) : [],
  ]);
  if (!box.isConnected) return;
  const stats = computeStats(catches);
  // Days fished = distinct dates in the log.
  const days = new Set(catches.map((c) => c.date).filter(Boolean)).size;
  const values = [
    [catches.length, 'Catches'],
    [stats.speciesCount, 'Species'],
    [spots.length, 'Spots'],
    [days, 'Days'],
  ];
  box.innerHTML = values
    .map(
      ([v, k]) => `
      <div class="prof__stat">
        <span class="prof__v">${esc(String(v))}</span>
        <span class="prof__k">${esc(k)}</span>
      </div>`
    )
    .join('');
}

export async function mount(root, ctx) {
  const user = currentUser();

  // Signed out: the sign-in card (no guest option here; that's on the log).
  if (!user) {
    // Stats still show the guest log.
    paintStats(root, null, ctx.regionId).catch(() => {});
    mountAuthCard(root, { onDone: () => ctx.navigate('/account'), allowGuest: false });
    return;
  }

  root.querySelector('#acctSignOut')?.addEventListener('click', async () => {
    await signOut();
    toast('Signed out');
    location.hash = '#/';
  });

  const fill = root.querySelector('#avatarFill');
  const nameEl = root.querySelector('#acctName');
  const input = root.querySelector('#displayName');
  const removeBtn = root.querySelector('#removeAvatar');

  const paint = (profile) => {
    if (nameEl) nameEl.textContent = shownName(user, profile);
    if (input) input.value = profile?.displayName || '';

    releaseAvatar();
    if (profile?.avatar && fill) {
      avatarUrl = URL.createObjectURL(profile.avatar);
      fill.innerHTML = `<img src="${avatarUrl}" alt="">`;
      if (removeBtn) removeBtn.hidden = false;
    } else if (fill) {
      fill.textContent = initials(shownName(user, profile));
      if (removeBtn) removeBtn.hidden = true;
    }
  };

  // Load stats after the first paint.
  const profile = await profiles.get(user.id);
  if (!root.isConnected) {
    releaseAvatar();
    return;
  }
  paint(profile);
  await paintStats(root, user.id, ctx.regionId);
  if (!root.isConnected) {
    releaseAvatar();
    return;
  }

  // --- avatar ---
  const picker = root.querySelector('#avatarInput');
  root.querySelector('#avatarBtn')?.addEventListener('click', () => picker?.click());
  root.querySelector('#pickAvatar')?.addEventListener('click', () => picker?.click());

  picker?.addEventListener('change', async () => {
    const file = picker.files?.[0];
    if (!file) return;
    try {
      // null = cancelled.
      const blob = await cropAvatar(file);
      if (blob) {
        paint(await profiles.save(user.id, { avatar: blob }));
        toast('Photo updated');
      }
    } catch (err) {
      toast(err.message || 'Could not use that photo');
    } finally {
      // Reset so picking the same file again fires change.
      picker.value = '';
    }
  });

  removeBtn?.addEventListener('click', async () => {
    paint(await profiles.clearAvatar(user.id));
    toast('Photo removed');
  });

  // --- names ---
  const count = root.querySelector('#nameCount');
  const tally = () => {
    if (count && input) count.textContent = `${input.value.length}/${DISPLAY_NAME_MAX}`;
  };
  input?.addEventListener('input', tally);
  tally();

  const handleEl = root.querySelector('#handle');
  const handleCount = root.querySelector('#handleCount');
  handleEl?.addEventListener('input', () => {
    if (handleCount) handleCount.textContent = `${handleEl.value.length}/${USERNAME_RULES.max}`;
  });

  root.querySelector('#profileForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    // Rename the handle first; if that fails, save nothing.
    if (handleEl && !handleEl.disabled) {
      const wanted = handleEl.value.trim();
      if (wanted && wanted !== user.username) {
        try {
          await renameHandle(wanted);
          toast(`You are @${wanted} now`);
        } catch (err) {
          toast(err.message || 'Could not change your handle');
          handleEl.focus();
          return;
        }
      }
    }

    const value = (input?.value || '').trim().slice(0, DISPLAY_NAME_MAX);
    paint(await profiles.save(user.id, { displayName: value }));
    if (!handleEl || handleEl.disabled || handleEl.value.trim() === user.username) {
      toast(value ? 'Display name saved' : 'Going by your handle');
    }
    // Back to the profile.
    if (ctx?.params?.get('edit')) ctx.navigate('/account');
  });
}
