# A single faulty review seat voids the generation; the seat is not re-dispatched automatically

BL-0322. Efficiency class, so it jumps the queue (owner rule 2026-10-24). Source: bltidy20 handoff list, 2026-10-28.

Observed repeatedly: the review collector (`scripts/hetero-review-loop.js collect`) records the generation as aborted (`seat_gap`) when one seat returns `no_verdict` while the other seats are fine, and the operator then re-dispatches that same seat by hand. Re-dispatching the same seat usually succeeds. A seat killed by the idle cap (`seat_idle_timeout` in `scripts/dispatch-review.sh`, BL-0293, shipped ae247356e, off by default) ends the same way, and nothing swaps or re-sends that seat afterwards.

Wanted: when exactly one seat fails with a transient reason (idle kill, quota or network blip, empty answer), re-dispatch that seat once, automatically, before the generation is judged; a second failure keeps today's behaviour. Needs a negative control: a seat that fails twice must still abort the generation.

Already shipped and not part of this row: the first authentication failure stops a whole paid batch (BL-0294, 8183aaaf2, `scripts/lib/auth-stop.js`).
