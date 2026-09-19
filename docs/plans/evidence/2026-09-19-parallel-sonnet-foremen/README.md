# Evidence — seven fired BACKLOG rows in parallel: six sonnet foremen (Agent subagents) × independent clones, cursor-grok-4.6-low hands (v2.36.71)

Owner request 2026-09-19 after `/next`: "能排的都依序排下去, ceo mode /l5, foreman = sonnet, impl = grok 4.6 low, 最大平行度, 有問題找 hetero engine 討論後你做主".

## Topology (what changed from the 2026-09-18 kimi run)
- Same shape: one `git clone` per unit under `/home/cookys/projects/autopilot-par2/`, one clone-local "PARALLEL-RUN LOCAL ONLY"
  shadow-governance commit per clone (never merged), hands via `dispatch-hetero.sh --runner cursor --model cursor-grok-4.6-low
  --effort low`, review via `dispatch-review.sh --runner claude-native --model claude-fable-5-1 --effort high`, verdict at depth 0 from git,
  hands landed by cherry-pick. Base `da5d9610` (origin/develop at launch).
- **The foreman is a sonnet Agent subagent of the depth-0 session**, not `dispatch-foreman.sh` (kimi-only). Consequences that the
  brief (`common.md`) had to carry: the hand dispatch runs with the Bash tool's `run_in_background: true` (a 40-min foreground call
  would hit the tool timeout) paired with a background dead-man (`sleep N; echo WAKE-<unit>`), the foreman ENDS ITS TURN and is
  woken by either; `env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID` on every rail call so the hand's suites cannot read the
  depth-0 l5 marker; `foreman-guard` (40 Bash calls) and `dispatch-model-guard` (`Engine: sonnet` first line) were live.
  The l5 marker was set on the main checkout (`session-mode.js set --level l5`); it never applies to the clones (marker `repo_root`
  mismatch → INACTIVE), which is what lets the hands run outside a sealed campaign.
- Advisor pre-launch corrections (applied to the briefs before dispatch): each engine unit adds its cases in a NEW suite file
  (`autopilot-engine-<unit>.test.sh`, `implementation-campaign-state-<unit>.test.sh`) instead of appending to shared suites —
  three EOF appends would have been a guaranteed cherry-pick conflict; C struck `status.js`/`cli.js` (pass-through already
  verbatim), A struck the reducer (the `wall` block lives in the receipt body; the reducer checks only the digest binding),
  B dropped an undefined "quiescence re-check at resume"; D/G briefs describe tool fences in words (prompt hygiene).
  Result: 15 hand cherry-picks, zero conflicts (+1 depth-0 chmod commit).

## Units
| unit | BACKLOG row | hands (cursor-grok-4.6-low) | review (claude-fable-5-1) | landed |
|---|---|---|---|---|
| **A** wall | managed campaign wall expiry leaves no terminal summary / journal disposition | `wall-a@5516f81d`, `wall-a-r2@407eac90` | FIX-THEN-SHIP 3🟠 (2 fixed: min-timeout floor, candidate threaded into the journal catches; 1 refuted with the schema on disk) 3🔵 | 2 commits + depth-0 chmod fix (the two new suites were 100644; `run.sh` refuses them — `suite-oracle-lock` went red until fixed) |
| **B** boundary | `boundary_rejected` says re-dispatch but `--resume` always terminalizes | `boundary-b@3c0d79b0`, `boundary-b-r2@1af86fff` | FIX-THEN-SHIP 2🟠 (e2e never exercised the claim path; **fabricated writer fence** to satisfy `verifyResumeCandidate`) 3🟡 → r2 SHIP-AS-IS 4🔵 | 2 commits |
| **C** park | park at `awaiting_disposition` reserves no wall for the repair round | `park-c-retry@d91302d6` (r1 dispatch died on a foreman prompt-path slip, retried), `park-c-r2@9754e376` | FIX-THEN-SHIP 3 must-fix (fits/estimate values unasserted → real bug: estimator read `verify_round`, ledger says `campaign_verification`; engine-level resume-stays-parked unproven; RED comments) 5🔵 | 2 commits |
| **D** author | `dispatch-author.sh` success predicate is non-empty stdout | `author-d@ad2cf9a9`, `-r2@cf55f9db`, `-r3@46f2be61`, `-r4@698bb86b`, `-r5@4617081e` | FIX-THEN-SHIP 2🟠 (`set -e` leak; codex gate mismatch) 1🟡 2🔵; depth-0 re-ruled the 🟡 (test harness narrowed its forbidden-substring scan) as must-fix → r3; **§37 sweep** found eight sibling suites whose fake runners print unframed output → r4 (shared `lib.sh` frame helper, six suites) + r5 (two more) | 5 commits |
| **F** suites | provider-readiness-consumer / autopilot-cli track the live review-loop config | `f@bac46f5b`, `f-r2@d36f5f94` | FIX-THEN-SHIP 1🟠 (stray `provider-readiness-receipt.json` at repo root) 2🔵 → r2 deletion | 2 commits |
| **G** planreview | /l5 marker row residual (seat records empty stdout instead of the precondition reason) + `secret-scan-diff.test.sh` key literals | `planreview-g@4ceb55e5`, `-r2@8ddc69fd` | FIX-THEN-SHIP 1🟠 (schema assertion missing on the new case) 2🔵 → r2 | 2 commits |

Every unit's diff ⊆ its allowed files (checked by depth-0 from `git diff --stat`). Foremen B, D, F did not re-run the verify block
themselves (budget) — the integrated run below is the evidence, not their reports.

## Depth-0 verdict
- Integrated verification in a scratch clone (`int-suites-A-B-C-G.txt`, `suites-int.sh`): 25 suites + sync-check + syntax + range
  secret-scan after A/B/C/G — 23 green, 2 red (`dispatch-detached-campaign-authority`, `controller-execution-independent`) with
  byte-identical failing-assertion sets at base `da5d9610`. F's suites green in normal and `env -i` runs; D's six suites green.
- Consumer sweep (`sweep.sh`, `consumer-sweep-int.txt`; evidence-discipline §37): 71 suites naming a moved interface minus the ones
  already run → 8 new reds all caused by D's contract change (fake runners with unframed output → `truncated`/5), fixed in r4/r5;
  `suite-oracle-lock` red = A's 100644 suites, fixed by chmod; `context-window`, `review-loop-runner`, `resolve-review-loop-consult-discuss-{gate,switch}`,
  `dispatch-author-{contract,result-provenance,session-mode,strict-roster}` red with the same failing sets at base (pre-existing).
  First sweep pass silently skipped 58 suites — the `while read` loop let the suites eat the list from stdin; rerun with `< /dev/null`.
- Full `hooks/tests/run.sh` on the integrated head: see `full-run-summary.txt`.

## Deferred (🔵 / notes, recorded here, not in BACKLOG — except A's timeout floor, which got an S row)
A: `MANAGED_DISPATCH_MIN_TIMEOUT_SECONDS = 1` is a floor, not a useful minimum (the reviewer accepted it; a real minimum belongs
with the rail's own timing data); summary-bytes test in-process. B: e2e `initialState` fixture fidelity; the catch-all around
`createWriterFence`. C: `repairRoundEstimateSeconds` intake option is a test hook on a production path; two `now()` reads at park.
D: a shared frame-locator lib for dispatch-review/dispatch-author (third copy now exists in `hooks/tests/lib.sh` for fake runners);
`resolve-review-loop.sh` admission warnings reach stderr under `DISPATCH_QUIET=1`. F: U+FFFD glyph in a `lib.sh` comment; F's fixture adds a `reviewer_engine:` line to `hooks/tests/lib.sh`, so `resolve-review-loop-consult-discuss-switch`'s "Population B pinned at 30" assertion (already red at base) now observes one more file — whoever repins it must count `lib.sh`.
G: the broad "any non-authored status with an error" refuse branch. Unit F named its run `f` (unique enough, but not the brief's `suites-f`).
