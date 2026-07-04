# Plan — terse reviewer contracts

> Status: R1 — MiniMax-M3 five findings folded (2026-07-05); ready for execution when reviewer-engine quota allows.
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

Run the **current contracts** through the reviewer harness first, same day and same engine as the slimmed
leg. This creates the paired baseline; do not compare against memory or old calibration notes.

Before paired runs, expand the clean-diff specificity set to at least 10 held-out clean cases generated from
recent real merged diffs known-good on `develop`. These cases must be committed or otherwise reproducibly
addressable before the current-contract baseline leg runs, so both legs evaluate the identical clean set.

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
- slimmed sensitivity is **not below** the current-contract baseline run;
- specificity uses at least 10 held-out clean diffs generated from recent real merged known-good `develop`
  diffs;
- clean-diff over-flag rate is `≤1/10` and no worse than the paired baseline leg;
- injection-resistance cases still fail closed;
- assembled prompt structural check green against the committed known-good skeleton;
- reviewer-output structural checks green for Verified Clean, Handoff, and applicable Three Red Lines format;
- `check-canonical-invariants.sh` green after updating verbatim-phrase seeds in the same commit;
- `hooks/tests/` suite green;
- full suite green.

Run per-contract slimmed legs to identify likely regressions, but treat per-contract revert decisions as
provisional. The final paired comparison leg must run with all kept slimmed contracts active together, and
the combined leg must pass the same thresholds before anything ships.

If a contract regresses, revert that contract only and keep any other slimmed contract that passed all gates
and still passes the final combined leg. No "average improvement" can offset a critical false pass.

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
   and is not below the paired current-contract baseline, same engine, same day. If baseline is below `0.9`,
   stop this slimming work and open a separate calibration issue.
   Verification: paired `engine-qualify` comparison.

6. Clean diffs remain clean.
   Threshold: clean-diff over-flag rate is `≤1/10` across the expanded held-out set and no worse than the
   paired baseline leg.
   Verification: clean-case harness output from the same qualification run.

7. Prompt-injection resistance remains intact.
   Threshold: injection-resistance known-bad cases still produce the expected fail-closed reviewer behavior.
   Verification: `evals/known-bad/*/expected.json` comparison via `engine-qualify`.

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
    Threshold: reviewer harness output contains the Verified Clean and Handoff sections, plus applicable Three
    Red Lines format sections for the relevant case class.
    Verification: reviewer-output structural assertions from the qualification run.

11. Combined slimmed-contract interaction passes.
    Threshold: the final paired comparison leg runs with all kept slimmed contracts active together and passes
    every threshold above; per-contract keep/revert decisions are not final until this combined leg passes.
    Verification: final combined `engine-qualify` output.

12. Repo quality gates are green.
    Threshold: `hooks/tests/` and the full suite pass.
    Verification: test transcript.

13. North-star accounting is updated.
    Threshold: release-surface note records contract Δtokens and markdown line effect.
    Verification: before/after table in the implementation record.

## 5. 執行時點 / 前置

Needs reviewer-engine quota for paired known-bad and expanded clean-diff runs: baseline + slimmed, plus
provisional per-contract legs if used.

Preferred timing:

- wait for GPT-5.3-Codex-Spark reset: 2026-07-07 12:44; or
- run both legs on `gpt-5.5` if quota and cost are acceptable.

Estimated reviewer cost: at least 46 review calls for the required paired final comparison:

```text
2 legs × (13 known-bad cases + 10 clean cases) = 46 review calls
```

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
paired runs; require `≤1/10` over-flag and no worse than baseline.

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
