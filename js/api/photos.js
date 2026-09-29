// Species reference photos from Wikipedia / Wikimedia Commons, looked up by
// scientific name. No key needed, CORS-enabled, and freely licensed (FishBase
// photos are copyrighted, so those are only linked). Each photo links back to
// its source page for attribution.
//
// Results, including misses, are cached in localStorage for 30 days.

const CACHE_KEY = 'angler.photocache';
const GALLERY_KEY = 'angler.gallerycache';
const TTL_MS = 30 * 24 * 60 * 60 * 1000;
const ENDPOINT = 'https://en.wikipedia.org/api/rest_v1/page/summary/';
const COMMONS = 'https://commons.wikimedia.org/w/api.php';

// Skip range maps, charts, stamps, labels and drawings by filename.
const NOT_A_PHOTO = /(map|distribution|range|chart|diagram|drawing|illustration|stamp|logo|icon|label|sign|graph|skeleton|otolith)/i;

function readCache() {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
  } catch {
    localStorage.removeItem(CACHE_KEY);
    return {};
  }
}

function writeCache(all) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(all));
  } catch {
    // Quota exceeded: clear and start over.
    localStorage.removeItem(CACHE_KEY);
  }
}

const inFlight = new Map();

/**
 * @param {string} scientific  e.g. "Lutjanus argentimaculatus"
 * @returns {Promise<{src:string,page:string,credit:string}|null>} null if no
 *          free photo exists
 */
export function fetchPhoto(scientific) {
  if (!scientific) return Promise.resolve(null);

  const all = readCache();
  const hit = all[scientific];
  if (hit && Date.now() - hit.at < TTL_MS) {
    return Promise.resolve(hit.data);
  }
  if (inFlight.has(scientific)) return inFlight.get(scientific);

  const title = encodeURIComponent(scientific.trim().replace(/\s+/g, '_'));
  const req = fetch(`${ENDPOINT}${title}`, { headers: { Accept: 'application/json' } })
    .then((res) => (res.ok ? res.json() : null))
    .then((d) => {
      const src = d?.thumbnail?.source || null;
      const data = src
        ? {
            src,
            page: d.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${title}`,
            credit: 'Wikimedia Commons',
          }
        : null;
      const store = readCache();
      store[scientific] = { at: Date.now(), data };
      writeCache(store);
      return data;
    })
    .catch(() => null)
    .finally(() => inFlight.delete(scientific));

  inFlight.set(scientific, req);
  return req;
}

function readGalleryCache() {
  try {
    return JSON.parse(localStorage.getItem(GALLERY_KEY) || '{}');
  } catch {
    localStorage.removeItem(GALLERY_KEY);
    return {};
  }
}

const galleriesInFlight = new Map();

/**
 * Several photos of a species from Commons search (the Wikipedia summary
 * endpoint only gives one).
 *
 * @returns {Promise<Array<{src:string,page:string,credit:string,title:string}>>}
 */
export function fetchPhotos(scientific, limit = 4) {
  if (!scientific) return Promise.resolve([]);

  const all = readGalleryCache();
  const hit = all[scientific];
  if (hit && Date.now() - hit.at < TTL_MS) return Promise.resolve(hit.data || []);
  if (galleriesInFlight.has(scientific)) return galleriesInFlight.get(scientific);

  const params = new URLSearchParams({
    action: 'query',
    generator: 'search',
    gsrsearch: `filetype:bitmap ${scientific}`,
    gsrnamespace: '6', // File:
    gsrlimit: String(limit * 3), // over-fetch; filtering drops a lot
    prop: 'imageinfo',
    iiprop: 'url|extmetadata',
    iiurlwidth: '640',
    format: 'json',
    origin: '*',
  });

  const req = fetch(`${COMMONS}?${params}`)
    .then((res) => (res.ok ? res.json() : null))
    .then((d) => {
      const pages = Object.values(d?.query?.pages || {});
      const photos = pages
        .filter((p) => p.imageinfo?.[0]?.thumburl)
        .filter((p) => !NOT_A_PHOTO.test(p.title))
        .map((p) => {
          const info = p.imageinfo[0];
          const artist = info.extmetadata?.Artist?.value || '';
          return {
            src: info.thumburl,
            page: info.descriptionurl,
            // extmetadata values are HTML; strip to text.
            credit: artist.replace(/<[^>]*>/g, '').trim() || 'Wikimedia Commons',
            title: p.title.replace(/^File:/, '').replace(/\.\w+$/, ''),
          };
        })
        .slice(0, limit);

      const store = readGalleryCache();
      store[scientific] = { at: Date.now(), data: photos };
      try {
        localStorage.setItem(GALLERY_KEY, JSON.stringify(store));
      } catch {
        localStorage.removeItem(GALLERY_KEY);
      }
      return photos;
    })
    .catch(() => [])
    .finally(() => galleriesInFlight.delete(scientific));

  galleriesInFlight.set(scientific, req);
  return req;
}

/** Lazily fill `figure[data-photo]` elements in `root` as they scroll into view. */
export function hydratePhotos(root) {
  const figures = [...root.querySelectorAll('figure[data-photo]')];
  if (!figures.length) return;

  const load = async (fig) => {
    const photo = await fetchPhoto(fig.dataset.photo);
    if (!photo) return; // stays hidden
    const img = fig.querySelector('img');
    const cap = fig.querySelector('figcaption');
    img.src = photo.src;
    img.alt = `Photograph of ${fig.dataset.photo}`;
    if (cap) cap.textContent = photo.credit;
    fig.hidden = false;
  };

  if (!('IntersectionObserver' in window)) {
    figures.forEach(load);
    return;
  }

  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        io.unobserve(e.target);
        load(e.target);
      }
    },
    { rootMargin: '300px' }
  );
  figures.forEach((f) => io.observe(f));
}
