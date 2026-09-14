# Killed/dead managed campaign stuck at IMPLEMENTING with a held lease has no operator remedy

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14

- **Trigger**: already fired three times 2026-08-29/30 (campaigns `3b6a9770…`, `d240ef14…`, `e9bcae52…`): leaf died (wall cap / host kill / acceptance failure before terminal journal), journal holds `live_lease`, `--resume` refuses with `campaign_state_lease_open` (`src/engine/campaign-intake.js:780`), `IMPLEMENTING` is not a resumable phase, and the Mission claim stays live forever (three such claims now sit in the registry).
- **Context**: add a bounded, evidence-gated terminalization for a campaign whose leaf run is provably dead (leaf manifest ended, pid gone, worktree reaped) that appends `MUTATION_FAILED` with the live lease identity and releases the Mission claim; never a silent no-op.
- **Effort**: S–M
- **Source**: l6-verdict-stability-p1 campaigns 2/3 + salvage, 2026-08-29/30.
- **Status**: shipped in U1 (branch `u1-terminalize-withdraw-20260831`) — `node bin/autopilot.js campaign terminalize --campaign-id <id> --leaf-manifest <file> [--ledger <file>]`.

