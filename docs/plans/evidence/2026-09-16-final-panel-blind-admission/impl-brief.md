# Implementation brief — final-panel-blind-admission-2026-09-16

You are the implementer of ONE managed deliverable. The harness commits your work; you never push,
never `git stash`, never touch files outside `output_paths`, never run a real reviewer binary —
suites use PATH stubs, stub adapters and sandbox ledgers only. Grant base: `a1ee6ff5`; the rubric
pins RED evidence and byte-identity against `9b049c00` (product files identical between the two —
cite `9b049c00`).

## Read first (in this order)
1. `docs/plans/2026-09-16-final-panel-blind-admission.md` — §0, §1 (five points; the precedence
   rule "blind check BEFORE the qualification loop" and the exact message text are normative), §2
   per-file changes and test list, §2.5 exact output_paths, §4 acceptance incl. `scope-integrity`.
2. `docs/plans/2026-09-16-final-panel-blind-admission.rubric.md` — R1–R10.
3. `src/engine/final-panel-qualification.js` (whole file, 40 lines) and `src/engine/campaign-intake.js`
   ~1410-1445 (the `qc_panel_seats` admission loop → `final_panel_seat_unqualified`; copy its
   `rejected(...)` / `status: 'blocked'` return shape).
4. `scripts/resolve-review-loop.sh`: `CHECK_SCORECARD` (:179, :236, :1495, :1864), the qc seat walk
   `_add_seat "qc_panel[$_i]"` ~2095-2115, the `CAP_WARNINGS_JSON` append idiom ~885-900, the ⚠
   stderr idiom ~2325. `scripts/dispatch-review.sh` :288-293 (the blind `case` — comment only).
5. Suites: `hooks/tests/implementation-campaign-state.test.sh` ~5260-5310 (the two
   `final_panel_seat_unqualified` cases: fixture roster, spy adapters); `hooks/tests/
   implementation-campaign-routing.test.sh` ~2311-2760 (the red-path engine block: sealed contract,
   real `appendCampaignEvent`, sandbox repo/ledger, `campaignIntake` seam, dispatcher stubs — copy
   its wiring for the R4 run); `hooks/tests/resolve-review-loop-qc-panel-rejection.test.sh` (config
   fixture idiom with `qc_panel_runners`); `hooks/tests/dispatch-review.test.sh` (stub-binary idiom).

## Product changes (plan §1 is normative)
1. `final-panel-qualification.js`: export `BLIND_DISCOVERY_CAPABLE_RUNNERS = Object.freeze([
   'anthropic-compatible', 'cc-shim', 'claude-native', 'qoderclicn'])` and
   `isBlindDiscoveryCapableRunner(runner)` (exact string match) next to `finalPanelSeatQualified`.
2. `campaign-intake.js`: BEFORE the existing qualification loop over `qcSeats`, walk the same
   seats; for every seat whose runner is not capable, push one line
   `qc_panel[<i>] <model>/<runner>@<endpoint|@none> cannot execute a managed blind-discovery review
   (runner is not in the enforceable no-tools set anthropic-compatible, cc-shim, claude-native,
   qoderclicn); replace it with a blind-capable seat or complete the codex containment
   qualification — pins and overrides do not bypass containment`; if any, return the blocked shape
   with code `final_panel_seat_blind_incompatible` and the lines joined by `\n`. No pin, override
   or ladder consultation happens for this check.
3. `resolve-review-loop.sh`: only under `CHECK_SCORECARD -eq 1`, after the seat admission walk, for
   each qc seat (index order) whose runner is not in the set, append to `CAP_WARNINGS_JSON`
   `qc_panel[<i>] seat (<model>/<runner>) cannot execute a managed blind-discovery review — the
   managed rail refuses it at intake (final_panel_seat_blind_incompatible); replace the seat or
   complete the containment qualification` and print `resolve-review-loop: ⚠ <same text>` to stderr.
   Exit code unchanged. The bash set is a literal mirror of the Node constant with a comment naming
   it; the parity test (below) is what keeps them equal.
4. `dispatch-review.sh`: add a comment above the blind `case` naming
   `BLIND_DISCOVERY_CAPABLE_RUNNERS` in `src/engine/final-panel-qualification.js`; do not change the
   `case`.
Mirrors: `bash scripts/sync-codex-plugin-skills.sh` then `--check`.

## Tests (plan §2 test list is normative; header `# RED at base 9b049c00: <observed message>`)
- state suite: fixtures per §2 — qualified codex seat (blocked, code, `@@none` rendering and an
  `@<endpoint>` variant, claim spies base 1 / head 0), two incompatible seats → exactly two lines in
  index order, override-admitted codex → still blocked, standing-pin codex (admitted only through
  the pin store path `finalPanelSeatQualified` consults) → still blocked, PRECEDENCE: unqualified
  codex → `final_panel_seat_blind_incompatible` not `…_unqualified`, `kimi`/`cursor` → blocked,
  `cc-shim`/`claude-native` → admitted (controls).
- routing suite: an engine run with a sealed contract, the REAL `appendCampaignEvent`, a REAL sandbox
  ledger and stub dispatchers (copy the red-path block's wiring; roster gains a codex qc seat) →
  `phase: 'campaign_intake'`, the code, zero implementation/review dispatcher calls, no intake row for
  the campaign in the sandbox ledger.
- resolver suite: config with `qc_panel_runners: codex, cc-shim, cursor` → with `--check-scorecard`
  exactly two `capability_warnings` entries in index order (regexes in the plan), both ⚠ lines on
  stderr, exit 0; without the flag none; the text contains no `pin-seat` and no
  `AUTOPILOT_QUALIFICATION_OVERRIDE`.
- dispatch-review suite: parity loop over the `--runner` vocabulary (`codex agy grok cc-shim
  anthropic-compatible claude-native qoderclicn kimi cursor opencode`) with
  `AUTOPILOT_BLIND_DISCOVERY=1` and a stub `--bin`: reaches the stub ⇔ `isBlindDiscoveryCapableRunner`
  (require the Node module from the test); the precondition message is the existing one.
Run each suite at base BEFORE product edits and quote the observed messages. Do not weaken or delete
any existing assertion.

## Docs
- `docs/BACKLOG.md`: cuda P1 row → `- **Status**: shipped v2.36.58 2026-09-16`; Context: replace the
  "(i) pre-spend admission next" tail with "(i) pre-spend `final_panel_seat_blind_incompatible`
  v2.36.58" (keep ≤ 240 bytes). Add ONE new row after it, Status `open`, title "Managed rail: codex
  containment (bwrap) qualification spike so a codex seat can serve the blind final panel", Effort
  Spike, Source "/l5 dogfood 2026-09-16 (cuda P1 consult, A2)", Pointer
  `docs/plans/2026-09-16-final-panel-blind-admission.md`, Context summarizing plan §6's probe list
  (≤ 240 bytes). `node scripts/check-backlog-entries.js --backlog docs/BACKLOG.md` must exit 0.
- `skills/l5/references/hetero-impl-loop.md`: step 11 fixed list append "blind-incompatible
  final-panel seat refused at intake v2.36.58"; step 6b: after "read the stderr ⚠ notes" add "(a
  qc seat whose runner cannot run blind review is reported there and refused at intake)". Regenerate
  the mirror. Do NOT touch CHANGELOG.md or version manifests.

## Verify (all, one at a time, foreground; all green)
```
bash hooks/tests/implementation-campaign-state.test.sh
bash hooks/tests/implementation-campaign-routing.test.sh
bash hooks/tests/resolve-review-loop.test.sh
bash hooks/tests/resolve-review-loop-standing-pin.test.sh
bash hooks/tests/resolve-review-loop-qc-panel-rejection.test.sh
bash hooks/tests/dispatch-review.test.sh
node scripts/check-js-syntax.js
bash scripts/sync-codex-plugin-skills.sh --check
node scripts/check-backlog-entries.js --backlog docs/BACKLOG.md
git diff --stat 9b049c00 -- src/engine/autopilot-engine.js src/runners/review.js src/engine/campaign-composition.js src/engine/implementation-campaign.js bin/autopilot.js   # must print nothing
git diff 9b049c00 -- scripts/dispatch-review.sh | grep '^[-+]' | grep -v '^[-+][-+]' | grep -v '^[-+]\s*#'   # must print nothing (comment-only)
```

## Sealed output_paths (the ONLY files you may change)
```
src/engine/final-panel-qualification.js
platforms/codex/plugin/src/engine/final-panel-qualification.js
src/engine/campaign-intake.js
platforms/codex/plugin/src/engine/campaign-intake.js
scripts/resolve-review-loop.sh
platforms/codex/plugin/scripts/resolve-review-loop.sh
scripts/dispatch-review.sh
platforms/codex/plugin/scripts/dispatch-review.sh
hooks/tests/implementation-campaign-state.test.sh
hooks/tests/implementation-campaign-routing.test.sh
hooks/tests/resolve-review-loop-qc-panel-rejection.test.sh
hooks/tests/resolve-review-loop.test.sh
hooks/tests/dispatch-review.test.sh
docs/BACKLOG.md
skills/l5/references/hetero-impl-loop.md
platforms/codex/plugin/skills/l5/references/hetero-impl-loop.md
```
Finish with a clean tree, changes committed as the harness instructs; report the RED-at-base
messages and every suite's pass/fail count.
