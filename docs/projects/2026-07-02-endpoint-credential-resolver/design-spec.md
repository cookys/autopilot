# Design Spec — Unified autopilot endpoint credential resolver

**Status**: spec (pre-impl) · **Base SHA**: `4fb7637890231ebadd24ca24ebe6f8877eef43bd` · **Version target**: `2.29.1` (PATCH — new script + hardening of existing dispatch scripts, no new user-facing skill/agent).

## Problem

autopilot has **no unified credential convention** for the env-token hetero-dispatch families (MiniMax / GLM / any Anthropic-compatible endpoint). What exists is a scattered half-measure:

- Base URL: `AUTOPILOT_MINIMAX_BASE_URL` (autopilot-namespaced, URL only) with fallback chain in `dispatch-anthropic-review.js`.
- Token: raw **provider-native** names, **hostname-routed** — `*.minimax.io` → `MINIMAX_API_KEY`; everything else → the single `ANTHROPIC_COMPATIBLE_AUTH_TOKEN`; cc-shim in `dispatch-hetero.sh` → raw `ANTHROPIC_AUTH_TOKEN` + `ANTHROPIC_BASE_URL`.

Consequences: (1) no single place to register a family's credentials; (2) cannot hold **multiple** compatible endpoints at once (MiniMax + GLM + another all collapse onto one `ANTHROPIC_COMPATIBLE_AUTH_TOKEN`); (3) the user must memorize three different prefixes across three scripts.

The OAuth-login families (codex / agy / grok / claude) are **out of scope** — they authenticate via their own CLI login files (`~/.codex`, `~/.gemini`, `~/.grok`, `~/.claude`) and need no env token.

## Goal

A **named-endpoint** convention plus a resolver that the three dispatch scripts consult, so any number of Anthropic-compatible endpoints can be registered by logical name, resolved uniformly, with provider-native env kept as a backward-compatible override — **without ever printing a secret**.

## Design

### Convention (Option 1 — pure env namespace)

```
AUTOPILOT_ENDPOINT_<NAME>_URL     # base URL for logical endpoint <NAME>
AUTOPILOT_ENDPOINT_<NAME>_TOKEN   # bearer token
```
`<NAME>` is uppercased, `[A-Z0-9_]+` (e.g. `MINIMAX`, `GLM`, `LOCAL_LLAMA`). Multiple endpoints coexist by distinct NAME. Secrets live only in the user's shell rc / secret manager — never on disk in the repo, never in a tracked config file.

### `scripts/resolve-endpoint.sh` (NEW — bash, sibling of `resolve-doa.sh`/`resolve-qc-gate.sh`)

**CRITICAL secret-hygiene invariant**: this script **NEVER writes a token value to stdout, stderr, or any log**. It emits only *metadata* — the URL (non-secret), the *name of the env var* that holds the token (`token_env`), and booleans. Callers read `$token_env` themselves so the token value never transits a subshell's captured stdout.

- **Usage**: `resolve-endpoint.sh <name>` → JSON, or `resolve-endpoint.sh --list`, or `--help`.
- **Resolution order** for `<name>` (first hit wins; records `*_source`):
  1. autopilot namespace: `AUTOPILOT_ENDPOINT_<NAME>_URL` + `AUTOPILOT_ENDPOINT_<NAME>_TOKEN` (`source: autopilot-namespace`).
  2. known provider-native fallback (backward compat): for `name==minimax` → url `AUTOPILOT_MINIMAX_BASE_URL` else default `https://api.minimax.io/anthropic`; token env `MINIMAX_API_KEY` (`source: provider-native`).
  3. generic compatible fallback: url `ANTHROPIC_COMPATIBLE_BASE_URL`, token env `ANTHROPIC_COMPATIBLE_AUTH_TOKEN` (`source: generic-compatible`).
- **JSON output** (stable schema; **no token value**):
  ```json
  {"name":"minimax","base_url":"https://api.minimax.io/anthropic","base_url_source":"default",
   "token_env":"MINIMAX_API_KEY","token_present":true,"ready":true,"source":"provider-native"}
  ```
  `token_present` = the resolved `token_env` is set and non-empty. `ready` = both a base_url AND a present token were resolved.
- **`--list`**: one JSON array of every endpoint for which BOTH url and a present token resolve, each `{name, base_url, source}` — never token values. Enumerates `AUTOPILOT_ENDPOINT_*_TOKEN` env keys + the known `minimax`/generic fallbacks.
- **Exit codes**: `0` ready · `1` not-ready (missing url or token) · `2` usage error. Fail-closed: unknown/garbage name with nothing resolvable → exit 1, `ready:false`.

### Wiring (existing scripts — additive, backward-compatible)

All three gain an optional `--endpoint <name>` flag. When given, they call `resolve-endpoint.sh <name>`; on `ready:false` they `die_precondition` with the exact missing var name(s). Raw provider-native env stays as override when `--endpoint` is absent (zero behaviour change to current callers).

1. **`scripts/dispatch-hetero.sh`** (cc-shim implementer path, ~line 176-184): with `--endpoint`, populate the child `ANTHROPIC_BASE_URL` (from `base_url`) and `ANTHROPIC_AUTH_TOKEN` (read from `$token_env` **in-script**, not via resolver stdout). Preserve `env -u ANTHROPIC_API_KEY` (shim token stays sole auth). Existing explicit-`ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN` path unchanged.
2. **`scripts/dispatch-review.sh`** (cc-shim + anthropic-compatible paths): same `--endpoint` resolution feeding the runner's env / the `--base-url` it passes to `dispatch-anthropic-review.js`.
3. **`scripts/dispatch-anthropic-review.js`**: accept `--endpoint <name>` (shell resolves and passes `--base-url` + exports the token env the JS already reads), OR read `AUTOPILOT_ENDPOINT_<NAME>_*` directly. Keep the existing `MINIMAX_API_KEY`/`ANTHROPIC_COMPATIBLE_AUTH_TOKEN`/`AUTOPILOT_MINIMAX_BASE_URL` precedence as fallback. Preserve the existing double-redaction of the token in logs.

### Docs / release wiring (per CLAUDE.md "when adding a new script")

- CLAUDE.md scripts-inventory: new `resolve-endpoint.sh` row (alphabetical-by-purpose, near the other `resolve-*` rows).
- `references/hetero-dispatch.md`: document the `--endpoint`/`AUTOPILOT_ENDPOINT_*` convention.
- `project-config-template/review-loop-config.md` Gotchas: update the cc-shim env note to point at the new convention.
- CHANGELOG `2.29.1` PATCH entry; `scripts/sync-version.js --version 2.29.1 --hook-count 22 --skill-count 27`.

## Tests (no live model calls)

New `hooks/tests/resolve-endpoint.test.sh`:
- namespace hit (`AUTOPILOT_ENDPOINT_FOO_URL/_TOKEN` set) → `ready:true, source:autopilot-namespace`, correct `token_env`.
- minimax provider-native fallback (only `MINIMAX_API_KEY` set) → `ready:true, source:provider-native`, default url.
- generic fallback; missing token → `ready:false`, exit 1; missing url → exit 1.
- **secret-hygiene assertion**: seed a token, capture full stdout+stderr, assert the token *value* appears nowhere (only its env-var name may).
- `--list` shows only ready endpoints, no token values; usage/`--help` → exit 2/0.
- Wiring: `dispatch-hetero.sh --endpoint <unset>` → `precondition_failed` naming the missing var (dry, no dispatch); `dispatch-review.sh --endpoint <unset>` likewise.

## Scope boundary

**IN**: `resolve-endpoint.sh`; additive `--endpoint` wiring in the 3 dispatch scripts; tests; docs; CHANGELOG + version. **OUT**: any change to OAuth-login runners (codex/agy/grok/claude); new runners; secret-manager/keyring integration; a tracked credentials file; changing the reviewer/roster policy. No behaviour change for any current caller that doesn't pass `--endpoint`.

## Acceptance

1. `resolve-endpoint.sh minimax` with `MINIMAX_API_KEY` set → exit 0, `ready:true`; token value absent from output.
2. `AUTOPILOT_ENDPOINT_GLM_URL`+`_TOKEN` set → `resolve-endpoint.sh glm` exit 0, `source:autopilot-namespace`; a *second* endpoint resolvable simultaneously (multi-endpoint goal met).
3. Nothing set → exit 1, `ready:false`, no crash.
4. All new + existing focused tests green; `sync-version.js --check`, `check-hook-inventory.js --check`, `preflight-release.sh` pass.
5. No secret ever printed by the resolver (test-asserted).
