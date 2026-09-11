'use strict';
/**
 * effort-scale.js — the one place that decides what an effort label is worth, per family.
 *
 * WHY THIS EXISTS. `resolve-dispatch-topology.js` orders the implementer ladder cheapest-first
 * using the effort label as a cost proxy. Anthropic states plainly that the labels are not
 * comparable across models: "effort level names don't correspond to the same amount of thinking
 * across models", and tells integrators to re-run an effort sweep after changing model
 * (platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-1,
 * "Consider all effort levels", read 2026-09-08). The two vendors do not even agree on what low
 * effort does: Anthropic says low makes Claude "less likely to call a search or retrieval tool",
 * while OpenAI lists low as "Ideal for use cases requiring tool-use, planning, search, or
 * multi-step decision making" (developers.openai.com/api/docs/guides/reasoning, read 2026-09-08).
 *
 * WHAT THIS TABLE HONESTLY CONTAINS TODAY: nothing that differentiates the families. Every scale
 * is the identity ranking. That is deliberate, and it is NOT an oversight to be filled in with
 * plausible numbers later by hand.
 *
 * The plan this file was built from (docs/plans/2026-09-08-family-aware-ladder-ordering.md, P1)
 * proposed seeding anthropic with "low as a bigger step down". Writing that number would have
 * violated the same plan's §2.5 constraint that every entry names how it was established: the
 * published evidence says the labels are incomparable and that low suppresses search, neither of
 * which places two vendors' levels on one axis. A fabricated coefficient would have re-created the
 * exact defect being fixed — a label trusted to mean more than the evidence supports — with more
 * machinery around it. So the seam exists, is called by the comparator, and stays identity until a
 * measured sweep fills it.
 *
 * WHAT THE SEAM BUYS even while empty:
 *   - the comparator no longer indexes a raw label table directly, so "does ordering compare raw
 *     effort labels across families?" is answerable by reading one call site;
 *   - a future sweep has exactly one place to land, with a schema that forces its provenance;
 *   - `notesFor()` carries the documented per-family facts that are real but are NOT orderings,
 *     so they can be surfaced in docs without leaking into ranking.
 *
 * Ordering must therefore NOT lean on this table to decorrelate. Decorrelation is the ladder's own
 * adjacency rule (see resolve-dispatch-topology.js), which needs no cross-vendor scale at all.
 */

const EFFORT_ORDER = Object.freeze(['low', 'medium', 'high', 'xhigh', 'max']);

const IDENTITY = Object.freeze({ low: 1, medium: 2, high: 3, xhigh: 4, max: 5 });

const UNKNOWN_RANK = 99;

// Every row must carry `evidence`. `status: 'no-evidence-to-differentiate'` is a real, reviewable
// claim — it says someone looked and found nothing that places this family's levels on a shared
// axis — and it is the only status allowed to ship an identity scale without a measurement.
const FAMILY_SCALES = Object.freeze({
  anthropic: Object.freeze({
    scale: IDENTITY,
    evidence: Object.freeze({
      status: 'no-evidence-to-differentiate',
      source: 'Prompting Claude Fable 5.1',
      url: 'https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-1',
      read_at: '2026-09-08',
      note: 'States the labels are not comparable across models and that low suppresses search. '
        + 'Neither statement yields a coefficient against another vendor, so the scale stays identity.',
    }),
  }),
  openai: Object.freeze({
    scale: IDENTITY,
    evidence: Object.freeze({
      status: 'no-evidence-to-differentiate',
      source: 'OpenAI reasoning guide',
      url: 'https://developers.openai.com/api/docs/guides/reasoning',
      read_at: '2026-09-08',
      note: 'Describes each level qualitatively (low is tool-use/search capable, xhigh for long runs) '
        + 'but publishes no scale that can be compared with another vendor.',
    }),
  }),
});

// Facts that are documented and real but are NOT orderings. Consumers may display these; the
// comparator must not read them.
const FAMILY_NOTES = Object.freeze({
  anthropic: 'low effort suppresses search/retrieval tool calls — do not seat a research role at low',
  openai: 'low effort is documented as tool-use/search capable',
});

/**
 * Rank an effort label within its family. Unknown family or unknown label ⇒ the identity rank,
 * never a neighbouring family's table and never a throw: an unrecognised engine must degrade to
 * today's behaviour, not to a guess.
 */
function normalizeEffort(family, effort) {
  const row = FAMILY_SCALES[family];
  const scale = (row && row.scale) || IDENTITY;
  const rank = scale[effort];
  if (typeof rank === 'number') return rank;
  const identity = IDENTITY[effort];
  return typeof identity === 'number' ? identity : UNKNOWN_RANK;
}

function notesFor(family) {
  return FAMILY_NOTES[family] || null;
}

/** True when this family's ranking is measured rather than inherited. Nothing qualifies yet. */
function isDifferentiated(family) {
  const row = FAMILY_SCALES[family];
  return Boolean(row && row.evidence && row.evidence.status === 'measured');
}

module.exports = {
  EFFORT_ORDER,
  IDENTITY,
  UNKNOWN_RANK,
  FAMILY_SCALES,
  normalizeEffort,
  notesFor,
  isDifferentiated,
};
