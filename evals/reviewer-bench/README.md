# Reviewer Bench Panel Command Adapters

These adapters bridge the `panel-cmd` interface to different reviewer engines.

## The panel-cmd Contract
A `panel-cmd` receives a git diff on `stdin`, writes a JSON object
`{"verdict":"pass"|"fail"}` to `stdout`, and exits `0`.

## Qualification Boundary

These legacy adapters emit only a binary verdict and remain suitable for
`calibration.sh`. They do not satisfy the session-authoritative
`engine-qualify.sh reviewer` protocol, which additionally requires semantic
`rule_id`, file, line, severity, and a structured behavioral witness. The host
executes the witness against both sides of the patch in a second isolated,
no-network bubblewrap sandbox. Generated paths and identifiers expose no
known-bad/clean labels, and the host accepts only the nonce-derived valid call
domain for that case. The current authoritative evaluator is therefore
limited to offline/local panel runtimes; these networked legacy adapters remain
calibration-only until the P3c case-only host egress broker is qualified. See
`skills/engine-onboarding/SKILL.md` for that protocol and its explicit
runtime/auth bind options.

## Copy-Paste Example

**Bench Sonnet vs Opus**:

```bash
scripts/calibration.sh run-known-bad --panel-cmd 'evals/reviewer-bench/panel-cmd-claude.sh claude-sonnet-5'
scripts/calibration.sh run-known-bad --panel-cmd 'evals/reviewer-bench/panel-cmd-claude.sh claude-opus-4-8'
```
Calibration results land in `~/.autopilot/calibration/samples.jsonl`.

## Note on Verdict Mapping
Verdict mapping is fail-closed (no verdict = fail = "caught" on a bad diff, which INFLATES sensitivity — so always check stderr for the no-verdict warning before trusting a run).
