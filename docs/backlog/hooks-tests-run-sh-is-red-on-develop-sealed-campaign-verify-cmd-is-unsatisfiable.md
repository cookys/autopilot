# `hooks/tests/run.sh` is red on `develop` — sealed campaign `verify_cmd` is unsatisfiable

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14

- **Trigger**: already fired (salvage campaign `campaign-v1-e9bcae52…` `acceptance_failed` on `bash hooks/tests/run.sh` with a byte-identical cherry-pick; seven suites red on base 500703b1: codex-plugin-package, execution-profile, mission-terminal-rollover, next-touch-validation, provider-readiness-consumer, qualification-review-provider, resolve-review-loop [timeout]).
- **Context**: every Mission node inherits the six-command chain as `verify_cmd`, so any campaign on this base fails acceptance regardless of the candidate. Triage the seven (environmental vs real regression), then either fix `develop` or make the graph's `verification_commands` name the suites the node actually touches.
- **Effort**: L (triage) — blocks every managed campaign on this repo until done.
- **Source**: l6-verdict-stability-p1 salvage campaign 2026-08-29.

