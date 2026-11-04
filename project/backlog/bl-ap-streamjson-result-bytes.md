# bl-ap-streamjson: do json and stream-json results carry the same bytes? (BL-0372)

Second in the PM order, after BL-0371. Measure with real dispatches whether the `result` of the json output format and of the stream-json output format are byte-identical. G40's agent lane passive observation depends on the answer. Parked by the PM until released.

Plan: [`project/plans/2026-11-04-bl-ap-streamjson-measurement.md`](../plans/2026-11-04-bl-ap-streamjson-measurement.md) (queued, dispatch after G40 P1; PM decisions D1/D2/D3/D5 recorded 2026-11-04).

## Status (2026-11-04)

Tasks 0-3 (the instrument, zero model calls) merged in 05a70bf82. Tasks 4-5 (the real measurement and its report) are parked on operator card d-2a19fdb5, waiting for a registered alias. The PM tracks it as bl-ap-sj45.
