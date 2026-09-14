# `--runner opencode` usage stays `null` — parse `step_finish.tokens` from the `--format json` event stream

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14

- **Trigger**: the first time an opencode seat's cost/efficiency is compared against another rail (scorecard `cost`/`usage` telemetry), or `dispatch-status.js` gains a second event-stream format anyway.
- **Context**: the opencode rail declares `log_format: plain`, so `dispatch-status.js --usage-only` returns `null`. The observed stream (opencode 1.18.25, 2026-09-03) carries `{"type":"step_finish","part":{"tokens":{"total,input,output,reasoning,cache{read,write}}}}` per step; summing per-step tokens is the obvious parser. Declare a `jsonl-opencode` format rather than sniffing.
- **Effort**: S
- **Source**: v2.35.12 (`docs/plans/2026-09-03-opencode-implementer-rail.md` § Out of scope)

