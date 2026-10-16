# qs-v3 — OFF-control expectation fix (written after seeing the v2 results)

v1 (`prereg/qs.md`) and v2 (`prereg/qs-v2.md`) results stay as records. v2: red arms valid (12/12 caught), but OFF failed
no_miss / always_extra_ran on s2: the current guidance runs only `bash hooks/tests/run.sh`, which never runs
`mods/live/run-tests.sh`; the design wrongly assumed the whole suite is a superset of the extra runner.

v3 changes ONLY the OFF sensitivity check (`score-qs3.js`): every OFF cell must have run the whole suite (all 24 hooks/tests
suites); extra runners are not expected of OFF. ON arm, red arms (same pack ids and bytes), ON thresholds, markers and the ship
rule are unchanged. This version was written after seeing v2; the ON thresholds did not move. All cells are new runs
(`results/qs.v3.jsonl`). No v4: a new instrument problem stops the row.
