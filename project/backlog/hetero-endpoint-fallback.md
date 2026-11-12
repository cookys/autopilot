# dispatch-hetero --endpoint falls back to a named cloud seat (BL-0435)

Evidence: with an explicit `--endpoint`, `scripts/dispatch-hetero.sh` exits `engine_unavailable` (exit 1) when the pre-probe
fails or the endpoint returns 503. It has no automatic fallback and no automatic re-dispatch. The qwen canary (2026-11-12,
report at `docs/dev/qwen-canary-2026-11-12.md`) reported "0 fallbacks", but that only means every pre-probe passed. The
fallback path was never exercised. The one 503 seen in the canary was re-dispatched by hand.

Ask (PM ruling 2026-11-12, fleet 01M76WDT193M2A7QRQ9X5YFWVZ): scheduled this week, after the noncq W1 close-out.

Acceptance:

1. Red test first: when the endpoint returns 503 or the pre-probe fails, the dispatch is re-sent to a named cloud seat,
   inside the same bwrap sandbox, and a `fell_back` record is written.
2. The fallback result goes through review exactly like the original result. Review is never skipped for a fallback.
3. Manifest reconciliation counts `fell_back` separately from ordinary dispatches.

After it ships, the qwen canary reruns for one week, including fallback.

Report: `docs/dev/qwen-canary-2026-11-12.md`.

Reported by the autopilot lane, 2026-11-12.
