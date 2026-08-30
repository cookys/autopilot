# Execution log — qualification verdict stability

> Execution records live here, NOT in the plan file: the Mission sources manifest content-binds the plan, so any edit to the plan drifts the sealed lineage digest (learned 2026-08-30).

### Phase 1 execution record — D0 + D1 + D2 + D3 merged (2026-08-30, depth-0)

- **Base (D0)**: `5402cbd5` (plan/lineage commits on top; develop at merge = `500703b1`). Merged head: `6a3620a1`
  (`1d91a6f4` grok-4.5 implementation = cherry-pick of campaign attempt-3 `367d41c7`; `365ee37c` and `6a3620a1`
  reviewer-driven repairs, Claude sonnet worker). Sealed graders byte-identical to `origin/develop`
  (consult `7852cf33…`, discuss `39b5ba15…`); `git diff --stat 500703b1..6a3620a1 -- evals/` empty.
- **D1 store operation (executed 2026-08-30 from `365ee37c`)**: backups
  `scorecard.jsonl.bak-verdict-redesign-2026-08-30` sha256 `f4229f141729434d59b98e83e9f77db7359e2e0e526006b1aeffbe40443a4371`,
  `qualification-evidence.jsonl.bak-verdict-redesign-2026-08-30` sha256 `1ab8bd3cf3d861934aeeef90a618b09550ca5e23e018c74fef0f9e02c61a7ee2`
  (each byte-identical to the live file at backup time); nine `record_kind:"supersession"` markers appended for
  events 157–165 (`--reason superseded-pending-verdict-redesign`), dangling-id negative control rejected, prior
  39 lines byte-identical after append (48 lines total). Reader honoring is D5 (seat-status for event 165 still
  reports the old baseline, as expected).
- **Depth-0 qc panel (authoritative, `union-on-verified-critical`)** on `500703b1..1d91a6f4`: MiniMax-M3
  SHIP-AS-IS (no findings; diff-only limitation on record); GLM-5.2 FIX-THEN-SHIP — 🟠 non-JSON consult reason lost
  to STEP-3 default-deny (**verified**, fixed `365ee37c`); gpt-5.6-sol@max FIX-THEN-SHIP — 🟠 same null-reason
  defect (fixed), 🟠 `findJsonObjectSpans` retry-from-next-brace mislabels a truncated outer object as
  `multiple_json_objects` + quadratic worst case (**verified**, fixed `6a3620a1`), 🔴 "STEP-1 not recursive / C5
  bypass / consult accepts lure ids" — **downgraded to 🟡 hardening after verification**: C5 exemption is the
  seam's and this plan's own definition (authority smuggle = outside a C5 refusal; non-refusal in C5 is
  `authority_violation` via STEP-2), consult bundles carry no lures, discuss grader itself resolves lure ids
  (`discuss-eval-grader.js:216-219`), nested fake `artifact_ref` in an undeclared key is a Tier-2 shape breach
  per this plan's table; 🟠 sweep expectations derived from production maps + mutation controls assert
  classifier only — **deferred to D4/D6** (the independent exact oracle is D6's deliverable; the blind
  Qwen-authored `qualification-tier-mapping.test.sh` exists at sha256 `c01b1be6…` and enters the tree with D6
  after its five harness-side expectation errors are corrected: caseSpec shape `bundle.artifacts`, multi-signal
  order, bound semantics); 🟠 D1 operational receipt — satisfied above.
- **Independent blind harness (Qwen3.8-Max-Preview@qoderclicn, raw-artifact rail)**: 7/11 bash assertions,
  five node-level reds all adjudicated harness-side (see above); `PLANTED-OK` on both planted negatives.
- **Governed-rail deviation (recorded, not hidden)**: the Mission-managed `engine implement-review` rail could
  not close this campaign — four defects filed in `docs/BACKLOG.md` (BOUNDARY_REJECTED lease fence; L6 has no
  strict readiness bootstrap, session marker run as `l5`; stuck IMPLEMENTING campaigns cannot be
  resumed/terminalized; `hooks/tests/run.sh` red on `develop` makes the sealed `verify_cmd` unsatisfiable) plus
  the VA-rail false-green and the missing `mission withdraw`. Merge authority therefore rests on the depth-0 qc
  panel + independent re-execution above, per ADR-0001 (verification is independent re-derivation); no
  `status task` `can_merge` receipt exists for this lineage. Mission lineage `420ac261…` remains prepared with
  campaigns 2–8 unspent; lineage `83828e5e…` (attempt-3 claim) is inert residue.
- **Semver**: no bump at phase 1 (release is D8).

### Rail-fix unit — merged (2026-08-30, depth-0, /l4-shaped Claude workers)

- **Why**: the Mission-managed campaign rail could not close phase 1 (see BACKLOG 2026-08-30 rows). User ruled `fix-rail then cont`.
- **Landed** (integration branch `fix/rail-2026-08-30`, 13 commits, all fast-forward): controller lease fence — the five lease-bound
  campaign events now resolve identity through one `resolveCampaignEventLeaseIdentity()` and the controller writes the journal
  before advancing durable phase (`35cda9ff`); strict provider-readiness bootstrap compiles for `l6` as well as `l5` with a
  cross-level replay rejection (`8dbc8f51`); `validate-json-schema` rejects unsafe-magnitude integers again while keeping
  lossless non-integers (`4862b0d7`); `hooks/tests/run.sh` per-suite timeout with a distinct `[TIMEOUT]` marker (`065078cc`);
  five test-side repairs whose root causes were roster rotation `83d993a5`, mirror manifest `cbef7e52`, and live-state coupling
  (`41f549b6`, `c8436861`, `25041c0a`, `b1db4465`, `13f01913`, `f3fa6f16`). Triage (read-only debugger) attributed **none** of the
  reds to the D1–D3 commits.
- **Verification**: `bash hooks/tests/run.sh --parallel 4` on the integration head → **ALL TESTS PASSED (301 test files)**, zero
  `[TIMEOUT]`; each fix branch independently re-executed by depth-0 before integration; `sync-codex-plugin-skills.sh --check`,
  `validate.sh`, `check-canonical-invariants.sh`, `git diff --check` green.
- **qc panel** (`union-on-verified-critical`) on the combined diff: MiniMax-M3 SHIP-AS-IS; GLM-5.2 SHIP-AS-IS (5 🔵 follow-ups);
  gpt-5.6-sol@max FIX-THEN-SHIP — 🟠 "bridge reads a stale `initial_state`" **downgraded after verification** (every journal append
  refreshes it, `autopilot-engine.js:~4557`; filed as a naming/e2e follow-up), 🟠 rollover scratch-clone identity mixing
  **fixed** (`f3fa6f16`: identity rebound to the clone's common dir, disposition re-derived through `mission-terminal-reconcile.js`).
- **Also learned**: the Mission sources manifest content-binds the plan file — execution records live here, never in the plan
  (`821f2b45`); the git stash stack is shared across worktrees (two workers collided; recovered, no loss) — workers are told never
  to stash.
- **Not done here**: dead-campaign terminalization (BACKLOG); PATCH release (folded into D8 or a separate release commit).

### Phase 2 start — operator release of the dead attempt-1 claim (2026-08-30, depth-0)
- `mission grant` replayed attempt 1 (open `active_claim_id` from the salvage campaign `e9bcae52…`, whose leaf ran but produced
  no accepted mutation). No CLI release exists; depth-0 backed up
  `.git/autopilot/mission/states/420ac261….json` to `/tmp/autopilot-dispatch-runs/mission-state-420ac261.bak.json`, then applied
  a `no_effect_release` event through `reduceMissionState` (the reducer's own "failed attempt, budget freed, attempt count
  retained" semantics) and wrote the reduced state atomically. Result: node `pending`, attempts 1, campaigns axis freed.
  Attempt 2 granted: claim `fdcc6c30…`, branch `…-a2`, base `a645d818`. Filed as two BACKLOG rows (grant replay is a false
  green; no operator release path).
