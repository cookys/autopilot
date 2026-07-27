---
name: l5
description: >
  Terse CEO front-door — Level 5: like /l4 (background worktree-isolated foreman, depth-0 control
  loop + authoritative qc) but the IMPLEMENTER is orchestrated by the engine CLI and dispatched
  through the canonical `engine implement-review` path. Use when: "/l5 <goal>", "L5 <goal>", you want cost-arbitrage
  or a decorrelated second engine doing the mechanical impl. Presets involvement=just-results,
  scope=Hold, project red lines plus -x additions (override --mode / --expand / --solo). Not for: all-Claude run (→ /l4), inline
  (→ /l3).
---

# /l5 — CEO autonomy, foreman + hetero implementer

Terse front-door into `autopilot:ceo-agent` at **Level 5**: identical to `/l4`
except the IMPLEMENTER is a heterogeneous engine driven through the canonical
`engine implement-review --campaign-contract <campaign.json>` path
(`bin/autopilot.js` → campaign controller → `dispatch-hetero.sh`).

Hard rules:
- At entry run `node <plugin>/scripts/session-mode.js set --level l5` (`--solo` ⇒
  `set --level l3`) — arms the orchestrator-edit-gate + context-budget hooks
  (level-front-door § "Session-mode marker").
- The roster from [`../../scripts/resolve-review-loop.sh`](../../scripts/resolve-review-loop.sh)
  is the ONLY source of truth — never hardcode model/runner/effort inline.
- Implementation dispatch uses an **immutable base SHA**; verification is by **git
  artifacts** (commit/diff/cleanliness), never agent self-report.
- **Context-window gate (v2.32.58)**: every rail sizes the payload against the target
  engine's window before spending; over budget ⇒ `precondition_failed` with no runner and
  no worktree. Split the unit or pick a larger-window engine — `--context-window warn|off`
  overrides deliberately. Contract: [`references/hetero-dispatch.md`](../../references/hetero-dispatch.md) § Context-window gate.
- **One mutating entry**: depth-0 freezes the campaign contract, then invokes
  `node bin/autopilot.js engine implement-review --campaign-contract <campaign.json> ...`.
  Campaign identity automatically enables the durable ledger and detached lifecycle. Direct
  `scripts/dispatch-hetero.sh` invocation is controller-internal or diagnostic only, never an
  equivalent L5 workflow. Contract or caller disagreement is rejected pre-spend; a new scope
  requires a new contract hash.
- **Bounded leaf lifecycle**: every managed leaf inherits the campaign's stable
  `root_run_id`, which the canonical campaign controller derives from the
  sealed `campaign_id` and injects on every initial, repair, and resumed
  implementation dispatch as `AUTOPILOT_WORKTREE_ROOT_RUN_ID`. This resource
  identity is separate from `AUTOPILOT_ROOT_RUN_ID`, which remains the
  foreman/watcher trace root. Managed dispatch depth is normalized to at least
  `1`, so an inherited zero/malformed depth cannot bypass occupancy admission.
  Never substitute a foreman/stage/leaf run id or an ambient checkout path.
  `max_leaf_worktrees_per_root` is a hard occupancy cap (default `4`), so a
  retained outcome must be inspected and dispositioned immediately rather than
  left until session end. Use `reap-dispatch-worktrees.sh` first, pass its exact
  inventory to `reap-dispatch-branches.sh`, then issue and freshness-check one
  `LifecycleResidueReceipt`. Freshness is not absence: require its
  `zero_residue` field to be exactly `true`; `false` is a resource blocker.
  This rail proves resource disposition only and never computes task
  `can_close`, generation advance, or finish authority.
- **Terminal status gate**: run `autopilot status task --root-run-id <campaign-root> --json`
  before merge, after merge, and before marker clear. Finish-flow may clear an L5 marker only with
  that final fresh, digest-valid receipt and `can_close=true`; lifecycle `zero_residue=true` alone
  is not task completion.
- Review is DECORRELATED: the reviewer is a different engine family than the implementer.
- `--solo` → the `/l3` inline engine (also the degradation on `precondition_failed`).

**Capability profile (shadow):** `/l5` fixes heterogeneous-implementer topology only. When the host
supplies a current verified envelope/grant/profile payload, forward it unchanged; never infer
guidance density from the level, runner, or model name. A late mismatch requires a fresh-session
handoff.
The canonical `profile-session.js` lane proves only no-effect context isolation. Existing
heterogeneous rails remain guided until their exact adapter is independently witnessed enforcing
the grant, tools, effects, identity, and terminal outcome.

**MUST-READ**: [`references/hetero-impl-loop.md`](references/hetero-impl-loop.md)
(this level's loop: roster fields, harness/telemetry, wired runners) and
[`../ceo-agent/references/level-front-door.md`](../ceo-agent/references/level-front-door.md)
(§ Heterogeneous engine loop details — diff scopes, loop governance).
