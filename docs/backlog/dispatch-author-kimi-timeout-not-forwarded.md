# dispatch-author kimi: `--timeout` never reaches the adapter, which caps every run at 300 s

Source: PEER-REPORTED by cuda/chatgpt-tunnel via fleet, 2026-10-02 (message 01M3XPVA0KXJ4PCP0T3CSCPWE3); re-verified locally by reading code at 88bf59d3 — NOT yet reproduced by running it.

- **Trigger**: FIRED (peer report with evidence); queued after the test-suite repo write containment release. Reproduce first with a stub kimi that sleeps past 300 s under `--timeout 10m`.
- **Context**: `scripts/dispatch-author.sh` (kimi branch) wraps `scripts/dispatch-author-kimi.js` in shell `timeout`, which honours `--timeout`. But `dispatch-author-kimi.js` parses only `--model`/`--prompt-file` and calls `runKimiAuthor({ model, prompt })` without `timeoutMs`, so `src/runners/kimi.js` (`runKimiAuthor`) falls back to 300000 ms. Effective deadline = min(--timeout, 5 min). Peer run: `--runner kimi --model kimi-code/k3-256k --effort max --timeout 10m`, 06:55:21→07:00:22Z `runner_failed/kimi_timeout`, no artifact (raw receipt on cuda). Fix shape: forward the resolved timeout seconds as a flag to the .js, set `timeoutMs` slightly under the shell deadline so the adapter reports `kimi_timeout` before the shell kill; contract test in `hooks/tests/dispatch-author-kimi.test.sh`.
- **Effort**: S
