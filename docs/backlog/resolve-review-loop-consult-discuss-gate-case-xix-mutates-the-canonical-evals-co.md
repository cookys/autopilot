# `resolve-review-loop-consult-discuss-gate` case (xix) mutates the canonical evals corpus — move it to a scratch copy and un-serialize

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14

- **Trigger**: the next time a pooled test dies with `EACCES` on `evals/consult-capability-evidence-corpus.json`, or when `hooks/tests/run.sh --parallel` wall time is being trimmed and the serial tail is on the table.
- **Context**: case (xix) `chmod 000`s the REAL `evals/consult-capability-evidence-corpus.json` for two script runs; any pooled test that requires the consult grader in that window (verdict-stability D7, 2026-09-03: 12 EACCES failures, green standalone) dies. v2.35.11 serialized the file in `run.sh` as the right-sized fix; the proper fix is to point `resolve-review-loop.sh` at a scratch manifest (an env/flag override for the applicability-scope path) so the test never touches the tracked file.
- **Effort**: S
- **Source**: v2.35.11 pre-merge suite run (`d48b5235`); `hooks/tests/resolve-review-loop-consult-discuss-gate.test.sh:487-493`

