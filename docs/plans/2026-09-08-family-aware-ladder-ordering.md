# Family-aware implementer-ladder ordering

## 0. Context / thesis

The implementer ladder is a **total order** that `selectImplementerRung` climbs by index on every red
repair round (`src/engine/implementer-ladder.js:47-49`, `idx = Math.min(start + repairRound, top)`).
That order is built primary-key-first on `EFFORT_RANK` (`scripts/resolve-dispatch-topology.js:38-44`,
sort at `:436-448`), whose stated rationale is cost: *"Cheapest-first — there is no reliable price data;
effort rank low < medium < high < xhigh < max, then ascending latency"* (`:5-11`).

Two things have since become true and neither is reflected in that ordering.

1. **Effort names are not comparable across vendors.** Anthropic states it directly: *"effort level
   names don't correspond to the same amount of thinking across models"*, and tells integrators to
   re-run an effort sweep when they change model
   (`platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-1`,
   "Consider all effort levels", read 2026-09-08). The two vendors also disagree about what low effort
   even does: Anthropic says low makes Claude *"less likely to call a search or retrieval tool"*, while
   OpenAI lists low as *"Ideal for use cases requiring tool-use, planning, search, or multi-step
   decision making"* (`developers.openai.com/api/docs/guides/reasoning`, read 2026-09-08). So
   `medium@openai` and `medium@anthropic` are two different amounts of thinking wearing one label, and
   the ladder sorts them as equal.
2. **This host's ladder is mostly cross-family.** 17 rungs spanning ten engine families
   (gemini, opencode, gpt, claude, cursor, GLM, grok, MiniMax, qwen3, Qwen3). The ordering key is
   therefore applied across incomparable units for almost every adjacent pair.

There is already precedent for treating effort as family-local: `scripts/lib/grok-effort.sh` maps
autopilot's five levels onto the grok CLI's four, with probe evidence and an explicit warning that the
vendor enum moves. That file is the seed of the mechanism this plan generalises.

**Thesis.** A climb after a red result is a **decorrelation** problem, not a horsepower problem. If
`grok-4.5/high@grok` produced a bad diff, `grok-4.5/xhigh@grok` shares the model, the tokenizer, the
training data and most of the failure mode; a different family is the informative retry. The ladder
should climb family-first, and compare effort only inside a family where the label means something.

Builds on: ADR-0001 (topology facts are re-derived, never trusted); v2.36.16 (legacy seats emit a
contract-valid effort and rungs are deduped by dispatch identity); v2.36.18 item 2 (implementer rungs
carry `family`), which is a hard prerequisite for everything below.

## 1. Problem

On a red repair round the loop must pick a *better* next implementer. Today it picks the next index in
a list ordered by a label that does not mean the same thing on either side of a family boundary. The
observable failure is a repair round spent on a rung that is not stronger, not cheaper, and not
decorrelated from the one that just failed — the run burns a round and may not converge.

This is latent, not firing today: it needs a host whose ladder has both a high-effort seat in one
family and any seat in another, which this host has.

## 2. OKR / KRs

**Objective**: a climb always changes something that plausibly changes the outcome.

- **KR1**: for every adjacent rung pair in a generated ladder, either the family differs, or the family
  is the same and the effort is strictly higher. Asserted by a property test over generated ladders.
- **KR2**: no ordering decision compares raw effort labels across families. Asserted by a unit test on
  the comparator with a two-family fixture whose labels invert under normalisation.
- **KR3**: the first rung remains the cheapest available seat (the cheapest-first promise is kept, not
  traded away for decorrelation). Asserted by Case 1's existing expectations staying green.
- **KR4**: zero change to the ladder produced on a single-family host. Asserted by a fixture with three
  same-family seats producing a byte-identical ladder before and after.

## 2.5 Global Constraints (copied verbatim into every dispatch)

- ADR-0001 binds: topology is re-derived from installed binaries plus scorecard. Never read an ordering
  from a feed, a cache, or a prior receipt.
- `implementer_ladder: auto` consumers must keep working unchanged. `scripts/resolve-review-loop.sh`
  maps each rung to `{engine, effort, runner}` and drops other keys; do not change that mapping in this
  plan.
- The review-loop contract schema is NOT touched by this plan. Adding a field there triggers the
  three-way `x-field-order`/`required`/properties cascade plus the JS validator, `validPayload`, seven
  runner fixtures, the key-order pin, and the switch test's adjacency literal. Out of scope (§7).
- Never weaken or delete an existing assertion to make a new ordering pass. A changed expectation must
  be justified in the diff.
- Effort normalisation tables are **evidence-carrying**: every entry names how it was established
  (vendor doc URL with a read date, or a probe run). An unevidenced entry is a guess and is forbidden.

## 2.6 Change-policy decisions

- **Compatibility impact**: published-compatible. `implementer_ladder` keeps its shape and its
  consumers; only the ORDER of rungs changes, and only on multi-family hosts. Hosts with one family see
  a byte-identical ladder (KR4). No config key is removed or renamed.
- **Dependency decision**: none. Node built-ins plus the existing in-repo helpers.
- **Version**: PATCH (behaviour change to an existing script, no new skill or agent).

## 3. File-structure map

| File | Responsibility in this change |
|---|---|
| `scripts/lib/effort-scale.js` (new) | The per-family normalisation table and `normalizeEffort(family, effort)`. Each row carries its evidence (URL + read date, or probe). Unknown family ⇒ identity mapping, never a guess. |
| `scripts/resolve-dispatch-topology.js` | Replace the implementer comparator: normalise effort, then order family-first per §4 P2. `familyOf()` and the dedupe from v2.36.16 stay as they are. |
| `hooks/tests/resolve-dispatch-topology.test.sh` | New cases for KR1–KR4; existing Case 1/12/13 expectations must stay green or their change must be justified. |
| `scripts/lib/effort-scale.test.js` (new) | Unit tests for the table: identity fallback, evidence field present on every row, no silent default. |
| `references/hetero-dispatch.md` | One subsection: what a climb means now, and why family-first. |
| `docs/scripts-inventory.md`, `CLAUDE.md` | Index row + grouped name for the new lib file (the four-place wiring rule). |

## 4. Phases

### P1 — the normalisation table (size: S)

Create `scripts/lib/effort-scale.js` exporting `normalizeEffort(family, effort) -> number` and the raw
table. Rows are keyed by family. Each row is `{ scale: {low: n, ...}, evidence: { source, url, read_at } }`.

Seed it with exactly two evidenced families and identity for the rest:
- `anthropic`: low is documented as search-suppressing, so it is not merely "one notch below medium"
  for retrieval work; encode low as a bigger step down. Evidence: the Fable 5.1 guide URL above.
- `openai`: low is documented as tool-use/search capable; encode low as a normal step. Evidence: the
  reasoning guide URL above.
- every other family: identity (`low:1 … max:5`), `evidence: {source: 'identity-default'}`.

**Acceptance**: `node --test scripts/lib/effort-scale.test.js` green; every non-identity row has a URL
and a read date; an unknown family returns the identity rank rather than throwing or defaulting to a
neighbour's table.

### P2 — the comparator (size: S)

In the implementer branch of `resolve-dispatch-topology.js`, replace the sort with:

1. Primary: normalised effort rank ascending (cheapest-first preserved, KR3).
2. Secondary: **family rotation** — when two rungs tie on normalised rank, order so that adjacent rungs
   prefer alternating families rather than clustering one family together.
3. Tertiary: ascending `latency.sample_wall_time_s`, then engine name, exactly as today.

Then a post-pass enforces KR1: walk the ordered list and, wherever rung `i+1` has the same family and
the same normalised rank as rung `i`, pull forward the nearest later rung with a different family. If
no such rung exists, leave the order alone (a single-family host is allowed to have a same-family
neighbour; that is KR4).

**Acceptance**: KR1 and KR2 tests green; Case 1, 12 and 13 green unchanged; `--check` rc 0 after
regenerating the host cache.

### P3 — documentation and wiring (size: S)

`references/hetero-dispatch.md` gains a short subsection stating what a climb now means, with the two
vendor quotes and their URLs. `docs/scripts-inventory.md` gains the row for `scripts/lib/effort-scale.js`
and `CLAUDE.md` gains the basename in the "Shared JSON & store primitives" group (the four-place rule).

**Acceptance**: `node scripts/check-claude-md-inventory.js` rc 0; `node scripts/doc-drift-gate.js` rc 0.

## 5. Test / validation

Script-gated: `hooks/tests/resolve-dispatch-topology.test.sh` (KR1, KR3, KR4 as fixtures);
`scripts/lib/effort-scale.test.js` (KR2 and the evidence rule); `node
scripts/resolve-dispatch-topology.js --check` rc 0 on this host after regeneration; the full suite.

Mutation evidence required before this is called done: (a) revert the comparator to raw `EFFORT_RANK`
and show KR1/KR2 go red; (b) drop the KR1 post-pass and show only KR1 goes red. Per
`references/evidence-discipline.md` §30, confirm each mutant fails for the intended reason and not by
crashing into a `catch`.

Human-gated: nothing. This change is entirely mechanical and its acceptance is a property of generated
ladders.

## 6. Risks + inversion

What would guarantee failure:

- **Encoding a normalisation table from intuition.** The whole defect being fixed is a label treated as
  meaning more than the evidence supports. A guessed table repeats the defect with more machinery.
  Mitigated by the evidence field being mandatory and tested.
- **A stale table.** `grok-effort.sh` already carries the scar: it clamped `xhigh→high` for a month
  after xAI shipped `xhigh`. Mitigated by storing `read_at` and treating the table as advisory input to
  ORDER only, never as an authorisation to dispatch.
- **Optimising decorrelation so hard that cheapest-first dies.** If family rotation outranks cost, a
  run starts on an expensive seat. KR3 exists to catch exactly this.
- **Silently reordering single-family hosts.** KR4 exists to catch this.

## 7. Out of scope

- Plumbing `family` through the review-loop contract schema (the three-way cascade). The topology
  producer carries it; the resolver's `{engine, effort, runner}` mapping is unchanged.
- Reviewer, consult, discuss and plan-review ladders. They already carry `family` and are selected by
  different rules; changing them is a separate decision.
- Per-family prompt style (v2.36.18 item 6). Related, separately shipped.
- Cost-based ordering from real price data. There still is none; this plan keeps the effort proxy and
  only fixes its cross-family comparability.

## 8. Open questions

- **Q1 — is family rotation the right secondary key, or should the ladder simply refuse to place two
  same-family rungs adjacently at any cost?** The strict version could reorder a single-family host's
  ladder into nonsense. Recommendation: the KR1 post-pass as written (best-effort, leaves single-family
  hosts alone). Board ruling needed only if the strict version is wanted.
- **Q2 — should a climb also be allowed to move DOWN in effort when it changes family?** A cheaper seat
  in a decorrelated family may beat an expensive correlated one. Recommendation: no, not in this plan;
  it changes the cheapest-first contract and deserves its own evidence.

- **Q3 — what family is an OpenCode-hosted engine?** `familyOf()` returns `unknown` for
  `opencode-go/muse-spark-1.3-contributor`, which is three of this host's seventeen rungs. `unknown`
  degrades safely here (P1 gives it the identity scale), but `familyOf` also feeds the cross-family
  review-panel checks, so classifying it is a gate-affecting change and is deliberately NOT bundled
  into this plan. Recommendation: leave `unknown` until someone needs opencode to count as a distinct
  family for decorrelation, then change it as its own unit with the panel tests in scope.

## Review log

R0 author: depth-0 (Claude Opus 5), 2026-09-08. Not yet reviewed; this plan is authored for the bounded
plan-review loop and has no generations recorded.
