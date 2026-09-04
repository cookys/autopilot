# D2-repair-2 ledger

Deliverable: D2-repair-2 — repair the 19 verified (4 Critical) + 1 deferred depth-0 findings from
the generation-1 review of the new hetero-review driver/checker (`docs/projects/_archive/2026-09-04-dev-flow-hetero-loops/ledger/review-core/g1/dispositions.json`).

Foreman branch: `worktree-agent-aef93d16ebb646335` (worktree `agent-aef93d16ebb646335`).
Base: `0701589b8f2dd22523a6dbcfedc749cfae499dd9`. Head: `3a9342d042cbfa9bd3d750a4c287dce3e38519d1`.

Note: the branch history was squashed into one commit after a debug-session incident committed
scratch test-repo fixture files (`file.txt`, `base.txt`, `large.txt`, `normal.txt`) and throwaway
commits into this branch's ancestry (root cause: running ad-hoc copies of `hooks/tests/*.test.sh`
directly instead of only via the real acceptance commands — the cwd/branch context leaked into a
live `git commit` on this worktree's checked-out branch instead of an isolated `mktemp` sandbox).
The final tree was verified byte-identical to the pre-squash state before squashing; nothing was
lost. Recorded here per evidence discipline.

## Cuts

| cut | rung | attempts | status | commit(s) merged |
|---|---|---|---|---|
| C1 (driver) | gemini-3.8-flash-medium | 1 | green | `a02fd472` + foreman test-fixture fix `62311829` |
| C2 (checker) | gemini-3.8-flash-medium → gemini-3.8-flash-high | 3 (2 red, escalated on the 2nd) | green | `22b8b2a1`, `f6766ac7` (retry1, fixture updates), `1b55127e` (retry2, high rung, real `dispositionsPath` ReferenceError fix) |
| C3 (docs/tests) | gemini-3.8-flash-low | 1 (partial red, foreman-completed) | green | `0846e544` + foreman completion `472c80e6` |
| mirror | — | — | green | `bd359ce7` |

All of the above are squashed into `3a9342d0` on the final branch; individual cut branches
(`cut/D2-repair2-C1`, `-C2`, `-C2-retry1`, `-C2-retry2`, `-C3`) remain in the repo for audit.

## Finding id prefix → cut → commit

| finding id prefix | title | cut | disposition scope |
|---|---|---|---|
| `ec8ba780` | untrusted-helper-execution | C1 | full |
| `41cc5686` | fix-verdict-passes-gate | C2 | full |
| `4249df82` | seat-gap-gate-bypass | C1 (record) + C2 (reject) | full |
| `fb472166` | plan-freeze-unbound | C2 | full |
| `83debe7b` | receipt-rederivation-fail-open | C2 | full |
| `c3f22037` | cross-generation-format-drift | C1 (shared module) + C2 (adopts it) | full |
| `c74bdc05` | generation-artifacts-mutable | C1 | accepted with scope (aborted-generation replace kept) |
| `c2ca07fe` | finding-parser-fail-open | C1 | full |
| `22814c72` | review-exclusion-bypass | C1 (allowlist+digest) + C2 (reject outside allowlist) | full |
| `d3b4a27e` | auto-transition-not-expanded | C4 — handed off (D5-integration foreman owns resolver/topology) | accepted with scope |
| `78976dc6` | plan-panel-family-chair | C5 — handed off (D5-integration foreman owns resolver/topology) | accepted with scope (chair stays reviewer-qualified) |
| `4ffd0544` | phase-base-integration | C1 (persist) + C3 (consumers) | full |
| `42864072` | consult-hermetic-test-gap | C3 — attempted, reverted; **open follow-up** | full (not yet delivered) |
| `88084fa9` | hetero-collect-null-verdict-fail-open | C1 | full |
| `97c05534` | findings-json-no-integrity-binding | C1 (record) + C2 (verify) | full |
| `2ab20291` | receipt-chain-not-compared-to-disk | C2 | full |
| `bdfe1fa8` | open-findings-missing-silent-pass | C2 | full |
| `13f01363` | readme-skills-badge-stale | C3 + foreman completion (badge scoped only 2 files; full 30-skills sync needed 6 more) | full |
| `f61e6dec` | changelog-qc-placeholder-shipped | none — accepted by design (replaced at release/QC time, not a code cut) | full |
| `d7921293` | (deferred) alias normalisation in consult picker | none — already a BACKLOG row | deferred |

## Acceptance

| command | result |
|---|---|
| `bash hooks/tests/hetero-review-loop.test.sh` | PASS — 166 assertions |
| `bash hooks/tests/check-phase-review-receipt.test.sh` | PASS — 21 assertions |
| `node scripts/check-js-syntax.js` | PASS — 603 files |
| `bash hooks/tests/dispatch-consult-hermetic.test.sh` | PASS — 9 assertions (baseline; the "real dispatcher" hardening for `42864072` is not in this pass) |
| `bash hooks/tests/skill-count-metadata.test.sh` | PASS — 38 assertions |
| `bash scripts/sync-codex-plugin-skills.sh --check` | PASS (after mirror commit) |
| `node scripts/check-claude-md-inventory.js` | PASS (after wiring `scripts/lib/review-chain-derive.js` into CLAUDE.md + docs/scripts-inventory.md) |

## Files changed (final squashed commit)

`scripts/hetero-review-loop.js`, `scripts/lib/review-chain-derive.js` (new),
`scripts/check-phase-review-receipt.js`, `hooks/tests/hetero-review-loop.test.sh`,
`hooks/tests/check-phase-review-receipt.test.sh`, `skills/dev-flow/SKILL.md`,
`skills/dev-flow/references/hetero-loops.md`, `README.md`, `README.zh-TW.md`, `AGENTS.md`,
`CLAUDE.md`, `docs/architecture.md`, `docs/skills.md`, `docs/assets/hero.svg`,
`docs/scripts-inventory.md`, mirrored `platforms/codex/plugin/**` equivalents.

## Open issues

1. `42864072` (consult-hermetic-test-gap): `dispatch-consult-hermetic.test.sh`'s new PATH-shimmed
   real-dispatcher assertions all fail — `scripts/dispatch-consult.sh` exits 2 (`consult_dispatch`
   resolved `off`) against the fake-bin shim used by cut C3's attempt. Root cause not yet
   diagnosed past that exit code; needs a follow-up dispatch to trace the resolver/env-forwarding
   path between the test's `REVIEW_LOOP_CONFIG_OVERRIDE`/`AUTOPILOT_TOPOLOGY_FILE` env vars and
   what `dispatch-consult.sh` actually passes to `resolve-review-loop.sh`.
2. C4/C5 (resolver `hetero_review` native-fallback overwrite, schema-invalid topology fallback,
   scorecard-row topology family) handed off — owned by the parallel D5-integration foreman, which
   per its own ledger has already landed a skill-count-30 cluster and auto-seat resolver fixes on
   `feat/dev-flow-hetero-loops` (pass 2, `59b380c2`/`fc38e0f1`). Not merged into this branch;
   integration should reconcile there, not here.

## bash_calls_used

Foreman-reported estimate: at or near the posture's 40-call cap by the end of this deliverable
(includes the debug/recovery work for the history-contamination incident above).

## handoff

None — deliverable closed with the open issues listed above. Depth-0 / the D2 repair coordinator
should pick up finding `42864072` as a fresh follow-up cut, and confirm C4/C5 land via the
D5-integration foreman's own track rather than re-dispatching them here.
