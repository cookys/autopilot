# A managed campaign whose wall expires leaves no terminal summary and no journal disposition

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14

- **Trigger**: already fired twice 2026-08-30 (campaigns attempt-3 `d240ef14…` and `…a3` D5): the leaf committed, `max_wall_seconds` (3600, schema max) elapsed before the review round, the `engine implement-review` process ended with a 0-byte stdout, and the campaign sits at `phase=IMPLEMENTING, activity=dead, wall_seconds_remaining=0` with a held lease and a live Mission claim.
- **Context**: wall expiry must journal a wall-expiry disposition (MUTATION_FAILED-class with the live lease identity, or a resumable-wait phase if repair generations remain) and always write the summary JSON; a foreman reading an empty file cannot tell a kill from a crash. Pair with a `campaign resume`/`terminalize` verb for an `activity=dead` campaign with repair generations remaining — the artifact was complete and reviewable, only the controller was stuck.
- **Effort**: S–M
- **Source**: phase-2 foremen (D4, D5) 2026-08-30.

