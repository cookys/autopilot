---
name: l5
description: >
  Terse CEO front-door — Level 5: like /l4 (background worktree-isolated foreman, depth-0 control
  loop + authoritative qc) but the IMPLEMENTER is leaf-dispatched to a heterogeneous engine
  (agy/Gemini) via dispatch-hetero.sh. Use when: "/l5 <goal>", "L5 <goal>", you want cost-arbitrage
  or a decorrelated second engine doing the mechanical impl. Presets involvement=just-results,
  scope=Hold, no-go=none (override -x / --expand / --solo). Not for: all-Claude run (→ /l4), inline
  (→ /l3).
---

# /l5 — CEO autonomy, foreman + hetero implementer

Terse front-door into `autopilot:ceo-agent` at **Level 5**: identical to `/l4`
except the foreman **leaf-dispatches the implementer to agy/Gemini** via
[`../../scripts/dispatch-hetero.sh`](../../scripts/dispatch-hetero.sh) (already
built; Gemini is a verified 2nd engine). Everything else — the depth-0 control
loop, qc@depth-0, merge-back, worktree GC — is unchanged from `/l4`.

## On invocation

1. Invoke `autopilot:ceo-agent` with the four startup questions **pre-filled**
   (same presets as `/l3`/`/l4`).
2. Execution posture: **offload with hetero impl**. Run the foreman + depth-0
   control loop per
   [`../ceo-agent/references/level-front-door.md`](../ceo-agent/references/level-front-door.md);
   the only delta vs `/l4` is the implementer step:
   - Impl is dispatched with `dispatch-hetero.sh` (worktree-isolated, artifact-
     verified). Map its outcome via the **outcome→action table**; reap the
     worktree from the outcome JSON's `worktree` field on any non-success.
   - The impl row of the **run-summary ledger** records `runner`/`model` straight
     from the `dispatch-hetero.sh` outcome JSON (provenance, success criterion #6).
3. **`--solo`** → fall back to the `/l3` inline engine (also the automatic
   degradation when the foreman or hetero dispatch returns `precondition_failed`).

What is deferred (NOT in v1): the full `role × task-type` routing table and
engines beyond Claude+Gemini (codex/grok/gpt — each behind a per-engine smoke
test). See [`../../references/hetero-dispatch.md`](../../references/hetero-dispatch.md)
and [`../ceo-agent/SKILL.md`](../ceo-agent/SKILL.md).
