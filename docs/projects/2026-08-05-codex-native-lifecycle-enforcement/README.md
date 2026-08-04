# Codex-native lifecycle enforcement — implementation receipt

Date: 2026-08-05

Branch: `mission/01a99a8481a7/codex-native-lifecycle-enforcement-a1`

Base: `e22003b426898a325bffa01fc1f9c9814f6e06d0`

## Outcome

| Deliverable | Verdict | Evidence |
|---|---|---|
| D1 — real Codex pre-effect contract | **READY** | Codex 0.146.0 fired request-bound `PreToolUse` with stable `cwd`, `tool_name`, and session identity, and structured stdout denied the target mutation. Exit-17 adapter failure is recorded separately as fail-open, not as the blocking contract. |
| D2 — lifecycle skill projections | **READY** | Exactly seven installed skill copies receive one generated normative adapter after YAML frontmatter. Tests bind the adapter digest and byte-exact canonical tail. |
| D3 — managed admission | **READY** | Managed CLI, Engine, and campaign dispatch reject absent, expired, malformed, repository-mismatched, level-mismatched, and Mission-mismatched markers before downstream effects. A real `session-mode set` marker admits the same Git common-dir worktree. |
| D4 — production Codex pre-effect hook | **READY** | The installed package registers the live-proven `PreToolUse` `.*` structured-denial adapter alongside the unchanged `PostCompact` hook. Real negative/positive/broken controls match the revised contract. |

The D1 reservation was respected: the first real call proved request-bound structured blocking; the
second one-shot session exercised allow, deny, and broken controls. No third D1 call was made. The
sanitized receipt is [codex-pre-effect-production-live-receipt.json](evidence/codex-pre-effect-production-live-receipt.json).
The single D4 installed-package run used three model calls for negative, positive, and broken controls.
A later change-only review moved read-only/lifecycle-entry early returns ahead of marker validation;
the receipt records both adapter digests and the 30/30 deterministic regression proof. The exercised
D4 branches did not change, so the explicit one-run reservation was not exceeded.

## Shipped boundaries

- Codex lifecycle/front-door skills now lead with executable `session-mode` and managed Engine
  mappings, and explicitly forbid imitating unavailable Claude task/agent primitives.
- The strict validator exported by `scripts/session-mode.js` binds TTL, effective level, Git
  common-dir, Mission policy/graph, and the digest-sealed Mission source projection.
- Every managed rejection reports `DEV_FLOW_ADMISSION_REQUIRED_OR_STALE` with zero dispatcher,
  model, mutation, and resource counters.
- Production Codex mutation enforcement covers the live-proven structured-denial boundary. Shell/exec
  is effect-capable as a whole, with only fixed lifecycle/managed-Engine entry boundaries exempted.
- Adapter-process failure is not fail-closed on Codex 0.146.0. If the hook command exits before it can
  emit structured stdout, Codex can continue the tool; the committed broken control preserves this
  limitation rather than hiding it behind a READY verdict.

## Focused development gates

- `bash hooks/tests/session-mode.test.sh` — 29 passed.
- `bash hooks/tests/autopilot-cli.test.sh` — 82 passed.
- `bash hooks/tests/dispatch-hetero.test.sh` — 212 passed.
- `AUTOPILOT_LIVE_CODEX=1 bash hooks/tests/codex-pre-effect-production-live.test.sh` — installed
  production negative/positive/broken controls; expected terminal verdict `READY` with the broken
  adapter classified `FAIL_OPEN`.
