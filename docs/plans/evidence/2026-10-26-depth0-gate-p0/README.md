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

Limits: c uses first-party auth, so a cc-shim endpoint's own behavior is not exercised. Every call carries `--model haiku --max-budget-usd 0.15`. Strict cumulative cap `PROBE_MAX_USD` (default 1.0): before each call the remaining budget is cap minus spent; if it is zero or less the case is written `skipped.json` and reported "not run", otherwise `--max-budget-usd` is min(0.15, remaining). Spend is the last result event's `total_cost_usd`; a call with no result event (crash) is charged its full budget.

Safety: the real `~/.claude` is never handed to a child. Native calls get a mktemp `CLAUDE_CONFIG_DIR` seeded with only `.credentials.json` (asserted before launch for every native case, probe a included: the throwaway hooks reach it through `--settings`, never through a file in the config dir); HOME is a mktemp dir; the credentials file is only copied. Without `PROBE_PAID=1` (or a fake `PROBE_CLAUDE_BIN`) the scripts refuse to start `claude`.

## Results (paid run by depth-0, CLI 2.1.309, model haiku, `raw/cli-version.txt`)

Raw output is in `raw/` (`summary.json`, `spend.json`, per case `stream.jsonl`, `hook.jsonl`, `meta.json`, `run.json`, `stderr.txt`); `sums.txt` has the sha256 of every raw file. All 8 cases are `produced`; total spend 0.0268 USD against the 1.0 USD cap (cap not reached). Secret scan of `raw/`: grep for token and credential patterns found nothing, and none of the 6 string values (16 chars or longer) of the real `.credentials.json` appears in any raw file. mktemp paths are kept.

| Path (plan 3.3) | Decision | Basis (case) | Routing proof |
|---|---|---|---|
| claude-native hand (credentials-only dir + `--settings`) | **keep** | b_armed: Stop hook fires, stdin `session_id` equals the `--session-id` X (`hook_stdin_matches_expected` true), one block then the model replied ALPHA, second call (`stop_hook_active` true) allowed; hook wall 0 to 1 ms | b_armed blocked once; b_unarmed (hook armed for another session id) allowed (`allow(session-id-mismatch)`) |
| cc-shim hand, hetero form (`dispatch-hetero.sh:3881`, no config dir) | **keep, with the double-wiring rule** | c_hetero_armed: user-level and `--settings` hooks both fire in the same turn, so the turn blocks twice (`Stop:user:block`, `Stop:cli:block`); this confirms the plan's need for the idempotent (session, turn) counter under lock, or for wiring only one carrier | c_hetero_armed blocked; c_hetero_unarmed allowed on both carriers |
| cc-shim, author form (`--setting-sources project`, `dispatch-author.sh:1388`) | keep as a carrier fact, rail stays **excluded** by plan 3.3 (text-only, `--tools ""`) | c_author_armed: only the `--settings` hook fires (user-level not loaded), one block, then continues | c_author_armed blocked; c_author_unarmed allowed |
| native subagent (Agent tool), SubagentStop keyed `(session_id, agent_id)` | **keep (id proven)** | a_armed: autopilot plugin loaded (init plugins include `autopilot@inline`, plugin Stop hooks fired, 7 Stop starts in the trace); SubagentStop blocked once, second call with `stop_hook_active` true allowed, the subagent continued (ALPHA). The Agent tool-result `agentId` equals the hook `agent_id` (a_armed and a_unarmed both true). Hook stdin carries parent `session_id` (equal to the parent init session), `agent_id`, `cwd`, `agent_transcript_path`, `effort`, `permission_mode`, `prompt_id` | a_armed: subagent blocked, depth-0 Stop allowed (`allow(event-not-gated)`); a_unarmed: both events allowed |
| codex, agy, grok, opencode, cursor, copilot; dispatch-review, consult, explore, foreman, batch | **excluded** | unchanged from plan 3.3; this probe has no evidence for them | none |

Findings beyond the table: the SubagentStop stdin does contain `cwd` (the 2026-10-21 captured line had none), and the field list matches the official page plus `effort`, `permission_mode`, `prompt_id`, `transcript_path`. `a_armed` hook calls: SubagentStop 2, Stop (throwaway) 1.

## Limits

- One short session per case, model haiku only; trivial prompts. Nothing here covers long sessions, parallel subagents, background subagents, or other models.
- `--plugin-dir` is not a marketplace install; a user-installed plugin may load differently.
- The cc-shim shapes ran with first-party auth, not a cc-shim endpoint; the user-level hook stands in for "user config loads" and says nothing about the user's real plugins.
- The unarmed worker is simulated by the hook (env var or session id mismatch), not by the real rail.
- A Stop block is shown to continue the model in these runs only for the throwaway hook; the plugin's own Stop hooks never blocked here.

## (d) Official documentation, https://code.claude.com/docs/en/hooks (read 2026-10-26, characters 0 to 200000 of 282268)

- SubagentStop input: common fields plus `stop_hook_active`, `agent_id`, `agent_type`, `agent_transcript_path`, `last_assistant_message`; the example also shows `session_id`, `transcript_path`, `cwd`, `permission_mode`, `hook_event_name`, `background_tasks`, `session_crons`. `transcript_path` is the main session's; `agent_transcript_path` is the subagent's.
- Block: "Returning `decision: "block"` with a `reason` keeps the subagent running and delivers `reason` to the subagent as its next instruction"; exit 2 with stderr does the same ("Prevents the subagent from stopping"). Same decision format as Stop.
- "Hooks from settings files, managed policy settings, and plugins also run inside subagents"; the `agent_id` common field identifies the subagent.
- Not read: the Stop section (the `stop_hook_active` definition) and the last 82268 characters. The documented example `cwd` is present in the SubagentStop input, which contradicts the 2026-10-21 captured line that had no `cwd`; probe a records which is true.
- The docs do not say that the `agent_id` in the Agent tool result equals the hook `agent_id`; probe a measures it.

## Dry-run check (no cost)

`bash verify-dry.sh` runs the whole flow with `fake-claude.js`: 8 cases run, armed cases block and continue, unarmed do not, hetero shows both wirings and author shows only the `--settings` one, the config dir seen by each native call is a mktemp dir holding only credentials , and the cap negative control (fake reporting 1.2 USD per call) stops after one call, with later cases "not run". Red control: with `PROBE_MAX_USD=100` the same fake produces 8 calls. The fake only mimics the hook protocol, so it shows the tooling flow and not the real CLI behavior.
