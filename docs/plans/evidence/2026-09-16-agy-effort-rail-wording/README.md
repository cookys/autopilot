# Evidence — mission `agy-effort-rail-wording-2026-09-16` (v2.36.55)

- `g1-*`, `g2-*`, `plan.as-reviewed-g{1,2}.md`, `g{1,2}-receipt.txt`: plan hetero loop (GLM-5.2 + gpt-5.6-sol), G2
  terminal at the generation cap with zero unaddressed blockers (prior session). Plan re-stamped v2.36.54→v2.36.55
  under its pre-authorized clause after campaign D shipped first; receipt untouched (as-reviewed bytes).
- `prepared.json`, `grant.json`, `impl-brief.md`, `impl-run1.json`: /l5 managed campaign attempt 1 (base `fe225ff5`).
  Hand cursor-grok-4.6-low committed `e4a0b9a1` (all 24 output paths, 643 insertions). The rail stopped at
  `acceptance_failed: command #6 bash hooks/tests/provider-readiness-consumer.test.sh (expected exit 0, got 1)` and
  then failed to journal its own terminal (`campaign_terminal_journal` MUTATION_FAILURE_EVIDENCE_REQUIRED, BACKLOG
  row). Degraded `session-mode set --level l3 --entry-level l5 --fallback precondition_failed`.
- `verify-prc-base.log`, `verify-autopilot-cli-base.log`: the two suites are RED AT BASE (5 and 33 failures) on this
  host and in CI since `acf3b06c` (2026-09-12, implementer → cursor-grok-4.6-low, qualified only by a host pin the
  test sandbox hides → `resolveReviewLoopJson(['--check-scorecard'])` exits 3 inside the suites). The d0b95eff config
  does not heal them (6 / 25). PRE_EXISTING; fired BACKLOG row. The rubric's `no-regression` on these two is therefore
  NOT met by this deliverable nor by base — recorded here and in the CHANGELOG, not resealed away. The hand's
  standalone VA-remedy block passes (29→30 passed); its two KR3(i) assertions inside the coupled block fail for the
  pre-existing reason exactly as the assertion they replaced did at base.
- `verify-e4a0b9a1-summary.txt`: depth-0 verification in a detached scratch worktree (temp branch): dispatch-hetero
  340, dispatch-review 409, dispatch-author 114, provider-readiness 32, status-cli 33, implementation-campaign-state
  295 green; `check-js-syntax`, codex mirror `--check`, backlog gate 0 new.
- `red-at-base-fe225ff5.txt`: head tests over base product — 4 / 4 / 4 FAIL lines on the three dispatch suites
  (`--effort medium` vs `high`, fold note count/text), 3 on status-cli (fallback stderr line), 1 on the state suite
  (dirty remedy), +1 on provider-readiness-consumer (VA remedy). 21 lines.
- `review-codex-r1.json` (+ raw log): second-family review, FIX-THEN-SHIP, one 🟠 MUST-FIX accepted — two oracles were
  self-derived (dispatch-author's codex argv compared the capture to itself; status-cli's provider-less receipt was
  built from the implementation under test). Depth-0 repair `e1813ad0`: frozen literal argv
  (`exec --model gpt-5.5 --sandbox read-only --skip-git-repo-check -c model_reasoning_effort="xhigh"
  --output-last-message PATH`) and the base-captured, digest/timestamp-normalized receipt embedded as a heredoc
  literal (captured from the base CLI with the empty-config fixture). Both suites green after the repair.
- `dogfood-agy-flash-medium.{json,err}`: plan §5 proof after the merge — real agy 1.2.3
  `dispatch-review.sh --runner agy --model gemini-flash-medium` (default effort xhigh) on a 568-byte diff returns
  `SHIP-AS-IS`, stderr shows `agy effort xhigh (clamped high) folded to medium: model id encodes the tier`; at base
  this call died at the vendor with `--model gemini-3.8-flash-medium conflicts with --effort=high`.
- `integration-record.json` (merge `6d83e121`, accepted HEAD `c8d2f97e` incl. the executable-bit fix), `reap-wt.json`,
  `reap-branches.json` (bundle kept), `lifecycle-receipt.json` (`zero_residue: true`).
