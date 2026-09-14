# Plan-loop freeze: dispatcher and checker disagree on disposition shape; terminal artifact carries no dispositions

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14

- **Trigger**: the next plan loop that reaches the generation cap, or any change to `loadDispositionFile` / plan-artifact mode.
- **Context**: `check-phase-review-receipt.js --plan-artifact` requires `disposition` on every artifact finding and `candidate_blocker` on every disposition entry; `dispatch-plan-review.js` writes neither into the terminal artifact and its disposition file has no `candidate_blocker`. Depth-0 bridged with an `adjudicate.js` (applyDispositions + reshaped file) on 2026-09-05. Fix shape: the driver emits `gN.adjudicated.json` when a generation-N disposition file is supplied at the cap, and the checker accepts the driver's disposition shape. Also: post-terminal accept-and-fold always breaks the plan sha; the checker should accept a `--reviewed-plan` copy plus a recorded delta, or the driver should snapshot the reviewed bytes into state.
- **Effort**: Fix
- **Source**: `docs/projects/2026-09-05-statusline-live-context-feed/ledger/plan-review/README.md`

