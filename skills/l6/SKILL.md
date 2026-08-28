---
name: l6
description: >
  Terse CEO front-door — Level 6: like /l5 (worktree-isolated hetero implementer + authoritative
  qc) but the VERIFICATION AUTHORING is also leaf-dispatched to a heterogeneous engine; depth-0 remains
  pure orchestration. Use when: "/l6 <goal>", "L6 <goal>", "全委", "全部派遣", "省 token 全外包",
  "delegate everything incl verification". Presets involvement=just-results, scope=Hold, project red
  lines plus -x additions (override --mode / --expand / --solo). Not for: /l5 when you still want to do verification yourself; /l4
  all-Claude; /l3 inline.
---

# /l6 — CEO autonomy, foreman + full-dispatch verification

Terse front-door into `autopilot:ceo-agent` at **Level 6**: identical to `/l5`
except verification AUTHORING is ALSO leaf-dispatched to a heterogeneous engine;
depth-0 remains pure orchestration.

Hard rules:
- Before any TaskCreate, branch, worktree, runner, or model effect, run
  `node <plugin>/scripts/session-mode.js set --level l6 --repo-root <repo>`. `--solo` uses
  `set --level l3 --entry-level l6 --fallback solo`; a recorded precondition degradation uses
  `--fallback precondition_failed`. The command admits canonical Mission policy/graph/source
  coverage before writing the marker. Topology may change; its admission digest and later
  Mission prepare/grant may not.
- **Delegate the labor, never the trust**: depth-0 still EXECUTES committed
  artifacts, runs the mechanical checks, judges convergence-by-verification, and
  holds merge authority. A dispatched green or reviewer pass is never
  authoritative by itself.
- Verification authoring goes through `dispatch-author.sh` (the raw-prompt rail —
  NOT `dispatch-review.sh`) on a DIFFERENT family than the implementer engine.
- `/l6` strict verification-author dispatch is exactly:
  `scripts/dispatch-author.sh --strict-contract --contract-file <unit.json> --repo-root <consuming-repo> --prompt-file <file>`.
  Depth-0 freezes the unit contract first; the checker
  (`node scripts/dispatch-contract.js check --contract <unit.json> --repo <repo> --json`) must
  return GO before ANY runner spend — a prompt is task detail, not authorization. The
  runner/model derive from the checker's resolved verification-author tuple; caller-supplied
  `--runner`/`--model`/`--timeout` that disagree are precondition-rejected. A GO with
  `assurance: "provisional"` admits only untrusted **raw-artifact** generation labor from an
  exact project-configured provisional verification-author row (`observed_status=qualified`);
  it does **not** grant review, verifier, acceptance, merge, closeout, owner, or finish
  authority. Depth-0 must execute the authored artifact and remains the sole
  verification/merge authority. Consuming-checkout
  mutation is `containment_breach` (exit 4) and the artifact is quarantined, never promoted.
  Repository mutation has one entry:
  `node "$autopilot_root/bin/autopilot.js" engine implement-review --campaign-contract <campaign.json> ...`.
  The controller pins base, scope, budget, ledger identity, post-return boundary, and the
  depth-0-executed acceptance command. Direct `scripts/dispatch-hetero.sh` invocation is for
  controller internals or diagnostics, not an equivalent L6 workflow. While an l5/l6 session
  marker is active, prompt-only write or author dispatch on this repo fails before the runner.
- **Bounded leaf lifecycle**: every schema-2 implementation leaf inherits the
  campaign's stable `root_run_id`, which the canonical campaign controller
  derives from the sealed `campaign_id` and injects on every initial, repair,
  and resumed implementation dispatch as
  `AUTOPILOT_WORKTREE_ROOT_RUN_ID`. It is separate from
  `AUTOPILOT_ROOT_RUN_ID`, which remains the foreman/watcher trace root. Never
  substitute a foreman/stage/leaf run id or an ambient checkout path. Managed
  dispatch depth is normalized to at least `1`, so an inherited zero/malformed
  depth cannot bypass occupancy admission.
  Verification-author dispatch is a no-worktree authoring rail and does not
  consume this occupancy budget.
  `max_leaf_worktrees_per_root` is a hard occupancy cap (default `4`), so
  inspect and disposition every retained implementation outcome immediately.
  Run `reap-dispatch-worktrees.sh`, feed its exact inventory to
  `reap-dispatch-branches.sh`, then issue and freshness-check one
  `LifecycleResidueReceipt`. Freshness is not absence: require its
  `zero_residue` field to be exactly `true`; `false` is a resource blocker.
  This rail proves resource disposition only and never computes task
  `can_close`, generation advance, or finish authority.
- **Repair lineage convergence**: one managed campaign uses one stable branch
  and one leased implementation worktree. Repairs attach the exact checkout;
  Grok repairs also resume the exact provider UUID. A runner without verified
  resume support records the non-reuse reason and may not hide a fresh session
  as continuity. The same normalized finding recurring after one bounded
  repair, or two repair rounds without a smaller finding set, enters
  `awaiting_convergence_adjudication` before model spend. Compaction/resume
  restores this identity from the durable candidate reference, not from the
  conversational summary. Terminal success removes the clean retained
  worktree; dirty or unverifiable cleanup blocks.
- **Terminal status gate**: run
  `node "$autopilot_root/bin/autopilot.js" status task --root-run-id <campaign-root> --json`
  before merge, after merge, and before marker clear. Exit 0 alone is insufficient: capture the
  pre-merge JSON receipt and mechanically assert `can_merge === true` before merging.
  Finish-flow may clear an L6 marker only with
  that final fresh, digest-valid receipt and `can_close=true`; lifecycle `zero_residue=true` alone
  is not task completion.
- **Context-window gate (v2.32.58)**: all three rails — including the authoring leaf, whose
  payloads are the largest on any rail — size the input against the target engine's window
  before spending; over budget ⇒ `precondition_failed`, no runner spawned. Contract:
  [`references/hetero-dispatch.md`](../../references/hetero-dispatch.md) § Context-window gate.
  No manual override of a NO-GO exists; a changed contract is a new hash and a new GO check.
- `--solo` (or a foreman that cannot dispatch reliably) → fall back to `/l3` inline.
- Only admitted graph nodes become implementation tasks. Plan phase headings, modules, tests,
  verification authoring, reviewer seats, and retries stay inside the owning deliverable and
  gate-attempt budget.
- **Depth-0 context discipline**: depth-0 never authors implementation or verification content inline — even verification-prompt authoring is dispatched (dispatch-author.sh). Inline execution only via --solo or a recorded precondition_failed fallback.
- **Expensive-model thrift**: depth-0 assumes the session model is the most expensive engine in the fleet; inline fallback (`--solo` or authoring content itself) is an escalation event governed by `on_engine_unavailable` (from `resolve-review-loop.sh`), never a silent default.
- **Every depth-0 `Agent` dispatch MUST pass `model` explicitly** (foreman = `opus`; mechanical inventory / file work = `sonnet`/`haiku`) — a subagent with no `model` inherits the parent session's model, silently burning the expensive session engine (the exact spend the thrift rule guards) on a Fable-class CEO's foreman. See the model-inheritance warning in [`../ceo-agent/references/level-front-door.md`](../ceo-agent/references/level-front-door.md) § "Dispatching the foreman".
- 工頭等 leaf 只能用 `run_in_background`／子 Agent 的 task-notification 喚醒並結束回合；禁止 `sleep` 迴圈、禁止 `cat`/`tail` leaf output 進自己 context（只收 schema 判準表）、禁止用 Monitor 等 leaf；工頭 Bash 上限 40 次。

**Capability profile (shadow):** `/l6` fixes heterogeneous implementation and verification-author
topology only. When the host supplies a current verified envelope/grant/profile payload, forward it
unchanged; never infer guidance density from the level, runner, or model name. A late mismatch
requires a fresh-session handoff.
The canonical `profile-session.js` lane proves only no-effect context isolation. Existing
implementation and verification-author rails remain guided until their exact adapters independently
witness grant, tool/effect, identity, and terminal enforcement.

**MUST-READ**: [`references/full-dispatch-pipeline.md`](references/full-dispatch-pipeline.md)
(per-unit pipeline, machinery, authoring-rail rationale) and
[`../ceo-agent/references/level-front-door.md`](../ceo-agent/references/level-front-door.md)
(loop governance, qc@depth-0, ledger).
