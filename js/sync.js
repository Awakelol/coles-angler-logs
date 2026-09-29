// Firestore sync for catch logs.
//
// IndexedDB stays the source of truth; writes happen locally and get pushed
// later so logging works without signal.
//
// Layout: users/{uid}/catches/{catchId}. Photos and clips are stripped before
// upload (Firestore docs cap at 1 MiB, and Cloud Storage needs billing), so
// media stays on the device that took it. See stripForCloud.
//
// Merge is last-write-wins on updatedAt. Deletes are tombstones (see store.js),
// so a row missing from the cloud just means it hasn't been pushed yet.

import { store } from './store.js';
import { firebaseHandles, currentUid } from './auth/cloud.js';

const FS_VERSION = '10.12.2';
const FS_URL = `https://www.gstatic.com/firebasejs/${FS_VERSION}/firebase-firestore.js`;

const LAST_SYNC_KEY = 'angler.lastSync';

let fsPromise = null;

/** Lazy-load the Firestore SDK on first sync. */
function loadFirestore() {
  if (!fsPromise) {
    fsPromise = import(/* @vite-ignore */ FS_URL).catch((e) => {
      fsPromise = null; // allow a retry
      throw e;
    });
  }
  return fsPromise;
}

// --- pure helpers (no Firestore/IndexedDB, easy to test) --------------------

/** Fields that never leave the device. */
const LOCAL_ONLY = ['photo', 'video', 'poster'];

/**
 * A catch as sent to Firestore: no media and no undefined values (Firestore
 * rejects undefined; sending null instead could clobber another device's value).
 */
export function stripForCloud(record) {
  const out = {};
  for (const [k, v] of Object.entries(record)) {
    if (LOCAL_ONLY.includes(k) || v === undefined) continue;
    out[k] = v;
  }
  // Lets other devices show that a photo exists somewhere.
  if (record.photo) out.hasPhotoElsewhere = true;
  if (record.video) out.hasVideoElsewhere = true;
  return out;
}

const stamp = (r) => r?.updatedAt || r?.createdAt || '';

/**
 * Work out what to push and what to pull.
 *
 * @param {Array} localRows  every local record for this user, tombstones included
 * @param {Array} cloudRows  every cloud document for this user
 * @returns {{push: Array, pull: Array, unchanged: number}}
 */
export function planSync(localRows, cloudRows) {
  const byId = new Map();
  for (const r of localRows || []) byId.set(r.id, { local: r, cloud: null });
  for (const r of cloudRows || []) {
    const entry = byId.get(r.id);
    if (entry) entry.cloud = r;
    else byId.set(r.id, { local: null, cloud: r });
  }

  const push = [];
  const pull = [];
  let unchanged = 0;

  for (const { local, cloud } of byId.values()) {
    if (local && !cloud) {
      push.push(local);
    } else if (cloud && !local) {
      pull.push(cloud);
    } else {
      const l = stamp(local);
      const c = stamp(cloud);
      if (l > c) push.push(local);
      else if (c > l) pull.push(cloud);
      else unchanged++;
    }
  }

  return { push, pull, unchanged };
}

/**
 * Apply a cloud record over the local one, keeping local media fields (the
 * cloud copy never has them).
 */
export function mergeIncoming(cloudRecord, localRecord) {
  const merged = { ...cloudRecord };
  if (localRecord) {
    for (const field of LOCAL_ONLY) {
      if (localRecord[field] !== undefined) merged[field] = localRecord[field];
    }
  }
  return merged;
}

// --- sync ---------------------------------------------------------------------

export function lastSyncedAt() {
  try {
    return localStorage.getItem(LAST_SYNC_KEY) || null;
  } catch {
    return null;
  }
}

function noteSynced() {
  try {
    localStorage.setItem(LAST_SYNC_KEY, new Date().toISOString());
  } catch {
    /* private mode */
  }
}

export function clearSyncState() {
  try {
    localStorage.removeItem(LAST_SYNC_KEY);
  } catch {
    /* ignore */
  }
}

let running = null;

/**
 * Sync this device with the cloud. Never throws; concurrent calls share one run.
 *
 * @returns {Promise<{ok: boolean, pushed?: number, pulled?: number, reason?: string}>}
 */
export function syncNow() {
  if (running) return running;
  running = doSync().finally(() => {
    running = null;
  });
  return running;
}

async function doSync() {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { ok: false, reason: 'offline' };
  }

  const handles = await firebaseHandles();
  if (!handles) return { ok: false, reason: 'unconfigured' };

  const uid = await currentUid();
  if (!uid) return { ok: false, reason: 'signed-out' };

  let fs;
  try {
    fs = await loadFirestore();
  } catch {
    return { ok: false, reason: 'sdk-unavailable' };
  }

  try {
    const db = fs.getFirestore(handles.app);
    const catches = fs.collection(db, 'users', uid, 'catches');

    const snapshot = await fs.getDocs(catches);
    const cloudRows = snapshot.docs.map((d) => ({ ...d.data(), id: d.id }));
    const localRows = await store.allRecords(uid);

    const { push, pull } = planSync(localRows, cloudRows);

    // Pull first so a failed push still leaves us up to date.
    for (const remote of pull) {
      const existing = localRows.find((r) => r.id === remote.id) || null;
      const merged = mergeIncoming(remote, existing);
      // Store incoming tombstones too, or the next sync would push the row back.
      await store.putRaw({ ...merged, userId: uid });
    }

    for (const local of push) {
      await fs.setDoc(fs.doc(catches, local.id), stripForCloud({ ...local, userId: uid }));
    }

    noteSynced();
    return { ok: true, pushed: push.length, pulled: pull.length };
  } catch (err) {
    console.warn('[sync]', err);
    // Usually means the rules aren't published or Firestore isn't set up.
    const denied = err?.code === 'permission-denied' || /permission/i.test(err?.message || '');
    return { ok: false, reason: denied ? 'permission-denied' : 'failed' };
  }
}

/** Fire-and-forget sync after a local change. */
export function syncSoon() {
  syncNow().catch(() => {});
}
