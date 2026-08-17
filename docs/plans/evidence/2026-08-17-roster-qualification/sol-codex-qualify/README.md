# gpt-5.6-sol full reviewer qualification — QUALIFIED (2026-08-17)

BACKLOG "Roster qualification — remaining legs" gpt-5.6-sol leg, run on the
v2.34.15 codex CLI exam transport after the 9/9 admission spike
(`../sol-codex-spike.log`). **The roster's first qualified reviewer row** — and
the first qualification earned over a CLI harness transport.

## Result

Full `engine-qualify.sh reviewer`, corpus
`reviewer-known-bad-clean-v2.reviewer-metamorphic-v4`, 2 trials, wall 744 s:

- **42/42 corpus pass in BOTH trials** — sensitivity 21/21 known-bad each trial,
  specificity 0 false positives on 19 clean each trial, `false_pass_critical=0`.
- capability_score 1.0; evidence state `qualified` (not degraded) — evidence
  event 5, scorecard event 141; expires 2026-09-16 (30-day reviewer TTL).

## Identity + derivations (recorded)

- gpt-5.6-sol @ codex-cli 0.147.0, family openai, effort **max** (the seat's
  calibrated tier per `.claude/review-loop-config.md` 2026-08-14 ruling),
  harness `engine-qualify-e9eb3890`, prompt_config_hash `3cbe203c…`
  (= sha256(SYSTEM_PROMPT), unchanged).
- semantic_fingerprint = sha256(canonicalJson({kind:
  'reviewer-semantic-surface-v1', model:'gpt-5.6-sol',
  transport:'codex-cli-exec-read-only', endpoint:'@none'})) = `53c80046…`.
- containment_fingerprint = sha256(canonicalJson({kind:
  'reviewer-containment-surface-v1',
  exam_transport:'qualification-case-broker-networkless-bwrap',
  credential_isolation:'codex-home-redirect-broker-env-allowlist'})) = `8667f923…`.

## Operator-asserted identity caveat (per the v2.34.15 governance rule)

CLI transports return no runtime model id. **Pre-run probe (recorded)**: this
session, `codex exec --model gpt-5.6-sol -c model_reasoning_effort="max"
--sandbox read-only --skip-git-repo-check` under a redirected HOME with
`CODEX_HOME=/home/cookys/.codex` returned `OK`, rc 0, codex-cli 0.147.0. The
recorded model_version `gpt-5.6-sol-20260817` is asserted deployment
configuration (requested id + probe date), not a runtime echo.

## Transport

`engine-qualify.sh reviewer --remote-provider-cmd` → case-only broker →
`qualification-review-provider.js` with `QRP_TRANSPORT=cli QRP_CLI_KIND=codex
QRP_CLI_EFFORT=max`, credentials via `CODEX_HOME` through the broker env
allowlist; per-case timeouts broker 600000 ms / adapter 540000 ms. Row JSON:
`qualify-out.json` (`--emit-row`); verdict + exit: `qualify-err.log`.
