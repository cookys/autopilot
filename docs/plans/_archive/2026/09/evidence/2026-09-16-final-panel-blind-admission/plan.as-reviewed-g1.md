# A blind-incompatible final-panel seat is refused before the campaign spends

> Status: execution plan for ONE managed deliverable (`/l5`, mission graph node
> `final-panel-blind-admission-2026-09-16`) — the second of two cut from BACKLOG row "Managed rail
> (cuda P1): GLM tautological no_finding_proof stops full_diff_review; final panel seat
> transport_failed" (fired 2026-09-16). Deliverable 1 (v2.36.57) shipped (ii)+(iii); this is (i).

## 0. What is actually broken (verified 2026-09-16, base `9b049c00`)

- `scripts/dispatch-review.sh:288-293`: under `AUTOPILOT_BLIND_DISCOVERY=1` only
  `qoderclicn|cc-shim|claude-native|anthropic-compatible` run; any other runner dies with
  `blind review requires an enforceable no-tools runner profile (got: codex)`. Rationale (header
  ~95-125, `references/blind-dispatch.md`): those runners can execute tools and read the real repo
  from the scratch cwd, so outcome-blinding is not enforceable; codex `exec --sandbox read-only`
  still reads the whole filesystem.
- The engine sets `blindDiscovery: true` for every managed review (`src/runners/review.js`
  ~195-215; `autopilot-engine.js` ~4839 full-diff, ~9683 final panel).
- Intake (`src/engine/campaign-intake.js` ~1413-1440) admits `qc_panel_seats` on qualification /
  standing pins only (`final_panel_seat_unqualified`). With the operator pin
  `[gpt-5.6-sol/codex, GLM-5.2/cc-shim, MiniMax-M3/cc-shim]` the campaign runs to the end (implement,
  verify, review, full_suite, adjudicate, convergence) and only THEN the codex seat is
  `transport_failed` → `final_panel_seat_transport_failed`, panel 2/3, campaign blocked. Measured on
  cuda (fleet-comms, twice) and on this host (campaign C, 2026-09-16). The same seat dispatched
  manually without the blind env works every time.
- `resolve-review-loop.sh --check-scorecard` prints ⚠ for evidence-free pins but nothing about
  blind capability, so the operator sees no warning before `/l5`.

## 1. Ruling and shape (option A1 of the design consult, see Review log)

1. **One canonical predicate.** `src/engine/final-panel-qualification.js` exports
   `BLIND_DISCOVERY_CAPABLE_RUNNERS` (frozen array `['anthropic-compatible', 'cc-shim',
   'claude-native', 'qoderclicn']`) and `isBlindDiscoveryCapableRunner(runner)`. The bash allowlist in
   `dispatch-review.sh` stays as defense in depth and gains a comment naming the Node constant; a
   parity test asserts the bash gate's accept/deny for every runner in the `--runner` vocabulary
   matches the Node predicate.
2. **Pre-spend refusal at intake.** In `runCampaignIntake`, right after the existing
   `final_panel_seat_unqualified` loop and before any Mission/generation claim, every
   `qc_panel_seats[i]` whose `runner` is not blind-capable produces a rejection with the NEW code
   `final_panel_seat_blind_incompatible` (same `rejected('campaign_generation', …)` shape, `status:
   'blocked'`, `pre_spend_no_effect_receipt: null`). Message, exactly one line per seat:
   `qc_panel[<i>] <model>/<runner>@<endpoint|@none> cannot execute a managed blind-discovery review
   (runner is not in the enforceable no-tools set anthropic-compatible, cc-shim, claude-native,
   qoderclicn); replace it with a blind-capable seat or complete the codex containment qualification —
   pins and overrides do not bypass containment`. `override_admitted_seats` and standing pins do NOT
   admit such a seat. The reason is a capability of the runner, so "unqualified" is not reused.
3. **Resolver warning, report-only.** `resolve-review-loop.sh --check-scorecard` appends to
   `capability_warnings[]` one entry per blind-incompatible qc seat — `qc_panel[<i>] seat
   (<model>/<runner>) cannot execute a managed blind-discovery review — the managed rail refuses it at
   intake (final_panel_seat_blind_incompatible); replace the seat or complete the containment
   qualification` — and prints the same as a `⚠` stderr line; exit code unchanged (report-only);
   nothing is emitted without `--check-scorecard`; the remedy never suggests another pin.
4. **Runtime unchanged.** `performFinalPanel`, `finalPanelSeatReceipt`, the blind env, the bash gate's
   behaviour and `dispatch-review.sh`'s runner vocabulary are untouched.
5. **The hole this leaves, stated.** With `min_panel_size: 3` and a three-seat pin that includes
   codex, every managed campaign on that host now stops at intake instead of at the final panel —
   the expensive late failure becomes a cheap early one, but the operator's three-seat panel is not
   restored until the codex seat is replaced or the codex containment (bwrap) qualification spike
   (§6) lands. Depth-0 re-pins this host's panel after the merge (operator decision, not the hand's).

## 2. Changes by file

- `src/engine/final-panel-qualification.js` (+ mirror): the constant and predicate (exported next to
  `finalPanelSeatQualified`).
- `src/engine/campaign-intake.js` (+ mirror): the pre-claim loop (§1.2).
- `scripts/resolve-review-loop.sh` (+ mirror): under `CHECK_SCORECARD`, after the existing seat
  admission walk, the warning per blind-incompatible qc seat (§1.3), using the same
  `CAP_WARNINGS_JSON` append idiom as the implementer-ladder warnings (~885).
- `scripts/dispatch-review.sh` (+ mirror): comment only (names the Node constant); the `case` is
  unchanged.
- Tests (RED-at-base headers with observed messages; preservation guards labelled; stubs only):
  - `hooks/tests/implementation-campaign-state.test.sh` (next to the existing
    `final_panel_seat_unqualified` cases ~5270-5310): a roster whose `qc_panel_seats[0]` is
    `gpt-5.6-sol/codex`, fully qualified (in `fallback_ladder`) → `runCampaignIntake` returns
    `status: 'blocked'`, `rejection.code === 'final_panel_seat_blind_incompatible'`, message names
    `qc_panel[0] gpt-5.6-sol/codex` and contains `pins and overrides do not bypass containment`;
    the `missionClaim`/`claimGeneration` adapter spies are 0 (RED at base: admitted, claim called);
    the same roster with `override_admitted_seats: ['qc_panel[0]']` → still blind_incompatible (RED at
    base); replacing the seat with `GLM-5.2/cc-shim` (same otherwise-valid roster) → admitted
    (control, green at base); a `kimi` and a `cursor` seat → refused (RED at base); a
    `claude-native` seat → admitted (preservation).
  - `hooks/tests/implementation-campaign-routing.test.sh`: the engine-level P3 block's roster with a
    codex qc seat added → the run returns `phase: 'campaign_intake'` with the blind_incompatible
    code and ZERO implementation/review dispatcher calls (RED at base: dispatchers called, run ends
    at `final_panel`).
  - `hooks/tests/resolve-review-loop-qc-panel-rejection.test.sh` (or `resolve-review-loop.test.sh`,
    whichever already stubs a qc panel): with `--check-scorecard` and a codex qc seat the JSON's
    `capability_warnings` contains an entry matching `^qc_panel\[0\] seat \(gpt-5\.6-sol/codex\) cannot
    execute a managed blind-discovery review` and stderr has the `⚠` line; exit 0 (RED at base: no
    such warning); without `--check-scorecard` the warning is absent (preservation); the warning text
    contains no `pin-seat` / `AUTOPILOT_QUALIFICATION_OVERRIDE` remedy (preservation of the rule).
  - `hooks/tests/dispatch-review.test.sh`: parity — for every runner in the `--runner` vocabulary,
    invoking `dispatch-review.sh` with `AUTOPILOT_BLIND_DISCOVERY=1` and a stub binary either reaches
    the stub (blind-capable) or dies with the `enforceable no-tools runner profile` precondition, and
    that outcome equals `isBlindDiscoveryCapableRunner(runner)` (preservation, green at base for the
    gate; the Node side of the comparison is new).
- Docs: `docs/BACKLOG.md` cuda P1 row → `shipped v2.36.58 2026-09-16`, Context "(i) pre-spend
  `final_panel_seat_blind_incompatible` v2.36.58"; new open row "codex containment (bwrap) spike so a
  codex seat can become blind-capable" with the consult's probe list summarized in Context;
  `skills/l5/references/hetero-impl-loop.md` step 11 fixed list gains "blind-incompatible final-panel
  seat refused at intake v2.36.58" and step 6b's seat check sentence mentions the ⚠ (+ mirror).
  `CHANGELOG.md` and version manifests are NOT sealed (depth-0 release commit after the merge; the
  v2.36.58 number in text is a pin as in v2.36.53–57).

### 2.5 Sealed `output_paths` (exact)

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

## 3. Out of scope

- A2 (codex containment via bwrap) — spike, §6. A3 (advisory non-blind seat) — rejected by the
  consult: an advisory seat must never count toward the authoritative panel.
- Any change to `performFinalPanel`, seat receipts, the blind env, or the bash gate's behaviour.
- The reviewer (`reviewer_runner`) seat: the in-rail full-diff review also runs blind, but this
  repo's reviewer seats are cc-shim; a non-capable reviewer seat already fails at the first review
  (cheap) — a follow-up row if a host reports it.

## 4. Acceptance

| id | criterion | evidence |
|----|-----------|----------|
| `blind-incompatible-pre-spend` | a qualified/pinned codex qc seat is refused at intake with `final_panel_seat_blind_incompatible`, claim adapters never called; an override-admitted codex seat is still refused; the engine run ends at `campaign_intake` with zero dispatcher calls | state + routing suites |
| `blind-capable-admitted` | the same roster with a cc-shim / claude-native seat is admitted | state suite |
| `resolver-warning` | `--check-scorecard` reports the seat in `capability_warnings[]` and on stderr, exit 0, no pin remedy; absent without the flag | resolve-review-loop suite |
| `predicate-parity` | for every runner in the vocabulary the bash blind gate agrees with `isBlindDiscoveryCapableRunner` | dispatch-review suite |
| `no-regression` | `implementation-campaign-state`, `implementation-campaign-routing`, `resolve-review-loop`, `resolve-review-loop-standing-pin`, `resolve-review-loop-qc-panel-rejection`, `dispatch-review` green; `check-js-syntax.js`; `sync-codex-plugin-skills.sh --check`; `check-backlog-entries.js` | suite output |
| `scope-integrity` | `git diff --name-only 9b049c00 HEAD` ⊆ §2.5 plus committed plan/mission docs; `src/engine/autopilot-engine.js`, `src/runners/review.js`, `src/engine/campaign-composition.js` byte-identical to `9b049c00` | command output |

## 5. Dogfood proof (depth-0, after merge)

On this host, before re-pinning: `mission grant` + `engine implement-review` against the current pin
(codex in `qc_panel[0]`) returns `blocked` at `campaign_intake` with `final_panel_seat_blind_incompatible`
and no worktree/branch is created (the attempt is not spent); `resolve-review-loop.sh --check-scorecard`
prints the ⚠. Then depth-0 re-pins the seat (operator decision) and the next campaign passes intake.

## 6. Follow-ups filed, not done here

- A2 spike: codex inside `bwrap` with only the scratch inputs, runtime libraries, TLS/DNS and a
  sanitized `~/.codex` view; prove no repo/worktree/home/`/tmp`/`/proc` reach, no shell/git/curl/MCP
  re-acquisition, nested-sandbox behaviour, timeout/exit/raw_log parity, fail-before-spend on missing
  bwrap/mounts; record codex/bwrap versions and the file dependency set. Only then may `codex` enter
  the allowlist.
- Reviewer-seat (in-rail) blind capability warning, if a host reports a non-capable reviewer seat.

## Review log

- Design consult 2026-09-16 (codex gpt-5.6-sol; evidence
  `docs/plans/_archive/2026/09/evidence/2026-09-16-proof-parity-raw-log/consult-codex-answer.md`, "Deliverable 1"):
  recommends A1 now with a distinct rejection code (not "unqualified" — a pin cannot fix
  containment), one canonical predicate with a bash parity test, report-only resolver warning that
  never suggests a pin, and A2 as a bounded spike with the probe list above; names A1's residual
  availability hole. Folded into §1, §4, §6.
