# `adopt-qualification-defaults.js list` prints `event undefined — null` for legacy feed rows

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14

- **Trigger**: the next time the feed listing is shown to a consumer (any `list --from` run reproduces it: 12 such lines on 2026-09-03 against the live feed), or when a second display defect lands in the same command.
- **Context**: legacy (pre-effort, no event id / bundle path) scorecard rows reach the `evidence` line without a fallback, so the consumer prints `event undefined — null`. Producer side (llm-playground plan 065, P5 closed 2026-09-03) tracks the same item as XS display-layer; consumer fix is a fallback string when `event_id`/`bundle` are absent.
- **Effort**: S
- **Source**: 7840hs peer report 2026-09-03 (plan 065 P5); reproduced on aimax395 (exit 0, defaults 29 / strikes 1 / priors 57)

