---
name: l6
description: >
  Terse CEO front-door — Level 6: like /l5 (worktree-isolated hetero implementer + authoritative
  qc) but the VERIFICATION AUTHORING is also leaf-dispatched to a heterogeneous engine; depth-0 remains
  pure orchestration. Use when: "/l6 <goal>", "L6 <goal>", "全委", "全部派遣", "省 token 全外包",
  "delegate everything incl verification". Presets involvement=just-results, scope=Hold, red-lines=none
  (override -x / --expand / --solo). Not for: /l5 when you still want to do verification yourself; /l4
  all-Claude; /l3 inline.
---

# /l6 — CEO autonomy, foreman + full-dispatch verification

Terse front-door into `autopilot:ceo-agent` at **Level 6**: identical to `/l5`
except verification AUTHORING is ALSO leaf-dispatched to a heterogeneous engine;
depth-0 remains pure orchestration.

Hard rules:
- At entry run `node <plugin>/scripts/session-mode.js set --level l6` (`--solo` ⇒
  `set --level l3`) — arms the orchestrator-edit-gate + context-budget hooks
  (level-front-door § "Session-mode marker").
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
  `--runner`/`--model`/`--timeout` that disagree are precondition-rejected. Consuming-checkout
  mutation is `containment_breach` (exit 4) and the artifact is quarantined, never promoted.
  Write dispatches likewise run
  `scripts/dispatch-hetero.sh --strict-contract --contract-file <unit.json> ...` — base and
  timeout pin from the contract; post-return boundary (allow/deny/budget/output) and
  depth-0-executed acceptance argv gate the result. While an l5/l6 session marker is active,
  prompt-only (non-strict) write or author dispatch on this repo fails before the runner.
  No manual override of a NO-GO exists; a changed contract is a new hash and a new GO check.
- `--solo` (or a foreman that cannot dispatch reliably) → fall back to `/l3` inline.
- **Depth-0 context discipline**: depth-0 never authors implementation or verification content inline — even verification-prompt authoring is dispatched (dispatch-author.sh). Inline execution only via --solo or a recorded precondition_failed fallback.
- **Expensive-model thrift**: depth-0 assumes the session model is the most expensive engine in the fleet; inline fallback (`--solo` or authoring content itself) is an escalation event governed by `on_engine_unavailable` (from `resolve-review-loop.sh`), never a silent default.
- **Every depth-0 `Agent` dispatch MUST pass `model` explicitly** (foreman = `opus`; mechanical inventory / file work = `sonnet`/`haiku`) — a subagent with no `model` inherits the parent session's model, silently burning the expensive session engine (the exact spend the thrift rule guards) on a Fable-class CEO's foreman. See the model-inheritance warning in [`../ceo-agent/references/level-front-door.md`](../ceo-agent/references/level-front-door.md) § "Dispatching the foreman".

**MUST-READ**: [`references/full-dispatch-pipeline.md`](references/full-dispatch-pipeline.md)
(per-unit pipeline, machinery, authoring-rail rationale) and
[`../ceo-agent/references/level-front-door.md`](../ceo-agent/references/level-front-door.md)
(loop governance, qc@depth-0, ledger).
