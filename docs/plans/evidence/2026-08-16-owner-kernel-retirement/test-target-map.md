# Test-to-target map (plan P1 step 4) — decided 2026-08-16

Rule (§2.5): a test is deleted or rewritten only per this map; unmapped references are stop-and-review.
Raw mechanical reference scan: `test-target-map-raw.json` (47 hits) + 3 `owner-kernel-p0-*` tests whose
subject is the `docs/projects/2026-07-20-owner-kernel-governance/p0/` fixture tree (archived in P3).

## delete — subject is retired machinery (44 files)

- `owner-kernel-{acceptance,adversarial,alias-retirement,cli,installed-dogfood,production-corpus,release-gates,terminal}.test.sh`, `owner-kernel.test.sh` — kernel core / CLI / release gates. `owner-kernel.test.sh`'s incidental `resolveGovernancePolicy` coverage survives via the retained/rewritten tests below (G2 grok R7 evidence).
- `owner-kernel-p0-{evidence-manifest,execution-witness,receipt-root,supervised-profile,three-task-spike}.test.sh` — subject is the P0 probe harness under the project tree archived in P3; `p0-supervised-profile` additionally loses its CI bwrap prerequisites in the same commit.
- all 26 `supervised-*.test.sh` — subject modules deleted. Note: `supervised-engine-bridge-contract.test.sh` covers `AUTOPILOT_ENGINE_CONTROL_SINKS`; after the P2 inline, add a minimal constant-shape assertion to the engine CLI test if no coverage remains.
- `shadow-terminal-observer.test.sh`, `divergence-monitor.test.sh`, `check-retirement-receipts.test.sh`, `host-witness-adapter.test.sh` — subject scripts/adapters deleted.

## retire-with-wiring (1)

- `status-task-shadow-wiring.test.sh` — asserts `status task` writes the divergence store; retired in the SAME P2 commit that unwires `src/status/cli.js` (G2 grok R7).

## retain — thin barrel keeps them resolving; verify keeper-only symbols at P2 (4)

- `execution-profile.test.sh`, `profile-context-isolation.test.sh` — keeper `execution-profile.js` coverage; strip any `scripts/owner-kernel.js` CLI invocation lines.
- `mission-policy-graph.test.sh` — requires the barrel + keeper `mission-policy`; passes if it destructures keepers only, else rewrite the offending assertions.
- `level-governance-translation.test.sh` — keeper `policy.js` (`resolveGovernancePolicy`) coverage; strip CLI invocation lines.

## rewrite — extract keeper coverage, drop kernel-machine assertions (2)

- `owner-action-hardening.test.sh` — requires `owner-kernel/events` (deleted) + barrel; keeper `actions.js` assertions must survive in a rewritten test or move into a retained one.
- `owner-action-reconciliation.test.sh` — remaining `resolveGovernancePolicy`/actions coverage per G2 grok R7; same treatment.

## Execution note

At P2, before deleting each file, confirm its map row matches its actual requires (mechanical re-grep);
any mismatch is stop-and-review, not delete.
