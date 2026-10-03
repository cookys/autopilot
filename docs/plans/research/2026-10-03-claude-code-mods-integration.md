> Status: research, not a plan; nothing built. Date: 2026-10-03.
> Source: autopilot maintenance session (fable depth-0), run2 closeout; original at session scratchpad research/cc-mods-report.md.

# Claude Code MODs vs autopilot: research report (2026-10-03, CC 2.1.288)

## 摘要 (zh-TW)
1. MODs 是 Claude Code 2.1.288 的「函式 hook」plugin：同一支 TypeScript 模組可畫 pane、輸入列上方 band、狀態列、toast，也能攔截/改寫 tool call，且熱重載；官方文件我沒查到公開 URL，事實全來自本機 skill 與型別檔，API 標為早期版本、可能變動。
2. 最大價值：mod 有 `$.clock.every`、`$.prompt.submit`、`session.measure`，能在 CC 內部喚醒閒置 session、即時推送 cost/context，正好補 autopilot「停車不喚醒、營運者一直問怎麼這麼慢、成本警告靠 context 注入」三個痛點。
3. 限制：只有 Claude Code（CLI 才有 `$.process`），Codex/OpenCode/agy 完全沒有，所以只能當「CC 專屬增強層」，既有 shell hook 與腳本必須保留當 fallback，不可取代。
4. 優先試作三項：(A) 即時 dispatch/foreman 狀態 band＋完成 toast（吃現有 run-manifest/ledger 檔）、(B) 成本帶（讀 costs.jsonl＋`$.session.usage().cost`）、(C) 把 statusline-live-tee 換成 `session.measure` 寫 live 檔。
5. 已實測：`claude plugin validate` 對同時含 `modules` 與傳統 `hooks` 的 hooks.json 通過；尚未實測的（真實載入、延遲、desktop 行為）一律列為 spike。

## Evidence legend
- [V-run] I ran the real tool in this session. [V-file] read from the shipped skill/type file (`.../plugin-authoring/{reference.md,types/claude-code.d.ts}`, Claude Code 2.1.288, header says EARLY ACCESS, may change without notice) or from repo files. [SPIKE] unverified.
- No public docs.claude.com / code.claude.com URL for mods was found (web search tool was not run; the API is early access). So every claim below is [V-file] or [V-run] and the official-doc column is "none found".

## Part 1 — What mods are

| Aspect | Fact | Evidence |
|---|---|---|
| Packaging | A plugin folder: `.claude-plugin/plugin.json` + `hooks/hooks.json` containing `{"modules":["./register.ts"]}` (one path) + the module exporting `register(on, options)`. TS/JS, ES module, no `require`, no `import()`. `userConfig` fields become `options`. | V-file reference.md |
| Mix with classic hooks | A hooks.json holding both `modules` and a classic `hooks.Stop` block passes `claude plugin validate`; it lists hooks `session.measure, turn.complete` and calls `$.prompt.submit, $.ui.status`. Whether it loads and runs both at runtime is not proven. | V-run (validate only); load = SPIKE |
| Runtime | Own sandboxed JS environment: no DOM, no Node, no fs/net/process of its own; everything via `$` (`$.fs`, `$.http`, `$.process`, `$.env`, `$.settings.read`, `$.store` cross-session, `$.state` per-session). | V-file types header |
| Hook shape | `on(event, matcher?, ($, e, next) => ...)`. Return without `next` = answer for itself; `next({...e,x})` rewrites; chain of plugins then engine. `.catch` handler per registration. Failed hook is skipped, chain continues (fail-open by default). Per-hook time budget (`next.budget`, `next.signal`). | V-file |
| Surfaces (render) | `Pane` (docked sidebar; opened unasked only seats at >=144 cols, otherwise waits), `AbovePrompt` band, status line `$.ui.status(text)` (one per plugin), `$.ui.toast`, `$.ui.notice` (line under a tool dialog), transcript rows (tool/message/spinner components via `ui.render`), `$.audio.play`. Elements from `$.ui.resolve(e)` per surface: Box, Text, Button, Input, Select, Markdown, Raster, Image (terminal), Client (desktop). `Button` hotkeys, `ui.press/input/select` events for interactivity. Redraw capped ~30/s terminal. | V-file |
| Surfaces (platform) | `e.surface` is terminal / desktop / vscode / mobile; element tables differ (mobile no Input/Select; vscode no Client). `$.process` is "CLI only". Desktop Code tab support for panes/bands: element tables exist, but I did not run it. | V-file; desktop behavior SPIKE |
| Events | `tool.call`, `tool.check`, `tool.describe`, `prompt.submit/compose/context/section/attachment`, `session.start/end/append/send/receive/compact/measure/attach`, `turn.start/step/complete`, `agent.spawn/offer`, `command.run`, `ui.*`, `skill.prompt`, `telemetry.*`, `engine.create`, and every classic settings hook as `classic.<Event>` (stdin payload incl. `transcript_path`). `turn.step` and `process.spawn` stream (async generators). | V-file |
| Readable data | Session messages (`$.session.messages()` rows `{role,text,toolUses}`), `session.append` rows (every prompt/response/tool result incl. subagents, `agentId` tagged), `$.session.usage()` = context fill, rate-limit windows (five_hour/seven_day), cost as `/cost` totals; `session.measure` pushes after each main-thread turn; `turn.complete` carries `usage` + `agentId`; `$.agent.list()` gives subagent id/type/status/parent. | V-file |
| Actions | Deny/allow/rewrite a tool call (`{deny}`, `next({...e})`), answer a tool result, rewrite prompts and rows, add/replace system-prompt sections, `$.session.append` (inject a meta row the model reads), `$.prompt.submit` (queues a prompt that starts a turn when idle: can wake a quiet session), `$.agent.spawn/register`, `$.tool.register`, `$.command.register` (slash commands), `$.model.complete/fork`, `$.session.compact`, run host commands (`$.process.run/spawn`, argv, no shell, 30 s default, 10 min max, 4 MiB output), `$.http.fetch` through host. | V-file |
| Timers / long work | Start from `session.start`; `$.clock.every/after` run until cancelled or module reload; `$.process.spawn` child lives as long as its loop. A hook dispatch itself is time-budgeted; long work must not live in a hook body. | V-file |
| Lifecycle | `register` re-runs on reload; `session.start` fires again; module variables reset; `$.state`/`$.store` persist. Hot reload: `--plugin-dir`, `CLAUDE_CODE_PLUGIN_DIRS`, or the mods folder after the person answers "Enable hot reloading?" (human-only gate). Headless `claude -p` loads fresh, no watch unless `CLAUDE_CODE_PLUGIN_DIR_WATCH=1`. | V-file |
| Tooling | `claude plugin validate <dir>`, `claude plugin test <dir>` (`*.test.ts`, `claude-code/testing`, can mount UI on each surface), `tsc -p`. | V-file; validate V-run |
| Fail-open / sandbox | Mod cannot touch fs except via `$.fs` (4 MiB per read/write, hooks on `fs.*` can restrict), no network of its own. Managed policy / untrusted workspace can switch hot reload off. Org web-fetch policy applies to `$.http`. | V-file |

### Difference from classic mechanisms
| | classic settings/plugin `command` hook | statusLine command | mod function hook |
|---|---|---|---|
| Process model | spawn a process per event (autopilot: Node start per call, fd-0 stdin quirks, transcript re-read to recover tool data) | process per refresh, stdin JSON | in-process, no spawn, typed event object, no transcript scraping |
| Can render | no (stdout text only) | one line | pane/band/toast/status/row replacement |
| Can wake session | no (context injection on next event only) | no | yes (`$.prompt.submit`, `$.session.append`, timers) |
| State | files | files | `$.state`/`$.store` + files via `$.fs` |
| Portability | CC-only too, but mirrored conceptually in Codex hooks | CC-only | CC-only, early-access API |

## Part 2 — autopilot inventory and pain points (read from the repo)

Registered today (`hooks/hooks.json`, verified by parsing it): PreToolUse x7 groups (`opt-in-multiplexer`, `foreman-guard` Bash|Monitor, `cost-fuse` Bash|Edit|Write..., `dispatch-model-guard` Task|Agent, `run-approval-gate`, `depth0-delegate-gate`), PostToolUse x10 (`intent-capture`, `reload-watch`, `audit-log`, `log-error`, `failure-escalation`, `context-budget`, `suggest-compact`, multiplexer), Stop x3 (`cost-tracker`, `dirty-protected-paths`, multiplexer), SessionStart/SessionEnd/PreCompact/UserPromptSubmit. Every one is a `node` process spawn; `.*` matchers mean 5+ spawns on every tool call. `hooks/README.md`: hooks recover tool data from the transcript JSONL because `/dev/stdin` fails (fd 0 workaround) [V-file].

| Pain | Current implementation | File |
|---|---|---|
| "Why so slow" / no live view of running hands | `dispatch-status.js` (manifests + log parse + liveness) and `watch-foreman.js` (one line per event, designed to sit behind the CC Monitor tool; explicitly sensing-only, QUIET/LEAF_STALL are report-only) | scripts/dispatch-status.js, scripts/watch-foreman.js |
| Parked background agents do not wake themselves | memory note: needs Monitor / run_in_background / self-poke; foreman-guard caps Bash polling (cap 40, denies Monitor for foremen) | hooks/foreman-guard.js, memory `background-dispatch-pickup-gate` |
| Cost fuse as nudge | `cost-fuse.js` PreToolUse, reads `~/.claude/metrics/costs.jsonl` (written by `cost-tracker` at Stop), warn default, `daily_usd_brain: 150`; `cost-digest.js` tiers | hooks/cost-fuse.js, scripts/cost-digest.js |
| Real context window not visible to hooks | `statusline-live-tee.js` wraps the user's statusLine, writes `<live-base>/context/<sid>.json` (tmpfs) so `context-budget`/`depth0-delegate-gate` know the real window; otherwise spurious T2 handoff at ~150K on 1M sessions | scripts/statusline-live-tee.js |
| Hot-path latency | opt-in multiplexer collapses 13 opt-in hooks into one spawn per event; D6 benchmark exists | hooks/opt-in-multiplexer.js, scripts/benchmark-hook-multiplexer.js |
| Subagent identity for guards | hooks rely on `agent_id` in payload and on first-message `Engine:` line | foreman-guard.js header |

## Part 3 — Integration candidates (ranked)

Columns: effort S/M/L; risk = portability/regression risk; V = verified status of the *mod-side capability* (all are V-file API facts; none is a run-proven autopilot integration).

| # | Candidate | Autopilot feature | Mod surface | User value | Effort | Risk | Status |
|---|---|---|---|---|---|---|---|
| 1 | Live dispatch/foreman band: running hands, elapsed, last rc, QUIET flag | `dispatch-status.js --list`, `watch-foreman.js` | `AbovePrompt` band + `$.clock.every` + `$.process.run(node scripts/dispatch-status.js --list --json?)` (flag unverified) or `$.fs` read of manifests | answers "why so slow" without asking; replaces most Monitor polling | M | Low: read-only, additive. Fallback elsewhere: existing CLI/Monitor path untouched. Duplicate risk: two pollers if foreman-guard's polling cap is also counted; mod timers are not Bash calls so they do not hit the cap. | SPIKE (API V-file) |
| 2 | Completion/verdict toasts + wake | background agent done, review verdict, push verified | `turn.complete` (agentId) / `$.agent.list`, `$.ui.toast`, `$.prompt.submit` | closes the "parked agent never wakes" gap; owner sees completion immediately | M | Medium: `$.prompt.submit` starts a model turn (spends tokens, could loop); must be rate-limited and opt-in. Fallback: current self-poke/Monitor recipe. | SPIKE |
| 3 | Cost band + fuse in-process | cost-fuse, cost-tracker, cost-digest | `session.measure` -> `$.session.usage().cost`, status line/band; optional `tool.call` deny in block mode | live brain-tier spend vs `daily_usd_brain`, no context injection; avoids ledger lag (ledger is written at Stop) | S-M | Low-Med: `usage().cost` is session-only, fuse is per-day per-tier from ledger, so still need `costs.jsonl`; model-tier split needs per-model data (unverified whether `cost` itemizes by model). Fallback: keep hook. | SPIKE |
| 4 | Replace statusline-live-tee | statusline-live-tee.js + live-state-dir | `session.measure` writes `context/<sid>.json` via `$.fs` (schema_version 1 record already defined) | removes the need to wrap the user's statusLine (config-invasive); works without codeforge | S | Low: same file contract; keep tee for other hosts. Check `$.fs` can write to tmpfs `$XDG_RUNTIME_DIR` (absolute path allowed per types, but an `fs.*` hook may restrict). | SPIKE |
| 5 | Hot-path guards as `tool.call` function hooks | foreman-guard, dispatch-model-guard, depth0-delegate-gate, cost-fuse | `on('tool.call',{tool},...)` returns `{deny}`; `e.agentId`/`parentAgentId` replace payload scraping and `Engine:` header heuristics | no per-call spawn; typed subagent identity; removes transcript-JSONL recovery for PostToolUse | L | High: must reproduce exact deny semantics and reuse the guard libs (they are Node, mod env has no Node: logic would need a JS port, risking drift; `$.process.run` per call would erase the latency gain). Must not duplicate: both paths firing double-counts counters. Fallback: classic hooks stay the only path elsewhere. | SPIKE; measure first with existing benchmark |
| 6 | qc-gate / review status line | qc-gate, hetero-review-loop, plan-review panel progress (`dispatch-status.js --panels`) | `$.ui.status` or pane | glanceable verdict state | S | Low | SPIKE |
| 7 | Foreman pane with buttons | run-approval-gate, l5 control loop | `Pane` + `Button` (`ui.press`), `$.command.register('/autopilot-status')` | interactive; approve/inspect without typing | L | Medium: **approvals must stay human-tty-gated** (CLAUDE.md global: models never approve); a Button is a human action but ADR-0001 and run-approval design need review before wiring | SPIKE, defer |
| 8 | Slash commands for scripts (`/ap-next`, `/ap-cost`) | scripts inventory | `$.command.register` + `command.run` -> `$.process.run` | discoverability | S | Low, but skills already cover this | low priority |
| 9 | Context-budget/handoff nudges as real UI | context-budget, suggest-compact | band/toast instead of injected text | less context pollution | S | Low | SPIKE |
| 10 | System-prompt sections (replace SessionStart injection) | session-start.js, advisory-relay | `prompt.compose` `scope: 'session'` | cleaner than hook stdout injection | M | Medium: changes what the model sees = guidance change, needs eval evidence per repo rule | defer |

Things that would break or duplicate if done carelessly: (a) double enforcement (classic + mod) of the same guard; (b) the 4 MiB / no-Node sandbox means existing Node libs cannot be `require`d, so mods should shell out to existing scripts via `$.process.run` for reads (keep scripts the single source of truth) and avoid re-implementing logic; (c) `check-claude-md-inventory.js`/hook-inventory gates count hooks and scripts: a mod folder needs a place in plugin.json/inventory and a version patch bump (new shipped code), and `hooks/hooks.json` format is parsed by autopilot gates, so adding `modules` there needs a gate check; (d) ADR-0001: a mod's UI is telemetry, never a verdict input.

Portability stance: mods = CC-only enhancement layer, shipped as optional, off by default or auto-detecting `typeof $.ui`; nothing in Codex/OpenCode/agy mirrors may reference it; `multi-agent-portability.md` should get a row only after a run-proven spike (project rule: no unverified claims).

## Part 4 — Recommendation

Top 3 to prototype (all in a separate scratch mod outside the repo first; no repo edits until owner says go):

1. **Live dispatch band + completion toast (candidates 1+2, read-only first).** Build `ap-live` mod: on `session.start` start `$.clock.every(5000)` that runs `node <autopilot>/scripts/dispatch-status.js --list` (confirm its machine format first) and `$.fs.list` on the manifest dir, renders an `AbovePrompt` band (count running, oldest elapsed, any stalled), toasts on a manifest turning final. Phase 2 only: `$.prompt.submit` wake behind a user config flag with a hard max N per hour. Prove: run a real `/l5` dispatch in a throwaway repo, compare time-to-notice vs Monitor path; check the band survives hot reload and `claude -p` (should be inert). Measure: poll cost (ms per tick, `$.process.run` count), no token use in phase 1, wake loop count in phase 2, behaviour at <144 cols and in the desktop tab.
2. **Cost band (candidate 3).** `ap-cost` mod: `session.measure` reads `$.session.usage().cost` and rate limits, plus `$.fs.read` of `~/.claude/metrics/costs.jsonl` tail to compute today's brain-tier spend, shows `brain $X / $150` in `$.ui.status`, toast at 80%/100% (advisory only, mirrors warn mode). Prove: compare its number against `node scripts/cost-digest.js --today --json` over a real day; measure drift and whether `cost` itemizes by model. Fuse blocking stays in the classic hook.
3. **Hook latency measurement before any port (candidate 5 groundwork).** Do not port guards yet. Use `claude --debug` timing plus the existing `scripts/benchmark-hook-multiplexer.js` to get a per-tool-call baseline (spawn count x ms), then prototype ONE guard (`dispatch-model-guard`, simplest `Task|Agent` PreToolUse, low call rate) as a `tool.call` hook returning the same deny text; run both on the same fixtures and diff outputs (reference-parity-gate skill). Measure: p50/p95 added latency, deny parity, and whether `e.agentId` removes the `Engine:` heuristic. Only if the win is material and parity is 100% continue with others.

(candidate 4, statusline tee replacement, is the cheapest follow-up: S effort, same file contract.)

### Open questions for the owner
1. Ship mods inside the autopilot plugin (hooks.json `modules` beside classic hooks; load-time coexistence unproven) or as a separate optional plugin `autopilot-mods`? Separate is safer for standalone/other-platform parity.
2. Is `$.prompt.submit` auto-wake acceptable (it spends model turns unasked)? Default off with budget?
3. The hot-reload gate is a human-only prompt; for dogfood, who enables it, and are mods allowed under your managed/untrusted-workspace setups?
4. Which surface do you actually use (terminal fullscreen vs desktop Code tab vs vscode)? Panes need >=144 columns unasked; desktop behavior is unverified.
5. Version policy: a mod is shipped code, so PATCH bump (new script/hook class) or MINOR (new user-facing surface)? CLAUDE.md semver table does not cover it.
6. Unverified items to spike before any claim lands in docs: runtime load of `modules`+classic hooks together, `dispatch-status.js` JSON flag for `--list`, `$.session.usage().cost` model itemization, `$.fs` write to tmpfs, desktop surface behavior, public doc URL for the mods API.
