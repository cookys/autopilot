# Bundle w111 — v2.36.111 (peer-reported resume/review fixes + symlinked TMPDIR)

Rows, in landing order: A (779a8f5d) campaign resume admits REVIEWING + zero-write cap; C (ea71eee6) final-panel per-seat reuse; C-r2 (7f06ad8c) re-qualify reused seats + cross-process proof + classifier order; A-r2 (4c3b7a71) A's suite finalizes + finalize gate; A3 (fdf52225) REVIEWING-resume engine stage converges via real terminal + gate recognizes indirect finalizers; B (655a3b02) reviewer output budget 16384 + named output_budget_exhausted; D (81f22a61) symlinked TMPDIR (agy bwrap bind, polarity verify path).


---
# Unit A — campaign resume: REVIEWING phase + zero-write resume budget
Worktree `wt-A`, branch `hands/w111/A`, base = default BASE_SHA.
Sidecar (read it first): `docs/backlog/campaign-resume-reviewing-phase-and-zero-write-budget.md`.

Defect (peer-reported, verified only by reading): `resumePhaseSupported` in `src/campaign/cli.js` (near the `campaign_resume_phase_unsupported` reason code) does not admit the phase the ICC projection shows after a final-panel seat transport failure (REVIEWING), even though the engine classifies `final_panel_seat_transport_failed` as gate_transient / `retry_full_diff_review` / resumable (`classifyFullDiffReviewFault` in `src/engine/campaign-composition.js`). Second, the `campaign_file_budget_exhausted` check blocks every resume once `usage.changed_files >= limits.max_changed_files`, including a resume that only re-runs review and cannot write.

Do:
1. Reproduce first: a fixture campaign (follow the existing campaign resume tests — `git grep -l campaign_resume_phase_unsupported -- '*.test.js' 'hooks/tests/*.sh'`) whose state is REVIEWING after a transient final-panel seat failure, and one at the file cap whose resume is review-only. Both must be RED at base.
2. Pick ONE fix shape for (a): either project the transient review failure back to VERTICAL_VERIFICATION, or admit REVIEWING only with a bound candidate (and whatever binding the existing ADJUDICATING branch requires). Prefer the narrower change that matches how the controller actually records the state. Report which you picked and why — a follow-up unit (per-seat final-panel reuse) will resume into this state.
3. (b): apply the changed-file cap only to resumes that can write. A review-only resume is not blocked by it.
4. REQUIRED negative controls (tests): a writing resume at the cap stays `campaign_file_budget_exhausted`; REVIEWING without a bound candidate (or a non-transient fault) stays blocked.
Commit message: `fix(campaign): resume admits a transient final-panel review failure; changed-file cap applies only to writing resumes`

---
# Unit C — final-panel resume reuses valid seat verdicts
Worktree `wt-C`, branch `hands/w111/C`, base = default BASE_SHA. (Unit A changes `src/campaign/cli.js` resume admission in parallel; do not touch that file. Depth-0 reconciles at landing.)
Sidecar: `docs/backlog/final-panel-resume-reruns-all-seats.md` — read it fully.

Defect: after a `final_panel_seat_(no_verdict|transport_failed|parser_failed)` gate_transient fault, `--resume` re-runs the review, but `runPanel` (`src/engine/autopilot-engine.js`) re-dispatches every seat; panel reuse (`stationPanelReuse` in `src/engine/campaign-composition.js`) only applies when the whole previous panel was reviewed. Seats that already returned a valid bound verdict for the same packet are re-run.

Do:
1. RED first: a fixture where a 3-seat panel had 2 valid verdicts and 1 transport failure; on resume, assert only the failed seat is dispatched and the 2 verdicts are reused. Follow existing `stationPanelReuse` / final-panel tests (`git grep -l stationPanelReuse -- '*.test.js' 'hooks/tests/*.sh'`).
2. Fix: per-seat reuse of verdicts bound to the identical packet digest AND the same roster seat; re-dispatch only failed seats. Verbatim constraint from the sidecar: "Must stay ADR-0001-clean (re-derive from the stored seat artifact bound to the same packet; no attestation)." — reuse means reading the stored seat artifact and re-checking its binding (packet digest, seat id, parseable verdict), never trusting a "reviewed" flag or a summary field.
3. A per-seat attempt budget as a named constant, with a test that a seat over budget is not re-dispatched and the panel ends in a named terminal reason.
4. Negative controls: a changed packet digest (diff changed) → every seat re-runs; a stored artifact whose seat id does not match the roster → not reused; a stored artifact that fails to parse → re-dispatched.
5. Report any place the engine and the campaign CLI disagree about the phase after the transient fault (unit A owns admission; you own what happens once resumed).
Commit message: `fix(engine): final-panel resume re-dispatches only failed seats, reusing verdicts re-derived from artifacts bound to the same packet`

---
# Unit C-r2 — repair of final-panel per-seat reuse (unit C) on top of unit A
Branch `hands/w111/C2`, base = `dffca7827a6a46df7f4f69713813ac3c17803a3b` (= base f197fc09 + unit A `779a8f5d` "resume admits REVIEWING" + unit C `ea71eee6` cherry-picked). Create your worktree `wt-C2` from that base (use `git worktree add -q $C/../wt-C2 -b hands/w111/C2 dffca7827a6a46df7f4f69713813ac3c17803a3b` — branch hands/w111/AC already exists, do not reuse it).
Read first: `docs/backlog/final-panel-resume-reruns-all-seats.md`, unit C's commit (`git show ea71eee6 --stat`, `src/engine/final-panel-seat-store.js`, the `runPanel` changes in `src/engine/autopilot-engine.js`), and unit A's suite `hooks/tests/campaign-resume-reviewing-phase.test.sh` (it shows how to build a real ledger parked in REVIEWING with a dead lease).

Depth-0 accepted unit C's design but requires three fixes before landing:
1. **Re-qualify reused seats.** A reused seat currently returns before `finalPanelSeatQualified` runs, so a seat that lost qualification between runs (e.g. a critical strike, which is enforced immediately) still contributes its stored verdict. Run the same qualification check on a seat before reusing its verdict; a seat that is no longer qualified is not reused (handled exactly as an unqualified seat is today). Test: stored valid verdict + seat now disqualified → not reused.
2. **Prove reuse fires across processes.** The existing fixture replays in-process with `sharedPacket` null, so the stored `packet_hash` vs live packet comparison is never exercised and we have no evidence that the live packet hash is stable between two separate runs. Add an end-to-end test: run 1 = a separate process whose final panel ends with 2 valid verdicts + 1 seat transport failure (campaign parks in REVIEWING via the gate_transient fault); run 2 = a separate `--resume` process (dead lease owner, through the real intake/CLI admission unit A added). Assert only the failed seat is dispatched in run 2 and the other two verdicts are reused. If the live packet hash is NOT stable between runs (so reuse never fires), that is the defect: fix the binding so it keys on what is actually stable (tree/base/diff/spec/review-input digests), never by dropping the binding check. A negative control: change the diff between run 1 and run 2 → all seats re-dispatch.
3. **Classifier order.** In `classifyFullDiffReviewFault` (`src/engine/campaign-composition.js`) move the `attempt_budget_exhausted` terminal check above the gate_transient regex so an exhausted seat classifies terminal even when a sibling seat's reason is transient. Test it.
Plus one cleanup: the RED comment in the new test must list every assertion that was red at base.
Do NOT change unit A's admission semantics; if you need to, stop and report why.
Commit message: `fix(engine): reused final-panel seats are re-qualified and reuse is proven across a real --resume`

---
# Unit A-r2 — unit A's suite is always green (no finalize_test) and hides a blocked resume
Branch `hands/w111/A2`, base = `7f06ad8c` (= f197fc09 + unit A 779a8f5d + unit C ea71eee6 + unit C-r2 7f06ad8c). Worktree: `git -C $C worktree add -q $C/../wt-A2 -b hands/w111/A2 7f06ad8c`.

Defect found by depth-0: `hooks/tests/campaign-resume-reviewing-phase.test.sh` (added by unit A) sources `lib.sh` and uses `assert_eq`/`assert_contains`, but never calls `finalize_test`. `fail()` only appends to an array and prints to stderr, so the suite exits 0 and prints no PASS/FAIL summary even when assertions fail — it is green by construction. On top of that, its engine stage prints `c_status=blocked reason=git worktree command exited with status 1` with no assertion on it. A sibling hand diagnosed that block as the fixture, not the product: the fixture builds the lineage with `worktree_instance_id = sha256(worktreePath)`, but the real cleanup compares the filesystem-instance id (`src/engine/repair-lineage-cleanup.js` ~63-64 throws "retained worktree filesystem instance changed"; surfaced via `repair-lineage-cleanup-transaction.js` ~97 and `worktreeResultBlocked` in `autopilot-engine.js`). Re-derive this yourself before relying on it. See how `hooks/tests/final-panel-seat-resume-xproc.test.sh` / `hooks/tests/lib/final-panel-seat-xproc-driver.js` (unit C-r2) drive a real resume to `converged`.

Do:
1. Add `finalize_test` at the end of the suite. Then prove the suite can go red: temporarily revert one product line (e.g. drop REVIEWING from the cli.js admission) and show the suite exits 1 with FAIL lines; restore. Paste that red output as the `# RED` evidence (replace the old RED comment's claim with the measured one).
2. Fix the fixture so the engine stage's resumed run does not end blocked at the repair-lineage cleanup — build the worktree instance id the way production does (preferred) or inject the cleanup transaction the way the C-r2 driver does. Do NOT change product code to make the fixture pass; if you conclude the block is a product defect after all, stop and report path:line.
3. Assert the final resumed status explicitly (the expected terminal/converged status, and not `blocked`).
4. Mechanism, so this cannot recur: check whether any existing gate (grep `finalize_test` in `scripts/` and `hooks/tests/`) already enforces that a `hooks/tests/*.test.sh` that sources `lib.sh` ends with `finalize_test`. If none exists, add the smallest check — a new suite `hooks/tests/test-suite-finalize-gate.test.sh` that scans every `hooks/tests/*.test.sh` sourcing `lib.sh` and fails on any that never calls `finalize_test`. If existing suites already violate it, list them in your report and carry an explicit, commented allowlist for those exact files (do not edit those suites). The gate must be RED at f197fc09+unit A (it catches campaign-resume-reviewing-phase) and GREEN after your fix.
Run: the A suite, the C and C-r2 suites (`final-panel-seat-resume`, `final-panel-seat-resume-xproc`), the new gate suite, and A's consumer suites (`git grep -l -E 'resumePhaseSupported|resumableCandidatePhase|durableResumablePhases' -- '*.test.js' 'hooks/tests/*.sh'`).
Commit message: `fix(tests): the REVIEWING-resume suite finalizes and asserts the resumed status; a gate rejects lib.sh suites without finalize_test`

---
# Unit A3 — drive the REVIEWING-resume engine stage through the real terminal; tighten the finalize gate
Branch `hands/w111/A3`, base = `4c3b7a71` (head of hands/w111/A2). Worktree: `git -C $C worktree add -q $C/../wt-A3 -b hands/w111/A3 4c3b7a71`.

Why a new unit (not a failed repair): unit A-r2 surfaced a lineage fact the earlier briefs did not have. Its engine stage reaches REVIEWING via BOUNDARY_REJECTED → vertical_verified, and that lineage ends `blocked` at `controller_work_order_terminalize` ("controller transcript audit blocks terminal …"). Depth-0 checked: unit C-r2's cross-process driver (`hooks/tests/lib/final-panel-seat-xproc-driver.js`) reaches REVIEWING via a final-panel seat transport fault (gate_transient → durable_wait) and its resume reaches `converged` with the REAL terminalize/transcript audit (it injects no terminalize/audit dependency). The peer-reported path is that one. The boundary-lineage terminal block is a separate, pre-existing issue a debugger is investigating in parallel — NOT yours.

The per-row review of A-r2 returned 🟠 MUST-FIX: "the suite only asserts four reason substrings are absent and logs the status to stderr as a KNOWN GAP — still hides a blocked resume."

Do:
1. In `hooks/tests/campaign-resume-reviewing-phase.test.sh`, rebuild stage c (the engine run) so the campaign reaches REVIEWING through the final-panel transient seat fault, the same lineage as the C-r2 driver's run 1 (reuse that driver/stub where you can instead of copying it). Stages a/b (CLI eligibility and intake claim on the boundary lineage) stay as they are.
2. Assert the resumed final status explicitly: `c_status=converged` (or the real terminal success status) AND `assert_not_contains … "c_status=blocked"`. No "KNOWN GAP" stderr line; no tolerated block. Keep impl_calls=0 / review dispatched / no vertical_verified / no terminal_stop assertions.
3. Delete the duplicate `repairLineageCleanupTransaction` key in the engine options object (🔵 from the review).
4. Gate `hooks/tests/test-suite-finalize-gate.test.sh`: shrink the allowlist using measured evidence. Depth-0 ran all 18 allowlisted suites at 4c3b7a71; logs are in `<SCRATCH>/run/fprobe/<name>.log` (SCRATCH = parent of the clone; summary in `<SCRATCH>/run/finalize-probe.out`). Classify each: (i) finalizes indirectly (prints `PASS [name] N assertions`, e.g. codex-postcompact-production-live-driver) → the gate should recognize it (accept `finalize_test` called from a function/trap the suite defines, or the suite's own final summary line that exits nonzero on failure) and the entry leaves the allowlist; (ii) has its own harness with its own nonzero exit on failure (verify by reading its tail, e.g. `N passed, 0 failed` + `exit 1` path) → leaves the allowlist if the gate can recognize it simply, else stays with a comment "own harness, exits nonzero at <line>"; (iii) truly never fails (assertions accumulate with no exit path) → stays allowlisted with comment "ALWAYS-GREEN — needs finalize_test" . Flag specifically `mission-terminal-rollover` (it printed `0 passed, 0 failed`) and `autopilot-engine-boundary-resume` (prints `green_reason=git worktree command exited with status 1` with no assertion on it). Do NOT edit those 18 suites; report the classification table.
Run: the A suite, the gate suite, `final-panel-seat-resume`, `final-panel-seat-resume-xproc`, `implementation-campaign-state`, `node scripts/check-js-syntax.js`, sync --check.
Commit message: `fix(tests): the REVIEWING-resume engine stage resumes a final-panel transient fault to converged; finalize gate recognizes indirect finalizers`

---
# Unit B — reviewer seat output budget exhausted by thinking
Worktree `wt-B`, branch `hands/w111/B`, base = default BASE_SHA.
Sidecar: `docs/backlog/review-seat-max-tokens-exhausted-by-thinking.md`.

Defect (peer-reported, NOT located): a GLM reviewer seat at max effort returned HTTP 200, `stop_reason: max_tokens`, all output was thinking, no text — and it surfaced as a generic transport failure. The peer saw a 4096 output-token cap. The previous session could not find where 4096 is set.

Do:
1. LOCATE first and report path:line of where the output-token cap for anthropic-compatible / cc-shim / HTTP reviewer seats is set: `git grep -n -E 'max_tokens|maxTokens|max_output_tokens|4096' -- src scripts hooks project-config-template platforms/codex/plugin/scripts`, plus `scripts/lib/effort-scale.js`, `scripts/dispatch-anthropic-review.js`, `scripts/dispatch-local-openai.js`, `scripts/dispatch-review.sh`, the cc-shim path. If nothing in the repo sets it, it is a provider default — then the fix is to set it explicitly.
2. Fix: a max-effort reviewer gets an output budget large enough to hold thinking plus the verdict (peer suggests 16384; tie it to the effort tier if an effort→budget mapping exists, otherwise a named constant). Keep max effort.
3. Classify `stop_reason: max_tokens` with no text block as a distinct named failure (e.g. `output_budget_exhausted`) — it STILL FAILS. The parser is NOT relaxed: a thinking-only response never becomes a verdict. Test asserts the name, and a negative control that a normal text verdict still parses.
4. If the request path is in more than one script (anthropic + openai-compatible), cover each that can carry thinking; say which you did not touch and why.
Commit message: `fix(review): max-effort reviewer seats get a thinking-sized output budget; thinking-only max_tokens is a named failure`

---
# Unit D — dispatch-author suite fails when TMPDIR is a symlink
Worktree `wt-D`, branch `hands/w111/D`, base = default BASE_SHA.

Reproduced by depth-0 at f197fc09: `hooks/tests/dispatch-author.test.sh` passes 144/144 with TMPDIR=/tmp and TMPDIR=/tmp/ but fails 19/144 with TMPDIR set to a symlink to a directory (log: `<SCRATCH>/run/tmpdir/link.dispatch-author.log`, where SCRATCH is the parent of the clone). Failing groups: independently observed polarity receipt; agy script-wrapper / generic alias / runner_failed / empty_output; gemini-flash effort mapping. The dispatch exits 3 (or 2) where 0/1 is expected. A peer host hit the same suite failing until it switched to a plain private /tmp path. `provider-readiness-single-line-frame.test.sh` passes in all shapes (it is a consumer check, rerun it).

Reproduce: `ln -s <some real dir> <SCRATCH>/tdlinkD; TMPDIR=<SCRATCH>/tdlinkD bash hooks/tests/dispatch-author.test.sh`.

Do:
1. Diagnose: find where a path derived from TMPDIR (or the test's TEST_TMP) is compared, without resolving symlinks on one side, against a path resolved with `pwd -P`/realpath on the other (candidates: `scripts/dispatch-author.sh` REPO_ROOT normalization, `scripts/lib/main-checkout-boundary.sh`, cleanroom/containment checks, the agy containment `scripts/lib/agy-containment.js`, or the test harness itself in `hooks/tests/lib.sh`). Report the exact cause with path:line.
2. Decide product vs test: if the product refuses a legitimate symlinked TMPDIR (a real user can have one), fix the product by normalizing both sides consistently — never by loosening a containment/boundary check (a path genuinely outside the allowed root must still be refused; add a negative control proving it). If only the test fixture assumes an unresolved path, fix the fixture.
3. RED-first regression: a case (in the existing suite or a new small suite) that runs the affected path with a symlinked TMPDIR. Then the full `dispatch-author.test.sh` must pass under TMPDIR=/tmp AND under a symlinked TMPDIR AND under a non-/tmp real dir.
Commit message: `fix(dispatch-author): a symlinked TMPDIR no longer breaks <what you found>`

Addendum (depth-0, after the full repro finished): a non-/tmp REAL directory (`/home/cookys/.cache/tdprobe`) passes 144/144. Only the symlinked shape fails. So the cause is symlink resolution, not the /tmp prefix.
