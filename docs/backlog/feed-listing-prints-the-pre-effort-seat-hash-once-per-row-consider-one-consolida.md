# Feed listing prints the pre-effort `seat_hash` ⚠ once per row — consider one consolidated notice

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14

- **Trigger**: a consumer complains the listing is unreadable, or the producer moves to effort-bearing seat hashes (then the per-row ⚠ disappears on its own).
- **Context**: by decision (A) the feed's advertised `seat_hash` is a diff key only and the consumer re-derives every hash; every current row is pre-effort three-key, so every row prints the ⚠. The producer's red line is "entries are reordered, never recomputed", so this is purely a consumer display choice: one summary line ("N of M rows advertise a pre-effort hash; all re-derived") instead of N blocks.
- **Effort**: S
- **Source**: 7840hs peer report 2026-09-03 (plan 065 P5 closeout)

