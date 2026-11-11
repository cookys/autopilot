# Plan — Agent brief Cost line for fable and opus

> Status: active. Owner: autopilot depth-0. PM 01M755V431. Date: 2026-11-11 (Taipei). Size: S. No version bump. The harness commits; this session does not.

Goal: when a Claude Agent subagent is dispatched on fable or opus, its own brief states the cost, so the expensive model only does the hardest judgment and delegates reading, search, and summarising to haiku or sonnet subagents.

## Rule

`costLineFor(model)` in `hooks/lib/brief-header-template.js` normalises like the engine header (trim, lower-case, drop the `@` suffix, accept a full id such as `claude-opus-5-5` or `claude-fable-5-2`).

- fable or opus → `Cost: 最貴的模型，會燒光共用池；只做最難的判斷，讀檔、搜尋、整理一律派 haiku/sonnet subagent`
- sonnet → `Cost: 中價模型；機械性讀檔與搜尋可再派 haiku` (advisory; never a deny)
- haiku, anything else, empty → no line

`missingCostLine` is true only when that fable/opus line applies and none of the first 6 lines matches `^Cost:\s*\S`. `dispatch-model-guard` (PreToolUse Task|Agent) then denies, after the engine-header check and before the guarded-model check, with the reason `require_cost_line` and the exact line to paste. An `(intentional: …)` Engine header does not waive it. The effective model is `tool_input.model`, or the `Engine:` token when `model` is absent and `on_missing_model` is `allow`. `require_cost_line: on|off` defaults on; garbage stays on. `mode: off` and `AUTOPILOT_DISPATCH_MODEL_GUARD_MODE=off` still skip the whole hook.

The SessionStart hint stays one line, at most 200 characters, and names the Cost slot: `Agent brief first lines: Engine: <model> | Role: <role> | Lane: <slug> | Cost: <fable/opus 必填，見 costLineFor>`.

## Acceptance

- opus or fable without a Cost line in the first 6 lines is denied, including `(intentional: …)` and the full id `claude-opus-5-5`; with the line, other checks decide.
- sonnet and haiku without a Cost line are not denied by this check.
- `require_cost_line: off` does not deny.
- `node scripts/check-plan-graduation.js` passes with this file registered `active` in `project/projects/INDEX.md`.
- Codex plugin copies of the mirrored files match after `scripts/sync-codex-plugin-skills.sh`.

## Negative control

Force `missingCostLine` to `return false`, run `hooks/tests/dispatch-model-guard.test.sh`, and show `costline-opus-missing denies` red. Restore the function and leave the suite green. The commit message records that sentence.

## Out of scope

Sonnet and haiku are never denied for a missing Cost line. `scripts/lib/config-keys.json` registers the config file, not individual guard keys, so `require_cost_line` is documented only in `project-config-template/dispatch-guard-config.md`. Frozen `evals/skill-onoff/packs/**`, `hooks/README.md`, and `project/backlog/brief-header-hint-guards.md` stay unchanged unless a suite that this change breaks requires otherwise. `hooks/dispatch-model-guard.js` is not part of the Codex plugin mirror.
