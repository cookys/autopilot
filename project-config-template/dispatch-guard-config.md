# dispatch-guard-config — per-project expensive-model dispatch gate

> Copy to `.claude/dispatch-guard-config.md` in the consuming project to override.
> Resolved in-process by [`hooks/dispatch-model-guard.js`](../hooks/dispatch-model-guard.js)
> (opt-in PreToolUse hook on `Task|Agent`). Override path via
> `$DISPATCH_GUARD_CONFIG_OVERRIDE`. Sibling of the spend-control discipline in
> `scripts/resolve-dispatch.sh`: this hook mechanically asks when a subagent
> dispatch would land on a guarded expensive engine or omit `model:` entirely.

This is the **expensive-model dispatch forcing function**: an omitted `model:`
silently inherits the session model (which may be Fable-class), and an explicit
`fable` / `claude-fable-5` lands on a high-cost engine without a second look. The
hook returns a native PreToolUse `permissionDecision: "ask"` so the operator
approves deliberately — or re-dispatches with a cheaper explicit model. Fail-open
on unreadable payloads (spend control, not a security boundary).

## Settings (one `key: value` per line; first match wins)

- guarded_models: fable
- guarded_models_implementing: fable,opus
- on_missing_model: ask
- require_engine_header: on
- mode: ask

## Field reference

| Key | Values | Meaning |
|-----|--------|---------|
| `guarded_models` | comma-separated tokens | Case-insensitive substring match against `tool_input.model` (e.g. `fable` matches `claude-fable-5`). Empty/garbage → default `fable`. |
| `guarded_models_implementing` | comma-separated tokens | Case-insensitive substring match against `tool_input.model`, applied ONLY when the dispatch is implementation-shaped (`tool_input.mode` is absent or not `"plan"`); union'd with `guarded_models`. Empty/garbage → default `fable,opus`. |
| `on_missing_model` | `ask` \| `allow` | When `model` is omitted, this decides outright BEFORE `require_engine_header` runs (there is nothing for the header to match against): `ask` = permission ASK (default); `allow` = pass through. Garbage → `ask` (fail-closed). |
| `require_engine_header` | `on` \| `off` | Only evaluated when `model` is present. When `on` (default), the dispatch prompt's first non-empty line must be `Engine: <model>…` matching `tool_input.model`, or the dispatch is denied (not asked — mechanical, nothing for a human to approve). Garbage → `on` (fail-closed). |
| `mode` | `ask` \| `warn` \| `off` | `ask` = native permission ASK; `warn` = advisory stderr only; `off` = inert. Garbage → `ask` (fail-closed). |

## Defaults & fail-closed

Unknown / missing / unparseable config keys → **`mode: ask`**, **`on_missing_model: ask`**,
**`guarded_models: fable`**, **`guarded_models_implementing: fable,opus`**,
**`require_engine_header: on`**. Set `mode: warn` to calibrate before enforcing, or
`mode: off` / leave the opt-in hook disabled to skip entirely.

## Enable the hook

The hook is **opt-in** (default-off). Enable via:

```json
{ "hooks": { "dispatch-model-guard": true } }
```

in `~/.autopilot/config.json`, or env `AUTOPILOT_HOOK_DISPATCH_MODEL_GUARD=1`.
