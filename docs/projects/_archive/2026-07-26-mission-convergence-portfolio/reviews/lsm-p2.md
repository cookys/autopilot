# Seq 17 review — LSM P2 merge-intent preflight

## Result

`READY`

Implementation commit: `727bdf9`

## Minimum shippable version

- Ordered, content-sealed merge intent with exact refs, worktrees, pinned SHAs, `no-ff` /
  `ff-only`, required result, and explicit forbidden reverse edges.
- Read-only preflight inventories staged, unstaged, untracked, and ambiguous target paths; compares
  incoming paths; and emits `safe | overlapping | ambiguous | blocked` plus an exact preservation
  proposal.
- Later edges consuming a ref produced by an earlier edge carry sealed `source_from_edge` /
  `target_from_edge` bindings. Initial SHAs remain P2 observations; P3 revalidates those endpoints
  against predecessor execution receipts.
- Task status accepts only a content-digested safe preflight for `can_merge`; P2 always retains
  `merge_execution_unknown`, so it cannot prove `can_close`.

## Deterministic evidence

- `bash hooks/tests/merge-intent.test.sh` — PASS, 24 assertions.
- `bash hooks/tests/status-task.test.sh` — PASS, including all P2 named cases.
- `node /tmp/lsm-p2-independent-verification.js /home/cookys/projects/autopilot` — PASS.
- JS syntax and both edited schema JSON files — PASS.
- Completeness, error-path, secret, scope, canonical-invariant, skill-validation, and diff checks —
  PASS / zero new findings.
- The real-Git fixture snapshots refs, index/status, worktrees, stashes, and tracked/untracked bytes
  before and after preflight; snapshots are byte-identical.

## Bounded heterogeneous review

### Generation 1

- Qwen3.8-Max-Preview returned parser-valid `SHIP-AS-IS` but did not detect the dependent-edge
  transition.
- GLM-5.2 returned `SHIP-AS-IS` and classified the transition as `CUT/FOLLOW-UP`, claiming
  `no-ff` made it harmless.
- Depth-0 refuted that classification: `safety -> develop` changes the exact `develop` SHA, so a
  later `develop -> peo` edge revalidated only against its initial SHA would fail by construction.
  This was promoted to `MUST-FIX`, with the smallest repair being explicit predecessor-result
  bindings.

### Repair and final generation

- Added sealed `source_from_edge` / `target_from_edge` fields, schema coverage, a TWGame regression
  assertion, and the corresponding P3 consumption rule in the plan.
- GLM-5.2 then raised two `MUST-FIX` claims. Both were refuted with direct evidence:
  1. it predicted the digest-drift status test would fail, but the fresh named test passed and the
     code checks the receipt digest before verdict consistency;
  2. it required the flat independent-oracle adapter to supply an `ambiguous` array, while that
     oracle's frozen interface intentionally defines only staged/unstaged/untracked and production
     canonical preflight still inventories ambiguity.
- Qwen3.8-Max-Preview final review returned parser-valid `SHIP-AS-IS`, `FINDINGS: none`, and a
  structured no-finding proof covering manifest/seal, every fail-closed drift, dirty inventory,
  read-only evidence, predecessor binding, task-status consumption, schemas, and both test suites.

## Cut / follow-up

- Flat oracle and production manifest use intentionally different adapter/input shapes. P3 must
  consume the canonical `{manifest, seal}` production boundary, not the test compatibility facade.
- No backlog admission is required from this phase; neither final review produced an
  evidence-backed out-of-scope improvement with a live trigger.

LSM P3 may begin.
