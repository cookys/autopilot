# Final panel per-seat standing pins: the terminal QC panel admits what the operator recorded, and refuses before spending

> Status: execution plan for ONE managed deliverable (`/l5`, mission graph node `final-panel-pins-2026-09-15`).
> Source row: `docs/BACKLOG.md` "Managed rail: the final panel's non-incumbent seats are structurally
> precondition_failed under the exact-tuple rule" (fired 2026-09-15). Owner ruling 2026-09-15: do the
> durable version (per-seat standing pins), not the per-invocation override file alone — "這種每天再犯的
> 問題應該一次到位".

## 0. What is actually broken (measured 2026-09-15)

`finalPanelSeatQualified` (`src/engine/autopilot-engine.js:1135`) admits a terminal-panel seat only when
it is (a) the incumbent reviewer tuple with `reviewer_qualified: true`, or (b) an exact tuple in
`roster.fallback_ladder`. Three facts make that incumbent-only in practice:

1. The managed rail resolves the roster with bare `--check-scorecard` (`autopilot-engine.js:472, 2871,
   2966, 3521, 4834, 8526, 9666`) and never passes `--scorecard-scope-file` / `--scorecard-identity-file`;
   `resolve-review-loop.sh:1498` gates the ladder on both files, so `fallback_ladder` is `[]` by
   construction. The sealed roster of campaign `peer-residue-2026-09-15` carries `fallback_ladder: []`.
   The BACKLOG row names "the exact-tuple rule" as the cause; the actual cause is that path (b) has
   never had input on this rail. (Passing the scope files is a separate change — see §6.)
2. The resolver's roster gate (`resolve-review-loop.sh:2222-2338`) consults the override file and the
   standing-pin store only for seats whose runner is in `UNQUALIFIED_RUNNERS="cursor"` (the
   `else _is_unqualified_runner || continue` branch). A `qc_panel[N]` seat on codex/cc-shim is never
   looked up, so an operator decision about it can never reach `override_admitted_seats` — the sealed
   roster carries `override_admitted_seats: ["implementer"]` only.
3. The pin store keeps ONE row per role (`engine-capability-state.js pinSeat`: `existing.filter(entry
   => entry.role !== row.role)`), and the resolver strips `qc_panel[N]` to `qc_panel` for the lookup.
   A three-seat panel cannot be pinned; only the per-invocation `AUTOPILOT_QUALIFICATION_OVERRIDE` file
   (an array) can cover it, and the operator-pin plan (`docs/plans/2026-09-11-operator-pin-supersedes-qualification.md`
   §1 item 2) already names "per-invocation, file-shaped" as the defect.

Consequences: every `/l5` run stops at `final_panel_seat_precondition_failed` and degrades to l3; the
one seat that does run (MiniMax-M3, incumbent) passed candidate `61541082` with 57 red tests
(2026-09-15). The panel is not the gate today; depth-0 verification is.

What is NOT a bug and stays: GLM-5.2's reviewer exam is `failed` (scorecard event 139) — by ADR-0001 only
a recorded operator decision admits it; gpt-5.6-sol is qualified but under runner token `codex-cli`
while the seat says `codex` (BACKLOG "audit every remaining runner comparison for codex-cli/codex
canonicalisation" — not folded in here).

## 1. Ruling and shape

Config listing is NOT admission (resolver 2311: "naming an unqualified runner in a roster is refused,
not downgraded"; evidence-free admission must be a recorded operator decision in
`override_admitted_seats`). The 2026-09-11 Q3 ruling fixes pin identity as engine+runner+role, per
role, machine-wide. This plan keeps that identity and removes the one-row-per-role implementation
limit for the multi-seat role only:

- **Single-seat roles** (implementer, reviewer, reviewer_low_risk, plan_reviewer, plan_deep_reviewer,
  consult, discuss, verification_author, owner): unchanged — one standing pin per role, `pin-seat`
  replaces, `unpin-seat --role` removes it. `dispatch-contract.js` / `resolve-dispatch-topology.js
  --resolve-live` read only these roles and are byte-identical in behaviour.
- **`qc_panel`**: many standing pins, identity = engine+runner+endpoint; `pin-seat --role qc_panel`
  replaces only the row with the same engine+runner+endpoint. **Selector contract (frozen, G1 codex
  blocker R2):** `unpin-seat --role qc_panel --engine X --runner Y --endpoint E` — all three selector
  flags are required together; `--endpoint @none` selects the null-endpoint row; the endpoint is never
  a wildcard; the command removes exactly that row and reports `removed: 1` (or `0`). `unpin-seat
  --role qc_panel` with no selector removes all qc rows and reports the count. Any selector flag on a
  non-`qc_panel` role exits non-zero naming the rule.
- The roster resolver looks up override/pin for EVERY `qc_panel[N]` seat and records an admission as
  role string `qc_panel[N]` (index preserved) in `override_admitted_seats`. For a standing pin the
  match is engine+runner+role **and endpoint** (G1 codex blocker R3): the seat's `QC_PANEL_ENDPOINTS[N]`
  is carried into the admission loop, `@none` and empty normalise to the null endpoint, and the pin's
  `endpoint` must equal it — a pin for engine/runner at endpoint A never admits the same engine/runner
  at endpoint B. The per-invocation override file keeps its existing engine+runner+role match (its
  schema has no endpoint; unchanged). **A qc seat with no
  override/pin is NOT refused by the resolver** — plan review (`dispatch-plan-review.js`), `qc-panel.js`
  and every non-managed consumer read this roster and must keep working. Refusal is the managed rail's
  job (next bullet), and it happens before any spend.
- `finalPanelSeatQualified(roster, seat, index)` gains path (c): `roster.override_admitted_seats`
  contains `qc_panel[<index>]` (the exact index-bearing string; `qc_panel` alone does not admit,
  a roster without the key admits nothing by this path). One statement of the rule: the function
  moves to `src/engine/final-panel-qualification.js` and is imported by BOTH the engine's final panel
  and campaign intake — no second qualification statement anywhere.
- Campaign intake (`src/engine/campaign-intake.js runCampaignIntake`, right after the
  `campaign_ledger_path_mismatch` pre-claim check) evaluates every `qc_panel_seats[i]` with the shared
  function BEFORE the Mission claim adapter runs. Any seat that fails → `{status:'blocked',
  rejection: rejected('campaign_generation','final_panel_seat_unqualified', <msg>), steps:[rejection],
  pre_spend_no_effect_receipt: null}`. The message names every failing seat as `qc_panel[i]
  engine/runner@endpoint` and the two remedies verbatim: `engine-capability-state.js pin-seat --role
  qc_panel …` or replace the seat with one carrying reviewer evidence. No claim, no worktree, no runner.
  This is the "ask early" the owner asked for: the rail is headless, so "ask" = stop at the cheapest
  point with the decision spelled out.

## 2. Changes by file

### 2.1 `scripts/engine-capability-state.js`
- `pinSeat`: replacement key is `role` for every role except `qc_panel`, where it is
  `role+engine+runner+endpoint`. Store row shape unchanged (eight keys, `expires: null`).
- `unpinSeat(config, role, selector)`: `selector` = `{engine, runner, endpoint}` optional; for
  `qc_panel` without selector remove all qc rows; for other roles a selector is rejected (`unpin-seat:
  --engine/--runner/--endpoint apply to --role qc_panel only`). CLI: `unpin-seat` accepts
  `--engine --runner --endpoint`.
- `pins --role qc_panel` returns all qc rows (already true once the store holds them).
- Usage text updated. Concurrency/atomicity paths (`withWriteLock`, `writeSnapshot`) untouched.

### 2.2 `scripts/resolve-review-loop.sh` (roster gate, ~2222-2338)
- The loop's `else` branch becomes: `_is_unqualified_runner "$_run" || [[ "$_role" == qc_panel\[*\] ]]
  || continue`, and for qc seats the "no override/pin found" outcome is `continue` (permissive, with a
  one-line stderr note `qc_panel[N] seat (eng/run) has no recorded operator admission — the managed
  rail's final panel will refuse it at intake`), NOT `exit 3`. The existing refusal for
  `UNQUALIFIED_RUNNERS` seats is unchanged.
- The recorded role string is `$_role` verbatim (`qc_panel[2]`), not the stripped `qc_panel`.
- Pin lookup: `_add_seat` gains a fifth field (endpoint; only qc seats populate it from
  `QC_PANEL_ENDPOINTS[$_i]`, `@none`/empty → null) and the pin `rows.find` for `qc_panel` seats adds
  `normEndpoint(o.endpoint) === normEndpoint(seatEndpoint)`; single-seat roles keep the existing
  engine+runner+role match (their pins are one per role).

### 2.3 `src/engine/final-panel-qualification.js` (new) + `src/engine/autopilot-engine.js`
- Move `finalPanelSeatQualified` out verbatim, add the `index` parameter and path (c). Engine imports
  it, re-exports it (existing test imports `finalPanelSeatQualified` from the engine module — keep
  that surface). `performFinalPanel` passes `index`.
- `validateReviewRoster(…, {requireTerminalPanel:true})`: if `override_admitted_seats` is present it
  must be an array of strings; absent is allowed (older rosters).

### 2.4 `src/engine/campaign-intake.js`
- Pre-claim check per §1. It runs whenever `input.roster.qc_panel_seats` is a non-empty array — no
  completeness or `min_panel_size` gate (G1 GLM finding R6): an unadmitted seat can never reach the
  Mission claim adapter by any roster shape. An incomplete panel still meets the existing
  `validateReviewRoster` defect later; that path is unchanged.

### 2.5 Docs
- `references/hetero-dispatch.md` § where `qc_panel` / terminal panel is described (≤ 600 B): the
  three admission paths, the pin command, and that intake refuses pre-spend.
- `skills/l5/references/hetero-impl-loop.md` recipe: one bullet before `mission prepare` — check
  `resolve-review-loop.sh --check-scorecard --field override_admitted_seats` lists every
  `qc_panel[N]` that lacks evidence, else pin.
- `docs/scripts-inventory.md` row for `engine-capability-state.js`: mention qc_panel multi-pin.

### 2.6 Tests (all RED-at-base assertions recorded with the base sha in the test header)
- `hooks/tests/engine-capability-pin.test.sh`: (10) two `pin-seat --role qc_panel` with different
  engines → two rows (RED at base: today one); (11) same engine+runner+endpoint twice → one row,
  second reason (preservation guard — replacement already behaves so at base; labelled, green base
  recorded); (12) same engine+runner at endpoint `glm` and at `@none` → two rows (RED); (13)
  `unpin-seat --role qc_panel --engine A --runner R --endpoint glm` removes exactly that row,
  `removed: 1`, the `@none` row and the other engine survive (RED); (14) `unpin-seat --role qc_panel`
  without selector removes all qc rows and reports the count (RED: today it removes the single row —
  assert count 3); (15) selector flags on `--role implementer` exit non-zero naming the rule (RED:
  today the unknown flag is rejected for a different reason — assert the exact message); case 4
  (single-role replacement) stays green — preservation guard, labelled.
- `hooks/tests/resolve-review-loop-standing-pin.test.sh` (isolated `--store`, never the host store):
  a config with a 3-seat qc panel and two qc pins → `override_admitted_seats` contains exactly
  `qc_panel[0]` and `qc_panel[2]` (whichever indices are pinned), exit 0 (RED at base: `["…"]` lacks
  them); the unpinned seat produces the stderr note and does not refuse (preservation guard: exit 0);
  a pin for the same engine+runner at endpoint A does NOT admit the seat at endpoint B (RED at base
  only in the sense that base records nothing — assert the negative explicitly against the new
  positive so the endpoint comparison is pinned; mutant: drop the endpoint compare → admits).
- `hooks/tests/qc-panel-honesty.test.sh`: `finalPanelSeatQualified(roster, seat, 1)` true when
  `override_admitted_seats: ['qc_panel[1]']` (RED at base); false for `['qc_panel']`, for index
  mismatch (`['qc_panel[0]']` with index 1), and when the key is absent — all three are preservation
  guards (base already returns false; labelled, green base recorded); the index rule is additionally
  pinned by a supplementary mutant (index-insensitive match → the mismatch case admits).
- `hooks/tests/implementation-campaign-state.test.sh`: intake with a roster whose `qc_panel_seats[1]`
  is neither incumbent, ladder, nor admitted → `status:'blocked'`, `rejection.code ===
  'final_panel_seat_unqualified'`, `pre_spend_no_effect_receipt === null`, `steps` is exactly
  `[rejection]`, and TWO separate spies — `adapters.missionClaim` and the generation-claim adapter
  (`claimGeneration`, the `claimAdapter` variable in intake) — each have call count 0; message names
  `qc_panel[1] engine/runner@endpoint` and `pin-seat --role qc_panel` (RED at base); the same roster
  with `override_admitted_seats: ['qc_panel[1]']` proceeds to the claim (preservation of the happy
  path); a roster with `qc_panel_seats_complete: false` and an unadmitted seat is still refused before
  the claim (RED).

## 3. Out of scope (do not touch)

Passing scope/identity files from the managed rail (§0 fact 1 — separate row); codex-cli/codex
runner canonicalisation; `dispatch-contract.js` / `resolve-dispatch-topology.js --resolve-live`
(single-seat roles only); the pin store file format; any change to `UNQUALIFIED_RUNNERS` refusal
semantics; strike/revocation writers; `terminalPanelCrossFamilySatisfied`.

## 4. Acceptance

- `bash hooks/tests/engine-capability-pin.test.sh`, `resolve-review-loop-standing-pin.test.sh`,
  `resolve-review-loop.test.sh`, `qc-panel-honesty.test.sh`, `implementation-campaign-state.test.sh`,
  `implementation-campaign-routing.test.sh`, `dispatch-contract-pin.test.sh`, `resolve-live-tuple.test.sh`,
  `dispatch-hetero-contract.test.sh` PASS (run one at a time); `autopilot-engine.test.sh` shows no NEW
  red beyond the 10 known live-marker cases (BACKLOG row).
- `node scripts/check-js-syntax.js`, `bash scripts/sync-codex-plugin-skills.sh --check`,
  `node scripts/check-reference-sizes.js`, `node scripts/check-claude-md-inventory.js` clean.
- Every change-pinning assertion has a recorded red against the base sha; preservation guards are
  labelled as such in the test file.
- **Sealed output surface** (`output_paths`, verbatim; mirrors listed for every `scripts/**`,
  `src/**`, `references/**` file): `scripts/engine-capability-state.js`,
  `platforms/codex/plugin/scripts/engine-capability-state.js`, `scripts/resolve-review-loop.sh`,
  `platforms/codex/plugin/scripts/resolve-review-loop.sh`, `src/engine/final-panel-qualification.js`,
  `platforms/codex/plugin/src/engine/final-panel-qualification.js`, `src/engine/autopilot-engine.js`,
  `platforms/codex/plugin/src/engine/autopilot-engine.js`, `src/engine/campaign-intake.js`,
  `platforms/codex/plugin/src/engine/campaign-intake.js`, `references/hetero-dispatch.md`,
  `platforms/codex/plugin/references/hetero-dispatch.md`, `skills/l5/references/hetero-impl-loop.md`,
  `docs/scripts-inventory.md`, `hooks/tests/engine-capability-pin.test.sh`,
  `hooks/tests/resolve-review-loop-standing-pin.test.sh`, `hooks/tests/qc-panel-honesty.test.sh`,
  `hooks/tests/implementation-campaign-state.test.sh`.
- Version: PATCH (new module + behaviour change), CHANGELOG + INDEX by depth-0 at release, not the hand.

## 5. Dogfood proof (depth-0, after merge)

Record two qc pins on this host (GLM-5.2/cc-shim@glm; gpt-5.6-sol/codex@none — both with the
reason "no reviewer evidence reachable on the managed rail; operator-named panel seat, 2026-09-15"),
run `resolve-review-loop.sh --check-scorecard --field override_admitted_seats` and show
`qc_panel[0]`, `qc_panel[1]` present; then the NEXT managed campaign's final panel must show
three `reviewed` seat receipts or a real verdict, not `precondition_failed`.

## 6. Follow-ups filed, not done here

- Managed rail passes `--scorecard-scope-file` / `--scorecard-identity-file` so path (b) has input.
- codex-cli/codex canonicalisation (existing row).

## Review log

- 2026-09-15 plan review G1 (GLM-5.2 architecture seat: CONDITIONAL, one non-blocking R6 finding;
  codex/gpt-5.6-sol operations-skeptic: STOP with four blockers R3/R2/R6/R8). All five accepted and
  folded: pin endpoint carried into the resolver's qc admission (R3); `unpin-seat` selector contract
  frozen (R2); intake test proves both claim adapters uncalled and the null receipt (R6); red/preservation
  relabelling (R8); intake check ungated by completeness (GLM R6). Receipt taken on the reviewed bytes
  (`evidence/2026-09-15-final-panel-pins/plan.as-reviewed-g1.md`, `g1-dispositions.json`).
