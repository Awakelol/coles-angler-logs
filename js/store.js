// ---------------------------------------------------------------------------
// PERSISTENCE
//
// Catches live in IndexedDB so photos can be stored as Blobs (localStorage is
// strings-only and would blow its ~5 MB quota on the first photo). Small
// preferences stay in localStorage where the synchronous read is convenient.
//
// Everything is local to the device — no server, no account. Use the JSON
// export on the Settings screen to back up or move between phones.
// ---------------------------------------------------------------------------

const DB_NAME = 'anglerlog';
const DB_VERSION = 1;
const CATCHES = 'catches';

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(CATCHES)) {
        const store = db.createObjectStore(CATCHES, { keyPath: 'id' });
        store.createIndex('by-date', 'date');
        store.createIndex('by-species', 'speciesId');
        store.createIndex('by-region', 'regionId');
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  return dbPromise;
}

function tx(mode, fn) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(CATCHES, mode);
        const store = t.objectStore(CATCHES);
        let result;
        try {
          result = fn(store);
        } catch (err) {
          reject(err);
          return;
        }
        t.oncomplete = () => resolve(result && result.__req ? result.__req.result : result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      })
  );
}

const wrap = (req) => ({ __req: req });

export const store = {
  async allCatches() {
    const rows = await tx('readonly', (s) => wrap(s.getAll()));
    // Newest first.
    return (rows || []).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  },

  async getCatch(id) {
    return tx('readonly', (s) => wrap(s.get(id)));
  },

  async saveCatch(entry) {
    const record = { ...entry };
    if (!record.id) record.id = crypto.randomUUID();
    if (!record.createdAt) record.createdAt = new Date().toISOString();
    record.updatedAt = new Date().toISOString();
    await tx('readwrite', (s) => s.put(record));
    return record;
  },

  async deleteCatch(id) {
    await tx('readwrite', (s) => s.delete(id));
  },

  async clearCatches() {
    await tx('readwrite', (s) => s.clear());
  },
};

// --- small preferences -----------------------------------------------------

const PREFS_KEY = 'angler.prefs';

export const prefs = {
  all() {
    try {
      return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    } catch {
      return {};
    }
  },
  get(key, fallback = null) {
    const v = this.all()[key];
    return v === undefined ? fallback : v;
  },
  set(key, value) {
    const all = this.all();
    all[key] = value;
    localStorage.setItem(PREFS_KEY, JSON.stringify(all));
  },
};

// --- derived stats ---------------------------------------------------------

/**
 * Personal records. `biggest` keys on species and prefers weight, falling back
 * to length so an entry with only one of the two still counts.
 */
export function computeStats(catches) {
  const stats = {
    total: catches.length,
    speciesCount: new Set(catches.map((c) => c.speciesId).filter(Boolean)).size,
    totalWeightKg: 0,
    biggestBySpecies: new Map(),
    bySpecies: new Map(),
    byMonth: new Map(),
    heaviest: null,
    longest: null,
  };

  for (const c of catches) {
    const weight = Number(c.weightKg) || 0;
    const length = Number(c.lengthCm) || 0;
    stats.totalWeightKg += weight;

    if (c.speciesId) {
      stats.bySpecies.set(c.speciesId, (stats.bySpecies.get(c.speciesId) || 0) + 1);

      const best = stats.biggestBySpecies.get(c.speciesId);
      const better =
        !best ||
        weight > (Number(best.weightKg) || 0) ||
        (weight === (Number(best.weightKg) || 0) && length > (Number(best.lengthCm) || 0));
      if (better) stats.biggestBySpecies.set(c.speciesId, c);
    }

    if (weight && (!stats.heaviest || weight > Number(stats.heaviest.weightKg))) stats.heaviest = c;
    if (length && (!stats.longest || length > Number(stats.longest.lengthCm))) stats.longest = c;

    if (c.date) {
      const month = c.date.slice(0, 7);
      stats.byMonth.set(month, (stats.byMonth.get(month) || 0) + 1);
    }
  }

  return stats;
}

// --- backup ----------------------------------------------------------------

/** Photos are dropped from the export — Blobs don't survive JSON. */
export async function exportJson() {
  const catches = await store.allCatches();
  return JSON.stringify(
    {
      app: "Cole's Angler Log",
      exportedAt: new Date().toISOString(),
      version: 1,
      prefs: prefs.all(),
      catches: catches.map(({ photo, ...rest }) => ({ ...rest, hadPhoto: Boolean(photo) })),
    },
    null,
    2
  );
}

export async function importJson(text) {
  const data = JSON.parse(text);
  if (!Array.isArray(data.catches)) throw new Error('Not a valid Angler Log export');
  let n = 0;
  for (const c of data.catches) {
    const { hadPhoto, ...rest } = c;
    await store.saveCatch(rest);
    n++;
  }
  return n;
}
