// ---------------------------------------------------------------------------
// CATCH MEDIA — photos and short clips
//
// Images are downscaled before storage: a modern phone photo is 3–8 MB and a
// couple of dozen would fill the origin's quota.
//
// Video is the awkward one. There is no practical way to transcode in the
// browser — no ffmpeg, and MediaRecorder can't re-encode an existing file
// without playing it through in real time — so clips can only be ACCEPTED OR
// REJECTED, never shrunk. That makes the limits below the only defence
// against one holiday video eating the whole log's storage.
//
//   15 seconds, 20 MB. A phone clip runs roughly 1.5–3 MB/second at 1080p,
//   so 15s lands near the cap from both directions. Twenty catches with clips
//   is then ~400 MB, which is already close to what browsers grant a single
//   origin on mobile — hence also the quota check in `checkStorage`.
//
// A poster frame is grabbed from every clip so lists can show a still without
// decoding video, which matters on the log screen where dozens render at once.
// ---------------------------------------------------------------------------

export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'];
export const VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v', 'video/3gpp'];

/** What the file picker offers. Extensions included because iOS reports
 *  HEIC/MOV inconsistently by MIME type alone. */
export const ACCEPT_ATTR = [
  ...IMAGE_TYPES, ...VIDEO_TYPES,
  '.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic', '.heif',
  '.mp4', '.mov', '.webm', '.m4v', '.3gp',
].join(',');

export const LIMITS = {
  videoSeconds: 15,
  videoBytes: 20 * 1024 * 1024,
  imageBytes: 25 * 1024 * 1024, // generous: it gets downscaled anyway
  imageMaxPx: 1280,
  imageQuality: 0.8,
  posterMaxPx: 640,
};

export const fmtMB = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`;

export function kindOf(file) {
  const type = (file?.type || '').toLowerCase();
  const name = (file?.name || '').toLowerCase();
  if (type.startsWith('image/') || /\.(jpe?g|png|webp|gif|heic|heif)$/.test(name)) return 'image';
  if (type.startsWith('video/') || /\.(mp4|mov|webm|m4v|3gp)$/.test(name)) return 'video';
  return null;
}

/** Downscale an image and re-encode as JPEG. */
function resizeImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, LIMITS.imageMaxPx / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Could not process that image.'))),
        'image/jpeg',
        LIMITS.imageQuality
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      // HEIC is the usual culprit: iOS will hand it over but Chrome can't decode it.
      reject(new Error('That image could not be read. Try saving it as JPEG first.'));
    };
    img.src = url;
  });
}

/** Read duration and grab a poster frame without keeping the whole clip decoded. */
function inspectVideo(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;

    const fail = (msg) => {
      URL.revokeObjectURL(url);
      reject(new Error(msg));
    };

    video.onerror = () => fail('That video could not be read. MP4 or MOV works best.');

    video.onloadedmetadata = () => {
      const duration = video.duration;
      if (!Number.isFinite(duration) || duration <= 0) {
        return fail('That video has no readable length.');
      }
      if (duration > LIMITS.videoSeconds + 0.5) {
        return fail(
          `Clip is ${duration.toFixed(1)}s — the limit is ${LIMITS.videoSeconds}s. ` +
          `Trim it in your phone's photo app and try again.`
        );
      }
      // Seek slightly in; frame zero is often black on phone recordings.
      video.currentTime = Math.min(0.3, duration / 2);
    };

    video.onseeked = () => {
      try {
        const scale = Math.min(1, LIMITS.posterMaxPx / Math.max(video.videoWidth, video.videoHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(video.videoWidth * scale) || LIMITS.posterMaxPx;
        canvas.height = Math.round(video.videoHeight * scale) || LIMITS.posterMaxPx;
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(
          (poster) => {
            URL.revokeObjectURL(url);
            resolve({ duration: video.duration, poster: poster || null });
          },
          'image/jpeg',
          0.7
        );
      } catch {
        // Tainted canvas or an odd codec — the clip is still usable, just
        // without a still, so don't fail the whole upload over it.
        URL.revokeObjectURL(url);
        resolve({ duration: video.duration, poster: null });
      }
    };

    video.src = url;
  });
}

/** Refuse to fill the last of the origin's quota. */
export async function checkStorage(incomingBytes) {
  if (!navigator.storage?.estimate) return null;
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  if (!quota) return null;
  if (usage + incomingBytes > quota * 0.9) {
    return `Not enough space left (${fmtMB(usage)} of ${fmtMB(quota)} used). ` +
           `Delete some catches with media, or export and clear the log.`;
  }
  return null;
}

/**
 * Validate and prepare a picked file.
 * @returns {Promise<{kind:'image'|'video', blob:Blob, poster:Blob|null, duration:number|null}>}
 * @throws {Error} with a message written for the user, not the console.
 */
export async function prepareMedia(file) {
  const kind = kindOf(file);
  if (!kind) {
    throw new Error('Only photos and short videos can be attached.');
  }

  if (kind === 'image') {
    if (file.size > LIMITS.imageBytes) {
      throw new Error(`That photo is ${fmtMB(file.size)}; the limit is ${fmtMB(LIMITS.imageBytes)}.`);
    }
    const blob = await resizeImage(file);
    const spaceError = await checkStorage(blob.size);
    if (spaceError) throw new Error(spaceError);
    return { kind: 'image', blob, poster: null, duration: null };
  }

  // Size first — it's free to check, and rejects the common case without
  // asking the browser to decode a huge file.
  if (file.size > LIMITS.videoBytes) {
    throw new Error(
      `That clip is ${fmtMB(file.size)}; the limit is ${fmtMB(LIMITS.videoBytes)}. ` +
      `Videos can't be compressed in the browser, so it has to be trimmed first.`
    );
  }
  const { duration, poster } = await inspectVideo(file);
  const spaceError = await checkStorage(file.size + (poster?.size || 0));
  if (spaceError) throw new Error(spaceError);
  return { kind: 'video', blob: file, poster, duration };
}
