# Dispatch lineage (trace-context) — Phase 1

Status: in-progress (foreman /l5, run-id `foreman-lineage-p1-1784044280`)
Version target: v2.32.32 (script-only ⇒ PATCH; origin already at v2.32.31)

## Problem

Every dispatch run-manifest is flat: no `parent_run_id`, so a nested dispatch
(foreman → leaf) is unattributable. `watch-foreman.js` attributes leaves by a
born-after-watcher-start time-window heuristic that mis-attributes when two
foremen run concurrently. Build trace-context lineage so leaves attribute to
their real root deterministically.

**Phase 2 (nudge/directive) is OUT of scope — a separate later run.**

## Env contract (the propagation mechanism)

- `AUTOPILOT_PARENT_RUN_ID` — immediate parent's run id
- `AUTOPILOT_ROOT_RUN_ID` — chain root's run id
- `AUTOPILOT_DISPATCH_DEPTH` — depth of THIS dispatch (root = 0)

Dispatcher startup logic (guard every ref with `${VAR:-}` — set -u discipline):
- parent unset ⇒ manifest `parent_run_id:null`, `root_run_id:<own run_id>`, `depth:0`
- parent set ⇒ `parent_run_id:<parent>`, `root_run_id:${AUTOPILOT_ROOT_RUN_ID:-<parent>}`,
  `depth:${AUTOPILOT_DISPATCH_DEPTH:-1}` (non-numeric ⇒ 1)
- Before spawning the WORKER: export `AUTOPILOT_PARENT_RUN_ID=<own run_id>`,
  `AUTOPILOT_ROOT_RUN_ID=<resolved root>`, `AUTOPILOT_DISPATCH_DEPTH=<own depth+1>`

## Decomposition (units)

1. **U1 dispatch-hetero.sh lineage** — compute lineage after DISPATCH_RUN_ID;
   export child env; add 3 fields to `write_manifest`; add the 3 vars to the
   detach `declare -p` list (CRITICAL: detach re-writes manifest via serialized
   state, values must survive).
2. **U2 dispatch-review.sh lineage** — same compute + export + 3 manifest fields.
   Detach re-execs `$0` with env inherited, so no declare-p list; recompute is
   automatic. author/explore emit no manifest ⇒ untouched (noted).
3. **U3 dispatch-status.js --list** — surface `parent_run_id`/`root_run_id`/`depth`
   in the list rows (additive) so the status tree can fold.
4. **U4 watch-foreman.js `--root <run-id>`** — filter LEAF_* to matching
   `root_run_id`; pre-upgrade manifests (no lineage) fall back to the time-window
   heuristic BUT the line is tagged `attribution=time-window`. Without `--root`,
   byte-identical. Report-only invariant (no child_process) preserved.
5. **U5 `autopilot status runs --tree`** (src/status/cli.js) — fold by
   `parent_run_id`; roots at margin, children indented; referenced-but-absent root
   ⇒ synthetic `(external)` node. `--json` composes. Default `runs` unchanged.
6. **U6 docs** — hetero-dispatch.md, level-front-door.md (foreman ritual +
   HONEST BOUNDARY), CLAUDE.md inventory rows.
7. **U7 CHANGELOG + version bump** v2.32.32.

## Honest boundary (MANDATORY)

The tree covers ONLY layers passing through autopilot dispatchers. Engine-INTERNAL
spawns (codex `spawn_agent`, agy recursion) never appear; CC-native Agent foremen
appear only as the root id their leaves reference. The tree must never imply
completeness it does not have.

## Boundaries

- Additive-only manifest changes; absent lineage env ⇒ output differs ONLY by the
  three new keys.
- Do NOT touch review-result JSON schema / src/engine/review.js (strict SSOT).
- No nudge/steer/scheduling (Phase 2).
