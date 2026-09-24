# wave-1b repair — REPORT

## Status: DONE — all 5 previously-red suites + 4 bundle suites green on `release/w1b`

Final tip: **`7b90f681aab9f9cc07dc316199efdc47c5a9634d`** (13 commits ahead of `origin/develop`: the original
10 landed rows + 3 repair commits). Governance confirmed still `"enforcement_mode": "enforce"` at the final
tip. Tree clean throughout (`git status --short` empty before/after every gate run).

## 1. Bisect attribution (one representative suite per cluster, `git bisect run` on `release/w1b` ca39a653..8564ef2c)

| Cluster | Representative suite | First-bad commit | Row |
|---|---|---|---|
| A | `dispatch-contract.test.sh` | `1b2e2485` | 122 - fix(dispatch-contract): resolve quota for cc-shim/anthropic-compatible VA seats |
| B | `implementation-campaign-routing.test.sh` | `ea81dcdb` | 15 - fix(managed-rail): non-git --repo still consumes a Mission claim before intake rejects it |
| C | `resolve-review-loop-consult-discuss-switch.test.sh` | `1b2e2485` | 122 (same commit as A - its new fixture file shifted the Population B pin, a distinct symptom from cluster A) |

Bisect note: the shared repo's `core.bare` flag was found flipped to `true` in `$W/land`'s `.git/config`
(blocking ordinary `checkout`/`commit` in that clone) and had to be reset to `false` before any git-mutating
step in this repair; also the test suites themselves are not fully hermetic against `git bisect run` (they
mutate/commit into the checked-out tree as a side effect), so the bisect wrapper hard-resets to the pinned
commit after every test run. Both are session-local infra fixes, not part of the repair diff.

## 2. Repair hands (order C, B, A; each stacked via clone-local `w1b-shadow` shadow branch, cherry-picked, reviewed)

| Cluster | Hand branch | Hand commit | Landed SHA on `release/w1b` | Review verdict |
|---|---|---|---|---|
| C | `hands/w1b-repair/C` | `561186c0` | `2b598435` (test(resolve-review-loop-consult-discuss-switch): re-pin Population B 42->43 / explicit-switch 6->7) | FIX-THEN-SHIP (commit-message MUST-FIX only) -> amended, no code change |
| B | `hands/w1b-repair/B` | `4f06be08` | `580f535a` (test(implementation-campaign-routing): git-init the shadow-admit-repo fixture) | SHIP-AS-IS (commit-message note, non-blocking) -> amended for clarity |
| A | `hands/w1b-repair/A` | `dc363f02` | `7b90f681` (fix(dispatch-contract): restore agy to the effort-consuming set; drop fabricated effort from VA/anthropic-compatible fixtures) | FIX-THEN-SHIP (commit-message MUST-FIX only; unrequested-but-non-masking dispatch-hetero.test.sh hermeticity edits flagged CUT/FOLLOW-UP) -> amended |

All reviews run via `dispatch-review.sh --runner claude-native --model claude-fable-5-1 --effort high`; no
retry needed (verdicts returned on the first pass). Governance verified `enforce` on `release/w1b` after every
cherry-pick, before the next cluster's `w1b-shadow` was rebuilt.

### Root causes

- **Cluster C** (mechanical re-pin, no defect): row 122 added
  `hooks/tests/dispatch-lifecycle-residue-mission.test.sh`, a legitimate new Population B roster fixture
  (`- reviewer_engine: claude-opus`, `- consult_dispatch: off`, `- discuss_dispatch: off`). The switch
  suite's hardcoded population pins (42/6) were stale; re-pinned to 43/7 with a RECOUNTED comment block
  matching the file's own established precedent (`fc44b910`).
- **Cluster B** (fixture defect, guard correct): row 15's `canonicalRepoIdentity` pre-claim guard is
  unconditionally correct per its own authorization doc. The `shadow-admit-repo` fixture in
  `implementation-campaign-routing.test.sh`'s `defaultCleanroomProbe stubs` case was a bare `mkdirSync`'d
  directory, never a real git repo - a fake-path shortcut that only worked because the pre-row-15 code never
  checked git identity. Fixed by `git init -q`-ing the fixture; the guard/product code is untouched.
- **Cluster A** (two root causes under the same commit):
  1. *Product bug*: row 122's `runnerConsumesEffort()` mirrored `probe-engine-capability.sh`'s
     `_EFFORT_CONSUMER` list (codex/grok/qoderclicn/opencode) but missed that script's `agy` exemption
     (`[ "$RUNNER" != "agy" ]` on the non-consumer rejection) - agy folds effort into its model id, so
     exact-effort capability rows are legitimate authorizing observations for it. Restored `agy` to the
     switch in `scripts/dispatch-contract.js` and its codex mirror. This alone fixed the entire
     `dispatch-hetero.test.sh` cascade (its `agy`/`gpt-5.5`/`implementer` fixture is recorded with
     `effort:"high"`, the real-world shape).
  2. *Fixture bug*: `anthropic-compatible`/`glm-5.2` verification-author capability fixtures in
     `dispatch-author-contract.test.sh` and `dispatch-contract.test.sh` (Cases 7.1/10.7/10.8/11.4) fabricated
     an `"effort":"high"` field to satisfy the pre-row-122 code's unconditional `--effort` requirement - a
     defect, since `anthropic-compatible` has no `agy`-style exemption and never authorizes an exact-effort
     partition. Dropped the fabricated field so these fixtures resolve via the (correct) effort-less/legacy
     partition row 122 now queries.

## 3. Re-gate - final `release/w1b` tip `7b90f681`, solo, one at a time

| Suite | rc | Result |
|---|---|---|
| `dispatch-author-contract.test.sh` | 0 | PASS |
| `dispatch-contract.test.sh` | 0 | PASS |
| `dispatch-hetero.test.sh` | 0 | PASS |
| `implementation-campaign-routing.test.sh` | 0 | PASS |
| `resolve-review-loop-consult-discuss-switch.test.sh` | 0 | PASS |
| `managed-rail-core-engine.test.sh` (mrce bundle) | 0 | PASS |
| `dispatch-lifecycle-residue-mission.test.sh` (dlrm bundle) | 0 | PASS |
| `hooks-live-state-misc.test.sh` (hlsm bundle) | 0 | PASS (24 passed, 0 failed) |
| `review-loop-resolver-b.test.sh` (rlr bundle) | 0 | PASS |

`git status --short` empty before and after every run. Full per-suite output: `/tmp/final-{A1,A2,A3,B1,C1,
bundle-mrce,bundle-dlrm,bundle-hlsm,bundle-rlr}.log`.

## Note on the first re-gate attempt

An earlier background batch re-gate run (all 9 suites piped through one backgrounded shell) hung - its child
process tree showed only a stray `cat`, consistent with a heredoc-based test fixture stalling under
backgrounding/non-interactive stdin handling - and was killed. The re-gate above was rerun solo, foreground,
one suite per call, per depth-0's direction; every suite passed cleanly on the first foreground attempt, so
this was an execution-environment artifact of backgrounding, not a defect in the repair.

## Resume pointers

- Final `release/w1b` tip: `7b90f681aab9f9cc07dc316199efdc47c5a9634d` in `$W/land`.
- `w1b-shadow` (clone-local only, never landed) currently sits at the post-cluster-A shadow commit
  (`3f32f5d9`, nothing further needed - no cluster runs after A). Not merged, not pushed.
- Hand branches `hands/w1b-repair/{A,B,C}` and their prompt files `RUN/hand-{A,B,C}.md` /
  `RUN/hand-{A,B,C}.diff` are retained in `$W/land` and `$W/run-repair/` for audit.
- Steps 3-5 of the original landing brief (review/release/push) were explicitly out of scope for this repair
  brief; not attempted here.
