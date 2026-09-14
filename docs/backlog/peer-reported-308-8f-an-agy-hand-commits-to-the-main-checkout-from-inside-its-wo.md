# PEER-REPORTED (308-8f): an agy hand commits to the MAIN checkout from inside its worktree — REPRODUCED, FIXED v2.36.37

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14


- **Trigger**: **FIRED — reported 2026-09-13 with evidence, reproduced here the same hour.** `dispatch-foreman.sh` probe on 308: kimi foreman behaved; `dispatch-hetero.sh --runner agy` built `/tmp/hetero-hands-…` but agy committed to 308's `feat/homeforge` twice. Boundary caught it after the fact (`boundary_rejected` / `main_checkout_mutated`); the peer reset the main tree by hand and moved the work to `/l4`.
- **Root cause (measured, `docs/plans/evidence/2026-09-13-agy-worktree-escape/`)**: agy resumes a conversation keyed by an ancestor path (`last_conversations.json`) when the worktree path has no entry, inheriting that conversation's repository memory; `run_command` runs there. Reproducing it in a scratch repo put a stray commit on THIS repo's main checkout (reset immediately). Not an env var: `env -i` reproduces.
- **Fix**: `--new-project` on the agy launch in `dispatch-hetero.sh` and `dispatch-explore.sh` (mechanism; the prompt directive stays as guidance). `hooks/tests/dispatch-hetero.test.sh` pins the flag (red without it).
- **Residual**: every dispatch now creates an agy project/conversation entry under `~/.gemini` (residue, not a hazard). `--runner grok` was not tested for the same escape (peer's P1–P5 grok hands never showed it). The prevention remains an accident guard: a runner that resolves its workspace from somewhere else is caught by the boundary, not stopped.
- **Also**: `scripts/dispatch-foreman.sh` shipped without +x (peer ran it with `bash`); fixed.
- **Source**: `308-8f` cross-session report 2026-09-13; evidence in 308 `a096548e`.

