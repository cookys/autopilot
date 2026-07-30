# Controller Execution Discipline — external review findings (depth-0 independent audit)

- **Candidate under review**: branch `mission/aaa7a2f77e9e/controller-execution-discipline-a2`,
  HEAD `53aa0810c39e6d1cff17d4d45259efc992aae0e5` (53 files vs frozen base; 81 files / +27.5k vs `develop` incl. generated Codex mirrors).
- **Review provenance**: 8 parallel read-only audit agents (7× claude-sonnet-5, 1× claude-haiku-4.5) fanned out by a depth-0 Claude session on 2026-07-30/31, each with a disjoint file scope and an explicit "verify every claim by re-reading the code path before reporting" contract. Key contested claims were re-verified by depth-0 (grep/bash repro) before this document was written. No file in the candidate worktree was modified; no test was executed against it.
- **How to consume**: 🔴 items are review findings on THIS candidate — they belong in the current campaign's repair round (must-fix before merge), not in BACKLOG. 🟠/🟡/🔵 items are candidates for `scripts/admit-backlog-follow-ups.js` after the campaign's own joint review completes. Line numbers refer to the candidate worktree at the HEAD above.
- **Overall verdict**: architecture is sound, the storage/CAS layer and the new test suites are genuinely strong (see "Confirmed solid"), but four Criticals land exactly on the feature's core promise — "do not trust controller/rail self-report" — and one of them is a hard crash on a normal path of a new feature.

---

## 🔴 Critical — must-fix in current campaign

### C1. `dispatch-hetero.sh:3068` — guaranteed `unbound variable` crash in sealed zero-diff postcheck

`WORKTREE_CWD="${WORKTREE_CWD:-$REPO}"` — `$REPO` is never assigned anywhere in the script (verified by grep: zero assignments, 2 usages) and `WORKTREE_CWD` is never set by any caller. Under `set -uo pipefail` the expansion aborts the process with exit 127; the trailing `|| true` cannot rescue it because the failure happens during word expansion, before command execution (repro'd in isolated bash).

**Trigger (normal path)**: contract declares `output.required_change_paths` + candidate commits with an empty file-level diff + no ambient `STRICT_NOOP_RECEIPT_PATH`. The entire "validate sealed zero_diff_receipt at postcheck" capability is non-functional and dies mid-`run_strict_contract_postchecks`, after worktree/branch effects exist, outside the clean fail path.

Sibling latent typo at `:3318` (`${WT:-$REPO}`) — accidentally non-triggering today because `$WT` is always set there; same fix (use the real variable, e.g. `CONSUMING_REPO_ROOT`).

**Test gap that hid this**: `dispatch-hetero.test.sh:949-971` asserts the `CAMPAIGN_STRICT_AUTHORITY` sealed-output-surface behavior only by string-grepping the script source, never by dispatching a real out-of-scope/empty-diff mutation. Add a behavioral test — it catches C1 immediately.

### C2. `work-order.js` — `stale_dispositioned` side door defeats the no-re-dispatch gate

`updateWorkOrderLifecycle` / `createOrUpdateWorkOrder` accept a `disposition: 'stale_dispositioned'` (or `'consumed'`) patch with (a) no owner-liveness re-check and (b) `disposition_receipt` validated only **if present** — attaching one is optional (`validateStoredWorkOrderIntegrity` checks it only via `hasOwnProperty`). `classifyWorkOrder` (~:1263) then short-circuits on the stored disposition before any PID/ledger/worktree check, and `validateReconcileReceipt`'s re-derivation hits the same shortcut.

**Scenario**: original implementer alive and mid-repair; controller issues an ordinary lifecycle patch marking the WO stale (only needs the CAS token/generation readable from the same file). `listNonterminalWorkOrders` empties; `claimDispatchCas` admits a fresh dispatch/worktree/branch — exactly the requirement-(3) scenario, unlocked by one legal API call, no forgery needed.

**Fix direction**: terminal/stale disposition patches must require a mandatory, validated disposition receipt AND a fresh liveness/worktree re-derivation at write time (same rigor `validateControllerRecoveryAuthority` already applies on the recovery path).

### C3. Budget/no-op accounting pipeline broken in BOTH directions (P0 requirement 7 + no-effect refund requirement)

Free-ride direction — rail self-report is trusted with no evidence cross-check:
- `campaign-composition.js:1021` — `dispatcher_called !== false` is the only charge gate; nothing asserts `dispatcher_called === false` implies no `commit`/`candidate_ref`/`resource_inventory_delta`. A receipt can claim "no dispatch" while delivering a real candidate; recorded free, repeatable.
- `controller-execution.js:347-374` — `applyBudgetUsage` accepts negative deltas on cumulative axes (`{model_calls: -32}` refunds silently; delta provenance IS the rail receipt via `mutation.model_calls`, verified at `campaign-composition.js:1026-1029`), and the `owned_worktrees_absolute` / `owned_worktrees_is_absolute` path direct-SETs the high-water axis with no `Math.max` floor (can regress 4 → 0 and mint fresh headroom).

Inert direction — the legitimate no-op exemption never reaches the budget layer:
- `dispatch-hetero.sh:3412` sets `OUTCOME_DISPATCHER_CALLED=0` — dead variable, never read; the generic `emit()` JSON template has no `dispatcher_called` key.
- `autopilot-engine.js` never reads `parsed.dispatcher_called` (zero hits); the generic non-committed return at ~:3719 hardcodes `dispatcher_called: true`; `_runManagedCampaignComposition`'s implement callback (~:5965) drops the field entirely → `undefined` → always charged.
- Net: every honest no-op short-circuit burns `model_calls: 1`, prematurely tripping `awaiting_convergence_adjudication` on campaigns with several legitimate no-ops. The mechanism P0 explicitly required ("no-effect attempts must not burn budget") is end-to-end inert.

**Fix direction**: thread `dispatcher_called` (and `model_calls`) from the rail JSON through `implementTask` → implement callback → composition; validate rail-supplied usage deltas (non-negative cumulative axes, monotonic high-water); cross-check `dispatcher_called === false` against absence of candidate/resource evidence.

### C4. `controller-execution.js:1912` — `admitControllerEffects` never verifies snapshot freshness

The everyday per-effect admission gate reads `controller.dispatch_records` / `resource_inventory` / budget limits from an opaque in-memory argument with no `controllerStateDigest` recompute, no comparison against the persisted WO's `controller_digest`, and no CAS/generation freshness check — in direct contrast to `runPostCompactAdapter` (:2105-2149) which binds the exact `{root,node,attempt,id}` tuple and digest. A one-generation-stale snapshot (classic post-compaction resume hazard) is admitted as authority — the precise failure mode ("stale state is not authority") this project exists to close, unguarded on the hot path.

---

## 🟠 Major — adjudicate; most are repair-round or immediate-follow-up material

1. **Resume checkpoints don't round-trip** (`campaign-composition.js:308-329` vs the three `resumable: true` payloads): `AWAITING_CONVERGENCE` stop lacks `candidate` and `repair_generation`; `BOUNDARY_REJECTED` stop lacks `repair_generation`; `AWAITING_DISPOSITION` emits `repair_generations` (plural) vs the singular the validator requires → feeding any of them back verbatim throws `INVALID_RESUME_CHECKPOINT`. Engine-side reconstruction reads `priorController.repair_generation`, a field never written anywhere (verified) → dead fallback to `initial_state.generation`.
2. **Full-diff barrier not candidate-bound** (`controller-execution.js:604-645`): barrier lookup is generation-keyed only; `candidate_ref` is stored but never re-checked → same-generation candidate swap passes. `recordFullDiffBarrier` also stamps `kind: 'full_diff_review'` unconditionally — a focused receipt forwarded here mints a valid barrier. Call-site ordering is correct today; the module enforces nothing itself.
3. **Review-gate reuse keys omit roster/seat identity** (`campaign-composition.js` ~:1220 full_diff, ~:1856 joint_review): swapping the reviewer roster silently reuses the old roster's verdict for the same candidate/generation.
4. **Orphan adoption never checks leaf liveness** (`controller-execution.js:1307-1420`): proves controller death only; a still-running leaf implementer can keep committing into the adopted worktree → ownership race.
5. **Resource-debt blind spots**: orphan **branches** (worktree removed, ref remains) are structurally absent from the inventory model; a worktree created but never registered (crash between `git worktree add` and CAS write) is invisible forever (`reconstructOwnedInventory:1790-1797` requires a prior byPath hit); a stale `active: true` is never re-derived and sticks forever, silently bypassing receipt verification for that row (`classifyResourceOutcome` active-branch preempts terminal).
6. **Mission graph double-read TOCTOU** (`mission-routing-admission.js:980-999`): admission digest is sealed from read #1; per-node no-op validation consumes an unbound read #2 → a file swap between reads can certify a false whole-mission zero-dispatch.
7. **Schema capacity caps are decorative** (`implementation-campaign-contract.schema.json` vs `implementation-campaign-check.js`): `max_owned_worktrees`(≤64)/`temp_capacity_limit`/`max_prompt_bytes`/`max_finding_recurrence` bounds are never range-checked by the hand-rolled validator; `999999999` passes and is used verbatim as the `admitHighWater` ceiling.
8. **Terminal-status enum unenforced at consumption** (`work-order.js`): `validateTerminalReceipt` accepts any non-empty string; `isTerminalWorkOrder` treats any string as terminal under a consumed/stale/attached disposition — typo'd statuses (`"succeeded"`) pass; `'attached'` disposition is consumed but never produced in-file.
9. **Receipts are content-hashes, not attestations** (whole WO/receipt layer): `sha256Json` self-consistency only; all builders exported. Acceptable under the stated "confused, not malicious controller" threat model — but that boundary should be written down explicitly, because C2/C3 show even the confused-controller story currently leaks.
10. **`classifyMissingDisposition` defaults `findingsIdentityOk = true`** (`controller-execution.js:664`) — fail-open default inconsistent with the file's own fail-closed house style; empty-findings → `ok` with no cross-check.

## 🟡 Minor / 🔵 Suggestion (backlog material)

- `checkJointRepairBudget` equality-at-cap admits with the default `projectedDelta: null` call shape — both production call sites pass `projectedDelta` (verified), so not exploitable today; sharp API edge worth a guard.
- `attachControllerState(wo, {})` silently resets the whole controller state (empty object is truthy).
- Default `preEffectAdmit` no-ops when `gitCwd`/`repo` absent (production passes it; test/future callers get silent bypass).
- `pathContentDigest` follows symlinks while historical outputs hash git blobs — inconsistent byte models for no-op equality.
- `admitExecutableMissionDelta` has no traversal guard of its own (currently mitigated by both callers' normalizers).
- Test-evidence seam (`allowTestCallerEvidence`) skips node-scoped `exactEvidenceBinding` (unreachable in production today).
- `zero_diff_receipt_digest` emitted but consumed by nothing; `OUTCOME_DISPATCHER_CALLED` dead var (part of C3); `mutation_failed`/`unknown_status` hardcoded false; ~90-line sealed zero-diff verification duplicated in 3 places; stray `disposition_receipt` can poison a record into permanent `orphan_blocked`; `PROCESS_TABLE_UNREADABLE` propagates uncaught out of `classifyWorkOrder`; root-scoped nonterminal gate blocks unrelated graph_nodes (friction, fail-closed).

---

## Confirmed solid (traced end-to-end by auditors; do not re-litigate without new evidence)

Root CAS lock hierarchy (no TOCTOU within a root's admission); stale-lock reclaim arbitrated by atomic `open wx`; malformed/legacy JSON never silently absent (fail-closed, `.error` rows count as nonterminal); reconcile-receipt re-derivation re-reads live state under lock; all worktree/mutation checks grounded in real git (never JSON claims); controller ledger append-only verification (monotonic timestamps, digest binding); PID-reuse mitigated via pid+start+pgid+sid; multi-node no-op aggregation correct (1-of-N satisfied ≠ zero-dispatch; 0-node/dup-id/empty-path rejected upstream); no-op proof re-hashes live bytes against admission HEAD; `compaction-rehydrate` never trusts summaries; orphan-adoption CLI booleans never trusted; 6/6 effect sites budget-gated before adapter invocation; full-diff barrier ordering correct at current call sites; gate-reuse keys bind candidate+base SHA+generation+WO+root; failed gates ineligible for reuse; gate invalidation requires explicit reason; frozen-denominator partition check hard-fails on drift; recovery receipts re-derive clean/dirty/unique/terminal from live observation; `checkTempCapacity`/`admitHighWater` fail closed; Codex mirrors byte-identical; status enums in parity across layers; test suites: 5 of 6 files strong (real negative + tamper matrices, production-path fixtures, clean isolation) — the one weak seam is the string-grep noted in C1.
