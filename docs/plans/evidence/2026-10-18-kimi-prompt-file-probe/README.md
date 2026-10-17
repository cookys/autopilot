# kimi 2.2.0 prompt-file indirection probe (BL-0025), 2026-10-18

Isolated HOME with the credential staged by `scripts/lib/qualify-stage-credentials.sh` (write-back armed); model
`kimi-code/k3`; kimi has no `--prompt-file` (2.2.0 `--help`), so the prompt is a file in the scratch cwd and `-p` is a pointer.
Four paid calls (plus the BL-0176 author call recorded in `d0-rerun-2026-10-18`).

| # | Command shape | Result |
|---|---|---|
| 1 | cwd holds a 140226-byte `autopilot-review-prompt.md` (git log -p, nonce `NONCE-64e39ceb63ce` on the last line); `kimi -p "Your complete task is in the file ./autopilot-review-prompt.md ... Read the whole file ..." -m kimi-code/k3 --output-format text` | rc 0, reply `NONCE-64e39ceb63ce`: the nonce came back. But kimi's own note says it used `Read` with a negative offset to see only the last line. |
| 2 | Same, 140361 bytes, three nonces at ~25%, ~60% and the last line; ask for all three, "Read the ENTIRE file" | rc 0, all three came back (`NONCE-Aa696c627ef NONCE-Bdb52bd230a NONCE-C39aa23a859`). |
| 3 | Real `dispatch-review.sh --runner kimi --diff-file <150000-byte diff>` with ONE prompt file (first implementation) | `no_verdict`, `no derived BEGIN frame found`. kimi: "I have only seen lines 1-1472 ... my repeated Read calls kept returning from line 1 because I never included the line_offset parameter". One Read call returns about 94 KB / 1470 lines; kimi lost its offset and stopped. Fail-closed, but unusable. |
| 4 | Same dispatch, prompt delivered as ordered ~60 KB parts `autopilot-review-prompt.part-000..002`, pointer lists them in order | `status: reviewed`, `SHIP-AS-IS` with a no-finding proof that cites files from the early and the late commits of the diff (154166-byte prompt, raw log `dispatch-review-log-hkjv6l`). |

Conclusion: file indirection works only when each file fits one Read call. Shipped as ordered parts behind the 120000-byte
threshold, non-blind rail only (the blind cleanroom seat is tool-less and cannot read files; it still fails closed).
Test: `hooks/tests/dispatch-review-c.test.sh` (kimi argv wall block), with mutation controls recorded in the commit message.
