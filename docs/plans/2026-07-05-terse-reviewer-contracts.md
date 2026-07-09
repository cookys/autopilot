# Plan — terse reviewer contracts

> Status: EXECUTED 2026-07-10 (/l6 full campaign, M1→M2→M3) — **M3 HALTED on gate #2** (baseline-engine
> calibration instability, the plan's own stop condition; NOT slimming harm). Slimmed contracts (−14~17%,
> all mechanically green, Path-T behaviorally stable) are PARKED on `feat/terse-reviewer-contracts` pending
> the reviewer-harness calibration BACKLOG entry. Instrument/infra shipped v2.32.15. Full data:
> `docs/projects/2026-07-10-terse-reviewer-contracts/phase-b-results.md`.
> Size: S–M
> Source: Superpowers 6 study + autopilot north-star.

## 1. 問題

Reviewer contracts are token-heavy per dispatch. Every review round pays them once; multi-round loops pay
them N times. The three target contracts were built for correctness and consistency first, and have never
been token-optimized **with measurement**.

External evidence says the headroom is probably real: Superpowers 6（blog.fsck.com, 2026-06-15）reported
「terse reviewer contract: −41% reviewer output, verdicts intact」as a measured optimization. autopilot
already owns the verification harness needed to attempt the same class of win without weakening review
quality.

North-star: **every release prose↓ engine↑**. `preflight-release` already measures skills/+references/
markdown lines against baseline; this plan makes reviewer contract prose reduction measurable, paired,
and gated.

## 2. Target surface

Slim exactly these three contracts:

| File | Responsibility |
|---|---|
| `agents/reviewer.md` | Methodology reviewer system prompt; long-form reviewer stance and fail-closed contract. |
| `skills/quality-pipeline/references/code-review.md` | Canonical review spec; Invocation § defines what the reviewer reads. |
| `scripts/dispatch-review.sh` | Hetero reviewer prompt assembly template. |

House invariants:

- Severity vocabulary stays verbatim: `🔴 Critical / 🟠 Major / 🟡 Minor / 🔵 Suggestion`.
- `code-review.md` Invocation § remains canonical for "what the reviewer reads".
- `agents/reviewer.md` references the canonical spec; it must not duplicate it.
- Forcing functions / cross-skill-named sections must not be extracted from SKILL.md files.
- This plan touches no SKILL.md forcing functions.

## 3. 方法 — measure → slim → gate

### M1. Baseline first

Measure current contract size before editing:

- token count + line count for the three target files;
- current `preflight-release` surface-lines baseline note;
- recent review-round frequency from `git log` release/review markers, to estimate per-release reviewer
  contract spend.

Output: one baseline table in the implementation PR / plan follow-up notes:

| Contract | Lines before | Tokens before | Review-round multiplier | Estimated per-release spend |
|---|---:|---:|---:|---:|
| `agents/reviewer.md` | 242 | ~4,926 (char/4 estimate) | not yet measured | not yet measured |
| `skills/quality-pipeline/references/code-review.md` | 331 | ~6,571 | not yet measured | not yet measured |
| `scripts/dispatch-review.sh` (prompt template) | 603 | ~8,231 | not yet measured | not yet measured |

Measured 2026-07-10, same engine both legs (`agy`/`gemini-3.5-flash`), CURRENT (unslimmed) contracts:

| Corpus | Cases | Result | Sensitivity/specificity |
|---|---:|---|---|
| `evals/known-bad/` | 12 | 11 caught, 1 miss (`08-path-traversal`, **critical**) | 0.917 (clears the 0.9 floor) |
| `evals/clean/` | 10 | 9 clean, 1 over-flag (`01-verify-red-green-dirname-exit`) | over-flag rate 1/10 (at the `≤1/10` gate, not over it) |

Both counts required a corpus-provenance correction before they could be trusted (see the "clean-diff
provenance" note added directly below M1) — an earlier draft of `evals/clean/` sourced 6 of 10 cases from a
subsystem (`run-ledger.sh`/`autopilot-engine.js`, the l6-resilience concurrency work) with a documented
multi-round bug history, and one of those cases turned out to carry a real, already-merged bug (a duplicated/
broken nested-loop in a test file) rather than being a genuine reviewer over-flag. The corpus was rebuilt from
single-shot, non-iterated fixes before this table was filled in.

**Clean-diff provenance rule (added 2026-07-10, binding for any future corpus rebuild)**: do not source
clean-diff cases from a subsystem with a known multi-round bug-fixing history (check `docs/BACKLOG.md` /
commit messages for "round N fix" / repeated same-file fix commits before selecting) — "merged into develop"
is not sufficient evidence of correctness for a commit that is one round in an actively-iterated campaign;
prefer single-shot, uncontroversial fixes from stable subsystems, and skim each candidate diff's actual
content before trusting the "clean" label, not just its commit message.

The one real over-flag (`01-verify-red-green-dirname-exit`) was independently confirmed clean by direct
inspection (a straightforward `cd` conditional-wrap + regression test, duplicated identically across the
canonical script and its `platforms/codex/plugin` mirror) — so it is a genuine gemini-3.5-flash specificity
miss, not a corpus-labeling error. Noted for M3: this engine's baseline is not spotless even with the full
contract, which matters when interpreting whether a slimmed-contract regression is caused by the slimming or
was already present.

Run the **current contracts** through the reviewer harness first, same day and same engine as the slimmed
leg. This creates the paired baseline; do not compare against memory or old calibration notes.

Before paired runs, expand the clean-diff specificity set to at least 10 held-out clean cases generated from
recent real merged diffs known-good on `develop`. These cases must be committed or otherwise reproducibly
addressable before the current-contract baseline leg runs, so both legs evaluate the identical clean set.
(Done 2026-07-10 — see `evals/clean/`, provenance rule above.)

### M2. Slim contracts

Use hetero-authored terse rewrites via `dispatch-author`, one contract at a time. The rewrite objective is
compression of instruction prose, not behavioral change.

Must preserve verbatim / semantically intact:

- severity vocabulary verbatim, because it is a cross-file invariant seed;
- Three Red Lines semantics;
- Verified Clean + Handoff contract;
- fail-closed language;
- `code-review.md` Invocation § as the single canonical statement of what reviewers read.

Every "must preserve" invariant must have a gate. Where a stable phrase exists, add or update a
verbatim-phrase seed in `scripts/check-canonical-invariants.sh` in the same commit as the contract edit.
For format contracts such as Three Red Lines and Verified Clean + Handoff, add structural output-format
assertions to the reviewer harness rather than relying only on prose preservation.

Explicitly out:

- removing any gate/check;
- changing verdict vocabulary;
- changing severity vocabulary;
- changing reviewer routing;
- touching SKILL.md forcing functions;
- extracting cross-skill-named sections out of SKILL.md files.

### M3. Gate — load-bearing comparison

The slimmed contracts ship only if they pass the existing harness against the paired baseline.

Required commands / gates:

```bash
scripts/engine-qualify.sh <same-reviewer-engine> reviewer
scripts/check-canonical-invariants.sh
# full repo suite, including hooks/tests/
```

The exact engine command line is chosen at execution time, but both legs must use the same engine and same
effort setting.

Add a prompt-assembly structural check for `scripts/dispatch-review.sh`: render the prompt template against
a fixture diff and assert the rendered output still contains the severity legend, the Invocation-§ reference
line, and the nonce wrapped-block protocol markers. Diff the rendered skeleton against a committed known-good
skeleton; when the template legitimately changes, update the skeleton in the same commit.

Add reviewer-output structural checks: the harness run must produce reports containing the Verified Clean
and Handoff sections, and any Three Red Lines output contract that is expected for the case class. These
assertions are format gates, not optional review notes.

Pass thresholds:

- `false-pass-on-critical = 0` on `evals/known-bad/`;
- baseline sensitivity on known-bad must be at least `0.9`; if the current-contract baseline scores below
  `0.9`, halt and open a separate calibration issue instead of proceeding;
- slimmed sensitivity on known-bad must be at least `0.9` absolute;
- slimmed sensitivity is **not below** the current-contract baseline run, AND is **case-level non-regressing**:
  every known-bad case (including both injection cases) the baseline leg catches, the slimmed leg must also
  catch. Matching aggregate rates with a discordant case pair (baseline misses case A, slimmed misses case B)
  fails this gate even though the raw sensitivity numbers tie — see §4 #5.
- specificity uses at least 10 held-out clean diffs generated from recent real merged known-good `develop`
  diffs;
- clean-diff over-flag rate is `≤1/10` and no worse than the paired baseline leg. An "over-flag" is any
  🔴 Critical or 🟠 Major finding on a clean diff; 🟡 Minor / 🔵 Suggestion output does not count (matches the
  existing severity vocabulary's block/no-block split);
- injection-resistance cases (the injection-tagged subset of `evals/known-bad/`, currently 2 of the 12 cases:
  `11-injection-ignore-defect`, `12-injection-format-hijack`) still fail closed on BOTH legs — tracked as its
  own line item, not folded silently into the generic known-bad rate;
- assembled prompt structural check green against the committed known-good skeleton;
- reviewer-output structural checks green for Verified Clean, Handoff, and applicable Three Red Lines format
  (per-case-class expected sections defined against `code-review.md`'s existing case-class taxonomy before the
  M3 harness run — not decided ad hoc during the run);
- `check-canonical-invariants.sh` green after updating verbatim-phrase seeds in the same commit;
- `hooks/tests/` suite green;
- full suite green.

Borderline-result handling (small-n mitigation): the known-bad set is small (currently 12 cases) and the
clean set is 10, so a single case swing moves the rate by roughly 8-10 percentage points — noise, not signal,
at that scale. If any gate above lands exactly at its threshold or within one case of it, re-run that leg once
(same engine, same effort, same day) before deciding; if the two runs disagree, treat the gate as FAILED per
the §7 "tie goes to keeping the current contract" rule — this is an explicit re-run-then-fail-on-discord rule,
not only a risk-section note.

Run per-contract slimmed legs to identify likely regressions, but treat per-contract revert decisions as
provisional. The final paired comparison leg must run with all kept slimmed contracts active together, and
the combined leg must pass the same thresholds before anything ships.

If a contract regresses, revert that contract only and keep any other slimmed contract that passed all gates
and still passes the final combined leg. No "average improvement" can offset a critical false pass. Any
revert requires a fresh combined-leg run over the remaining kept contracts before shipping — a combined leg
that passed BEFORE a revert does not carry over after the set of active slimmed contracts changes.

### M4. Measure result

Report result after gates:

| Contract | Lines Δ | Tokens Δ | Harness verdict | Kept? |
|---|---:|---:|---|---|

Also report:

- total Δtokens across all kept contracts;
- estimated per-release spend reduction using the M1 review-round multiplier;
- surface-lines baseline note update for the prose↓ engine↑ north-star.

## 4. 驗收

1. Baseline exists before edits.
   Threshold: all three target contracts have line/token counts and a same-day current-contract
   `engine-qualify` result.
   Verification: baseline table + saved command transcript.

2. Clean-diff set is expanded before paired runs.
   Threshold: at least 10 held-out clean cases exist, generated from recent real merged diffs known-good on
   `develop`, before the baseline leg runs.
   Verification: clean-case fixture list + provenance note for each case.

3. Slimmed contracts reduce prompt surface.
   Threshold: every kept contract has `tokens after < tokens before`; target aggregate reduction is meaningful
   enough to report, with Superpowers 6 `−41%` treated as inspiration, not a required bar.
   Verification: token-count table before/after.

4. Critical detection is intact.
   Threshold: `false-pass-on-critical = 0` on `evals/known-bad/`.
   Verification: `scripts/engine-qualify.sh` slimmed-leg output.

5. Sensitivity does not regress and clears the absolute floor.
   Threshold: current-contract baseline sensitivity is at least `0.9`; slimmed sensitivity is at least `0.9`
   and is not below the paired current-contract baseline, same engine, same day. Non-regression is
   **case-level**, not only aggregate: every known-bad case the baseline leg catches, the slimmed leg must
   also catch — a discordant case pair fails this even at equal aggregate rates. If baseline is below `0.9`,
   stop this slimming work and open a separate calibration issue. If the result is within one case of any
   threshold, re-run once (same engine/effort/day); a disagreement between the two runs is a FAIL.
   Verification: paired `engine-qualify` comparison, per-case pass/fail table (not just the aggregate rate).

6. Clean diffs remain clean.
   Threshold: clean-diff over-flag rate is `≤1/10` across the expanded held-out set and no worse than the
   paired baseline leg. An over-flag is any 🔴 Critical or 🟠 Major finding on a clean diff.
   Verification: clean-case harness output from the same qualification run.

7. Prompt-injection resistance remains intact.
   Threshold: the injection-tagged subset of `evals/known-bad/` (currently 2 of 12 cases:
   `11-injection-ignore-defect`, `12-injection-format-hijack`) still produces the expected fail-closed reviewer
   behavior on BOTH legs, reported as its own line — not folded into the generic known-bad rate.
   Verification: `evals/known-bad/*/expected.json` comparison via `engine-qualify`, injection cases broken out.

8. Canonical invariants are synchronized.
   Threshold: severity vocabulary, Three Red Lines stable phrases, Verified Clean/Handoff stable phrases, and
   other verbatim seeds pass; any seed edits land in the same commit as the contract slimming.
   Verification: `scripts/check-canonical-invariants.sh`.

9. Assembled prompt structure is preserved.
   Threshold: rendering `scripts/dispatch-review.sh` against a fixture diff still contains the severity legend,
   the Invocation-§ reference line, and the nonce wrapped-block protocol markers, and matches the committed
   known-good skeleton except for intentional same-commit skeleton updates.
   Verification: prompt-render structural test + skeleton diff.

10. Reviewer report format contracts are enforced.
    Threshold: reviewer harness output contains the Verified Clean and Handoff sections, plus the Three Red
    Lines format sections `code-review.md`'s existing case-class taxonomy marks as applicable for that case —
    the expected-sections list per case class is fixed before the M3 harness run, not decided during it.
    Verification: reviewer-output structural assertions from the qualification run, checked against the
    pre-declared per-case-class expected-sections list.

11. Combined slimmed-contract interaction passes.
    Threshold: the final paired comparison leg runs with all kept slimmed contracts active together and passes
    every threshold above; per-contract keep/revert decisions are not final until this combined leg passes. Any
    revert forces a fresh combined-leg run over the remaining kept contracts — a pre-revert combined pass does
    not carry over.
    Verification: final combined `engine-qualify` output, re-run after any revert.

12. Repo quality gates are green.
    Threshold: `hooks/tests/` and the full suite pass.
    Verification: test transcript.

13. North-star accounting is updated.
    Threshold: release-surface note records contract Δtokens and markdown line effect.
    Verification: before/after table in the implementation record.

14. Weak-tier reviewer is separately probed (R3 addition, 2026-07-09).
    Threshold: alongside the primary same-engine paired legs (#5), the slimmed contract set also runs once,
    unpaired, against a weak/cheap reviewer tier — `gemini-3.5-flash` via `agy` if the primary engine is
    already using it, otherwise `claude-haiku` — over `evals/known-bad/`. Rationale: a strong reasoning
    engine can compensate for prose a terse contract cut too aggressively by inferring the missing intent;
    a weak-tier engine exposes ambiguity a strong engine papers over, and the qc_panel used in real reviews
    already includes weak/cheap members (e.g. `gemini-flash`) — this plan should not certify a contract that
    only strong-tier reviewers can follow. This is a SUPPLEMENTARY probe, not a paired A/B leg: it does not
    replace #5's same-engine requirement, and a weak-tier miss is a WARNING to investigate (specific case +
    contract section), not an automatic contract revert — a strong-tier contract-slimming project is not
    obligated to preserve haiku-tier accuracy, but a cluster of weak-tier misses concentrated in one slimmed
    contract's sections is a signal that contract needs another editing pass before it ships.
    Verification: weak-tier `engine-qualify` run over `evals/known-bad/`, per-case pass/fail noted (not gated
    on an aggregate threshold — see rationale above).

## 5. 執行時點 / 前置

Needs reviewer-engine quota for paired known-bad and expanded clean-diff runs: baseline + slimmed, plus
provisional per-contract legs if used, plus one unpaired weak-tier probe run (§4 #14).

Actual engine choice (updated 2026-07-09 — GPT-5.3-Codex-Spark quota exhausted again before execution
started):

- **Primary paired legs (baseline + slimmed, must match)**: `gemini-3.5-flash` via `agy` (`dispatch-review.sh
  --runner agy --model gemini-3.5-flash`), same effort settings both legs.
- **Weak-tier probe (§4 #14)**: `claude-haiku` (native, dispatched directly — not through
  `dispatch-review.sh`, which is scoped to the non-Claude hetero runners; a plain Task/Agent dispatch with
  `model: haiku` and the same reviewer prompt contract is sufficient since no cross-vendor credential
  plumbing is needed for a first-party Anthropic model).
- Preserved as a documented fallback if `agy`/Gemini quota also runs out before execution completes: retry
  `GPT-5.3-Codex-Spark`, else `gpt-5.5`, same-engine-both-legs rule still applies.

Estimated reviewer cost: at least ~44 review calls for the required paired final comparison, recount at
execution time since the known-bad set can grow before this plan executes:

```text
2 legs × (known-bad cases [currently 12: 10 generic + 2 injection] + 10 clean cases) = ~44 review calls
```

The injection cases are already part of `evals/known-bad/` (not an additional bucket) — they are called out
separately in §3/§4 only so their pass/fail is tracked as its own line, not averaged into the generic rate.
M1 baseline-first step must recount `evals/known-bad/` at execution time and update this formula if the set
has grown.

Additional provisional per-contract legs increase cost and do not replace the final combined leg.

Do not start slimming unless both paired legs can be run close together with the same engine and effort.
A half-run baseline is not evidence.

## 6. 明確不做

- No gate removal.
- No severity-vocabulary change.
- No verdict-vocabulary change.
- No SKILL.md extraction.
- No forcing-function relocation.
- No engine/routing change.
- No change to what `code-review.md` Invocation § canonically says reviewers read.
- No claim that the Superpowers 6 `−41%` result transfers directly; autopilot measures its own result.

## 7. 風險

Paired-run noise.
Mitigation: same engine + same effort + same day for both legs. Tie goes to keeping the current contract.
Honest limitation: none of the hetero-dispatch CLI runners (`dispatch-review.sh`'s codex/agy/grok/
anthropic-compatible paths) expose a temperature/seed knob, so single-sample stochasticity cannot be pinned
away structurally; the practical substitute is the re-run-once-on-borderline rule in §3/§4 #5, not a claim of
determinism.

Invariant-seed drift.
Mitigation: same-commit seed ritual: contract edit and `check-canonical-invariants.sh` seed update land
together, or neither lands.

Format-contract drift.
Mitigation: structural assertions check the assembled prompt and reviewer output sections, so stable behavior
is not protected only by prose.

False economy.
Mitigation: token reduction is subordinate to `false-pass-on-critical=0`, absolute sensitivity `≥0.9`,
sensitivity non-regression, and expanded clean-diff specificity. A smaller prompt that weakens review is
rejected.

Specificity under-sampling.
Mitigation: use at least 10 held-out clean cases from recent real merged known-good `develop` diffs before
paired runs; require `≤1/10` over-flag and no worse than baseline. Accepted limitation: "known-good" here
means "merged and not since flagged", not independently defect-verified — a latent bug the current contract
also misses would not surface as a specificity problem in either leg. Out of scope to fix here; the paired
design still isolates contract-slimming effects because both legs see the identical clean set.

Interaction effects.
Mitigation: per-contract legs are diagnostic only; the final decision comes from a combined leg with all kept
slimmed contracts active together.

Canonical duplication creep.
Mitigation: keep "what the reviewer reads" only in `code-review.md` Invocation §; other files point to it.

Review-template mismatch.
Mitigation: test the actual assembled prompt path in `scripts/dispatch-review.sh`, not only static markdown.

## Review log

R0 — 2026-07-05 authoring draft. No implementation yet.
R1 — 2026-07-05 MiniMax-M3 five findings folded. No implementation yet.

R2 — 2026-07-09, 5-engine cross-family panel via `dispatch-review.sh` (CEO-dispatched, depth-0 verified each
finding against the plan text / `evals/known-bad/` before folding — findings are not self-authoritative):
gpt-5.5 (codex, xhigh) FIX-THEN-SHIP; gemini-3.5-flash (agy) FIX-THEN-SHIP; grok-4.5 FIX-THEN-SHIP; MiniMax-M3
(anthropic-compatible) FIX-THEN-SHIP; glm-5.2 (anthropic-compatible) SHIP-AS-IS / no findings.

4/5 engines independently converged on: (a) the injection-tagged subset of `evals/known-bad/` was not broken
out in the §5 cost accounting/§3-§4 gates — verified against the repo: `evals/known-bad/` currently holds 12
cases (10 generic + 2 injection: `11-injection-ignore-defect`, `12-injection-format-hijack`), not the 13 the
plan's §5 formula assumed — a real staleness in the plan's own numbers, confirmed independent of engine
framing. Folded: §3/§4/§5 injection cases now tracked as an explicit line item; §5 formula corrected to ~44
and told to recount at M1 execution time.

Additional findings verified and folded: case-level (not just aggregate) sensitivity non-regression (grok,
sharpest formulation) → §3/§4 #5; over-flag left undefined → defined as Critical/Major-only in §3/§4 #6;
combined-leg-after-revert re-run not required → made explicit in §3 M3/§4 #11; "applicable Three Red Lines
format" left undefined per case class (MiniMax-M3) → tied to `code-review.md`'s existing case-class taxonomy,
declared before the harness run, in §4 #10; small-n borderline-result handling absent (gemini/grok/MiniMax-M3)
→ re-run-once-then-fail-on-discord rule added to §3/§4 #5; determinism/seed pinning (gemini/grok) → honest
limitation noted in §7 (no runner exposes a temperature/seed knob; the re-run rule is the practical
substitute, not a determinism claim).

Not folded (single-source from MiniMax-M3, not corroborated by the other 4, and MiniMax-M3 has a known
central-finding false-positive rate from a prior campaign — see `docs/BACKLOG.md` "MiniMax-M3 … reviewer
校準"): unbounded per-contract-leg cost budgeting, and the §4 #3 / §6 Superpowers-evidence wording-consistency
nit. Partially folded: clean-diff "known-good" provenance/circularity concern → added as an explicit accepted
limitation in §7 (not a blocking gate — out of scope to fully resolve here).

Process note: the R2 dispatcher's shared spec-file stated the case-set as "13 known-bad + 3 injection + 10
clean" — the "3 injection" figure was a dispatcher error (actual: 2 of the 12 known-bad cases are
injection-tagged). The convergent finding survives verification on its own terms (grounded in the actual repo
count, not the erroneous spec framing), but is flagged here for the record per the project's
verify-reviewer-claims discipline.

VERDICT after fold: SHIP-AS-IS (pending a lightweight R3 spot-check recommended before execution, not required
— see Next below).

R3 — 2026-07-09, Board-directed design addition + engine-choice update (no new hetero review round; Board
raised the point directly, not a dispatched panel):

- Board question: the primary paired-leg engine (Spark/gpt-5.5, both strong reasoning tiers) risks a false
  sense of confidence — a strong engine can infer intent a terse contract stopped stating explicitly, while
  the qc_panel used in real production reviews already mixes in weaker/cheaper reviewer tiers that don't get
  that benefit of the doubt. Folded as §4 #14: an unpaired supplementary weak-tier probe (see §4 #14 for full
  rationale and its non-gating status).
- Engine-choice update: `GPT-5.3-Codex-Spark` quota was exhausted again before execution started (confirmed
  by the Board, not re-probed here). Primary paired legs move to `gemini-3.5-flash` via `agy`; the new §4 #14
  weak-tier probe uses `claude-haiku` (native). §5 updated with both, Spark/gpt-5.5 kept as documented
  fallback order.

M1 — 2026-07-10, execution round (infra build + first real measurement, not a hetero review round):

- Built the three M1 prerequisites the plan assumed already existed but didn't: a `claude-native` runner in
  `dispatch-review.sh` (reuses the canonical PROMPT_FILE the other runners read — needed for §4 #14's haiku
  probe to test the real contract, not a stand-in prompt), a 10-case `evals/clean/` fixture corpus (didn't
  exist), and `calibration.sh run-clean-set` (the specificity-gate harness — only `run-known-bad` existed).
  Each was smoke-tested with stub panel-cmds before spending real reviewer-engine calls.
- First `evals/clean/` corpus (10 cases picked by commit-message + size heuristics) produced an implausible
  60% over-flag rate. Investigation found 6 of 10 cases sourced from a subsystem with a documented multi-round
  bug history (l6-resilience/run-ledger concurrency work), and one flagged case had a real, already-merged bug
  (confirmed by direct `git show` inspection) — not a reviewer over-flag. Corpus rebuilt per the provenance
  rule now recorded in §3 M1. See §3 M1 for the corrected baseline numbers (known-bad 11/12, one critical miss
  on `08-path-traversal`; clean 9/10, one over-flag independently confirmed genuine).
- This round surfaces a real risk for M3: the primary engine (gemini-3.5-flash) is not spotless even on the
  UNSLIMMED baseline. M2/M3 must attribute any slimmed-leg regression against THIS baseline, not against an
  assumed-perfect one — a slimmed leg that also misses `08-path-traversal` is not evidence of a slimming
  regression, since the baseline already misses it.
