# Pre-registration: BL-0146 D5, incremental versus full return review

Written and committed before any model call of this experiment (the harness was checked only against a
stand-in dispatcher, `harness/stub-review.sh`, which makes no model call). Owner of the question: BL-0146 plan
`docs/plans/2026-10-17-review-only-campaign-fix-increment.md` section 4 (Cost evidence), section 6 (R2, R6), section 8 point 3.
This experiment does not change the default of `adoption.return_review` (stays `full`).

## 1. Question

On the same returned head, what does `return_review: incremental` save against `full`, and what does it miss?

## 2. Arms (per scenario and repetition)

- `inc`: a throwaway campaign sealed at H0 with `adoption.return_review = incremental`. Round 1 reviews `base..H0`
  in full; the branch then advances to H1 and the run resumes with `continuation: return`. The measured cost is the
  return round only (round 1 is reported separately).
- `full`: a throwaway campaign sealed at H1, i.e. a blind full-range review of `base..H1`. This is what a return
  under `return_review: full` does (same diff bytes, same spec, no addendum); it needs no round 1, which keeps the
  spend inside the budget. Stated limitation: it is not a literal return round.

Both arms use the real engine path (`AutopilotEngine.runImplementationReviewLoop`, real panel, real
`dispatch-review.sh`), the same fixture bytes, the same spec file. Only the dispatcher scaffolding of the existing
review-candidate tests is reused (intake readiness, scope checker, worktree add), exactly as `hooks/tests/lib/review-candidate-driver.js` does.

## 3. Roster

`qc_panel` of the current `.claude/review-loop-config.md`, as resolved by `scripts/resolve-review-loop.sh`:
claude-fable-5-1 (claude-native, high), GLM-5.3 (cc-shim, endpoint glm, high), opencode-go/muse-spark-1.3-contributor
(opencode, high), Qwen3.8-Max (qoderclicn, high). Observed before any model call: the engine refuses the opencode seat
in a managed blind review ("runner is not in the enforceable no-tools set ... pins and overrides do not bypass
containment", `qc_panel[2]`), so the panel actually run has three seats: fable, GLM, Qwen (`min_panel_size` 3).
The refusal is itself a finding for the README.

## 4. Scenarios (fixtures in `harness/fixtures.js`, 24 small pricing modules in `harness/catalogue.js`)

Every planted defect is one changed line against a contract written in the spec. B = base, H0 = reviewed head, H1 = returned head.

| id | Situation | H0 | H1 |
|----|-----------|----|----|
| s1 | single-file fix | 9 files; coupon (O1) and bulk (O3) wrong | coupon fixed; bulk left wrong (an old finding on an untouched file) |
| s2 | ten-file fix | 26 files; 11 wrong modules | 10 fixed; `minorder` (O11) left wrong |
| s3 | cross-file regression | 9 files; coupon wrong (O1) | coupon fixed and rewritten to return the discounted subtotal; unchanged `checkout.js` still subtracts it (R1, double discount) |
| s4 | rename | 9 files; tax wrong (O1) | `tax.js` renamed to `vat.js` and fixed; `checkout.js` updated; unchanged `invoice.js` still requires `./tax` (R1) |
| s5 | R2 anchoring | 9 files; coupon (O1) and ship (O2) wrong | both fixed, each fix lands next to a NEW defect (N1 coupon clamp, N2 ship zero weight) |

Repetitions: 2 per scenario and arm, tags `s<k>-<arm>-r<rep>`. A cell is void and may be re-run once (at most) when
a seat returns no verdict for the return round, when the process throws, or (arm `inc` only) when round 1 does not park.
Round 1 finding nothing is not a void: that is the full path's own result and is reported.

## 5. Metrics (per return round; `harness/score.js` is the definition)

- Seat model calls: dispatch-review invocations in the return round (arm `full`: the single round).
- Fresh input bytes: bytes of the packet each seat receives (diff.patch, delta.diff, spec.md with the addendum, tree/, MANIFEST.json), summed over seats.
- Input tokens and cost: the runner-reported `usage` where present; otherwise estimated from bytes (bytes+9000 protocol)/4 input and 3000 output tokens. Prices in `harness/prices.json`: fable is the Anthropic list price; GLM and Qwen prices are ASSUMED (subscription seats), flagged as such. Reported cost is an estimate, never a bill.
- Surfaced defects: a finding matches a planted defect when it cites the defect's file within +-3 lines, or names the file
  and matches the defect's keyword pattern. A `still_present` resolution citing the line also counts as surfacing an old unfixed defect.
- Closure correctness (arm `inc`): per addendum row and seat, the answer (`resolved|invalid|still_present|silent`) against the truth
  (`closed` expected for an old defect H1 fixed, `open` expected for one it left).
- Fallback: `review_scope` and `incremental_fallback_reason` of the receipt.

## 6. Definitions

- Must-surface defect of a cell: planted defect of kind `old_unfixed`, `regression` or `new_next_to_old` at H1.
- Miss (panel level): no seat of the return round surfaced it. Miss (seat level): that seat did not.
- Incremental-only miss: in a repetition pair, the `full` arm surfaced a must-surface defect and the `inc` arm, with `review_scope = incremental`, did not.
  Cells that fell back to full are not incremental misses (they ran the full path); they count toward the fallback rate.
- Dangerous closure: a seat answers `resolved` or `invalid` for an old defect that H1 left in place.
- Benign open: a defect H1 fixed that a seat leaves open (costs a repair round, not safety).
- Extra cost of duplicated findings (review finding 0ad19dc1): addendum rows per distinct planted defect, and addendum bytes as a share of the packet.
- Verdict-word filter (review finding 5b2be4ec): number of cells whose fallback reason is the addendum-malformed reason, plus how many real round-1 claims match the `ADDENDUM_VERDICT_WORDS` pattern in `src/engine/review-resolution.js`.

## 7. Budget and stopping rule

Hard cap USD 40 of estimated spend (cumulative estimate written by the harness to `spend.json`; a `.STOP` file or reaching
the cap makes the next batch refuse to dispatch). The runs go in this order and stop when the cap is reached:
pilot (`s1-inc-r1`, `s1-full-r1`), then repetition 1 of s2..s5 for both arms, then repetition 2 of all five. A scenario
left without a second repetition because of the cap is reported with n=1.

## 8. Basis for the default decision (stated only; the owner decides)

The numbers support moving the default to `incremental` only if, over the cells that stayed incremental: no
incremental-only miss of a `regression` or `new_next_to_old` defect, no dangerous closure, the median saving on cost and bytes
is at least 30 percent, and at most 40 percent of the `inc` cells fell back to full. Anything else is reported as a reason
to keep `full`. No threshold is tuned after the data.

## 9. Amendments

Every change after the first model call is appended here with its reason and the cells it touches.

- A1 (after the pilot cells `s1-inc-r1` and `s1-full-r1`, before any other cell): the pilot arm `inc` fell back to `full` with
  reason `finding_unmapped`. The real seats wrote their findings as `[id] MUST-FIX claim ...` with no `path:line`, and the
  engine maps a finding to a path only from a `path:line` token in the claim (`review-increment-wiring.js`, `findingPathFromClaim`);
  the review protocol (`scripts/dispatch-review.sh`) never asks for one. Consequences: (1) the pilot cells are kept as the
  *raw* condition and renamed `s1-incraw-r1` and `s1-fullraw-r1` (spec without a reporting-format line); (2) every cell of the main
  grid uses a spec with one added paragraph, `## Reporting format`, asking each finding's claim to start with `path:line`
  (`specVariant: loc`, now the harness default; `harness/fixtures.js` `buildSpec`); (3) the raw condition is also run once for the
  other four scenarios as `s<k>-incraw-r1` (arm `inc` only), to report how often the shipped protocol reaches the incremental path
  at all. The raw cells are reported separately and are not in the pairs, savings or miss figures. Nothing about metrics or
  definitions in sections 5 to 8 changes.
- Estimated cost (note, not a change): the runners report no `usage` (`null` for all seats, and `dispatch-status.js --usage-only`
  returns `null` on the raw logs), so every cost figure is the byte-derived estimate of section 5. Calls and bytes are measured;
  cost is a model of bytes and is labelled so in the README.
