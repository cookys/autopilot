<!-- proposed text, eval copy only; NOT applied to skills/ -->
- A verified Critical or Major blocks the MERGE of its candidate. It does not stop its lane or any other lane.
- A lane runs to a candidate and returns its candidate sha and ALL findings as text in its final message / receipt. Depth 0 writes them to the registry (a name that is not a report-shaped FINDINGS file). Never ask a Claude subagent to write a FINDINGS file; no brief tells a lane to Write a report-style file.
- Acceptance and the review panel run in parallel on the same sha. Depth 0 waits for both, and for every dispatched lane to land, before any repair dispatch.
- Depth 0 pools findings across lanes in ONE adjudicate-findings store (lane tag in the finding id, e.g. A-F1), disposes each (must-fix-now, follow-up, reject), runs completeness registry-wide, then dispatches ONE repair round per pool covering every must-fix-now id.
- A second pool only if the first repair round introduced or exposed new verified Major findings; the 3-round cap still ends it.
- Wait ends on a landed `<run_id>.<stage>.exit` file or a receipt that passes its validator.
- Unchanged: depth-0 re-derivation, union-on-verified-critical, repair-gate, blind re-review.
