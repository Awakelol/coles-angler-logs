// Theme: 'light', 'dark' or 'system'.
//
// Stored under its own localStorage key (not prefs) because index.html reads it
// in an inline script before first paint to avoid a light->dark flash. The
// resolved theme goes on <html data-theme>.

export const THEME_KEY = 'angler.theme';
export const THEMES = ['light', 'dark', 'system'];

// Set to true to hide the theme picker and force light mode.
export const THEME_LOCKED = false;

// Status bar colour. Keep in sync with --cream in style.css.
const THEME_COLOR = { light: '#F6F4EA', dark: '#080B14' };

export function getTheme() {
  if (THEME_LOCKED) return 'light';
  const saved = localStorage.getItem(THEME_KEY);
  return THEMES.includes(saved) ? saved : 'system';
}

export function systemPrefersDark() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
}

/** 'system' resolved to 'light' or 'dark'. */
export function resolvedTheme(choice = getTheme()) {
  return choice === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : choice;
}

export function applyTheme(choice = getTheme()) {
  const resolved = resolvedTheme(choice);
  document.documentElement.setAttribute('data-theme', resolved);
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
