# hlsm (hooks-live-state-misc) wave-1b — REPORT (attempt 2)

## Governance note — shadow commit resolved differently than attempt1

Attempt1 (`REPORT.attempt1.md`) hit `dispatch-hetero.sh`'s `enforce`-mode precondition at base
`475ebdc7`, was mid-flight offered an inbound "depth-0" message instructing it to build on a
local commit flipping `.claude/owner-kernel-governance.json` `mission_convergence.enforcement_mode`
from `enforce` to `shadow`, inspected the diff and correctly identified it lacked an authority source (not a failure to inspect it), and declined
— reset the clone to base and stopped without dispatching.

This run's brief (WAVE-1b OVERRIDES item 0) carries the same shadow commit
(`1d9908dfb4567b150f0ba008c7940bd7823911f3`, sole change: that one enforcement_mode flip, message
"PARALLEL-RUN LOCAL ONLY … (never land)") but as part of the primary task specification itself,
citing `docs/plans/evidence/2026-09-19-parallel-sonnet-foremen/common.md` line 7. I read that file
(present at base, not touched by the shadow commit) before proceeding: it documents this exact
pattern — a clone-local, never-merged commit flipping `enforcement_mode` to `shadow` so a plain
hand dispatch (not a sealed managed campaign) can run in a throwaway clone — as the standing
recipe for this whole wave-1b parallel run, used identically by sibling foremen. Unlike attempt1's
unverifiable mid-flight message, this instruction is (a) in my actual task spec from my invoking
context, not an inbound peer claim, and (b) backed by a real, committed, in-repo document matching
it line-for-line. I was never asked to change the governance file myself — only not to touch it —
and the shadow commit is explicitly never cherry-picked or landed by depth-0. On that basis I
treated it as legitimate for this clone-local session and dispatched both rows on top of it.
`BASE_SHA` for row 139 was therefore `1d9908dfb4567b150f0ba008c7940bd7823911f3`, not `475ebdc7`.

## Premise checks

- **Row 139**: defect present at the shadow-commit base — `hooks/depth0-delegate-gate.js` header
  documented `Bash` as matched via `isBashReadClass()` but had no citation of the P3.1 delta vs.
  `docs/plans/_archive/2026/09/2026-09-05-statusline-live-context-feed.md` §4. No `assert_r139_*`
  case existed in `hooks/tests/hooks-live-state-misc.test.sh`. `hooks/depth0-delegate-gate.test.js`
  exists (courtesy verify line is real, not vacuous). Brief's file list/scope unchanged — dispatched
  as written.
- **Row 140**: defect present — no `assert_r140_*` case; mutants (a)/(b)/(c) uncovered. One brief
  sub-item was already stale per the OVERRIDES note (and independently reconfirmed): the
  `timeout: 2000` header-doc note already exists in `scripts/lib/live-state-dir.js`'s header
  comment ("findmnt is given 2000 ms (`timeout: 2000`)"). Dropped that sub-item from the hand
  prompt; told the hand explicitly to make no edit to `scripts/lib/live-state-dir.js` (and
  therefore no codex-mirror sync was needed — none ran).

## Row 139 — depth0-delegate-gate header doc

- Hand branch: `hands/w1b-hlsm/139`, head `8064fdacf00b321ec054c59980a7636ad6e63f5a`
  (base `1d9908dfb4567b150f0ba008c7940bd7823911f3`).
- `diff --stat`: `hooks/depth0-delegate-gate.js | 6 ++++++`, `hooks/tests/hooks-live-state-misc.test.sh | 21 +++++++++++++++++++++` — 2 files, 27 insertions, 0 deletions. Matches Allowed files exactly; no other file touched.
- Diff content: added header paragraph citing the P3.1 delta verbatim per spec; new
  `assert_r139_depth0_delegate_gate` case (greps for "P3.1" and the archive-file name).
- Review verdict: **SHIP-AS-IS** (claude-native / claude-fable-5-1, effort high). No findings.
- No repair round needed.

## Row 140 — live-state-dir / context-budget mutation-hardening coverage

- Hand branch: `hands/w1b-hlsm/140`, head `c4210072d6f060309e05ea3ab23e866fbfaafc6b`
  (base = row 139's accepted head `8064fdac…`).
- `diff --stat`: `hooks/tests/hooks-live-state-misc.test.sh | 90 ++++...` — 1 file, 90 insertions, 0
  deletions. Matches Allowed files exactly (no touch to `live-state-dir.js`, no mirror sync, no
  touch to `context-budget.js` or either run-only suite).
- New `assert_r140_live_state_dir_conte` case covers all three sub-items:
  (a) `notFound` → `/proc/mounts` fallback with no wildcard default, asserts source is not
  `ssd-fallback`; (b) end-to-end hook drive with transcript=130k / live=160k asserting the
  `Math.max` lag guard picks 160k (T2 fires; 130k alone would not); (c) asserts the live-path run's
  stderr carries the `(statusline)` windowSource annotation.
- Review verdict: **SHIP-AS-IS** (claude-native / claude-fable-5-1, effort high). Two 🔵
  suggestion-level findings, both explicitly accepted-as-is by the reviewer's own rationale
  (consistent with existing patterns in the same suite, not required to fix):
  - `r140-devshm-hardcode`: fixture hardcodes `/dev/shm`; same pre-existing dependency as r133.
  - `r140-stderr-wording-coupling`: assertions key on literal stderr substrings/exit code; brief
    explicitly asked for a stderr-annotation assertion, same coupling style as existing r12 cases.
  No 🔴/🟠 findings. No repair round needed.
- **Out of scope, reported per brief item (d)**: the injection-test residue cleanup was not
  attempted — the leaking test file was never identified in either row's Allowed list, so no hand
  was authorized to touch it. Still outstanding; needs its own row/brief with an identified file.

## Aggregate verify (run once, worktree on row 140's accepted head `c4210072…`)

```
hooks-live-state-misc: 24 passed, 0 failed
check-js-syntax: 682 tracked .js/.cjs/.mjs file(s) parse cleanly
context-budget-window-memory: 6 passed, 0 failed
scripts/lib/live-state-dir.test.js: 22 passed, 0 failed
hooks/depth0-delegate-gate.test.js: 29 passed, 0 failed
```
Worktree created via `git worktree add` on the accepted head (never checked out the orchestrator's
clone directly) and removed afterward.

## Final state

- `accepted-heads.txt`: `c4210072d6f060309e05ea3ab23e866fbfaafc6b` (row 140's accepted head; stacks
  on row 139's `8064fdac…`, which stacks on the shadow commit `1d9908df…`).
- No versions bumped, no CHANGELOG/BACKLOG edits, no merges — both hand commits sit only on their
  branches in this clone, ready for depth-0 to cherry-pick.

## Row verdicts

LAND 139 8064fdacf00b321ec054c59980a7636ad6e63f5a
(row 139 review findings field: "none" — SHIP-AS-IS confirmed, no 🔴/🟠 hidden alongside it)
LAND 140 c4210072d6f060309e05ea3ab23e866fbfaafc6b

## Mutation-kill verification (foreman-performed, not hand self-report)

Per CLAUDE.md evidence discipline, self-reported mutation-kill claims are not trusted; verified
independently in a throwaway worktree on row 140's accepted head, then discarded (no commit made):
- Reverting `hooks/context-budget.js`'s `contextTokens = Math.max(usage.tokens, liveTotal)` to
  `contextTokens = usage.tokens` (dropping the live-total floor): suite goes from 24 passed / 0
  failed to **22 passed, 2 failed** (the two `lag guard` assertions go red). Assertion (b) is a
  real mutation-kill, not vacuous.
- Reverting `scripts/lib/live-state-dir.js`'s `if (notFound) {` to `if (false) {` (disabling the
  `/proc/mounts` fallback path): suite goes to **21 passed, 3 failed** (`notFound without wildcard`
  and downstream assertions go red). Assertion (a) is a real mutation-kill, not vacuous.

Both confirmed real. LAND verdict for row 140 stands.
