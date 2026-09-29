// Optional LLM second opinion for photo ID.
//
// Fishial plus the catalogue check does most of the work; a vision model helps
// tell apart species that look alike (mostly ponyfish around Leyte).
//
// Whichever key is set is used:
//   GEMINI_API_KEY     has a free tier, so it's preferred
//   ANTHROPIC_API_KEY  Claude, paid per call
//
// With neither set, the caller falls back to the catalogue check. Both
// providers get the same prompt and return the same shape.

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const GEMINI_DEFAULT_MODEL = 'gemini-2.5-flash';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_MODEL = 'claude-opus-5';

/** Which provider will answer, or null. */
export function providerFor(env) {
  if (env.GEMINI_API_KEY) return 'gemini';
  if (env.ANTHROPIC_API_KEY) return 'claude';
  return null;
}

function systemPrompt(catalogue) {
  const list = catalogue
    .map((s) => `${s.id} | ${s.scientific} | ${s.common}${s.local ? ` | local: ${s.local}` : ''}`)
    .join('\n');

  return (
    // List the individual waters: which coast a photo came from changes
    // which lookalikes are plausible.
    `You identify fish from photographs for an angler fishing the waters ` +
    `around Leyte island, Philippines — Leyte Gulf and San Pedro Bay on the ` +
    `Pacific side, Carigara Bay and San Juanico Strait to the north, and ` +
    `Ormoc Bay, the Camotes Sea, Canigao Channel, Sogod Bay and Surigao ` +
    `Strait on the Bohol Sea side.\n\nChoose from this catalogue of species ` +
    `recorded in these waters — id | scientific | common | local names:` +
    `\n\n${list}\n\n` +
    `Rules:\n` +
    `- Prefer a catalogue species. Use speciesId "unknown" only if none is ` +
    `plausible; a confident wrong answer is worse than an honest one.\n` +
    `- Judge on visible features — body shape, fin placement, mouth, markings, ` +
    `colour — and say which ones decided it.\n` +
    `- Many of these look alike, the ponyfish especially. If you cannot ` +
    `separate two, say low confidence and list the other as an alternative.`
  );
}

function userPrompt(guesses) {
  if (!guesses.length) return 'What fish is this?';
  return (
    `What fish is this?\n\nA fish-recognition model looked at the same photo ` +
    `and offered, best first:\n` +
    guesses.map((g) => `  ${g.scientific} (${(g.accuracy * 100).toFixed(0)}%)`).join('\n') +
    `\n\nTreat that as evidence, not the answer — it is trained mostly on ` +
    `North American and European sportfish. If it names something that does ` +
    `not occur in Philippine waters, say so.`
  );
}

// Gemini's responseSchema is an OpenAPI 3.0 subset (no additionalProperties,
// no $ref), so the two schemas are written separately.
const FIELDS = ['speciesId', 'scientific', 'confidence', 'reasoning', 'alternatives'];

const GEMINI_SCHEMA = {
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
      },
    },
  },
  required: FIELDS,
  propertyOrdering: FIELDS,
};

const ANTHROPIC_SCHEMA = {
  ...GEMINI_SCHEMA,
  propertyOrdering: undefined,
  additionalProperties: false,
  properties: {
    ...GEMINI_SCHEMA.properties,
    alternatives: {
      type: 'array',
      items: { ...GEMINI_SCHEMA.properties.alternatives.items, additionalProperties: false },
    },
  },
};

async function askGemini(env, { b64, mime, guesses, catalogue }) {
  const model = env.GEMINI_MODEL || GEMINI_DEFAULT_MODEL;

  const res = await fetch(`${GEMINI_URL}/${model}:generateContent`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      // Header rather than ?key= so it stays out of request logs.
      'x-goog-api-key': env.GEMINI_API_KEY,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt(catalogue) }] },
      contents: [
        {
          role: 'user',
          parts: [
            { inline_data: { mime_type: mime, data: b64 } },
            { text: userPrompt(guesses) },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: GEMINI_SCHEMA,
        maxOutputTokens: 2048,
      },
    }),
  });

  if (!res.ok) throw new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const data = await res.json();
  const candidate = data.candidates?.[0];
  // SAFETY / RECITATION / MAX_TOKENS mean no usable answer (sometimes with a
  // 200 and empty parts).
  if (candidate?.finishReason && candidate.finishReason !== 'STOP') {
    throw new Error(`gemini stopped: ${candidate.finishReason}`);
  }
  const text = candidate?.content?.parts?.map((p) => p.text).filter(Boolean).join('');
  if (!text) throw new Error('gemini returned no text');
  return JSON.parse(text);
}

async function askClaude(env, { b64, mime, guesses, catalogue }) {
  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 4096,
      // Picking from a list doesn't need much effort; keep it fast.
      output_config: {
        effort: 'medium',
        format: { type: 'json_schema', schema: ANTHROPIC_SCHEMA },
      },
      system: systemPrompt(catalogue),
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mime, data: b64 } },
            { type: 'text', text: userPrompt(guesses) },
          ],
        },
      ],
    }),
  });

  if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const data = await res.json();
  // Refusals can come back as a 200.
  if (data.stop_reason === 'refusal') throw new Error('anthropic declined this image');

  const text = (data.content || []).find((b) => b.type === 'text')?.text;
  if (!text) throw new Error('anthropic returned no text');
  return JSON.parse(text);
}

/**
 * Ask whichever provider is configured.
 * @returns {Promise<object|null>} null when none is configured
 */
export async function secondOpinion(env, input) {
  const provider = providerFor(env);
  if (!provider) return null;

  const answer = provider === 'gemini' ? await askGemini(env, input) : await askClaude(env, input);

  // Only trust what the schema guarantees.
  return {
    speciesId: String(answer.speciesId || 'unknown'),
    scientific: String(answer.scientific || ''),
    confidence: ['high', 'medium', 'low'].includes(answer.confidence) ? answer.confidence : 'low',
    reasoning: String(answer.reasoning || ''),
    alternatives: Array.isArray(answer.alternatives) ? answer.alternatives.slice(0, 3) : [],
    provider,
  };
}
