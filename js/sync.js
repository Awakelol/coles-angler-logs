// ---------------------------------------------------------------------------
// FIRESTORE SYNC
//
// Makes a catch log follow its owner between devices. IndexedDB stays the
// source of truth — every write lands locally first and is pushed afterwards —
// because the app is used on the water where there is frequently no signal,
// and a screen that refuses to record a fish until the network agrees is
// useless at the exact moment it is needed.
//
// SHAPE.  users/{uid}/catches/{catchId}, one document per catch. Scoping by
// uid rather than a userId field means the security rules are three lines and
// obviously correct, and a device can only ever request its own data.
//
// RECORDS ONLY.  Photos and clips are stripped before upload and stay on the
// phone that took them. Firestore documents cap at 1 MiB and media belongs in
// Cloud Storage, which needs a billing account on projects created recently.
// Deliberate, and the boundary is one function — stripForCloud — so adding
// media later means writing the uploader, not unpicking this.
//
// MERGE.  Last write wins on updatedAt, which every record carries (see
// store.saveCatch). Not a CRDT and not trying to be: a fishing log is edited
// by one person on one device at a time, and the failure mode of last-write-
// wins here is losing an edit made on a phone that was offline while the same
// catch was edited elsewhere. Vanishingly rare, and the alternative costs more
// complexity than the problem is worth.
//
// DELETES.  Tombstones, not absences — see the note at the top of js/store.js.
// A row missing from the cloud means "this device has something new", never
// "the cloud deleted it".
// ---------------------------------------------------------------------------

import { store } from './store.js';
import { firebaseHandles, currentUid } from './auth/cloud.js';

const FS_VERSION = '10.12.2';
const FS_URL = `https://www.gstatic.com/firebasejs/${FS_VERSION}/firebase-firestore.js`;

const LAST_SYNC_KEY = 'angler.lastSync';

let fsPromise = null;

/** Load the Firestore SDK once, on first sync. It is not part of app start-up. */
function loadFirestore() {
  if (!fsPromise) {
    fsPromise = import(/* @vite-ignore */ FS_URL).catch((e) => {
      fsPromise = null; // let a later attempt retry rather than wedging
      throw e;
    });
  }
  return fsPromise;
}

// --- the pure part ----------------------------------------------------------
//
// Kept free of Firestore, IndexedDB and the clock so it can be tested directly
// with plain objects. Every interesting decision this module makes is here.

/** Fields that never leave the device. */
const LOCAL_ONLY = ['photo', 'video', 'poster'];

/**
 * A catch as it goes to Firestore: no media, no undefined values.
 *
 * Firestore rejects `undefined` outright, and an optional field the user left
 * blank is exactly how one gets there — so they are dropped rather than sent
 * as null, which would overwrite a value another device had filled in.
 */
export function stripForCloud(record) {
  const out = {};
  for (const [k, v] of Object.entries(record)) {
    if (LOCAL_ONLY.includes(k) || v === undefined) continue;
    out[k] = v;
  }
  // Remembered so the UI can say "photo is on your other phone" rather than
  // leaving a catch looking as though it never had one.
  if (record.photo) out.hasPhotoElsewhere = true;
  if (record.video) out.hasVideoElsewhere = true;
  return out;
}

const stamp = (r) => r?.updatedAt || r?.createdAt || '';

/**
 * Decide what moves in each direction.
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
 * Fold a cloud record into the local one.
 *
 * The local media fields are preserved: the cloud copy never carried them, and
 * accepting it wholesale would delete the photo off the device that took it —
 * which looks exactly like the app losing your picture.
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

// --- the plumbing -----------------------------------------------------------

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
    /* private mode; the timestamp is a nicety */
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
 * Reconcile this device with the cloud.
 *
 * Never throws — the caller is usually a screen that has already rendered, and
 * a sync failure is a status line, not an error page. Concurrent calls share
 * one run rather than racing each other into duplicate writes.
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

    // Pull first. If the push half fails on a flaky connection, the device has
    // still gained whatever the cloud knew, and the push retries next time.
    for (const remote of pull) {
      const existing = localRows.find((r) => r.id === remote.id) || null;
      const merged = mergeIncoming(remote, existing);
      // A tombstone that arrived from elsewhere still has to be stored, not
      // applied and forgotten, or the next sync would push the row back up.
      await store.putRaw({ ...merged, userId: uid });
    }

    for (const local of push) {
      await fs.setDoc(fs.doc(catches, local.id), stripForCloud({ ...local, userId: uid }));
    }

    noteSynced();
    return { ok: true, pushed: push.length, pulled: pull.length };
  } catch (err) {
    console.warn('[sync]', err);
    // The one worth naming: rules not published, or Firestore never created.
    const denied = err?.code === 'permission-denied' || /permission/i.test(err?.message || '');
    return { ok: false, reason: denied ? 'permission-denied' : 'failed' };
  }
}

/**
 * Sync in the background after a local change.
 *
 * Fire-and-forget on purpose: saving a catch must feel instant, and whether
 * the network agreed is not something to wait on before closing the form.
 */
export function syncSoon() {
  syncNow().catch(() => {});
}
