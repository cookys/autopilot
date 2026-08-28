# Frozen fixture bytes — verdict-bytes preservation

## unknown-model-notice.cc-2.1.238.txt
- **Provenance**: LIVE reproduction 2026-08-21 (G2 #6 repair): `claude -p --model MiniMax-M3`
  under Claude Code 2.1.238, `CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT` unset,
  scratch HOME, dead endpoint (`ANTHROPIC_BASE_URL=http://127.0.0.1:9`). RC=124 (endpoint hang
  killed by timeout — irrelevant to the notice, which prints pre-flight).
- **SHA-256**: 5ab3e1663fb3b4a06a0089f43f67590df0503cd1949062144bae92c2bd80f1ab
- **Stream note (honest disclosure)**: on CC 2.1.238 the notice arrives on **stderr**; the 8/8
  incident record describes stdout on the then-current CC. cc-shim merges both
  (`> "$RAW_LOG" 2>&1`, dispatch-review.sh cc-shim branch), so the capture-level destruction
  shape — chrome bytes ahead of an intact block in RAW_LOG — is equivalent. Fixture A uses
  these bytes as the prepended chrome; it reproduces the capture shape, not the 2026-08-08
  stream topology, and is labeled accordingly.

## c-complete-timeout.{author-envelope.json,raw-capture.txt}
- **Provenance**: LIVE production-path observation 2026-08-21 (G2 #1 repair): REAL
  `dispatch-author.sh --runner grok --timeout 3s` with a PATH-stubbed `grok` that prints one
  complete strict payload, flushes, then hangs; the author's own timeout killed it
  (`runner exited 124`), author RC=3, envelope `status:runner_failed` WITH `raw_log`.
- **Truth this froze**: through `dispatchSeat` this classifies as **exit_failure** (author exit
  3; no ETIMEDOUT hint) — NOT `timeout`. The production timeout-kill class that yields
  salvageable bytes is author-survives/runner-killed; an author killed outright leaves no
  envelope and no reference (unsalvageable by construction, = C-incident class).
- **raw SHA-256**: c9f34aace0ad3cf0662e5797ce65b3d4b0093ed494e4661bc43a9db35dd34804
