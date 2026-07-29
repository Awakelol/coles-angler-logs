// ---------------------------------------------------------------------------
// POST /api/identify — what fish is this?
//
// A Cloudflare Pages Function. It exists for one reason above all others:
// THE API KEYS MUST NEVER REACH THE BROWSER. The app is a static site, so
// anything it ships is readable by anyone who opens devtools. An Anthropic key
// can spend real money and a Fishial key is someone else's quota; both stay
// here, in Cloudflare's environment, and the browser only ever talks to this.
//
// It asks two services and cross-checks them — see js/identify-verdict.js for
// why, and for the arbitration rules.
//
// ENVIRONMENT VARIABLES (Cloudflare dashboard → Settings → Variables):
//   ANTHROPIC_API_KEY     required
//   FISHIAL_API_KEY       optional — omit and it runs on Claude alone
//   FISHIAL_API_SECRET    optional
//
// Set all three as SECRETS (encrypted), not plaintext variables.
// ---------------------------------------------------------------------------

import { INDO_PACIFIC_SPECIES } from '../../js/data/species/indo-pacific.js';
import { arbitrate, normalise } from '../../js/identify-verdict.js';
import { md5Base64 } from '../_lib/md5.js';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-opus-5';

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

// Tokens last 10 minutes. Cached per isolate — best effort, and a miss just
// costs one extra round trip.
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

  // Only the headers they specify — adding our own makes the signature fail.
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
  const species = (data.results || []).flatMap((r) => r.species || []);
  return species
    .map((s) => ({ scientific: s.name, accuracy: Number(s.accuracy) || 0 }))
    .sort((a, b) => b.accuracy - a.accuracy)
    .slice(0, 5);
}

// --- Claude ----------------------------------------------------------------

/**
 * The catalogue is the whole reason this beats a generic classifier: Claude is
 * choosing from the species that actually occur here, with the names people
 * use, rather than from every fish on earth.
 */
function cataloguePrompt() {
  const lines = INDO_PACIFIC_SPECIES.map((s) => {
    const local = Object.values(s.local || {})
      .flat()
      .slice(0, 4)
      .join(', ');
    return `${s.id} | ${s.scientific} | ${s.common}${local ? ` | local: ${local}` : ''}`;
  });
  return lines.join('\n');
}

const SCHEMA = {
  type: 'object',
  properties: {
    speciesId: {
      type: 'string',
      description: 'id from the catalogue, or "unknown" if none is a good match',
    },
    scientific: { type: 'string', description: 'scientific name, or "" if unknown' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    reasoning: {
      type: 'string',
      description: 'one or two sentences on the visible features that decided it',
    },
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

async function claudeIdentify(env, b64, mime, fishialGuesses) {
  const hint = fishialGuesses.length
    ? `\n\nA fish-recognition model looked at the same photo and offered, best first:\n` +
      fishialGuesses
        .map((f) => `  ${f.scientific} (${(f.accuracy * 100).toFixed(0)}%)`)
        .join('\n') +
      `\nTreat that as evidence, not as the answer. It is trained mostly on ` +
      `North American and European sportfish and may not know Indo-Pacific ` +
      `species well. If it names something that does not occur in Leyte Gulf, ` +
      `say so.`
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
      // A constrained pick from a supplied list; it does not need max effort,
      // and lower effort keeps this quick enough to wait on.
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      system:
        `You identify fish from photographs for an angler fishing Leyte Gulf, ` +
        `Philippines.\n\nChoose from this catalogue of species recorded in ` +
        `these waters — id | scientific | common | local names:\n\n` +
        cataloguePrompt() +
        `\n\nRules:\n` +
        `- Prefer a catalogue species. Only answer "unknown" if none is a ` +
        `plausible match; a wrong confident answer is worse than an honest one.\n` +
        `- Judge on visible features: body shape, fin placement, mouth, ` +
        `markings, colour. Say which ones decided it.\n` +
        `- Many of these look alike, especially the ponyfish. If you cannot ` +
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

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`anthropic ${res.status}: ${detail.slice(0, 200)}`);
  }

  const data = await res.json();
  // Safety classifiers can decline with a 200 — check before reading content.
  if (data.stop_reason === 'refusal') throw new Error('anthropic declined this image');

  const text = (data.content || []).find((b) => b.type === 'text')?.text;
  if (!text) throw new Error('anthropic returned no text');
  return JSON.parse(text);
}

// --- handler ---------------------------------------------------------------

export async function onRequestPost({ request, env }) {
  if (!env.ANTHROPIC_API_KEY) {
    return json({ error: 'unconfigured', message: 'ANTHROPIC_API_KEY is not set.' }, 503);
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

  // Fishial first: its guesses become evidence in Claude's prompt. Running
  // them in parallel would be faster but would throw away the cross-check,
  // which is the entire point.
  let fishial = [];
  let fishialError = null;
  if (env.FISHIAL_API_KEY && env.FISHIAL_API_SECRET) {
    try {
      fishial = await fishialIdentify(env, bytes, mime);
    } catch (err) {
      // A dead Fishial must not take the whole feature down.
      fishialError = String(err.message || err);
    }
  }

  let claude = null;
  let claudeError = null;
  try {
    claude = await claudeIdentify(env, b64, mime, fishial);
  } catch (err) {
    claudeError = String(err.message || err);
  }

  if (!claude && !fishial.length) {
    return json(
      { error: 'failed', message: 'Neither service could look at that photo.',
        detail: { claude: claudeError, fishial: fishialError } },
      502
    );
  }

  const known = new Set(INDO_PACIFIC_SPECIES.map((s) => normalise(s.scientific)));
  const inRegion = (name) => known.has(normalise(name));

  const verdict = arbitrate(
    claude && claude.speciesId !== 'unknown' ? claude : null,
    fishial,
    inRegion
  );

  return json({
    ...verdict,
    reasoning: claude?.reasoning || null,
    alternatives: claude?.alternatives || [],
    sources: {
      claude: claude ? { ...claude, error: null } : { error: claudeError },
      fishial: fishial.length ? { candidates: fishial } : { error: fishialError },
    },
  });
}
