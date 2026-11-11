# Fake MiniMax rows in the real dispatch usage ledger (BL-0429)

`/run/user/<uid>/autopilot/dispatch-usage-202611.jsonl` on <host> (team account) holds 48 rows for runner cc-shim / MiniMax-M3 / account minimax in the week to 2026-11-11. They come in groups of four (2 running, 1 reviewed, 1 no_verdict), with usage none, wall_secs null and no run manifest, at the times full or affected suites ran. The team account has no MiniMax token, so no real call was possible.

Likely cause: a dispatch-review fixture run whose usage ledger is not redirected to a temp dir. The suite that writes them is not identified yet. Found while cross-checking the first quota-provider-sync probe (PM message 01M75H3XZ0).
