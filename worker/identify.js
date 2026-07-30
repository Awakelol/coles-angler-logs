// ---------------------------------------------------------------------------
// POST /api/identify — what fish is this?
//
// FISHIAL DOES THE LOOKING. A model trained specifically on fish, free for
// non-commercial use on its developer tier.
//
// THE CATALOGUE DOES THE CHECKING, and it does it for free. Fishial is trained
// mostly on North American and European sportfish, so on an Indo-Pacific fish
// its top answer can be confidently wrong. Catching that needs no
// intelligence, only a lookup: does this species actually occur in Leyte Gulf?
// js/identify-verdict.js answers that from data already in the app.
//
// A VISION MODEL IS OPTIONAL. It adds the one thing the pair above cannot do:
// reading markings and body shape to separate lookalikes — the ponyfish,
// mostly. Set a key and the two get arbitrated; set none and the free path
// runs alone. Either way the response says which path ran, so a cheaper answer
// is never mistaken for a better one.
//
// Keys live in the Worker's environment and never reach the browser: this is a
// static site, so anything it ships is readable in devtools.
//
// ENVIRONMENT VARIABLES (Cloudflare dashboard → Settings → Variables):
//   FISHIAL_API_KEY      recognition
//   FISHIAL_API_SECRET   recognition
//   GEMINI_API_KEY       optional second opinion — has a free tier
//   GEMINI_MODEL         optional, defaults to gemini-2.5-flash
//   ANTHROPIC_API_KEY    optional second opinion — metered per call
// ---------------------------------------------------------------------------

import { INDO_PACIFIC_SPECIES } from '../js/data/species/indo-pacific.js';
import { arbitrate, reconcileLocal, normalise } from '../js/identify-verdict.js';
import { secondOpinion, providerFor } from './_lib/llm.js';
import { md5Base64 } from './_lib/md5.js';

const FISHIAL_TOKEN_URL = 'https://api-users.fishial.ai/v1/auth/token';
const FISHIAL_UPLOAD_URL = 'https://api.fishial.ai/v1/recognition/upload';
const FISHIAL_RECOGNISE_URL = 'https://api.fishial.ai/v1/recognition/image';

const MAX_BYTES = 6 * 1024 * 1024;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

// --- Fishial ---------------------------------------------------------------

// Tokens last 10 minutes. Cached per isolate — best effort; a miss costs one
// extra round trip and nothing else.
let tokenCache = { value: null, expires: 0 };

async function fishialToken(env) {
  if (tokenCache.value && Date.now() < tokenCache.expires) return tokenCache.value;

  const res = await fetch(FISHIAL_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: env.FISHIAL_API_KEY,
      client_secret: env.FISHIAL_API_SECRET,
    }),
  });
  if (!res.ok) throw new Error(`fishial auth ${res.status}`);

  const data = await res.json();
  if (!data.access_token) throw new Error('fishial auth returned no token');

  // Expire a minute early rather than mid-upload.
  tokenCache = { value: data.access_token, expires: Date.now() + 9 * 60 * 1000 };
  return data.access_token;
}

/**
 * Fishial's three-step dance: register the image, PUT it to the signed URL
 * they hand back, then ask for the recognition by signed id.
 */
async function fishialIdentify(env, bytes, mime) {
  const token = await fishialToken(env);
  const auth = { authorization: `Bearer ${token}` };

  const reg = await fetch(FISHIAL_UPLOAD_URL, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      blob: {
        filename: 'catch.jpg',
        content_type: mime,
        byte_size: bytes.length,
        checksum: md5Base64(bytes),
      },
    }),
  });
  if (!reg.ok) throw new Error(`fishial upload ${reg.status}`);
  const slot = await reg.json();

  const direct = slot['direct-upload'] || slot.direct_upload;
  const signedId = slot['signed-id'] || slot.signed_id;
  if (!direct?.url || !signedId) throw new Error('fishial upload: unexpected response');

  // Only the headers they specify — adding our own breaks the signature.
  const put = await fetch(direct.url, {
    method: 'PUT',
    headers: direct.headers || {},
    body: bytes,
  });
  if (!put.ok) throw new Error(`fishial PUT ${put.status}`);

  const rec = await fetch(`${FISHIAL_RECOGNISE_URL}?q=${encodeURIComponent(signedId)}`, {
    headers: auth,
  });
  if (!rec.ok) throw new Error(`fishial recognise ${rec.status}`);

  const data = await rec.json();
  return (data.results || [])
    .flatMap((r) => r.species || [])
    .map((s) => ({ scientific: s.name, accuracy: Number(s.accuracy) || 0 }))
    .sort((a, b) => b.accuracy - a.accuracy)
    .slice(0, 5);
}

// --- handler ---------------------------------------------------------------

export async function identify(request, env) {
  const hasFishial = Boolean(env.FISHIAL_API_KEY && env.FISHIAL_API_SECRET);
  const provider = providerFor(env);
  const hasLLM = Boolean(provider);

  if (!hasFishial && !hasLLM) {
    return json(
      { error: 'unconfigured', message: 'No recognition service is configured yet.' },
      503
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad-request', message: 'Expected JSON.' }, 400);
  }

  const b64 = String(body.image || '');
  const mime = String(body.mime || 'image/jpeg');
  if (!b64) return json({ error: 'bad-request', message: 'No image.' }, 400);

  let bytes;
  try {
    const bin = atob(b64);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } catch {
    return json({ error: 'bad-request', message: 'Image is not valid base64.' }, 400);
  }
  if (bytes.length > MAX_BYTES) {
    return json({ error: 'too-large', message: 'That photo is too big.' }, 413);
  }

  let fishial = [];
  let fishialError = null;
  if (hasFishial) {
    try {
      fishial = await fishialIdentify(env, bytes, mime);
    } catch (err) {
      fishialError = String(err.message || err);
    }
  }

  const catalogue = INDO_PACIFIC_SPECIES.map((s) => ({
    id: s.id,
    scientific: s.scientific,
    common: s.common,
    local: Object.values(s.local || {}).flat().slice(0, 4).join(', '),
  }));

  let llm = null;
  let llmError = null;
  if (hasLLM) {
    try {
      llm = await secondOpinion(env, { b64, mime, guesses: fishial, catalogue });
    } catch (err) {
      // A dead or rate-limited model must not take the feature down — the
      // free path below is a complete answer on its own.
      llmError = String(err.message || err);
    }
  }

  if (!llm && !fishial.length) {
    return json(
      {
        error: 'failed',
        message: 'Nothing could read that photo.',
        detail: { llm: llmError, fishial: fishialError },
      },
      502
    );
  }

  // With a usable model answer, cross-check the two. Otherwise the catalogue
  // does the checking on its own — same idea, no cost, no second network call.
  //
  // "unknown" counts as no answer: arbitrating against it would report a bare
  // one-sided Fishial result, when reconcileLocal can still demote a foreign
  // top pick to a local one further down the ranking. The cheaper path is
  // genuinely the better one here.
  const usableLLM = llm && llm.speciesId !== 'unknown' && llm.scientific;

  const verdict = usableLLM
    ? arbitrate(llm, fishial, (name) =>
        catalogue.some((s) => normalise(s.scientific) === normalise(name))
      )
    : reconcileLocal(fishial, catalogue);

  return json({
    ...verdict,
    reasoning: llm?.reasoning || null,
    alternatives: llm?.alternatives || [],
    // Named so the UI can say how the answer was reached — a free answer
    // should never be presented as though it had a second opinion behind it.
    // Named so the screen can show how the answer was reached. An "unknown"
    // from the model means the catalogue decided, and it must say so.
    checkedBy: usableLLM ? `fishial + ${llm.provider}` : 'fishial + local catalogue',
    sources: {
      fishial: fishial.length ? { candidates: fishial } : { error: fishialError },
      llm: hasLLM ? (llm ? { ...llm, error: null } : { provider, error: llmError }) : null,
    },
  });
}
