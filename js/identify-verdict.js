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
//            better at knowing a fish is not plausible in Leyte Gulf.
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
};

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
