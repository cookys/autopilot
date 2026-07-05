# Reviewer Bench Panel Command Adapters

These adapters bridge the `panel-cmd` interface to different reviewer engines.

## The panel-cmd Contract
A `panel-cmd` receives a git diff on `stdin`, writes a JSON object
`{"verdict":"pass"|"fail"}` to `stdout`, and exits `0`.

## Copy-Paste Examples

1. **Qualify gpt-5.5**:
```bash
scripts/engine-qualify.sh reviewer --engine gpt-5.5 --runner codex --family openai --panel-cmd 'evals/reviewer-bench/panel-cmd-dispatch.sh codex gpt-5.5' --emit-row
```

2. **Bench Sonnet vs Opus**:
```bash
scripts/calibration.sh run-known-bad --panel-cmd 'evals/reviewer-bench/panel-cmd-claude.sh claude-sonnet-5'
scripts/calibration.sh run-known-bad --panel-cmd 'evals/reviewer-bench/panel-cmd-claude.sh claude-opus-4-8'
```
Calibration results land in `~/.autopilot/calibration/samples.jsonl`.

## Note on Verdict Mapping
Verdict mapping is fail-closed (no verdict = fail = "caught" on a bad diff, which INFLATES sensitivity — so always check stderr for the no-verdict warning before trusting a run).
