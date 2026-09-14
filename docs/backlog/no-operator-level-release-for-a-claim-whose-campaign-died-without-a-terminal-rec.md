# No operator-level release for a claim whose campaign died without a terminal receipt (second instance)

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14

- **Trigger**: already fired again 2026-08-30 — depth-0 had to emit `no_effect_release` through the reducer module API (`reduceMissionState`) on the local state file (backup taken) because `mission control` exposes only `finish_requested|abort_requested|scope_frozen|ceiling_adjust` and intake's automatic `pre_spend_no_effect` path is unreachable once a leaf ran.
- **Context**: pairs with the existing "Killed/dead managed campaign stuck at IMPLEMENTING" row: the fix must release BOTH the campaign lease (MUTATION_FAILED with the live lease identity) and the Mission claim, gated on provable leaf death, and be reachable from `mission`/`campaign` CLI without raw state plumbing.
- **Effort**: S–M
- **Source**: phase-2 foreman escalation + depth-0 operator action, 2026-08-30.
- **Status**: shipped in U1 (branch `u1-terminalize-withdraw-20260831`) — `node bin/autopilot.js mission withdraw --state <file> --out <file> --claim-id <id> --campaign-ledger <file>`, refuses `mission_withdraw_campaign_not_terminal` until the bound campaign is terminal.

