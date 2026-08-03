# Reviewer MVP Portfolio Aggregation

`scripts/review-mvp-portfolio.js` turns a bounded panel assessment into a deterministic minimum
shippable portfolio. It is a depth-0 synthesis tool, not another reviewer and not scope authority.
Candidate union discovers options; it never expands the frozen ticket automatically.

## Input contract

Invoke with `node scripts/review-mvp-portfolio.js --input <panel.json|->`. The schema-1 input is:

```json
{
  "schema_version": 1,
  "roster": ["reviewer-a", "reviewer-b"],
  "budget": 8,
  "acceptance_prerequisites": ["core-path"],
  "reviewers": [
    {
      "reviewer_id": "reviewer-a",
      "assessments": [
        {
          "item_id": "core-path",
          "title": "Ship the core path",
          "classification": "MUST-FIX",
          "evidence": "Frozen acceptance A1 names this path.",
          "evidence_kind": "spec",
          "evidence_verified": true,
          "scores": { "acceptance": 10, "risk": 8, "value": 9, "cost": 3 }
        }
      ]
    }
  ]
}
```

Collection is deliberately **two-pass**:

1. Each reviewer independently nominates stable subitems with evidence. Depth-0 deduplicates that
   discovery union by `item_id` and freezes the candidate list; nomination alone never expands
   scope.
2. The same frozen list is sent back to every roster member. Every reviewer scores every item, so
   absence cannot act as a hidden zero, veto, or accidental admission. Only that complete matrix
   may enter the deterministic aggregator.

Do not append portfolio JSON to the normal `VERDICT` / `FINDINGS` review protocol. The ordinary
review rail remains a defect verdict; portfolio scoring is a separate depth-0 synthesis phase
invoked only when the task has explicit subitems, a fixed budget, and a panel.

The roster must be unique and exactly match the reviewer blocks. Every reviewer must assess the
exact same candidate union, once per stable `item_id`; this prevents unknown or strategically
unscored items from entering the MVP. Titles and optional follow-up metadata must agree across the
panel. Scores are integer `acceptance`, `risk`, and `value` in `0..10`, plus positive integer
`cost`. Evidence kind is one of `spec`, `test`, `verified-observation`, `preference`, or
`unsupported`; preference and unsupported claims cannot be marked verified.

An eligible `CUT/FOLLOW-UP` may add identical metadata in every assessment:

```json
{
  "follow_up": {
    "context": "Why this remains valuable but is not current scope.",
    "trigger": "The observable condition that makes a later ticket timely.",
    "proposed_backlog_title": "A concrete backlog title"
  }
}
```

## Selection rule

The aggregator applies these rules in order:

1. Union candidates by stable `item_id`; never use majority voting.
2. Select every evidence-verified `MUST-FIX` and every frozen acceptance prerequisite. Their
   conservative cost is the maximum cost assigned by any reviewer. If mandatory cost exceeds the
   fixed budget, fail closed.
3. Exclude optional candidates unless every roster member supplied complete, verified,
   non-preference evidence and all four scores.
4. Over the remaining budget, maximize the sum of panel `acceptance + risk + value` scores.
   Deterministic ties prefer fewer items, then lower cost, then lexical `item_id`.
5. Emit every unselected item in `cut_list`. A cut never blocks the current terminal state.

This yields the smallest portfolio among equal maximum-score portfolios. It does not reinterpret
the frozen prerequisites, invent requirements, or implement follow-ups.

## Output and backlog handoff

The result contains:

- `selected_mvp`, with selection reason and per-reviewer/aggregate score breakdown;
- `cut_list`, including unsupported or preference-only exclusions;
- `backlog_candidates`, never a direct write to `docs/BACKLOG.md`;
- aggregate budget/score accounting and stable tie-breakers;
- a bounded `terminal_condition` proving prerequisites and verified MUST-FIX items are selected.

Only an unselected, fully evidence-backed, positive-value `CUT/FOLLOW-UP` with complete follow-up
metadata enters `backlog_candidates`. Each entry carries a stable SHA-256 fingerprint over its
`item_id`, context, trigger, and proposed title; sorted sources; concrete evidence; and aggregate
score. Preference-only, unsupported, selected, malformed, or duplicate items are excluded. LSM P4
remains the authority that deduplicates and admits candidates to the real backlog. This emission
does not change the current MVP terminal state or authorize a new ticket.

Malformed JSON, unknown fields, roster/candidate-matrix mismatch, score gaps, metadata drift, and
impossible mandatory budgets exit `2` without a portfolio.
