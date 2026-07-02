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
- **ATOMIC candidate resolution** (revised per spec-review R1 F2 — first-hit-*per-variable* was fail-open). A candidate = a `(url_var-or-default, token_var)` PAIR. Select the FIRST candidate whose **selection trigger** fires, then bind BOTH url and token from THAT candidate only — **never cross-combine a url from one candidate with a token from another**:
  1. **autopilot-namespace** — trigger: EITHER `AUTOPILOT_ENDPOINT_<NAME>_URL` OR `AUTOPILOT_ENDPOINT_<NAME>_TOKEN` is set (non-empty). Once triggered, url ← `AUTOPILOT_ENDPOINT_<NAME>_URL`, token_env ← `AUTOPILOT_ENDPOINT_<NAME>_TOKEN`, **no fallthrough** (a partial namespaced config resolves `ready:false` + `missing`, it does NOT fall to a generic token).
  2. **provider-native** (only if 1's trigger did not fire): for `name==minimax` → url `AUTOPILOT_MINIMAX_BASE_URL` else default `https://api.minimax.io/anthropic`; token_env `MINIMAX_API_KEY` (`source: provider-native`).
  3. **generic-compatible** (only if 1 & 2 did not fire): url `ANTHROPIC_COMPATIBLE_BASE_URL`, token_env `ANTHROPIC_COMPATIBLE_AUTH_TOKEN`.
- **JSON output** (stable schema; **no token value**):
  ```json
  {"name":"minimax","base_url":"https://api.minimax.io/anthropic","base_url_source":"default",
   "token_env":"MINIMAX_API_KEY","token_present":true,"url_safe":true,"ready":true,
   "missing":[],"source":"provider-native"}
  ```
  - `token_present` = the resolved `token_env` is set and non-empty (read via safe indirect expansion — see hygiene rules).
  - `url_safe` = base_url matches `^https://` OR an `http://` loopback host (`localhost`/`127.0.0.1`/`[::1]`) — mirrors `dispatch-anthropic-review.js`'s existing URL guard so a token is never reported ready-to-send to a plaintext remote (R1 F5).
  - `ready` = **base_url non-empty AND token_present AND url_safe** (all three). Any miss ⇒ `ready:false` and `missing` names the exact absent var(s)/reason (e.g. `["AUTOPILOT_ENDPOINT_GLM_TOKEN"]` or `["url_unsafe"]`).
- **MECHANICAL secret-hygiene rules** (R1 F3 — the invariant needs enforced mechanics, not just intent):
  - Validate `token_env` name against `^[A-Za-z_][A-Za-z0-9_]*$` before use; reject otherwise (fail-closed).
  - Read the value ONLY via bash indirect expansion `${!token_env-}` — never `eval`.
  - `--list` enumerates candidate names via `compgen -v` / bash var-name expansion — **never** by parsing `env`/`printenv` (that pipes token *values*).
  - `set +x` (disable xtrace) around any statement that touches a token value, so an inherited `SHELLOPTS=xtrace` cannot leak it to stderr.
- **`--list`**: one JSON array of every endpoint for which `ready:true`, each `{name, base_url, source}` — never token values.
- **Exit codes**: `0` ready · `1` not-ready (missing url/token, or unsafe url) · `2` usage error. Fail-closed: unknown/garbage name with nothing resolvable → exit 1, `ready:false`.

### Wiring (existing scripts — additive, backward-compatible)

All three gain an optional `--endpoint <name>` flag. When given, they call `resolve-endpoint.sh <name>`; on `ready:false` they `die_precondition` with the exact missing var name(s). Raw provider-native env stays as override when `--endpoint` is absent (zero behaviour change to current callers).

**Scope note (R1 F6)**: `--endpoint` is a **MANUAL-ONLY** flag in this PATCH. Threading `implementer_endpoint`/`reviewer_endpoint` through `review-loop-config.md` → `resolve-review-loop.sh` → the engine/`/l5`/`/l6` automation surface is an explicit **follow-up** (BACKLOG), NOT in scope here. The CLAUDE.md "wire it in" rule is satisfied by the inventory row + `references/hetero-dispatch.md` + the review-loop-config Gotchas note documenting the manual flag; the skills are deliberately left calling the current path.

1. **`scripts/dispatch-hetero.sh`** (cc-shim implementer path, ~line 176-184): with `--endpoint`, resolve; on `ready:false` `die_precondition` naming the missing var(s)/`url_unsafe`. On ready, populate child `ANTHROPIC_BASE_URL` ← `base_url` and `ANTHROPIC_AUTH_TOKEN` ← `${!token_env}` read **in-script** (never via resolver stdout), with `set +x` around the read/export. Preserve `env -u ANTHROPIC_API_KEY`. Existing explicit-`ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN` path (no `--endpoint`) unchanged.
2. **`scripts/dispatch-review.sh`** (cc-shim + anthropic-compatible paths): same `--endpoint` resolution. For anthropic-compatible it passes `--base-url <base_url>` AND `--token-env <token_env>` to the JS (see 3). For cc-shim, same env population as (1).
3. **`scripts/dispatch-anthropic-review.js`** (R1 F1 — named tokens must actually reach the JS): add a `--token-env <NAME>` flag. When given, validate the NAME (`^[A-Za-z_][A-Za-z0-9_]*$`) and read `process.env[NAME]` as the auth token **before** the existing hostname-routed `MINIMAX_API_KEY`/`ANTHROPIC_COMPATIBLE_AUTH_TOKEN` fallback. Do **NOT** copy a named token into a singleton fallback var (that reintroduces the collision this design removes). No `--token-env` ⇒ existing precedence byte-identical. Preserve the existing token double-redaction in logs and the existing URL-safety guard.

### Docs / release wiring (per CLAUDE.md "when adding a new script")

- CLAUDE.md scripts-inventory: new `resolve-endpoint.sh` row (alphabetical-by-purpose, near the other `resolve-*` rows).
- `references/hetero-dispatch.md`: document the `--endpoint`/`AUTOPILOT_ENDPOINT_*` convention.
- `project-config-template/review-loop-config.md` Gotchas: update the cc-shim env note to point at the new convention.
- CHANGELOG `2.29.1` PATCH entry; `scripts/sync-version.js --version 2.29.1 --hook-count 22 --skill-count 27`.

## Tests (no live model calls)

New `hooks/tests/resolve-endpoint.test.sh`:
- namespace hit (`AUTOPILOT_ENDPOINT_FOO_URL/_TOKEN` set, https) → `ready:true, source:autopilot-namespace`, correct `token_env`, `missing:[]`.
- minimax provider-native fallback (only `MINIMAX_API_KEY` set) → `ready:true, source:provider-native`, default url.
- generic fallback; missing token → `ready:false`, exit 1, `missing` names the token var; missing url → exit 1.
- **ATOMIC / no-fail-open (R1 F2)**: `AUTOPILOT_ENDPOINT_GLM_URL` set, `_TOKEN` UNSET, `ANTHROPIC_COMPATIBLE_AUTH_TOKEN` ALSO set → MUST be `ready:false, source:autopilot-namespace, missing:["AUTOPILOT_ENDPOINT_GLM_TOKEN"]` (must NOT cross-combine GLM url + generic token). Symmetric partial-minimax case.
- **URL-safety (R1 F5)**: namespaced endpoint with `http://evil.example` token present → `url_safe:false, ready:false, missing:["url_unsafe"]`, exit 1; `http://127.0.0.1:4000` → `url_safe:true`.
- **secret-hygiene (R1 F3)**: seed a token, capture full stdout+stderr, assert the token *value* appears nowhere (only its var name may) — for BOTH a resolve and a `--list` run. Plus an **xtrace-leak** case: run under `SHELLOPTS=xtrace` / `bash -x` and assert the token value still appears nowhere on stderr.
- invalid `token_env` name (namespaced var name with a metachar via a crafted NAME) → rejected fail-closed.
- `--list` shows only `ready:true` endpoints, no token values; usage/`--help` → exit 2/0.
- Wiring: `dispatch-hetero.sh --endpoint <unset>` → `precondition_failed` naming the missing var (dry, no dispatch); `dispatch-review.sh --endpoint <unset>` likewise.
- **byte-identical no-endpoint regression (R1 F4)**: with a **stub `resolve-endpoint.sh` on PATH that exits non-zero if called**, run `dispatch-review.sh`/`dispatch-hetero.sh` cc-shim + anthropic-compatible with the OLD flags and NO `--endpoint` → the stub is never invoked and the existing base-url/token precedence path is preserved (mock-node assertion on the args the JS receives).
- **JS `--token-env` (R1 F1)**: `dispatch-anthropic-review.js --token-env AUTOPILOT_ENDPOINT_GLM_TOKEN` reads THAT var before hostname fallback; no `--token-env` ⇒ existing precedence unchanged; invalid name rejected.

## Scope boundary

**IN**: `resolve-endpoint.sh`; additive `--endpoint` wiring in the 3 dispatch scripts; tests; docs; CHANGELOG + version. **OUT**: any change to OAuth-login runners (codex/agy/grok/claude); new runners; secret-manager/keyring integration; a tracked credentials file; changing the reviewer/roster policy. No behaviour change for any current caller that doesn't pass `--endpoint`.

## Acceptance

1. `resolve-endpoint.sh minimax` with `MINIMAX_API_KEY` set (https url) → exit 0, `ready:true`; token value absent from output.
2. `AUTOPILOT_ENDPOINT_GLM_URL`+`_TOKEN` (https) set → `resolve-endpoint.sh glm` exit 0, `source:autopilot-namespace`; a *second* endpoint resolvable simultaneously (multi-endpoint goal met).
3. Nothing set → exit 1, `ready:false`, no crash.
4. **No fail-open**: partial namespaced config (url set, token unset) with a generic token also set → `ready:false` + `missing`, exit 1 (never cross-combined). Unsafe url (plaintext remote) → `ready:false`, exit 1.
5. **No secret leak**: token value absent from resolver stdout+stderr on resolve AND `--list`, INCLUDING under `bash -x`/`SHELLOPTS=xtrace` (test-asserted).
6. **Additive**: with a fail-if-called stub resolver on PATH, no-`--endpoint` callers of the 3 dispatch scripts behave byte-identically (stub never invoked).
7. Named token reaches the JS runner: `dispatch-anthropic-review.js --token-env AUTOPILOT_ENDPOINT_<NAME>_TOKEN` uses that var before hostname fallback.
8. All new + existing focused tests green; `sync-version.js --check`, `check-hook-inventory.js --check`, `preflight-release.sh` pass.

## Revision log
- **R1 (2026-07-02)**: decorrelated spec review (gpt-5.5, xhigh) returned `REVISE-SPEC` with 5 🟠 + 1 🟡. All accepted after verification: atomic candidate resolution (no fail-open cross-combine); mechanical secret-hygiene (`${!token_env-}`, name regex, `compgen -v`, xtrace-off); JS `--token-env` so named tokens actually reach the direct HTTP runner; URL-safety in `ready`; byte-identical no-endpoint regression tests with a fail-if-called stub; `--endpoint` declared manual-only (config-surface wiring → BACKLOG follow-up).
