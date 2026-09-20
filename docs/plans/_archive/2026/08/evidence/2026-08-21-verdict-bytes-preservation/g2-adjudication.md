# G2 terminal adjudication — verdict-bytes preservation (2026-08-21)

Panel: sol (codex gpt-5.6-sol, max) + grok (grok-4.6, xhigh), both required, both STOP.
G2 is terminal (`generation_cap_requires_depth_0_adjudication`); the two-generation cap is
exhausted, so these dispositions are the FINAL plan authority. All 9 findings ACCEPTED (7
blocking, 2 non-blocking), zero rejected. Plan frozen as R3 with every repair folded.

| # | fingerprint (8) | rubric | Disposition folded into R3 |
|---|---|---|---|
| 0 | 00e12f6a | VB3 | **Accepted.** Fresh-exclusive capture per attempt becomes an explicit requirement: the seat loop asserts each attempt's `private_raw_reference.locator` was newly allocated for THAT attempt (controller-created, not reused/redirected); salvage refuses out-of-attempt references. Fixture: attempt-1 leaves a valid payload, attempt-2 times out referencing the stale capture → attempt-2 salvage null. |
| 1 | d34a2871 | VB4 | **Accepted.** C-complete-timeout is generated THROUGH the production timeout path: a deterministic stub author binary writes + flushes one complete payload then hangs; the real dispatcher timeout kills it; the resulting envelope/capture/reference bytes are frozen (SHA-256 + provenance) before salvage is implemented. The test drives the production path, not a synthetic normalizer input. |
| 2 | 47400de8 | VB5 | **Accepted.** KR2 field names frozen pre-code (see R3 §3): attempt-record keys ride the schema-free `attempts.items` (verified `{ "type": "object" }` in plan-review-artifact.schema.json:73-77 — recorded as evidence, not assumed); the exhaustion-artifact observation field and the panel-manifest boolean are named, and every STRICT surface (plan-review-artifact.schema.json + codex mirror) updates atomically with old-artifact/new-artifact compatibility tests. |
| 3 | cdaddd64 | VB3 nb | **Accepted.** Shell salvage is a total no-op unless capture readable AND non-empty AND both derived markers passed explicitly as arguments (no unset-global reads). Four negative tests (missing / unreadable / empty / pre-marker emission) assert unchanged status, error text, usage JSON, exit code. |
| 4 | afc29fa0 | VB3 | **Accepted verbatim.** Carry rule frozen: per-attempt records keep every admitted salvage; seat summary = null if zero salvages; `unratified_conflict` if ≥2 distinct payloads (canonical verdict+findings); else that single payload with the provenance of the latest attempt that produced it. No strict-only promotion. Fixture J (attempt-1 salvaged STOP, attempt-2 no salvage → summary STOP) added; fixture I stays the two-valid conflict. |
| 5 | 226802a7 | VB3 | **Accepted, option A + tail guard.** Extracted salvage on timeout/exit_failure/quota admits only when objectCandidates finds exactly one complete valid object AND the scan terminates clean (depth 0, not inside a string, no open candidate) — a complete READY followed by a truncated STOP yields null. The READY+truncated-STOP byte shape is a pinned negative control. interrupted/unavailable stay strict-only. |
| 6 | 32618379 | VB4 | **Accepted.** The false "recovered from v2.34.7 suppression code/tests" provenance is withdrawn (the test only asserts the env flag exists; CHANGELOG has prose, not bytes). Repair order: FIRST attempt live reproduction (`claude -p` with a non-Anthropic model name, suppression env unset) and freeze the exact prefix bytes + SHA-256 under this evidence dir; if reproduction fails, A is relabeled CONSTRUCTED with a frozen multi-line prefix (blank lines + context-window/unknown-model wording) and never called the 8/8 incident shape. Dead-gate green for A runs against the frozen file. |
| 7 | 22d44080 | VB5 | **Accepted.** Shell contract split: required set stays the current nine keys; `unratified_verdict` is allowed-if-present, nullable, schema-OPTIONAL; NOT emitted on reviewed/precondition paths (success emit at :1180 stays byte-identical); runtime assertion non-null ⇒ status no_verdict. Pins: reviewed-without-key passes validateReviewResult + validate-json-schema.js; no_verdict-with-key passes both. KR2's observation field enters schemas/plan-review-artifact.schema.json + codex mirror in the same commit as the emitter. |
| 8 | 8ea65fa9 | VB1 nb | **Accepted verbatim.** Locator frozen: exactly one exact-line derived BEGIN in the runner-specific capture; take the FIRST exact-line derived END after it; missing END → null; END uniqueness NOT required (a prompt-tail END echo after a content-valid block must not destroy salvage). §2 aligned. Fixture F stays two-BEGIN. |

## Residue

- The G2 growth ratio 2591/1733 (≈1.495) carries `growth_warning:true` honestly — the R2 fold
  compaction landed under the 1.5 stop by 0.005; recorded, not hidden.
- No finding was refuted; there are no rejected repairs at G2 (G1's two rejections stand:
  in-band attempt binding, standing acceptance-search).
