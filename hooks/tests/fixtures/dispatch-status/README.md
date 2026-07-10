# dispatch-status fixtures

- `codex-chrome-merged.log` — REAL capture of `codex exec` (codex-cli v0.144.0,
  2026-07-11, gpt-5.5, low effort) merged stdout+stderr, exactly as
  dispatch-hetero.sh's `run_worker … >"$LOG" 2>&1` produces. Sanitized only in
  the workdir path (scratchpad → /tmp/fixture-workdir). The trailing
  `tokens used` + comma-grouped number two-line form is the empirical token
  signal dispatch-status.js parses — spike-before-assert evidence for the
  codex-chrome parser.
