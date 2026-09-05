# P3 brief — depth-0 delegate gate

Repo: `/home/cookys/projects/autopilot`. Base branch: the P2 branch once merged into `feat/v2.36.1-statusline-live-context-feed`
(depth-0 tells you the exact base sha in the dispatch message). Worktree: `git worktree add /home/cookys/projects/autopilot-wt-p3 -b feat/v2.36.1-p3 <base>`.
Node ≥ 20.10, built-ins only. Plan (read §2.5 and P3 only): `docs/plans/2026-09-05-statusline-live-context-feed.md`.
Read first: `hooks/foreman-guard.js` (the PreToolUse default-on pattern), `hooks/hooks.json`, `profiles/hook-classes.json`,
`scripts/check-hook-inventory.js` header, `scripts/lib/live-state-dir.js` (from P2: `resolveLiveDir`, `readLive`, `modelFamily`).

## Global Constraints (verbatim from plan §2.5)

- New knobs: `AUTOPILOT_DEPTH0_DELEGATE_GATE_MODE=off|warn|block` (default `warn`), config `~/.autopilot/config.json` `depth0_delegate_gate.{mode,threshold,guarded_models}` (defaults `warn`, `8`, `["fable","opus"]`). Garbage mode ⇒ `warn`.
- Model family: lowercase id must match `^claude-([a-z]+)-[0-9]+(-[0-9]+)*(\[[a-z0-9]+\])?$`; group 1 is the family; non-matching ⇒ `unknown` (never blocks). Use `modelFamily` from `scripts/lib/live-state-dir.js`; do not reimplement.
- Readers accept a live file only if `schema_version` is the integer `1` and `written_at` is within 120 s; otherwise absent.
- The gate is default-on and NOT bound to the l3–l6 session marker. It warns without a live file by design (§2.6: new stderr). It blocks only in `block` mode with a fresh live `model.id` whose family is in `guarded_models`.
- Severity vocabulary 🔴/🟠/🟡/🔵. No trust machinery. Fail-open on any error (exit 0).

## Deliverables

1. `hooks/depth0-delegate-gate.js` (new, PreToolUse). Skip when `payload.agent_id` present. Tool classes: read-class = `WebFetch|WebSearch|Read|Grep|Glob`; delegation = `Agent|Task|Skill` (resets the counter). Also treat a `Bash` whose command starts with `grep `, `rg `, `find `, `cat `, `sed -n`, `head `, `tail ` as read-class (executable-text only: strip heredoc bodies and comments the way `foreman-guard.js` does). State: `<base>/depth0-gate/<sid>.json` `{reads, lastFireAt}` via `resolveLiveDir` (+ `AUTOPILOT_DEPTH0_GATE_DIR` override for tests). At `reads ≥ threshold` and every `threshold` after: stderr `depth0-delegate-gate: <N> consecutive read-class calls at depth-0 — delegate to an Explore/survey subagent (model: sonnet) and read only its conclusion`, exit 0. In `block` mode, when the main live file is fresh and `modelFamily(model.id) ∈ guarded_models` and `reads ≥ 2×threshold`: deny with the same JSON shape `foreman-guard.js` emits, message names the model family and the count. Any other tool: no-op, counter untouched.
2. `hooks/hooks.json`: direct PreToolUse entry (copy the `foreman-guard.js` block shape) with matcher `WebFetch|WebSearch|Read|Grep|Glob|Bash|Agent|Task|Skill`. Do not route through the opt-in multiplexer.
3. `profiles/hook-classes.json`: add `{"stem":"depth0-delegate-gate","class":"invariant_effect"}` in sorted position. Then repin `hook_classes_sha256` in `profiles/profile-catalog.json` AND `platforms/codex/plugin/profiles/profile-catalog.json` (sha256 of the new hook-classes.json bytes), and copy `hook-classes.json` to the codex mirror path if one exists there. Verify: `node scripts/build-profile-payload.js catalog --check` rc 0, `node scripts/check-hook-inventory.js --check` rc 0.
4. `hooks/depth0-delegate-gate.test.js`: below threshold silent; threshold nudge; refire cadence; reset on Agent/Task/Skill; Bash `grep …` counts, Bash `npm test` does not, heredoc containing `grep` does not; subagent fire silent; block with live `claude-fable-5-1`, `CLAUDE-FABLE-5-1`, `claude-opus-4-8[1m]` in `block` mode at `2×threshold`; no block for `claude-sonnet-5`, `fable-ish`, `claude-fable`, malformed id, stale file, absent file, `warn` mode; `off` mode silent; garbage stdin fail-open; state lands under the base.
5. `hooks/README.md` row; `hooks/settings.example.json` knob example. Do NOT bump versions or edit CHANGELOG (P4).

## Method

harness-verify-loop per change; before commit `bash hooks/tests/run.sh --parallel 4` with `AUTOPILOT_TOPOLOGY_FILE=/nonexistent`, read the whole log for `FAIL`, plus `node scripts/check-js-syntax.js`, the two `--check` commands above, and `node scripts/build-profile-payload.js` for the guided/autonomous bundles (no `PROFILE_HOOK_DRIFT`). Commit `feat(hooks): depth0-delegate-gate — nudge depth-0 to delegate read bursts (v2.36.1 P3)`.

## Report → `ledger/p3/report.json`

`{"status":…,"worktree":…,"branch":"feat/v2.36.1-p3","commits":[…],"suite":{"passed":N,"failed":N,"failed_names":[…]},"catalog_check":"rc=0|…","hook_inventory_check":"rc=0|…","hook_classes_sha256":"…","files_changed":[…],"notes":…}`. Reply with the report path.
