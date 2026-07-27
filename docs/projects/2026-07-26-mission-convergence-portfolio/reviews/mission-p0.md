# Mission Phase 0 — Integration Oracle and Enforcement Probe

> RED: `21ba802`
>
> Implementation and repairs: `609e65b..bacdf7b`
>
> Status: READY

## Frozen Boundary

P0 owns only the sanitized incident corpus, cross-plan authority ownership check, and current-Codex
enforcement disposition. It does not implement the Mission reducer, live ICC binding, task closeout,
or package mirror.

## Deterministic Evidence

- `bash hooks/tests/mission-convergence-integration.test.sh`: PASS, 14 assertions. The six incidents
  and four controls deterministically expose current `UNSUPERVISED` behavior without a missing-module
  setup error; an independent frozen table rejects altered terminal states or reasons.
- `bash hooks/tests/mission-authority-ownership.test.sh`: PASS, 9 assertions. Seven frozen
  authorities have one non-empty owner, active-plan markers agree with the portfolio manifest, and a
  duplicate or empty owner fails closed.
- `bash hooks/tests/codex-enforcement-probe.test.sh`: PASS, 26 assertions.
- `docs/projects/2026-07-26-mission-convergence-portfolio/mission-p0-codex-enforcement.json`
  records Codex CLI 0.145.0 receiving the exact harmless Bash `touch` request at `PreToolUse`,
  returning `decision:block`, and leaving the target absent. The selected disposition is
  `codex_enforcement_outcome=block-capable`.
- Invalid/pre-hook probe failure preserves the prior artifact and emits no replacement disposition.
  Successful publication is atomic. The isolated credential copy is mode 0600 and is removed by the
  registered process-exit/signal cleanup; a detached guardian covers abrupt parent death.

## Heterogeneous Trail

The requested Grok 4.5 High implementer was dispatched through the canonical isolated rail with
`runner=grok`, `model=grok-4.5`, and `effort=high`. The first attempt exposed and repaired a detached
worker serialization bug (`c066e7d`, 125 focused assertions). The subsequent real model process
produced zero log/event bytes for 360 seconds and was terminated by the dispatcher lifecycle.
It produced no commit or verdict and is recorded only as a transport failure. Its branch and
worktree were reaped.

The final local Architect / Ops / Skeptic review admitted and repaired these findings:

| Severity | Finding | Repair |
|---|---|---|
| 🟠 Major | Plugin installation alone could select `wrapper-required` after pre-tool failure. | Require request-bound hook evidence or an observed effect; invalid probe exits nonzero. |
| 🟠 Major | Target substring could bind an unrelated tool request. | Bind the exact Bash `touch <scratch-target>` action. |
| 🟠 Major | Failed retry deleted the prior valid artifact. | Preserve prior evidence and atomically publish only a valid replacement. |
| 🟠 Major | Manifest-only ownership could drift from active plans. | Add and check machine-readable per-plan authority markers. |
| 🟡 Minor | Empty owner string passed validation. | Reject blank authority, owner, and plan fields. |

No transport failure, empty response, or self-report was counted as approval.

## Final Decision

`READY`. P1 may implement the pure Mission reducer and shadow ledger. P2 may use the
request-bound current-Codex PreToolUse primitive only after Mission identity and control-sequence
binding is implemented; this P0 probe does not promote Codex to H4 gate authority.
