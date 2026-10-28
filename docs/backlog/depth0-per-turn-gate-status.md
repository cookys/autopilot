# depth-0 per-turn gate: status detail

BL-0306. Plan: docs/plans/2026-10-26-depth0-per-turn-gate.md

## Status

- P0 done. Evidence: commit bfde42aa1 (0.0433 USD), docs/plans/evidence/2026-10-26-depth0-gate-p0.
- P1 done, merged ae44b5a0a: scripts/gate-verify.js, schemas/gate-rules.schema.json, 183 tests, 87 mutations all shown red.
- P2 done: hook wiring merged 7230a7f6e (lane d0gp2, three generations, four seats, full_range 45eec18f), then fix merge b60ab831a (the pre-merge suite found a SubagentStop group regression; per-turn-gate now joins the existing group).
- P3 ON/OFF evaluation can start. Cap 20 USD approved; owner instruction: once acceptance passes, run P3 directly without asking again.
- P4 (guidance) only after P3 PASS.
- Follow-on of BL-0055.

## Closed design questions (history; rows deleted)

- BL-0318 (exit 2 turned into allow, and a worker can cause exit 2): owner chose option B in d-b3bc7aef. When armed, gate-verify exit 2 always blocks (reason error) and shares max_blocks with ordinary blocks. Plan sections 2.5, 3.1, 3.2 and the Review log were revised to match. Wired in 7230a7f6e.
- BL-0319 (git calls in the hook may read the worker's .git/config): the hook makes no git call of its own; the arm step's rev-parse isolates GIT_* and has a decoy-repo negative control; gate-verify's git calls were already isolated. Merged in 7230a7f6e and b60ab831a.

## Known limits of P2 (BL-0326)

1. When the worker cd's into a subdirectory, payload.cwd no longer matches the repo of the switch file, so the gate does not take effect.
2. A native subagent running in the foreground gets no agentId, so the gate works only for background subagents.
3. With a cc-shim double trigger the worker really gets only one fix round (pinned by a test).
4. The SubagentStop record file is named <session>.<agent_id>.jsonl; the P3 reader must read these too.
5. The T-G1 tests do not cover core.askPass or core.alternateRefsCommand (not known to be unguarded; simply untested).
