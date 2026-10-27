# preflight-release runs six paid slash-entry probes by default

BL-0316. Found by self, 2026-10-27.

`scripts/preflight-release.sh` runs slash-entry-probe by default: 6 real claude-sonnet-5 `claude -p` probes. Only `AUTOPILOT_SKIP_SLASH_PROBE=1` skips them.

Evidence: about 15:40 Taipei on 2026-10-27 the fbship hand ran it twice without a sentinel on PATH: 12 real calls, cache write about 2.27M tokens, about 9 USD at API price.

Proposed: make the probe explicit opt-in, or skip automatically when a sentinel or test environment is detected. The change to a check needs a negative control (a run that must be blocked, shown red before green).

The count of 6 comes from the `probe` lines in hooks/tests/slash-entry-probe.test.sh (the last is hetero-review). The "5 total" in that file's opening comment is out of date. 12 real calls across two runs is 6 x 2.
