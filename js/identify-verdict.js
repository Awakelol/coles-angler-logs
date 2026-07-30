// ---------------------------------------------------------------------------
// CROSS-CHECKING TWO IDENTIFIERS
//
// Two services look at the same photo and they do not know the same things:
//
//   FISHIAL  a model trained specifically on fish. Strong where it has
//            training data, which skews North American and European sportfish.
//            Returns a ranked list with accuracy scores.
//   CLAUDE   a general model, but it can be handed THIS region's catalogue and
//            told to pick from it. Weaker at fine-grained lookalikes, much
//            better at knowing a fish is not plausible in these waters.
//
// The rule: agreement is the answer. Disagreement is not a coin toss — the
// LOCAL CATALOGUE breaks the tie. A species that does not occur in these
// waters is wrong however confident the classifier is, and that is the one
// judgement neither model makes on its own.
//
// Pure and free of network calls so it can be tested directly.
// ---------------------------------------------------------------------------

/** Scientific names vary in case, spacing, and trailing authority strings. */
export function normalise(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2) // genus + species; drop any author citation
    .join(' ');
}

export const VERDICTS = {
  AGREED: 'agreed',
  CORROBORATED: 'corroborated',
  LOCAL_WINS: 'local-wins',
  SPLIT: 'split',
  ONE_SIDED: 'one-sided',
  NONE: 'none',
  // Reached without any language model — see reconcileLocal().
  LOCAL_MATCH: 'local-match',
  LOCAL_DEMOTED: 'local-demoted',
  RELATED: 'related',
  NOT_LOCAL: 'not-local',
};

const genusOf = (name) => normalise(name).split(' ')[0] || '';

/**
 * Check Fishial's ranking against the local catalogue — no language model.
 *
 * This is the whole cross-check done for free. Fishial is trained mostly on
 * North American and European sportfish, so on an Indo-Pacific fish its top
 * answer can be confidently wrong. What catches that is not intelligence, it
 * is a lookup: does this species actually occur here? The catalogue already
 * knows, and that judgement costs nothing to make.
 *
 * The escalation, in order:
 *   1. Top answer is a local species          -> take it
 *   2. A LOWER-ranked answer is local         -> take that, say why
 *   3. None are local but a genus matches     -> offer the local relative
 *   4. Nothing matches                        -> report it, flagged clearly
 *
 * @param {Array} candidates [{scientific, accuracy}] ranked, best first
 * @param {Array} catalogue  [{id, scientific, common}] species found here
 */
export function reconcileLocal(candidates, catalogue = []) {
  const ranked = (candidates || [])
    .filter((c) => c && c.scientific)
    .map((c) => ({ ...c, key: normalise(c.scientific) }));

  if (!ranked.length) {
    return { verdict: VERDICTS.NONE, agreed: false, confidence: 'none', answer: null };
  }

  const byName = new Map();
  const byGenus = new Map();
  for (const s of catalogue) {
    const k = normalise(s.scientific);
    byName.set(k, s);
    const g = genusOf(s.scientific);
    if (g && !byGenus.has(g)) byGenus.set(g, s);
  }

  const top = ranked[0];

  // 1 & 2 — the best-ranked candidate that actually occurs here.
  const localIndex = ranked.findIndex((c) => byName.has(c.key));
  if (localIndex >= 0) {
    const hit = ranked[localIndex];
    const species = byName.get(hit.key);

    if (localIndex === 0) {
      return {
        verdict: VERDICTS.LOCAL_MATCH,
        agreed: true,
        answer: species.scientific,
        speciesId: species.id,
        confidence: hit.accuracy >= 0.7 ? 'high' : hit.accuracy >= 0.4 ? 'medium' : 'low',
        note: 'Recorded in these waters, and the fish model ranked it first.',
      };
    }

    return {
      verdict: VERDICTS.LOCAL_DEMOTED,
      agreed: false,
      answer: species.scientific,
      speciesId: species.id,
      runnerUp: top.scientific,
      confidence: 'medium',
      note:
        `The fish model ranked ${top.scientific} first, but that isn't recorded ` +
        `in these waters. Its #${localIndex + 1} pick, ${species.scientific}, is.`,
    };
  }

  // 3 — same genus as something local. Close relatives look alike, and this is
  // usually the right family of answer even when the species is wrong.
  for (const c of ranked) {
    const relative = byGenus.get(genusOf(c.scientific));
    if (relative) {
      return {
        verdict: VERDICTS.RELATED,
        agreed: false,
        answer: relative.scientific,
        speciesId: relative.id,
        runnerUp: c.scientific,
        confidence: 'low',
        note:
          `No exact match here. The fish model suggested ${c.scientific}; the ` +
          `closest species recorded in these waters is ${relative.scientific}, ` +
          `a close relative. Check the two side by side.`,
      };
    }
  }

  // 4 — nothing local. Say so rather than dressing up a foreign species.
  return {
    verdict: VERDICTS.NOT_LOCAL,
    agreed: false,
    answer: top.scientific,
    speciesId: null,
    confidence: 'low',
    note:
      `The fish model's best guess is ${top.scientific}, which isn't in the ` +
      `local catalogue. Either it's a species not yet listed, or the ` +
      `model is out of its depth — it's trained mostly on Atlantic and ` +
      `Pacific sportfish. Treat this as a lead, not an answer.`,
  };
}

/**
 * Decide what to tell the user.
 *
 * @param {object}   claude   {scientific, speciesId, confidence, reasoning}
 * @param {Array}    fishial  [{scientific, accuracy}] ranked, best first
 * @param {Function} inRegion (scientificName) => boolean — is it in the local
 *                            catalogue? This is what makes the tie-break real.
 */
export function arbitrate(claude, fishial, inRegion = () => false) {
  const ranked = (fishial || [])
    .filter((f) => f && f.scientific)
    .map((f) => ({ ...f, key: normalise(f.scientific) }));

  const pick = claude && claude.scientific ? normalise(claude.scientific) : '';

  if (!pick && !ranked.length) {
    return { verdict: VERDICTS.NONE, agreed: false, confidence: 'none', answer: null };
  }

  // Only one side answered — usable, but say which one and don't inflate it.
  if (!pick || !ranked.length) {
    const source = pick ? 'claude' : 'fishial';
    const answer = pick ? claude.scientific : ranked[0].scientific;
    return {
      verdict: VERDICTS.ONE_SIDED,
      agreed: false,
      source,
      answer,
      confidence: 'low',
      note: `Only ${source === 'claude' ? 'the local catalogue check' : 'the fish model'} returned a result.`,
    };
  }

  const top = ranked[0];

  // 1. Both landed on the same species. This is the strong case.
  if (top.key === pick) {
    return {
      verdict: VERDICTS.AGREED,
      agreed: true,
      answer: claude.scientific,
      speciesId: claude.speciesId || null,
      confidence: top.accuracy >= 0.7 ? 'high' : 'medium',
      note: 'Both the fish model and the local catalogue check agree.',
    };
  }

  // 2. They disagree. Is Claude's pick anywhere in Fishial's ranking? If so
  //    the two are closer than the top line suggests — Fishial saw it, just
  //    ranked something else higher.
  const alsoSeen = ranked.findIndex((f) => f.key === pick);
  if (alsoSeen > 0) {
    return {
      verdict: VERDICTS.CORROBORATED,
      agreed: false,
      answer: claude.scientific,
      speciesId: claude.speciesId || null,
      confidence: 'medium',
      runnerUp: top.scientific,
      note:
        `The fish model ranked ${top.scientific} first but had ${claude.scientific} ` +
        `at #${alsoSeen + 1}. Going with the one that occurs in these waters.`,
    };
  }

  // 3. Genuine disagreement. The catalogue decides: a species that isn't found
  //    here is wrong no matter how confident the classifier is.
  const topIsLocal = inRegion(top.scientific);
  const pickIsLocal = inRegion(claude.scientific);

  if (pickIsLocal && !topIsLocal) {
    return {
      verdict: VERDICTS.LOCAL_WINS,
      agreed: false,
      answer: claude.scientific,
      speciesId: claude.speciesId || null,
      confidence: 'medium',
      runnerUp: top.scientific,
      note:
        `The fish model said ${top.scientific}, which isn't recorded in these ` +
        `waters. ${claude.scientific} is, so that's the better answer.`,
    };
  }

  if (topIsLocal && !pickIsLocal) {
    return {
      verdict: VERDICTS.LOCAL_WINS,
      agreed: false,
      answer: top.scientific,
      speciesId: null,
      confidence: 'medium',
      runnerUp: claude.scientific,
      note:
        `Going with the fish model: ${top.scientific} is recorded in these ` +
        `waters and ${claude.scientific} isn't.`,
    };
  }

  // 4. Nothing separates them. Say so rather than pretending — an honest
  //    "these two disagree" is more useful than a confident wrong answer.
  return {
    verdict: VERDICTS.SPLIT,
    agreed: false,
    answer: claude.scientific,
    speciesId: claude.speciesId || null,
    runnerUp: top.scientific,
    confidence: 'low',
    note:
      `No agreement: the fish model says ${top.scientific}, the catalogue ` +
      `check says ${claude.scientific}. Compare both before recording it.`,
  };
}
