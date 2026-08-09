// ---------------------------------------------------------------------------
// PERSISTENCE
//
// Catches live in IndexedDB so photos can be stored as Blobs (localStorage is
// strings-only and would blow its ~5 MB quota on the first photo). Small
// preferences stay in localStorage where the synchronous read is convenient.
//
// IndexedDB is the source of truth even for accounts that sync: the app has to
// work on the water with no signal, so every write lands here first and is
// pushed later (js/sync.js).
//
// DELETES ARE SOFT. A removed catch becomes a tombstone — the record stays with
// `deleted: true` and a fresh updatedAt — rather than vanishing. Hard deletion
// cannot survive syncing: phone A deletes a catch, phone B still has it, the
// next pull sees a row A doesn't have and helpfully restores it. The user
// deletes it again. Forever. A tombstone is a fact that can be synced; an
// absence is not. Tombstones are purged after TOMBSTONE_TTL_DAYS, by which
// point every device has long since seen them.
// ---------------------------------------------------------------------------

const DB_NAME = 'anglerlog';
// v2 added SPOTS, v3 added PROFILES. The upgrade only creates what is missing,
// so an existing database keeps every catch in it.
const DB_VERSION = 3;
const CATCHES = 'catches';
const SPOTS = 'spots';
const PROFILES = 'profiles';

// Long enough that a phone left in a drawer for a season still learns about
// deletions when it comes back; short enough that the store doesn't grow
// forever with rows nobody will ever look at.
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
      // Places the user dropped on the map themselves — their own marks, as
      // opposed to the zones and spots that ship with a region.
      if (!db.objectStoreNames.contains(SPOTS)) {
        const store = db.createObjectStore(SPOTS, { keyPath: 'id' });
        store.createIndex('by-region', 'regionId');
      }
      // Display name and avatar, one row per account. Here rather than in
      // localStorage because an avatar is a Blob, and localStorage is strings
      // with a ~5 MB cap — the same reason catches live here.
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

// Every existing call reads and writes catches; keeping the short name means
// the store below stays as it was.
const tx = (mode, fn) => txIn(CATCHES, mode, fn);
const spotTx = (mode, fn) => txIn(SPOTS, mode, fn);

const wrap = (req) => ({ __req: req });

export const store = {
  /**
   * Catches belonging to the signed-in user, newest first.
   *
   * Records are scoped by `userId` so several people can share a device and
   * keep separate logs. Entries written before profiles existed have no
   * userId; they're adopted by the first account created (see adoptOrphans).
   */
  async allCatches(userId = null) {
    const rows = (await tx('readonly', (s) => wrap(s.getAll()))) || [];
    const mine = (userId === null ? rows : rows.filter((r) => r.userId === userId))
      .filter((r) => !r.deleted);
    return mine.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  },

  /**
   * Everything including tombstones. Only js/sync.js wants this — every screen
   * in the app should be calling allCatches() and seeing live records.
   */
  async allRecords(userId = null) {
    const rows = (await tx('readonly', (s) => wrap(s.getAll()))) || [];
    return userId === null ? rows : rows.filter((r) => r.userId === userId);
  },

  /**
   * Hand pre-profile entries to a user. Called once when the first account is
   * created, so switching on profiles doesn't appear to delete the log.
   */
  async adoptOrphans(userId) {
    const rows = (await tx('readonly', (s) => wrap(s.getAll()))) || [];
    const orphans = rows.filter((r) => !r.userId);
    for (const row of orphans) {
      await tx('readwrite', (s) => s.put({ ...row, userId }));
    }
    return orphans.length;
  },

  /**
   * Move every record from one owner id to another.
   *
   * Called when a device-only account is upgraded to a synced one: the catches
   * were written against a random local id and must be re-keyed to the Firebase
   * uid before anything is pushed, or they would sync as nobody's.
   */
  async reassignOwner(fromUserId, toUserId) {
    if (!fromUserId || !toUserId || fromUserId === toUserId) return 0;
    const rows = (await tx('readonly', (s) => wrap(s.getAll()))) || [];
    const mine = rows.filter((r) => r.userId === fromUserId);
    for (const row of mine) {
      // updatedAt is deliberately NOT touched. These are the same catches, and
      // bumping it would make them look newer than a copy already in the cloud.
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
   * Write a record exactly as given, without touching updatedAt.
   *
   * saveCatch() stamps updatedAt because a local edit has just happened. A
   * record arriving from the cloud has NOT just been edited — stamping it
   * would make this device look like it held the newest copy, and the next
   * sync would push it straight back, forever.
   */
  async putRaw(record) {
    await tx('readwrite', (s) => s.put(record));
    return record;
  },

  /**
   * Soft delete. The row survives as a tombstone so the deletion can sync;
   * see the note at the top of this file for why an absence cannot.
   */
  async deleteCatch(id) {
    const existing = await tx('readonly', (s) => wrap(s.get(id)));
    if (!existing) return;
    // Media is the bulk of the bytes and a tombstone has no use for it.
    const { photo, video, poster, ...rest } = existing;
    await tx('readwrite', (s) =>
      s.put({ ...rest, deleted: true, updatedAt: new Date().toISOString() })
    );
  },

  /** Really remove a row. Used by sync reconciliation and tombstone purging. */
  async hardDelete(id) {
    await tx('readwrite', (s) => s.delete(id));
  },

  /** Drop tombstones old enough that every device has certainly seen them. */
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

  // --- the user's own spots -------------------------------------------------
  //
  // Distinct from `region.spots`, which are the named places that ship with a
  // region and are the same for everybody. These are marks somebody dropped on
  // the map themselves — the gap in the reef only they know about — so they
  // are owned, scoped by userId exactly as catches are, and carry the same
  // createdAt / updatedAt / deleted shape. Nothing syncs them yet; having the
  // shape already right is what makes that a small change rather than a
  // migration.

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

  /** Soft delete, for the same reason catches get one — see the file header. */
  async deleteSpot(id) {
    const existing = await spotTx('readonly', (s) => wrap(s.get(id)));
    if (!existing) return;
    await spotTx('readwrite', (s) =>
      s.put({ ...existing, deleted: true, updatedAt: new Date().toISOString() })
    );
  },

  /** Pre-account spots join the first account created, as catches do. */
  async adoptOrphanSpots(userId) {
    const rows = (await spotTx('readonly', (s) => wrap(s.getAll()))) || [];
    const orphans = rows.filter((r) => !r.userId);
    for (const row of orphans) await spotTx('readwrite', (s) => s.put({ ...row, userId }));
    return orphans.length;
  },

  /** Re-key when a device-only account becomes a synced one. */
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
 * WHO YOU ARE, as opposed to who you sign in as.
 *
 * The username is the handle — chosen at sign-up, unique, and what the account
 * IS. The display name is a label on top of it and can be anything, including
 * nothing, in which case the handle is shown. Keeping them apart means someone
 * can rename themselves without their sign-in breaking.
 *
 * NOT SYNCED YET. Firestore rules currently permit users/{uid}/catches only,
 * so a profile document would be denied. The shape is ready for it — one
 * document per account, keyed by the same id — but publishing the rule is a
 * console action, so this stays on the device until that happens.
 */
export const profiles = {
  async get(userId) {
    if (!userId) return null;
    // wrap(), like every other read in this file. Without it txIn resolves
    // with the IDBRequest itself rather than its .result — and an IDBRequest
    // is truthy and has no displayName, so `|| null` never fired and every
    // caller silently saw a profile with no fields in it. Display names and
    // avatars were being written correctly and never read back.
    return (await txIn(PROFILES, 'readonly', (s) => wrap(s.get(userId)))) || null;
  },

  async save(userId, patch) {
    if (!userId) throw new Error('A profile needs an account to belong to.');
    const current = (await this.get(userId)) || { id: userId };
    const next = { ...current, ...patch, id: userId, updatedAt: Date.now() };
    await txIn(PROFILES, 'readwrite', (s) => s.put(next));
    return next;
  },

  /** Forget the avatar without forgetting the name. */
  async clearAvatar(userId) {
    const current = await this.get(userId);
    if (!current) return null;
    const { avatar, ...rest } = current;
    await txIn(PROFILES, 'readwrite', (s) => s.put({ ...rest, updatedAt: Date.now() }));
    return rest;
  },
};

/** What to call someone: their display name if they set one, else the handle. */
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

/** Photos and clips are dropped from the export — Blobs don't survive JSON. */
export async function exportJson() {
  const catches = await store.allCatches();
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

export async function importJson(text) {
  const data = JSON.parse(text);
  if (!Array.isArray(data.catches)) throw new Error('Not a valid Angler Log export');
  let n = 0;
  for (const c of data.catches) {
    const { hadPhoto, hadVideo, ...rest } = c;
    await store.saveCatch(rest);
    n++;
  }
  return n;
}
