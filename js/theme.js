// ---------------------------------------------------------------------------
// THEME
//
// Three settings: 'light', 'dark', 'system'. The choice lives in its own
// localStorage key rather than in prefs, because index.html reads it in a
// blocking inline script before first paint — without that, the page renders
// cream and then snaps to dark, which is worse than having no dark mode.
//
// The applied theme is written to <html data-theme>, and CSS keys off that.
// 'system' resolves live, so the app follows the phone flipping to dark at
// sunset without needing a reload.
// ---------------------------------------------------------------------------

export const THEME_KEY = 'angler.theme';
export const THEMES = ['light', 'dark', 'system'];

// The light theme has been rebuilt on the blue/off-white palette; dark has not.
// Rather than ship a half-retuned dark mode, the picker is hidden and light is
// forced. The theme system itself is untouched — flip this back to false and
// the setting returns, along with whatever dark mode currently looks like.
export const THEME_LOCKED = false;

// Matches the --cream / page background of each theme, so the phone's status
// bar and PWA chrome tint to match instead of staying stuck on yellow.
// Must match --cream / the page canvas for each theme, or the phone's status
// bar sits a shade off the top of the page. Dark is GitHub's canvas colour.
const THEME_COLOR = { light: '#F6F4EA', dark: '#080B14' };

export function getTheme() {
  if (THEME_LOCKED) return 'light';
  const saved = localStorage.getItem(THEME_KEY);
  return THEMES.includes(saved) ? saved : 'system';
}

export function systemPrefersDark() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
}

/** The theme actually in force — 'system' resolved to light or dark. */
export function resolvedTheme(choice = getTheme()) {
  return choice === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : choice;
}

export function applyTheme(choice = getTheme()) {
  const resolved = resolvedTheme(choice);
  document.documentElement.setAttribute('data-theme', resolved);
  // Tells the browser to render form controls and scrollbars to match.
  document.documentElement.style.colorScheme = resolved;

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', THEME_COLOR[resolved] || THEME_COLOR.light);
  return resolved;
}

export function setTheme(choice) {
  const next = THEMES.includes(choice) ? choice : 'system';
  localStorage.setItem(THEME_KEY, next);
  return applyTheme(next);
}

/** Follow the OS while the user is on 'system'. */
export function watchSystemTheme() {
  if (typeof matchMedia !== 'function') return;
  const mq = matchMedia('(prefers-color-scheme: dark)');
  const onChange = () => {
    if (getTheme() === 'system') applyTheme('system');
  };
  if (mq.addEventListener) mq.addEventListener('change', onChange);
  else if (mq.addListener) mq.addListener(onChange);
}
