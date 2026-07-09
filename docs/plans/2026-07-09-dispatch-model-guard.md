# Plan — dispatch-model-guard: ask-the-user gate on expensive-engine Agent dispatch

> Status: APPROVED 2026-07-09 — D1=`fable` only; D2=`ask` (fail-closed); D3=fail-open (allow+warn)
> Owner: depth-0 CEO session
> Branch: TBD (`feat/dispatch-model-guard`)
> Frame: the empirical probe (2026-07-09) proved an Agent dispatch with no `model:` silently inherits `claude-fable-5` and runs — 45k subagent tokens at Fable rates for a 5-second task. Three layers (autopilot hooks, user settings, memory discipline) all have NO mechanical enforcement. Sibling of the shipped `on_engine_unavailable` key (v2.32.12): that governs engine-death fallback; this governs dispatch-time model selection.

## 0. Context / thesis

User rule: **any dispatch that would land on a guarded engine (i.e. Fable) must ASK the user first** — never silently spend the most expensive model on delegate labor. Enforcement must be mechanical (a hook), not prose (memory/CLAUDE.md), because the failure mode is precisely "the model forgot".

Mechanism: a PreToolUse hook on the subagent-dispatch tool returning `permissionDecision: "ask"` — Claude Code surfaces a native permission prompt with the reason; the user approves or denies per-call. `deny` is NOT the default posture: legitimate Fable dispatches exist (e.g. a hard verify stage); the point is consent, not prohibition.

## 1. File-structure map

| File | Responsibility |
|------|----------------|
| `hooks/dispatch-model-guard.js` | NEW opt-in PreToolUse hook (Node built-ins only). Reads fd-0 payload (`_shared` getToolEvent pattern), self-gates via `_shared/opt-in.js`, decides allow / ask. |
| `hooks/hooks.json` | Wire PreToolUse matcher for the dispatch tool (exact tool name = Spike S1: `Task`, `Agent`, or both). |
| `hooks/opt-in-manifest.json` | Add `dispatch-model-guard` stem (default-off tier). |
| `hooks/README.md` | Tier table row + usage/enable doc. |
| `settings.example.json` | Enable example. |
| `project-config-template/dispatch-guard-config.md` | NEW tiny DI config: `guarded_models`, `on_missing_model`, `mode`. |
| `hooks/tests/dispatch-model-guard.test.sh` | Synthetic-payload unit tests (ask/allow/malformed). |
| `CHANGELOG.md` | vNEXT entry with the mandatory `opt-in` paragraph (check-optin-changelog gate). |

## 2. Behavior spec

Decision logic (per PreToolUse event on the dispatch tool):

```
model = tool_input.model (lowercase, trimmed)
if hook not enabled (opt-in.js)            → exit 0 (no-op)
if model present  and matches guarded list → ask  ("dispatching to guarded engine '<m>' — approve, or set a cheaper model per scripts/resolve-dispatch.sh")
if model present  and not guarded          → allow (exit 0, silent)
if model ABSENT                            → on_missing_model policy:
    ask  (default, fail-closed)            → ask  ("model omitted — would inherit the session model (may be Fable); set model: explicitly")
    allow                                  → allow
```

- **Guarded list matching**: case-insensitive substring on the `model` param (`fable` matches `fable`, `claude-fable-5`). Default list: `fable`. NOT `opus` by default (user said "ie. fable"); config可加.
- **`mode` enum**: `ask` (default) | `warn` (allow + stderr/systemMessage advisory — calibration mode) | `off`. Garbage → `ask` (fail-closed, same stance as `on_engine_unavailable`).
- **Malformed/empty payload**: allow + stderr warning (**fail-open**). Rationale: a payload-schema change must not brick every subagent dispatch on the machine; the guard is a spend-control, not a security boundary. (Decision point D3 below — flip to fail-closed if user prefers.)
- **Headless implication**: in `claude -p` / foreman contexts, `ask` cannot prompt → effectively deny; the reason string instructs the dispatching model to re-dispatch with an explicit cheaper `model:`. This is desirable fail-closed behavior for /l4–/l6 depth-1 foremen (they should never dispatch Fable delegates anyway).
- **Out of scope v1** (→ BACKLOG entries): `Workflow` tool `agent()` calls (inherit main-loop model inside the workflow runtime — hook sees only the Workflow call, not per-agent models); parent-session-model detection (S2 may make the omitted-model ask smarter later); non-CC hosts.

## 3. Phases

### P0 — Spike: payload facts (size S; blocks P1)

Repo rule: no env-var/payload claims without verification. Use `scripts/toggle-payload-capture.js` (existing Tier-B diagnostic) + a scratch always-on capture hook.

- S1: exact `tool_name` the hook sees for a subagent dispatch (`Task` vs `Agent`) — capture one real dispatch.
- S2: does the PreToolUse payload carry the session model anywhere? (If yes, omitted-model case can allow when parent is cheap.)
- S3: `permissionDecision: "ask"` accepted by current CC (2.x) PreToolUse JSON output — verify live (dispatch guarded model, observe native prompt).
- S4: `ask` behavior under headless `claude -p` (expect deny-with-reason; record).

**Done when**: all four answers recorded in this plan's § 5 (facts, not guesses).

### P1 — Hook + config + tests (size S)

- `hooks/dispatch-model-guard.js`: fd-0 read (`fs.readFileSync(0)` + `/dev/stdin` fallback, same as branch-protection), opt-in self-gate, config read from `$PWD/.claude/dispatch-guard-config.md` → repo `.claude/` → template default (resolve-* order, but in-process Node — no shell-out per tool call).
- Output on ask: `{hookSpecificOutput:{hookEventName:"PreToolUse", permissionDecision:"ask", permissionDecisionReason:"…"}}`.
- `hooks/tests/dispatch-model-guard.test.sh`: synthetic payloads — guarded-explicit → ask; cheap-explicit → allow; omitted → ask (default) / allow (config); `mode: warn` → allow+advisory; garbage config → ask; malformed payload → allow+warn; disabled → no-op.

**Done when**: test file green; hook never crashes on any synthetic input.

### P2 — Wiring + inventory + release hygiene (size Fix)

- hooks.json PreToolUse entry (matcher per S1); opt-in-manifest + README tier table + settings.example.json.
- `check-hook-inventory.js --check` green (23 hooks: 10 default-on + 13 opt-in); `sync-version.js --version <PATCH> --hook-count 23 --skill-count 28`; CHANGELOG with `opt-in` paragraph (check-optin-changelog gate); INDEX fix-ship row; `preflight-release.sh` 8/8.

### P3 — Live e2e on this machine (size Fix)

- Enable via `~/.autopilot/config.json {"hooks":{"dispatch-model-guard":true}}`.
- Probe A: Agent dispatch `model: fable`-class → native ask prompt appears (user sees it — this is the acceptance the user asked for: "用 fable 派遣會被擋下").
- Probe B: omitted model → ask. Probe C: `model: haiku` → silent allow.
- Record in CHANGELOG/plan; leave enabled on this machine.

Dependency: P0 → P1 → P2 → P3. Execution per /l6 (impl + tests dispatched hetero; depth-0 orchestrates + runs Spike probes since they need THIS session's harness).

## 4. Risks / inversion

- **"ask" unsupported or renamed in current CC** → P0 S3 catches; fallback design: `deny` + reason (harsher but mechanical).
- **Hook bricks all dispatches** (bug/payload change) → fail-open malformed posture + opt-in tier + `mode: off` escape hatch.
- **Foreman deadlock** (headless ask) → reason string self-describes the fix; /l4–/l6 front-door docs get one line noting delegates must carry explicit `model:`.
- **Tool-name drift** (harness renames Task→Agent) → matcher covers both if S1 ambiguous.

## 5. Spike findings (P0 — verified empirically 2026-07-09, live capture via scratch `--settings` headless haiku session; corroborated by official docs https://code.claude.com/docs/en/hooks.md — S1 matcher list names `Agent`, S2 "PreToolUse does not receive a model field", S3 enum `allow|deny|ask|defer`; S4 undocumented, answered by the live probe only)

- S1: `tool_name` = **`Agent`** (captured payload). Matcher ships as `Task|Agent` for version drift safety.
- S2: PreToolUse payload keys = `session_id, transcript_path, cwd, prompt_id, permission_mode, hook_event_name, tool_name, tool_input, tool_use_id` — **NO session-model field**. Omitted-model case cannot know the parent model → D2 `ask` fail-closed confirmed necessary. `tool_input` carries `model` only when explicitly passed.
- S3: `permissionDecision: "ask"` JSON output **accepted and acted on** by CC (headless probe: call refused pending permission, reason surfaced). Interactive prompt UX verified at P3.
- S4: headless (`claude -p`): ask ⇒ **tool call refused + `permissionDecisionReason` string delivered to the model**, which stops/adapts — desired fail-closed foreman behavior, reason string doubles as the re-dispatch instruction.

## 6. Open decision points (user)

- **D1 guarded list default**: `fable` only(建議,可自行加 opus)vs `fable,opus`.
- **D2 omitted-model default**: `ask`(fail-closed,建議 — 這正是 45k-token 事故的路徑)vs `allow`.
- **D3 malformed-payload posture**: fail-open allow+warn(建議)vs fail-closed ask.
