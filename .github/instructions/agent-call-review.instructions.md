---
applyTo: "packages/agent-call/**,skills/agent-call/**,bin/agent-call.js,scripts/install-agent-call.sh,hooks/tests/agent-call-package.test.sh,docs/agent-call.md"
---
Review agent-call adversarially, not cosmetically. Treat same-user local processes and tmux content as untrusted peer inputs. Look specifically for symlink/path traversal, descriptor spoofing, token disclosure, socket races, command injection, false delivery acknowledgements, malformed MCP/Channel framing, event-loop hangs, stale PID reuse, unsafe overwrite/cleanup, and accidental coupling to Autopilot's ephemeral dispatch lane. Any receipt stronger than the adapter can prove is blocking. Any path that lets peer text become operator permission is critical.
