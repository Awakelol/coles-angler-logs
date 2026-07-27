// ---------------------------------------------------------------------------
// Small shared UI helpers.
// ---------------------------------------------------------------------------

/** Escape untrusted text before it goes into an innerHTML template. */
export function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

let toastTimer;
export function toast(message) {
  const node = document.getElementById('toast');
  if (!node) return;
  node.textContent = message;
  node.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('is-visible'), 2600);
}

export function fmtDate(iso, opts = { day: 'numeric', month: 'short', year: 'numeric' }) {
  if (!iso) return '—';
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, opts);
}

export function fmtTime(iso, timeZone) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZone });
}

export function fmtWeekday(iso, timeZone) {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { weekday: 'short', timeZone });
}

export function todayISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function round(n, places = 1) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—';
  const f = 10 ** places;
  return String(Math.round(Number(n) * f) / f);
}

/** Show a modal sheet. `render(close)` returns the sheet's inner HTML. */
export function openSheet(title, render, onMount) {
  const backdrop = el(`
    <div class="sheet-backdrop">
      <div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="sheet__head">
          <h2>${esc(title)}</h2>
          <button class="icon-btn" data-close aria-label="Close">
            <svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M18.3 5.7 12 12l6.3 6.3-1.4 1.4L10.6 13.4 4.3 19.7 2.9 18.3 9.2 12 2.9 5.7 4.3 4.3l6.3 6.3 6.3-6.3z"/></svg>
          </button>
        </div>
        <div data-sheet-body></div>
      </div>
    </div>`);

  backdrop.querySelector('[data-sheet-body]').innerHTML = render();
  const close = () => backdrop.remove();

  backdrop.querySelector('[data-close]').addEventListener('click', close);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });
  document.addEventListener('keydown', function onKey(e) {
    if (e.key === 'Escape') {
      close();
      document.removeEventListener('keydown', onKey);
    }
  });

  document.body.appendChild(backdrop);
  if (onMount) onMount(backdrop, close);
  return close;
}

export function loadingBlock(label = 'Loading…') {
  return `
    <div class="card">
      <div class="skeleton" style="height:22px;width:45%"></div>
      <div class="skeleton" style="height:64px"></div>
      <p class="card__sub">${esc(label)}</p>
    </div>`;
}

export function errorBlock(title, message, retryLabel) {
  return `
    <div class="notice notice--error">
      <h3>${esc(title)}</h3>
      <p>${esc(message)}</p>
      ${retryLabel ? `<button class="btn btn--sm" data-retry>${esc(retryLabel)}</button>` : ''}
    </div>`;
}
