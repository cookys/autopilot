# `hetero-review-loop.js` opt-out knob parser character class parses `*->` as a range

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14

- **Trigger**: the next touch of the knob parser in handleOptOut
- **Context**: a line such as "9plan_review: off" can set configured_value; harmless while the checker re-derives the value from the resolver (GLM CUT/FOLLOW-UP)
- **Effort**: S
- **Source**: same ledger dir as above

