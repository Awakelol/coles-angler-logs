// ---------------------------------------------------------------------------
// SPECIES PHOTOS
//
// Real reference photos, fetched by scientific name from the Wikipedia REST
// API. No key, CORS-enabled, and everything on Wikimedia Commons carries a
// free licence (CC or public domain) — unlike FishBase photos, which are
// copyrighted by individual contributors and may not be embedded. Each photo
// links back to its Wikipedia page, which is the attribution requirement.
//
// Results (including misses) are cached in localStorage for 30 days, so the
// grid costs at most one request per species ever, not one per page view.
// ---------------------------------------------------------------------------

const CACHE_KEY = 'angler.photocache';
const GALLERY_KEY = 'angler.gallerycache';
const TTL_MS = 30 * 24 * 60 * 60 * 1000;
const ENDPOINT = 'https://en.wikipedia.org/api/rest_v1/page/summary/';
const COMMONS = 'https://commons.wikimedia.org/w/api.php';

// Commons search returns plenty that isn't a photo of the animal: range maps,
// distribution charts, stamps, museum labels, line drawings. Cheap to filter
// on the filename, and far better than showing a distribution map as if it
// were the fish.
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
    // Quota hit — start over rather than wedging every future lookup.
    localStorage.removeItem(CACHE_KEY);
  }
}

const inFlight = new Map();

/**
 * @param {string} scientific  e.g. "Lutjanus argentimaculatus"
 * @returns {Promise<{src:string,page:string,credit:string}|null>} null when
 *          the species has no free photo — callers should hide the slot.
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
 * Several photos of one species, from Wikimedia Commons.
 *
 * The Wikipedia summary endpoint only ever returns one image, so the detail
 * sheet uses Commons search instead to show a few angles — a fish in the hand
 * looks very different to one on a reef.
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
            // extmetadata values are HTML fragments; strip to plain text.
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

/**
 * Fill `figure[data-photo]` elements inside `root` as they scroll into view.
 * Lazy on purpose: the guide shows 40 species and eagerly fetching all of
 * them would be 40 requests for art most people never scroll to.
 */
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
