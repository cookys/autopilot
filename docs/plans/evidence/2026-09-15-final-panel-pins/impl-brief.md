Implement docs/plans/2026-09-15-final-panel-per-seat-pins.md (read it first: §1 ruling/shape, §2 changes by file, §2.6 tests, §3 out of scope). You edit files only; the harness commits. No version bump, no CHANGELOG edit, no `git stash`, no push.

Every path you create or modify MUST be one of these (the contract's output_paths; anything else rejects the round):
scripts/engine-capability-state.js
platforms/codex/plugin/scripts/engine-capability-state.js
scripts/resolve-review-loop.sh
platforms/codex/plugin/scripts/resolve-review-loop.sh
src/engine/final-panel-qualification.js            (NEW)
platforms/codex/plugin/src/engine/final-panel-qualification.js   (NEW, via sync)
src/engine/autopilot-engine.js
platforms/codex/plugin/src/engine/autopilot-engine.js
src/engine/campaign-intake.js
platforms/codex/plugin/src/engine/campaign-intake.js
references/hetero-dispatch.md
platforms/codex/plugin/references/hetero-dispatch.md
skills/l5/references/hetero-impl-loop.md
docs/scripts-inventory.md
hooks/tests/engine-capability-pin.test.sh
hooks/tests/resolve-review-loop-standing-pin.test.sh
hooks/tests/qc-panel-honesty.test.sh
hooks/tests/implementation-campaign-state.test.sh

Mirrors: never hand-edit platforms/codex/plugin/**; run `bash scripts/sync-codex-plugin-skills.sh` after editing scripts/**, src/** or references/**.

## A. scripts/engine-capability-state.js (pin store, ~line 944)
- `pinSeat`: replacement key = `role` for every role except `qc_panel`; for `qc_panel` the key is role+engine+runner+endpoint (endpoint compared after `normalizePinEndpoint`, null ≡ `@none`). Row shape unchanged (eight keys, `expires: null`).
- `unpinSeat(config, role, selector)`: `selector` optional; when given, `engine` and `runner` are both required and `endpoint` defaults to null (omitted ≡ `@none`); it removes exactly the matching qc row and returns `{role, removed}`. Without a selector on `qc_panel` remove all qc rows. Any selector on a non-`qc_panel` role throws `unpin-seat: --engine/--runner/--endpoint apply to --role qc_panel only`. CLI `unpin-seat` accepts `--engine --runner --endpoint` (add them to the allowed-flag set near line 1856); usage text (line ~45-46, ~82) updated.
- `pins --role qc_panel` returns every qc row (no change needed once the store holds them).

## B. scripts/resolve-review-loop.sh (roster gate, ~2053-2338)
- `_add_seat` gains a 5th field: endpoint. Only the qc seats populate it (`_add_seat "qc_panel[$_i]" … "${QC_PANEL_ENDPOINTS[$_i]:-}"` near line 2108); `@none`/empty normalise to null for comparison.
- In the admission loop (~2222): the `else` branch becomes `_is_unqualified_runner "$_run" || [[ "$_role" == qc_panel\[*\] ]] || continue`.
- The standing-pin `rows.find` (~2300): for `qc_panel` seats ALSO require `normEndpoint(o.endpoint) === normEndpoint(seatEndpoint)`; single-seat roles keep engine+runner+role. The override-file match is unchanged (no endpoint in its schema).
- When a `qc_panel[N]` seat has NO override/pin: `echo "resolve-review-loop: ⚠ ${_role} seat (${_eng}/${_run}) has no recorded operator admission — the managed rail's final panel will refuse it at intake" >&2; continue` — do NOT exit 3. The existing `UNQUALIFIED_RUNNERS` refusal is unchanged.
- The recorded role string in `override_admitted_seats` is `$_role` verbatim (`qc_panel[2]`) — it already is; keep it.

## C. src/engine/final-panel-qualification.js (new) + src/engine/autopilot-engine.js
- Move `finalPanelSeatQualified` (autopilot-engine.js:1135-1155) verbatim into the new module as `finalPanelSeatQualified(roster, seat, index)`; add path (c): `Array.isArray(roster.override_admitted_seats) && Number.isInteger(index) && roster.override_admitted_seats.includes(\`qc_panel[${index}]\`)` → true. `qc_panel` alone, a different index, or an absent key admits nothing by this path. Engine `require`s it and keeps exporting `finalPanelSeatQualified` (line ~9905 — the existing test imports it from the engine module). `performFinalPanel` (~5055-5065) passes `index` to both calls.
- `validateReviewRoster(…, {requireTerminalPanel:true})`: if `override_admitted_seats` is present it must be an array of strings (TypeError otherwise); absent is allowed.

## D. src/engine/campaign-intake.js (runCampaignIntake, right after the `campaign_ledger_path_mismatch` block ~1355)
- If `Array.isArray(input.roster?.qc_panel_seats) && input.roster.qc_panel_seats.length > 0`: evaluate every seat with the shared function (`require('./final-panel-qualification')`). Collect failures. If any: `const rejection = rejected('campaign_generation','final_panel_seat_unqualified', msg)`; return `{status:'blocked', reason: rejection.reason, rejection, steps:[rejection], pre_spend_no_effect_receipt:null}` BEFORE any claim adapter runs. `msg` names each failing seat as `qc_panel[i] <model>/<runner>@<endpoint|@none>` and the remedies verbatim: `record a standing pin: node scripts/engine-capability-state.js pin-seat --role qc_panel --engine <model> --runner <runner> --effort <effort> --endpoint <endpoint|@none> --reason <text> --operator <who>; or replace the seat with one carrying reviewer evidence`. No completeness/min_panel_size gate.

## E. Docs
- references/hetero-dispatch.md: in the section describing `qc_panel` / the terminal panel, add ≤ 600 B (record `wc -c` before/after in your final note): the three admission paths (incumbent, exact ladder tuple, recorded `qc_panel[N]` admission), the `pin-seat --role qc_panel` command, and that campaign intake refuses an unadmitted seat before any spend.
- skills/l5/references/hetero-impl-loop.md: one bullet before step 7 (`mission prepare`): run `bash scripts/resolve-review-loop.sh --check-scorecard --field override_admitted_seats` (and read the stderr ⚠ notes) — every `qc_panel[N]` without evidence must be pinned first, else intake refuses with `final_panel_seat_unqualified`.
- docs/scripts-inventory.md: `engine-capability-state.js` row — mention `qc_panel` multi-pin (engine+runner+endpoint) and selector unpin. Keep it an index row.

## F. Tests (base sha 80377e7f). Use each suite's existing helpers. For every CHANGE-PINNING assertion run it once BEFORE editing the code and paste the FAIL line into the test file's header comment as `# RED at base 80377e7f: …`; label preservation guards `# preservation guard (green at base)`.
- engine-capability-pin.test.sh (isolated `--store` under $TEST_TMP — NEVER the host store): (10) two `pin-seat --role qc_panel` different engines → two rows [RED]; (11) same engine+runner+endpoint twice → one row, second reason [preservation]; (12) same engine+runner at `--endpoint glm` and at `@none` → two rows [RED]; (13) `unpin-seat --role qc_panel --engine A --runner R --endpoint glm` removes exactly that row, `removed: 1`, the `@none` row and the other engine survive [RED]; (13b) same without `--endpoint` removes exactly the null-endpoint row, the `glm` row survives [RED]; (14) `unpin-seat --role qc_panel` no selector, 3 rows → `removed: 3` [RED]; (15) `unpin-seat --role implementer --engine x --runner y` exits non-zero and stderr contains `apply to --role qc_panel only` [RED]; case 4 stays [preservation].
- resolve-review-loop-standing-pin.test.sh (isolated `--store`; copy how the file already builds its config fixture): 3-seat qc panel config, pins for seats 0 and 2 (matching endpoints) → `--field override_admitted_seats` contains exactly `qc_panel[0]` and `qc_panel[2]`, exit 0 [RED]; the unpinned seat 1 produces the stderr ⚠ note and exit stays 0 [preservation]; a pin for seat 1's engine+runner at a DIFFERENT endpoint does not add `qc_panel[1]` [preservation]; supplementary mutant note: dropping the endpoint compare would admit it.
- qc-panel-honesty.test.sh: `finalPanelSeatQualified(roster, seat, 1)` true with `override_admitted_seats: ['qc_panel[1]']` [RED]; false with `['qc_panel']`, with `['qc_panel[0]']`, and with the key absent [preservation ×3].
- implementation-campaign-state.test.sh (copy the existing `runCampaignIntake` fixtures in that file): roster with `qc_panel_seats[1]` neither incumbent, ladder, nor admitted → `status === 'blocked'`, `rejection.code === 'final_panel_seat_unqualified'`, `pre_spend_no_effect_receipt === null`, `steps` deep-equals `[rejection]`, message contains `qc_panel[1]` and `pin-seat --role qc_panel`, and TWO spies — `adapters.missionClaim` and `adapters.claimGeneration` — each called 0 times [RED]; same roster with `override_admitted_seats: ['qc_panel[1]']` reaches the claim adapter (spy count ≥ 1) [preservation]; roster with `qc_panel_seats_complete: false` and an unadmitted seat is still refused pre-claim [RED].

## Verification you must leave green (one suite at a time)
bash hooks/tests/engine-capability-pin.test.sh; bash hooks/tests/resolve-review-loop-standing-pin.test.sh; bash hooks/tests/resolve-review-loop.test.sh; bash hooks/tests/qc-panel-honesty.test.sh; bash hooks/tests/implementation-campaign-state.test.sh; bash hooks/tests/implementation-campaign-routing.test.sh; bash hooks/tests/dispatch-contract-pin.test.sh; bash hooks/tests/resolve-live-tuple.test.sh; node scripts/check-js-syntax.js; bash scripts/sync-codex-plugin-skills.sh --check; node scripts/check-reference-sizes.js; node scripts/check-claude-md-inventory.js.
`autopilot-engine.test.sh` has 10 known reds on this host (live l5 marker) — no NEW red allowed there.

Final note (stdout, not a file): every red you recorded with the base sha, the `wc -c` of hetero-dispatch.md before/after, the exact commands you ran green.
