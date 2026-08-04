# Codex-native lifecycle enforcement — implementation receipt

Date: 2026-08-05

Branch: `mission/01a99a8481a7/codex-native-lifecycle-enforcement-a1`

Base: `e22003b426898a325bffa01fc1f9c9814f6e06d0`

## Outcome

| Deliverable | Verdict | Evidence |
|---|---|---|
| D1 — real Codex pre-effect probe contract | **READY** | Codex 0.146.0 fired request-bound `PreToolUse` with stable `cwd`, `tool_name`, and session identity, and structured stdout denied the target mutation. Exit-17 adapter failure is recorded separately as fail-open, not as the blocking contract; this is probe evidence, not production wiring. |
| D2 — lifecycle skill projections | **READY** | Exactly seven installed skill copies receive one generated normative adapter after YAML frontmatter. Tests bind the adapter digest and byte-exact canonical tail. |
| D3 — managed admission | **READY** | Managed CLI, Engine, and campaign dispatch reject absent, expired, malformed, host-session-mismatched, repository-mismatched, level-mismatched, and Mission-mismatched markers before downstream effects. A real `session-mode set` marker admits the same Git common-dir worktree, while a copied marker cannot be reused by another Codex session. |
| D4 — production Codex pre-effect hook | **NOT_READY / NO_SHIP** | The production package registers only `PostCompact`; the retained `PreToolUse` adapter is unregistered probe evidence. The no-admission and exit-17 controls reproduced, but no payload-session marker was visible to the following L3/L5 calls, so no Codex-thread-bound direct-mutation enforcement is shipped. |

The D1 reservation was respected: the first real call proved request-bound structured blocking; the
second one-shot session exercised allow, deny, and broken controls. No third D1 call was made. The
sanitized receipt is [codex-pre-effect-production-live-receipt.json](evidence/codex-pre-effect-production-live-receipt.json).
The single final D4 package probe uses three Codex sessions: no-admission, a combined
L3/L5/managed-Engine sequence, and the broken-adapter control. Its receipt hashes the installed
adapter and the generated package adapter separately and requires byte equality. The run admitted
one L3 and one L5 lifecycle command, but the next effect calls saw no valid payload-session marker;
the receipt therefore records L3 sentinel 0, no qualifying L5-direct or managed-entry invocation,
and no dispatcher call. The sole existing campaign also remains sealed to the pre-amendment graph.
No replacement authority or additional live run was minted, so D4 remains `NOT_READY/NO_SHIP`.

The frozen source plan and rubric retain their original bytes. The user-directed correction is a
separate [amendment](../../plans/2026-08-05-codex-native-lifecycle-enforcement-amendment.md) with its
own [rubric](../../plans/2026-08-05-codex-native-lifecycle-enforcement-amendment.rubric.md), source
hashes, rubric IDs, and review status; it updates the existing D4 node without creating a new graph
node or lineage.

## Shipped boundaries

- Codex lifecycle/front-door skills now lead with executable `session-mode` and managed Engine
  mappings, and explicitly forbid imitating unavailable Claude task/agent primitives.
- The strict validator exported by `scripts/session-mode.js` binds TTL, effective level, Git
  common-dir, host payload session identity, Mission policy/graph, and the digest-sealed Mission
  source projection.
- Every managed rejection reports `DEV_FLOW_ADMISSION_REQUIRED_OR_STALE` with zero dispatcher,
  model, mutation, and resource counters.
- The live-proven structured-denial boundary remains D1 probe evidence only. The installed package
  registers no `PreToolUse` hook and ships no Codex-thread-bound direct-mutation enforcement;
  `PostCompact` is the sole production Codex hook.
- The marker file/body validator is session-bound, but the final installed control did not bridge
  the hook payload session into the shell-run lifecycle marker. Until that boundary is qualified,
  the Codex lifecycle package is not production-ready.
- Managed Codex implementers run with a new credentials-only `CODEX_HOME`, inherit no controller
  config/plugin/session state, receive no ambient `CODEX_THREAD_ID`, and use `--ignore-user-config`.
- A true Git non-repository result remains a safe no-op. Git spawn errors, timeouts, signals, and
  unexpected exits deny effect-capable tools while read-only tools remain available.
- Adapter-process failure is not fail-closed on Codex 0.146.0. If the probe command exits before it
  can emit structured stdout, Codex can continue the tool; the committed broken control preserves
  this limitation rather than hiding it behind a READY verdict.

## Focused development gates

- `bash hooks/tests/session-mode.test.sh` — 29 passed.
- `bash hooks/tests/autopilot-cli.test.sh` — 82 passed.
- `bash hooks/tests/dispatch-hetero.test.sh` — 213 passed, including the actual Codex runner path and
  isolated child-home assertions.
- `node --test hooks/orchestrator-edit-gate.test.js` — 35 passed.
- `AUTOPILOT_LIVE_CODEX=1 bash hooks/tests/codex-pre-effect-production-live.test.sh` (historical
  D1/D4 probe; no rerun in this repair) — no-admission/L3/L5/managed-entry/broken controls; the
  receipt records exact installed/generated adapter equality, broken-adapter `FAIL_OPEN`, failed
  lifecycle-to-payload session binding, zero managed dispatcher calls, and D4 `NOT_READY/NO_SHIP`.
