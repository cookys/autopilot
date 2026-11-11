# dispatch-guard-config — per-project expensive-model dispatch gate

> Copy to `.claude/dispatch-guard-config.md` in the consuming project to override.
> Resolved in-process by [`hooks/dispatch-model-guard.js`](../hooks/dispatch-model-guard.js)
> (opt-in PreToolUse hook on `Task|Agent`). Override path via
> `$DISPATCH_GUARD_CONFIG_OVERRIDE`. Sibling of the spend-control discipline in
> `scripts/resolve-dispatch.sh`: this hook mechanically reminds the dispatching agent when a
> subagent dispatch would land on a guarded expensive engine or omit `model:` entirely.

This is the **expensive-model dispatch forcing function**: an omitted `model:`
silently inherits the session model (which may be Fable-class), and an explicit
`fable` / `claude-fable-5` lands on a high-cost engine without a second look. The
hook returns a native PreToolUse `permissionDecision: "deny"` whose reason hands the
decision to the **dispatching agent** (default `mode: remind`, v2.36.9): re-dispatch
with a cheaper explicit model, or keep the engine and mark line 1
`Engine: <model> (intentional: <why>)`, which the guard then allows silently. No human
dialog is opened (owner ruling 2026-09-06: the dialog blocked the session; the agent
should judge). `mode: ask` opts back into the interactive dialog. Fail-open on
unreadable payloads (spend control, not a security boundary).

An Agent brief opens `Engine: <model>`, then `Role: <role>`, then `Lane: <slug>`.
For fable or opus the fourth line is `Cost:` (exact text from `costLineFor` in
`hooks/lib/brief-header-template.js`) and it must sit in the first 6 lines. A missing
Cost line is denied even when line 1 is marked `(intentional: …)`. Sonnet may carry
an advisory Cost line and is never denied for omitting it; haiku and any other model
get no Cost line.

## Settings (one `key: value` per line; first match wins)

- guarded_models: fable
- guarded_models_implementing: fable,opus
- on_missing_model: deny
- require_engine_header: on
- require_cost_line: on
- mode: remind

## Field reference

| Key | Values | Meaning |
|-----|--------|---------|
| `guarded_models` | comma-separated tokens | Case-insensitive substring match against `tool_input.model` (e.g. `fable` matches `claude-fable-5`). Empty/garbage → default `fable`. |
| `guarded_models_implementing` | comma-separated tokens | Case-insensitive substring match against `tool_input.model`, applied ONLY when the dispatch is implementation-shaped (`tool_input.mode` is absent or not `"plan"`); union'd with `guarded_models`. Empty/garbage → default `fable,opus`. |
| `on_missing_model` | `deny` \| `ask` \| `allow` | When `model` is omitted, this decides outright BEFORE `require_engine_header` runs (there is nothing for the header to match against): `deny` = native DENY whose reason tells the model to re-dispatch with `model:` (default since v2.36.2 — a missing model is never a human judgment, and an interactive `ask` made the owner click through a dialog); `ask` = permission ASK (the pre-v2.36.2 dialog); `allow` = pass through. Garbage → `deny` (fail-closed). |
| `require_engine_header` | `on` \| `off` | Only evaluated when `model` is present. When `on` (default), the dispatch prompt's first non-empty line must be `Engine: <model>…` matching `tool_input.model`, or the dispatch is denied (not asked — mechanical, nothing for a human to approve). Garbage → `on` (fail-closed). |
| `require_cost_line` | `on` \| `off` | When `on` (default), a fable or opus dispatch whose first 6 lines have no `Cost:` line is denied. The effective model is `tool_input.model`, or the `Engine:` token when `model` is absent. The reason names `require_cost_line` and the exact line to paste. This deny still fires when the Engine header is marked `(intentional: …)`. Sonnet and haiku are never denied for a missing Cost line. Garbage → `on` (fail-closed). Parsed like `require_engine_header`. |
| `mode` | `remind` \| `ask` \| `warn` \| `off` | `remind` (default since v2.36.9) = native DENY carrying the reminder and the two legal re-dispatches; a dispatch whose Engine header carries `(intentional: …)` is allowed silently (a missing Cost line on fable/opus is still denied); `ask` = native permission ASK (the pre-v2.36.9 dialog); `warn` = advisory stderr only; `off` = inert. Garbage → `remind` (fail-closed, no dialog). |

## Defaults & fail-closed

Unknown / missing / unparseable config keys → **`mode: remind`**, **`on_missing_model: deny`**,
**`guarded_models: fable`**, **`guarded_models_implementing: fable,opus`**,
**`require_engine_header: on`**, **`require_cost_line: on`**. Set `mode: warn` to calibrate before enforcing, or
`mode: off` / leave the opt-in hook disabled to skip entirely.

## Enable the hook

The hook is **opt-in** (default-off). Enable via:

```json
{ "hooks": { "dispatch-model-guard": true } }
```

in `~/.autopilot/config.json`, or env `AUTOPILOT_HOOK_DISPATCH_MODEL_GUARD=1`.
