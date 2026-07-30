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
// A LANGUAGE MODEL IS OPTIONAL and off by default, because it costs money per
// call. Set ANTHROPIC_API_KEY and it adds a second opinion that can read
// markings and body shape, and the two get arbitrated. Leave it unset and the
// free path runs alone — and says which path ran, so a cheaper answer is never
// mistaken for a better one.
//
// Keys live in the Worker's environment and never reach the browser: this is a
// static site, so anything it ships is readable in devtools.
//
// ENVIRONMENT VARIABLES (Cloudflare dashboard → Settings → Variables):
//   FISHIAL_API_KEY      recognition
//   FISHIAL_API_SECRET   recognition
//   ANTHROPIC_API_KEY    optional second opinion; omit to stay free
// ---------------------------------------------------------------------------

import { INDO_PACIFIC_SPECIES } from '../js/data/species/indo-pacific.js';
import { arbitrate, reconcileLocal, normalise } from '../js/identify-verdict.js';
import { md5Base64 } from './_lib/md5.js';

const FISHIAL_TOKEN_URL = 'https://api-users.fishial.ai/v1/auth/token';
const FISHIAL_UPLOAD_URL = 'https://api.fishial.ai/v1/recognition/upload';
const FISHIAL_RECOGNISE_URL = 'https://api.fishial.ai/v1/recognition/image';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-opus-5';

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

// --- optional second opinion ------------------------------------------------

function cataloguePrompt() {
  return INDO_PACIFIC_SPECIES.map((s) => {
    const local = Object.values(s.local || {}).flat().slice(0, 4).join(', ');
    return `${s.id} | ${s.scientific} | ${s.common}${local ? ` | local: ${local}` : ''}`;
  }).join('\n');
}

const SCHEMA = {
  type: 'object',
  properties: {
    speciesId: { type: 'string', description: 'catalogue id, or "unknown"' },
    scientific: { type: 'string' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    reasoning: { type: 'string', description: 'the visible features that decided it' },
    alternatives: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          speciesId: { type: 'string' },
          scientific: { type: 'string' },
          why: { type: 'string' },
        },
        required: ['speciesId', 'scientific', 'why'],
        additionalProperties: false,
      },
    },
  },
  required: ['speciesId', 'scientific', 'confidence', 'reasoning', 'alternatives'],
  additionalProperties: false,
};

async function llmIdentify(env, b64, mime, guesses) {
  const hint = guesses.length
    ? `\n\nA fish-recognition model looked at the same photo and offered, best first:\n` +
      guesses.map((f) => `  ${f.scientific} (${(f.accuracy * 100).toFixed(0)}%)`).join('\n') +
      `\nTreat that as evidence, not the answer — it is trained mostly on North ` +
      `American and European sportfish. If it names something that does not ` +
      `occur in Leyte Gulf, say so.`
    : '';

  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4096,
      // A constrained pick from a supplied list — it does not need max effort,
      // and lower effort keeps this quick enough to wait on.
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      system:
        `You identify fish from photographs for an angler fishing Leyte Gulf, ` +
        `Philippines.\n\nChoose from this catalogue of species recorded in these ` +
        `waters — id | scientific | common | local names:\n\n${cataloguePrompt()}\n\n` +
        `Rules:\n` +
        `- Prefer a catalogue species. Answer "unknown" only if none is ` +
        `plausible; a confident wrong answer is worse than an honest one.\n` +
        `- Judge on visible features — body shape, fin placement, mouth, ` +
        `markings, colour — and say which ones decided it.\n` +
        `- Many of these look alike, the ponyfish especially. If you cannot ` +
        `separate two, say low confidence and list the other as an alternative.`,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mime, data: b64 } },
            { type: 'text', text: `What fish is this?${hint}` },
          ],
        },
      ],
    }),
  });

  if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const data = await res.json();
  // Safety classifiers can decline with a 200 — check before reading content.
  if (data.stop_reason === 'refusal') throw new Error('anthropic declined this image');

  const text = (data.content || []).find((b) => b.type === 'text')?.text;
  if (!text) throw new Error('anthropic returned no text');
  return JSON.parse(text);
}

// --- handler ---------------------------------------------------------------

export async function identify(request, env) {
  const hasFishial = Boolean(env.FISHIAL_API_KEY && env.FISHIAL_API_SECRET);
  const hasLLM = Boolean(env.ANTHROPIC_API_KEY);

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

  let llm = null;
  let llmError = null;
  if (hasLLM) {
    try {
      llm = await llmIdentify(env, b64, mime, fishial);
    } catch (err) {
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

  const catalogue = INDO_PACIFIC_SPECIES.map((s) => ({
    id: s.id,
    scientific: s.scientific,
    common: s.common,
  }));

  // With a language model, cross-check the two. Without one, the catalogue
  // does the checking on its own — same idea, no cost, no second network call.
  const verdict = llm
    ? arbitrate(
        llm.speciesId !== 'unknown' ? llm : null,
        fishial,
        (name) => catalogue.some((s) => normalise(s.scientific) === normalise(name))
      )
    : reconcileLocal(fishial, catalogue);

  return json({
    ...verdict,
    reasoning: llm?.reasoning || null,
    alternatives: llm?.alternatives || [],
    // Named so the UI can say how the answer was reached — a free answer
    // should never be presented as though it had a second opinion behind it.
    checkedBy: llm ? 'fishial + AI second opinion' : 'fishial + local catalogue',
    sources: {
      fishial: fishial.length ? { candidates: fishial } : { error: fishialError },
      llm: hasLLM ? (llm ? { ...llm, error: null } : { error: llmError }) : null,
    },
  });
}
