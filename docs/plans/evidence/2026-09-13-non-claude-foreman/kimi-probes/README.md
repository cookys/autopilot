# kimi 0.41.0 capability probes — 2026-09-13, this host, model `kimi-code/k3`

Every claim in the design document about kimi is one of these files. Anything not here is
"未驗證" in the document.

| Probe | Command shape | Result | File |
|---|---|---|---|
| P1 shell tool under `-p` | `kimi -m kimi-code/k3 -p '…run cat note.txt…' --output-format stream-json` | Executes a `Bash` tool call non-interactively; returns the output; emits `session.resume_hint` | `p1-shell-tool.jsonl` |
| P2 file edit under `-p` | `-p '…edit note.txt with your file editing tool…'` | `Read` then `Edit` tool calls; file content changed on disk | `p2-file-edit.jsonl` |
| P3 multi-turn | `kimi -r <session_id> -p '…what was the cat output…'` and `kimi -S <id> -p …` | Both resume and answer from prior-turn memory (`hello`) | `p3-resume-r.jsonl`, `p3-resume-S.jsonl` |
| P4 ACP | `printf '{"jsonrpc":"2.0","id":1,"method":"initialize",…}' \| kimi acp` | Responds: `loadSession:true`, session list/resume/fork/close, MCP http+sse, embeddedContext | `p4-acp-initialize.json` |
| P5 prompt ceiling | `-p "<N KB filler>… nonce"` at 100/127/128/200 KB | 100–128 KB: nonce echoed. **200 KB: `argument list too long` (exit 127) before kimi runs** — the ceiling is the kernel's `MAX_ARG_STRLEN` (128 KiB per argv string), not kimi's context | (stdout only; reproduce with the loop in the design doc) |
| P5b context via file | 300 KB file, `-p 'Read big.txt with your Read tool and reply with the nonce at the end'` | `Read` tool call; trailing nonce returned correctly | (stdout only) |
| P5c stdin | `printf … \| kimi -p -` | `-` is taken literally ("your message came through empty — just a dash"); **no stdin path** | (stdout only) |

Negative space, measured: `kimi run <prompt>` and a bare positional prompt are `unknown command`
(peer 308-db, same version; not re-run here). `-p` cannot be combined with `--auto`/`-y`
(peer chatgpt-tunnel-host, v0.41.0; not re-run here).
