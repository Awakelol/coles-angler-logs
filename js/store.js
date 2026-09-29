// Persistence.
//
// Catches, spots and profiles live in IndexedDB (photos are Blobs, which
// localStorage can't hold). Small prefs stay in localStorage.
//
// IndexedDB is the source of truth even for synced accounts: writes land here
// first and js/sync.js pushes them later, so the app works offline.
//
// Deletes are soft: a deleted row keeps `deleted: true` and a new updatedAt so
// the deletion can sync to other devices. Otherwise another device would just
// push the row back. Tombstones are purged after TOMBSTONE_TTL_DAYS.

const DB_NAME = 'anglerlog';
// v2 added spots, v3 added profiles.
const DB_VERSION = 3;
const CATCHES = 'catches';
const SPOTS = 'spots';
const PROFILES = 'profiles';

const TOMBSTONE_TTL_DAYS = 180;

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
      // User-dropped map spots (not the region's built-in ones).
      if (!db.objectStoreNames.contains(SPOTS)) {
        const store = db.createObjectStore(SPOTS, { keyPath: 'id' });
        store.createIndex('by-region', 'regionId');
      }
      // Display name + avatar blob, one row per account.
      if (!db.objectStoreNames.contains(PROFILES)) {
        db.createObjectStore(PROFILES, { keyPath: 'id' });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  return dbPromise;
}

function txIn(name, mode, fn) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(name, mode);
        const store = t.objectStore(name);
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

const tx = (mode, fn) => txIn(CATCHES, mode, fn);
const spotTx = (mode, fn) => txIn(SPOTS, mode, fn);

const wrap = (req) => ({ __req: req });

export const store = {
  /**
   * A user's live catches, newest first. Pass null for every record on the
   * device. Rows with no userId predate accounts (see adoptOrphans).
   */
  async allCatches(userId = null) {
    const rows = (await tx('readonly', (s) => wrap(s.getAll()))) || [];
    const mine = (userId === null ? rows : rows.filter((r) => r.userId === userId))
      .filter((r) => !r.deleted);
    return mine.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  },

  /**
   * The log a page should show: the user's catches, or for a guest (no user)
   * only the catches with no owner, never other accounts' rows.
   */
  async catchesFor(userId) {
    if (userId) return this.allCatches(userId);
    return (await this.allCatches(null)).filter((r) => !r.userId);
  },

  /** Includes tombstones. For sync only; screens should use allCatches(). */
  async allRecords(userId = null) {
    const rows = (await tx('readonly', (s) => wrap(s.getAll()))) || [];
    return userId === null ? rows : rows.filter((r) => r.userId === userId);
  },

  /** Give ownerless rows to a user. Called when the first account is created. */
  async adoptOrphans(userId) {
    const rows = (await tx('readonly', (s) => wrap(s.getAll()))) || [];
    const orphans = rows.filter((r) => !r.userId);
    for (const row of orphans) {
      await tx('readwrite', (s) => s.put({ ...row, userId }));
    }
    return orphans.length;
  },

  /**
   * Re-key a user's rows, e.g. local id -> Firebase uid when a device-only
   * account is upgraded. Must happen before the first push.
   */
  async reassignOwner(fromUserId, toUserId) {
    if (!fromUserId || !toUserId || fromUserId === toUserId) return 0;
    const rows = (await tx('readonly', (s) => wrap(s.getAll()))) || [];
    const mine = rows.filter((r) => r.userId === fromUserId);
    for (const row of mine) {
      // Leave updatedAt alone so these don't look newer than the cloud copy.
      await tx('readwrite', (s) => s.put({ ...row, userId: toUserId }));
    }
    return mine.length;
  },

  async deleteAllFor(userId) {
    const rows = (await tx('readonly', (s) => wrap(s.getAll()))) || [];
    for (const row of rows.filter((r) => r.userId === userId)) {
      await tx('readwrite', (s) => s.delete(row.id));
    }
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

  /**
   * Write a record as-is without stamping updatedAt. Used for rows pulled from
   * the cloud; stamping them would make sync push them straight back.
   */
  async putRaw(record) {
    await tx('readwrite', (s) => s.put(record));
    return record;
  },

  /** Soft delete (see top of file). */
  async deleteCatch(id) {
    const existing = await tx('readonly', (s) => wrap(s.get(id)));
    if (!existing) return;
    // Drop the media; a tombstone doesn't need it.
    const { photo, video, poster, ...rest } = existing;
    await tx('readwrite', (s) =>
      s.put({ ...rest, deleted: true, updatedAt: new Date().toISOString() })
    );
  },

  /** Permanently remove a row. Used by sync and tombstone purging. */
  async hardDelete(id) {
    await tx('readwrite', (s) => s.delete(id));
  },

  /** Remove tombstones older than ttlDays. */
  async purgeTombstones(ttlDays = TOMBSTONE_TTL_DAYS) {
    const cutoff = new Date(Date.now() - ttlDays * 86400000).toISOString();
    const rows = (await tx('readonly', (s) => wrap(s.getAll()))) || [];
    let purged = 0;
    for (const row of rows) {
      if (row.deleted && (row.updatedAt || '') < cutoff) {
        await tx('readwrite', (s) => s.delete(row.id));
        purged++;
      }
    }
    return purged;
  },

  async clearCatches() {
    await tx('readwrite', (s) => s.clear());
  },

  // --- user spots -------------------------------------------------------------
  //
  // Not the same as `region.spots` (built-in places). These are per-user map
  // marks with the same shape as catches (userId, timestamps, soft delete).
  // They don't sync yet.

  /** One user's spots in a region, newest first. Tombstones excluded. */
  async allSpots(userId = null, regionId = null) {
    const rows = (await spotTx('readonly', (s) => wrap(s.getAll()))) || [];
    return rows
      .filter((r) => !r.deleted)
      .filter((r) => (userId === null ? true : r.userId === userId))
      .filter((r) => (regionId === null ? true : r.regionId === regionId))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  },

  async saveSpot(spot) {
    const record = { ...spot };
    if (!record.id) record.id = crypto.randomUUID();
    if (!record.createdAt) record.createdAt = new Date().toISOString();
    record.updatedAt = new Date().toISOString();
    await spotTx('readwrite', (s) => s.put(record));
    return record;
  },

  /** Soft delete. */
  async deleteSpot(id) {
    const existing = await spotTx('readonly', (s) => wrap(s.get(id)));
    if (!existing) return;
    await spotTx('readwrite', (s) =>
      s.put({ ...existing, deleted: true, updatedAt: new Date().toISOString() })
    );
  },

  /** Same as adoptOrphans, for spots. */
  async adoptOrphanSpots(userId) {
    const rows = (await spotTx('readonly', (s) => wrap(s.getAll()))) || [];
    const orphans = rows.filter((r) => !r.userId);
    for (const row of orphans) await spotTx('readwrite', (s) => s.put({ ...row, userId }));
    return orphans.length;
  },

  /** Same as reassignOwner, for spots. */
  async reassignSpotOwner(fromUserId, toUserId) {
    if (!fromUserId || !toUserId || fromUserId === toUserId) return 0;
    const rows = (await spotTx('readonly', (s) => wrap(s.getAll()))) || [];
    const mine = rows.filter((r) => r.userId === fromUserId);
    for (const row of mine) await spotTx('readwrite', (s) => s.put({ ...row, userId: toUserId }));
    return mine.length;
  },

  async deleteAllSpotsFor(userId) {
    const rows = (await spotTx('readonly', (s) => wrap(s.getAll()))) || [];
    for (const row of rows.filter((r) => r.userId === userId)) {
      await spotTx('readwrite', (s) => s.delete(row.id));
    }
  },

  async clearSpots() {
    await spotTx('readwrite', (s) => s.clear());
  },
};

// --- small preferences -----------------------------------------------------

const PREFS_KEY = 'angler.prefs';

/**
 * Display name and avatar. The username (handle) is the account identity;
 * the display name is optional and falls back to the handle.
 *
 * Device-only for now: the Firestore rules only allow users/{uid}/catches.
 */
export const profiles = {
  async get(userId) {
    if (!userId) return null;
    return (await txIn(PROFILES, 'readonly', (s) => wrap(s.get(userId)))) || null;
  },

  async save(userId, patch) {
    if (!userId) throw new Error('A profile needs an account to belong to.');
    const current = (await this.get(userId)) || { id: userId };
    const next = { ...current, ...patch, id: userId, updatedAt: Date.now() };
    await txIn(PROFILES, 'readwrite', (s) => s.put(next));
    return next;
  },

  /** Remove the avatar, keep the name. */
  async clearAvatar(userId) {
    const current = await this.get(userId);
    if (!current) return null;
    const { avatar, ...rest } = current;
    await txIn(PROFILES, 'readwrite', (s) => s.put({ ...rest, updatedAt: Date.now() }));
    return rest;
  },
};

/** Display name if set, otherwise the username. */
export function shownName(user, profile) {
  const chosen = (profile?.displayName || '').trim();
  return chosen || user?.username || '';
}

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
 * Personal records. "Biggest" per species compares weight first, then length,
 * so entries with only one of the two still count.
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

/** Photos and clips aren't included; Blobs don't survive JSON. */
export async function exportJson(userId = null) {
  const catches = await store.catchesFor(userId);
  return JSON.stringify(
    {
      app: "Cole's Angler Log",
      exportedAt: new Date().toISOString(),
      version: 1,
      prefs: prefs.all(),
      catches: catches.map(({ photo, video, poster, ...rest }) => ({
        ...rest,
        hadPhoto: Boolean(photo),
        hadVideo: Boolean(video),
      })),
    },
    null,
    2
  );
}

/** Imported catches are given to `userId` so they show up in that user's log. */
export async function importJson(text, userId = null) {
  const data = JSON.parse(text);
  if (!Array.isArray(data.catches)) throw new Error('Not a valid Angler Log export');
  let n = 0;
  for (const c of data.catches) {
    const { hadPhoto, hadVideo, deleted, ...rest } = c;
    await store.saveCatch({ ...rest, userId });
    n++;
  }
  return n;
}
