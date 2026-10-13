# `hooks/tests/run.sh` is red on `develop` — sealed campaign `verify_cmd` is unsatisfiable

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14

- **Trigger**: already fired (salvage campaign `campaign-v1-e9bcae52…` `acceptance_failed` on `bash hooks/tests/run.sh` with a byte-identical cherry-pick; seven suites red on base 500703b1: codex-plugin-package, execution-profile, mission-terminal-rollover, next-touch-validation, provider-readiness-consumer, qualification-review-provider, resolve-review-loop [timeout]).
- **Context**: every Mission node inherits the six-command chain as `verify_cmd`, so any campaign on this base fails acceptance regardless of the candidate. Triage the seven (environmental vs real regression), then either fix `develop` or make the graph's `verification_commands` name the suites the node actually touches.
- **Effort**: L (triage) — blocks every managed campaign on this repo until done.
- **Source**: l6-verdict-stability-p1 salvage campaign 2026-08-29.


## 2026-10-13 status

- **Green**: `bash hooks/tests/run.sh` passes 480/480 at f108ec42, run alone, in about 56 minutes. The seven suites listed above are green.
- **Still open**: a node whose `verification_commands` start with the whole suite needs about 56 min for that step alone. That is near the one-hour campaign wall and far past the 15 min CI cap. `src/mission/runtime.js:1368` joins each node's `verification_commands` with `&&`; the graph author writes them per node (e.g. `docs/mission-qualification-verdict-stability-execution-graph.json`), so Mission does not inherit one chain for every node.
- **Options (owner decision)**:
  - A. Keep the chain and wait for the suite to go green. Reached 2026-10-13; the time problem remains.
  - B. Each node's `verification_commands` name only the suites it touches, plus the light checks. Editing a sealed graph breaks its digest, so this applies to new graphs only (see BL-0134 for what editing sealed files costs).
  - C. Run the whole suite as a separate, non-blocking gate outside campaign acceptance (release preflight, nightly).
- Related: BL-0001 (select the suites a diff touches in qc-gate).
