// POST /api/identify
//
// Fishial identifies the fish (fish-specific model, free developer tier).
// Its top answer can be wrong for Indo-Pacific fish, so the result is checked
// against the local catalogue (js/identify-verdict.js).
//
// An LLM vision model is optional and helps separate lookalikes (mostly the
// ponyfish). With no key configured the free path runs alone. The response
// says which path was used.
//
// Keys stay in the Worker environment and never reach the browser.
//
// Environment variables (Cloudflare dashboard → Settings → Variables):
//   FISHIAL_API_KEY      recognition
//   FISHIAL_API_SECRET   recognition
//   GEMINI_API_KEY       optional second opinion (has a free tier)
//   GEMINI_MODEL         optional, defaults to gemini-2.5-flash
//   ANTHROPIC_API_KEY    optional second opinion (paid per call)

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

// Tokens last 10 minutes; cached per isolate (best effort).
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

  // Refresh a minute early.
  tokenCache = { value: data.access_token, expires: Date.now() + 9 * 60 * 1000 };
  return data.access_token;
}

/**
 * Fishial upload flow: register the image, PUT it to the signed URL, then
 * request recognition by signed id.
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

  // Only the headers they specify, or the signature breaks.
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
      // Model failures are non-fatal; the free path still gives an answer.
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

  // With a usable model answer, arbitrate between the two. Otherwise (no
  // model, or it said "unknown") let reconcileLocal check Fishial's ranking
  // against the catalogue, which can still promote a local lower-ranked pick.
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
    // Tells the UI how the answer was reached.
    checkedBy: usableLLM ? `fishial + ${llm.provider}` : 'fishial + local catalogue',
    sources: {
      fishial: fishial.length ? { candidates: fishial } : { error: fishialError },
      llm: hasLLM ? (llm ? { ...llm, error: null } : { provider, error: llmError }) : null,
    },
  });
}
