# Foreman rail, Shape B — build plan (round 2 of the non-Claude foreman design)

Owner ruling 2026-09-13: **B, quota is the motive** (round-1 doc
[`2026-09-13-non-claude-foreman-rail-design.md`](2026-09-13-non-claude-foreman-rail-design.md) §6).
This page is the one-page build plan; it names what ships, what was measured before it was
built, and the policy forks taken conservatively so the operator can reverse them by reading.

## What ships (one PATCH)

| Piece | Kind | Why |
|---|---|---|
| `scripts/lib/main-checkout-boundary.sh` | extraction | `_fp_unverifiable` / `main_checkout_fingerprint` / `build_hands_git_env` move out of `dispatch-hetero.sh` unchanged in behaviour so both rails run ONE implementation. `dispatch-hetero.test.sh` (279) is the regression test for the extraction and runs BEFORE any foreman code exists |
| `scripts/wait-dispatch-results.js` | new, general rail | chatgpt-tunnel-host (B): the exit-file contract already exists (`dispatch-detach.sh:46`, `dispatch-hetero.sh` `EXIT_FILE`) — what was missing is a wait primitive. Blocks on `<ledger>.results/<run_id>.<stage>.exit`, names the missing ones on timeout |
| `scripts/dispatch-foreman.sh` | new rail | kimi holds the loop in a dispatcher-created worktree; the rail enforces what `foreman-guard` enforces for Claude |
| tests, inventory, CHANGELOG/INDEX | — | red-first; `/l5` routing through the rail is a SECOND patch (skill change, different bar) |

## Measured before building (kimi 0.41.0, this host)

| Question | Result | Consequence |
|---|---|---|
| kimi under an allowlisted env (`env -i PATH HOME TERM KIMI_*`) | runs, Bash tool works (`p7`) | env policy = allowlist, not scrub |
| `kimi -r <id>` from a different cwd | **refused**: `Session … was created under a different directory` (`p6`) | every turn, incl. the forced handoff turn, runs with cwd = the foreman worktree; the rail never moves it |
| Native Read/Write outside cwd | both work (`p7`) | brief, plan, protocol, HANDOFF and the audit stream all live in the run dir OUTSIDE the worktree |
| Network git on the managed hands path under `GIT_ALLOW_PROTOCOL=` | no `fetch`/`push`/`ls-remote` on `dispatch-hetero.sh`, `lib/*.sh`, `src/engine`, `src/merge` | nested dispatch under the push block is expected to work; the suite runs one nested dispatch through the stub to pin it |
| Stream shape | `{"role":"assistant","tool_calls":[{"function":{"name":"Bash",…}}]}`; raw tool stdout can leak as NON-JSON lines (`p1` line 1) | the counter parses each line as JSON and skips failures; a substring grep would count a hand's leaked output |

## Rail-owned enforcements (design §4) → mechanism

1. **Audit log outside the worktree** — `<run_dir>/foreman.stream.jsonl`; kimi's own session store under `~/.kimi-code/` is resume state, not audit, and the result says so.
2. **Tool cap** — the same knob as `hooks/foreman-guard.js` (`foreman_guard.bash_cap` / `AUTOPILOT_FOREMAN_GUARD_BASH_CAP`, default 40). At cap: `kill -- -<pgid>`, status `tool_cap_reached`, then ONE handoff turn `kimi -r <session> -p "<cap reached; write HANDOFF.md>"` under its own cap of 5. Hands already dispatched are their own `setsid` sessions and survive by design; they are reported, not killed.
3. **Verdict at depth 0** — result JSON carries `foreman_branch`, `foreman_head`, `base_sha`, `hands_branches[]`, `handoff_path`, `report_path`; there is no `merged` field. Any ref outside `refs/heads/<foreman-branch>` and `refs/heads/hands/<run_id>/*` changing is `main_checkout_mutated`; a foreman HEAD that is a merge commit or not a descendant of base is `foreman_integrated`; foreman commits go through `check-hands-commit.js`.
4. **Egress / env secrets** — allowlisted env (`PATH HOME TERM LANG LC_* XDG_RUNTIME_DIR KIMI_* AUTOPILOT_*`) plus `--env-passthrough NAME` for anything a nested rail needs; the result records `env_policy` and the passthrough list. Egress at the network level is NOT bounded (MCP http/sse exists) → `egress_policy: "unbounded"` in every result until a measured mechanism exists.
5. **Containment** — kimi runs as its own `setsid` session; the cap/deadline kill targets the session's process group. `containment: setsid` in the result; cgroup is a follow-up.
6. **Worktree budget** — `AUTOPILOT_WORKTREE_ROOT_RUN_ID` and `AUTOPILOT_ROOT_RUN_ID` are forwarded unchanged; `AUTOPILOT_DISPATCH_DEPTH` is set to 1 so hands land at depth 2.

## Policy forks taken conservatively

- Foreman commits on its own branch are allowed (plan-doc edits) but content-gated; integration is rejected.
- Deadline default 3600 s (campaign ≤1 h, memory `l6-managed-campaign-gotchas`). Expiry → kill → handoff turn → status `deadline_expired`; the result's `handoff_written` distinguishes "no handoff" from "empty run".
- The rail never writes HANDOFF.md itself: a fabricated handoff is worse than `handoff_written=false`.

## Review stopping rule

Three decorrelated rounds. After round 3 depth 0 adjudicates by re-derivation and records residuals in `docs/BACKLOG.md`.
