# BL-0376 D5 follow-ups: review follow-ups (BL-0386)

Three Suggestion-level findings from the d5fu review, generation 1 (2026-11-04). None blocks anything. Each item: problem, then impact.

a. Mixed versions sharing one audit file. An older script reading the same audit file rejects the combined `a+b` `quota_capture` as `bad_quota_capture`. A fail-closed reader such as BL-0375 `readDemand` would then see no demand until that line ages out. Impact: only when versions are mixed on one audit file.
b. An adapter failure for an alias that is never attempted in the run is no longer written to the audit; it is visible only in sync-statusline. Impact: diagnostic completeness only.
c. `captureFieldOk` cannot verify the "capture first, adapter second" order, because the two code sets overlap. The order is guaranteed only by the writer `combineCaptureReasons`, and this is not documented. Impact: a future writer could emit the other order unnoticed.

Source: d5fu review g1 (2026-11-04). Effort S.
