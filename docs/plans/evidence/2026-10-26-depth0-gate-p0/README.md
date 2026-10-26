# depth-0 gate P0 probe tooling

Plan: `docs/plans/2026-10-26-depth0-per-turn-gate.md` section 5, row P0, and section 3.3. Precedent: `docs/plans/evidence/2026-10-23-per-turn-gate-p0/`. This directory holds the probe tooling and the dry-run check; the paid results are added beside it after depth-0 runs it. No autopilot code is changed.

## Files

- `throwaway-hook.js`: the probe hook. Blocks once when armed (`P0_ARM=1`, and `P0_ARM_SID` equals the stdin `session_id` when set, `*` = any), allows when unarmed, on a session-id mismatch, on `stop_hook_active` true, or when `P0_ONLY` names the other event. Logs one JSON line per call to `$P0_LOG`: full stdin, process cwd, whether stdin `cwd` exists, hook wall ms, the wiring label (`cli`, `user`).
- `probe.sh a|b|c`: one repeatable command per probe; raw output in `$OUT/<probe>/<case>/` (`stream.jsonl`, `hook.jsonl`, `settings.json`, `meta.json`, `run.json`).
- `run-all.sh`: runs a, b, c in order, then `summary.json` (produced / not produced per case, key fields, cost).
- `analyze.js`, `summarize.js`, `mk-settings.js`: result extraction. `fake-claude.js` and `verify-dry.sh`: free check, never calls an API.

## Probes

| Probe | Command | What it proves |
|---|---|---|
| a | `PROBE_PAID=1 OUT=<dir> bash probe.sh a` | native subagent (Agent tool): throwaway SubagentStop in the config dir `settings.json`, plus the autopilot plugin Stop hooks loaded with `--plugin-dir <repo>`. Records hook stdin (parent `session_id`, `agent_id`, cwd), whether the Agent tool-result `agentId` equals the hook `agent_id`, whether the subagent continues after a block (hook re-fires with `stop_hook_active` true). Armed: SubagentStop blocks; depth-0 Stop is logged allow (`P0_ONLY`). Unarmed: no block. |
| b | `PROBE_PAID=1 OUT=<dir> bash probe.sh b` | claude-native shape (credentials-only config dir, `--settings <file>`, `--session-id X`, hook by absolute path): Stop fires, block continues the model (reply ALPHA), stdin `session_id` equals X, hook wall time. Unarmed worker = armed hook with a different session id: not blocked. |
| c | `PROBE_PAID=1 OUT=<dir> bash probe.sh c` | cc-shim shapes: hetero (no config dir, scratch HOME, user-level hook plus `--settings` hook, copied from `scripts/dispatch-hetero.sh:3881`) and author (adds `--setting-sources project --tools ""`, from `scripts/dispatch-author.sh:1388`). Double wiring shows as `Stop/cli` and `Stop/user` both firing once in the same turn. Armed and unarmed each. |

(a) loads the plugin through `--plugin-dir`. Basis: the 2026-10-23 precedent control run used `--plugin-dir <checkout>` on CLI 2.1.309 and its trace listed the plugin Stop hooks (`docs/plans/evidence/2026-10-23-per-turn-gate-p0/README.md`, "Step 0 isolation"); the official page says plugin hooks also run inside subagents (below). Limit: a user-installed plugin (marketplace) is not the same load path as `--plugin-dir`; probe c uses a user-level settings hook as the stand-in for "something in the user config loads", and does not claim the user's real plugins.

Limits: c uses first-party auth, so a cc-shim endpoint's own behavior is not exercised. Every call carries `--model haiku --max-budget-usd 0.15`. Cumulative cap `PROBE_MAX_USD` (default 1.0) is checked before each call; `total_cost_usd` of the last result event of each call is summed; later cases are written `skipped.json` and reported "not run".

Safety: the real `~/.claude` is never handed to a child. Native calls get a mktemp `CLAUDE_CONFIG_DIR` seeded with only `.credentials.json` (asserted before launch; probe a then adds its `settings.json`); HOME is a mktemp dir; the credentials file is only copied. Without `PROBE_PAID=1` (or a fake `PROBE_CLAUDE_BIN`) the scripts refuse to start `claude`.

## Verdict table (filled after the paid run)

| Path (plan 3.3) | Probe | Result | Routing proof (armed blocks, depth-0/unarmed does not) | Keep? |
|---|---|---|---|---|
| hetero claude-native hand | b, (c native = b) | pending | pending | pending |
| hetero cc-shim hand | c | pending | pending | pending |
| native subagent | a | pending | pending | pending |

## (d) Official documentation, https://code.claude.com/docs/en/hooks (read 2026-10-26, characters 0 to 200000 of 282268)

- SubagentStop input: common fields plus `stop_hook_active`, `agent_id`, `agent_type`, `agent_transcript_path`, `last_assistant_message`; the example also shows `session_id`, `transcript_path`, `cwd`, `permission_mode`, `hook_event_name`, `background_tasks`, `session_crons`. `transcript_path` is the main session's; `agent_transcript_path` is the subagent's.
- Block: "Returning `decision: "block"` with a `reason` keeps the subagent running and delivers `reason` to the subagent as its next instruction"; exit 2 with stderr does the same ("Prevents the subagent from stopping"). Same decision format as Stop.
- "Hooks from settings files, managed policy settings, and plugins also run inside subagents"; the `agent_id` common field identifies the subagent.
- Not read: the Stop section (the `stop_hook_active` definition) and the last 82268 characters. The documented example `cwd` is present in the SubagentStop input, which contradicts the 2026-10-21 captured line that had no `cwd`; probe a records which is true.
- The docs do not say that the `agent_id` in the Agent tool result equals the hook `agent_id`; probe a measures it.

## Dry-run check (no cost)

`bash verify-dry.sh` runs the whole flow with `fake-claude.js`: 8 cases run, armed cases block and continue, unarmed do not, hetero shows both wirings and author shows only the `--settings` one, the config dir seen by each native call is a mktemp dir holding only credentials (plus `settings.json` for a), and the cap negative control (fake reporting 1.2 USD per call) stops after one call, with later cases "not run". Red control: with `PROBE_MAX_USD=100` the same fake produces 8 calls. The fake only mimics the hook protocol, so it shows the tooling flow and not the real CLI behavior.
