# Endpoint transport opt-in + exam/routing parity (v2.35.11)

**Branch**: `feat/v2.35.11-endpoint-transport-optin` · **Plan**: [`docs/plans/2026-09-03-endpoint-transport-optin.md`](../../plans/2026-09-03-endpoint-transport-optin.md) · **Status**: in progress

## Project Goal

> **Final goal**: a local Anthropic-protocol model on a private LAN can be routed to as implementer through the SAME named-endpoint definition the qualification exam used, with the transport class disclosed on the evidence row.
> **Success criteria**: (1) `resolve-endpoint.sh` returns `ready:true` + `transport_security:plaintext_private` for a private-IP `http://` URL only when `_TRANSPORT=plaintext-private` is set, and `ready:false` for hostname/public-IP/no-flag (asserted in `hooks/tests/resolve-endpoint.test.sh`); (2) `engine-qualify.sh implementer --endpoint` resolves through the same script and the emitted row carries `endpoint.transport_security` (asserted in `scripts/engine-qualify-impl.test.js`); (3) full suite green; (4) dogfood: one `dispatch-hetero.sh --endpoint qwen38` probe commits against the flash-next deployment.
> **Scope boundary**: IN — resolve-endpoint.sh, both loaders, endpoints CLI, dispatch-hetero stderr notice, engine-qualify implementer, docs/recipe, CHANGELOG, version. OUT — `endpoints test` model id, `local-deployment.js` policy, cc-shim effort forwarding, any new adaptor.

## Scope completeness audit (L-1.5)

| Dimension | Coverage |
|---|---|
| Source + tests | P0 (resolver/loaders/CLI/hetero) + P1 (qualify) with tests in 4 existing test files |
| User-facing docs | P2: engine-onboarding recipe, hetero-dispatch runner row, endpoints.env.example |
| API / interface reference | P2: scripts-inventory row; `--help` text in resolve-endpoint.sh / engine-qualify.sh |
| Config templates | `scripts/endpoints.env.example` (P2); review-loop-config template unchanged (field exists) |
| CHANGELOG / version | P2: v2.35.11 section (also records the unbumped ladder-run `--gate-cmd` merge `44c7181d`) + `sync-version.js` + grep sweep |
| Migration | none — additive key, absent ⇒ byte-identical behaviour |
| Dependent consumers | dispatch-review / dispatch-author / dispatch-anthropic-review / qualification-sweep parse only base_url+token_env — verified additive |
| Credit | none |
| Dogfood | P2: flash-next seat re-pointed through `AUTOPILOT_ENDPOINT_QWEN38_*` |

**User-stated requirements**: 「用系統性的方法做好」→ D1+D2+D3 (policy in one owner, exam parity, team recipe); 「我個人暫時可以不要去動 api key 的時候繞過」→ D1 `plaintext-private` opt-in (no proxy, placeholder token).

## Skill routing (L-1.6)

No `.claude/skill-routing.md` in this repo; dev-flow invoked. Areas: scripts (bash/node) — N/A, conventions in CLAUDE.md language table; src/endpoints — N/A; tests — `hooks/tests/lib.sh` assert helpers, existing files extended.

## Progress

| Phase | Status | Commit |
|---|---|---|
| P0 transport opt-in (resolver, loaders, CLI, hetero notice, tests) | done | `cceb4d8b` |
| P1 engine-qualify `--endpoint` parity + row disclosure + tests | done | `6ada25f6` |
| P2 docs, CHANGELOG, version, dogfood (qwen38 endpoint resolved `plaintext_private`, `dispatch-hetero --endpoint qwen38` committed in 14 s) | done | `5a8bb16b` |
| L-5 finish-flow | pending | |
