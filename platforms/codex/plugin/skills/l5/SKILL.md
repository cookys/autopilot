---
name: l5
description: >
  Terse CEO front-door — Level 5: like /l4 (background worktree-isolated foreman, depth-0 control
  loop + authoritative qc) but the IMPLEMENTER is orchestrated by the engine CLI and dispatched
  through the canonical `engine implement-review` path. Use when: "/l5 <goal>", "L5 <goal>", you want cost-arbitrage
  or a decorrelated second engine doing the mechanical impl. Presets involvement=just-results,
  scope=Hold, no-go=none (override -x / --expand / --solo). Not for: all-Claude run (→ /l4), inline
  (→ /l3).
---

# /l5 — CEO autonomy, foreman + hetero implementer

Terse front-door into `autopilot:ceo-agent` at **Level 5**: identical to `/l4`
except the foreman **runs** the canonical implementation-review loop via
[`../../bin/autopilot.js`](../../bin/autopilot.js) (`engine implement-review`),
which dispatches implementation rounds through [`../../scripts/dispatch-hetero.sh`](../../scripts/dispatch-hetero.sh) and decorrelated review.

## On invocation

1. Invoke `autopilot:ceo-agent` with the four startup questions **pre-filled**
   (same presets as `/l3`/`/l4`: OKR from `<goal>`; involvement=3 just-results;
   scope=Hold (override: `--expand` → Expand); no-go=none (override: `-x <csv>`)).
2. Resolve the roster and execution parameters from [`../../scripts/resolve-review-loop.sh`](../../scripts/resolve-review-loop.sh) (e.g. `reviewer_engine`, `reviewer_runner`, `implementer_engine`, `implementer_runner`, `review_diff_scope`, `independent_harness`).
3. Execution posture: **offload with hetero impl + decorrelated review**. Run the foreman + depth-0 control loop per [`../ceo-agent/references/level-front-door.md`](../ceo-agent/references/level-front-door.md). The main differences from `/l4`:
   - **Implementation** is dispatched using `engine implement-review` (internally invoking `dispatch-hetero.sh` with immutable base SHA and cgroup containment).
   - **Review** (spec and code) runs the resolved decorrelated reviewer engine instead of Claude.
   - **Harness & telemetry** run independent verifications and capture diff-domain metrics per project config.
4. **`--solo`** → fall back to the `/l3` inline engine (also the automatic degradation when the foreman returns `precondition_failed`).

Wired runners: `codex`, `agy/Gemini`, `grok`, and `cc-shim`. See [`../../references/hetero-dispatch.md`](../../references/hetero-dispatch.md) and [`../ceo-agent/SKILL.md`](../ceo-agent/SKILL.md) for more details.
