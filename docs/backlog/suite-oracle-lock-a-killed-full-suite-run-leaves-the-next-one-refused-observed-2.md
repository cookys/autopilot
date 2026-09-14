# 🔵 suite oracle lock: a killed full-suite run leaves the next one refused (observed 2026-09-02)

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14

- **2026-09-04 second instance**: a `kill -9` of a running suite left `.owner` naming a dead pid; the next run was refused although `kill -0` on the holder failed. Workaround used: verify no live `run.sh` then `AUTOPILOT_SUITE_ORACLE_LOCK=0` — which the `suite-oracle-lock` test inherits and fails on, so that file had to be re-run standalone without the env. Trigger stands.

`hooks/tests/run.sh --parallel` refused with `action lock held by run_id=…-2994178-…` while pid
2994178 no longer existed and `/proc/*/fd` showed **no process holding
`/tmp/.autopilot-suite-oracle.lock`**. A later re-run succeeded, so this was contention with a run
that was still finishing rather than a permanently stuck lock — but the refusal message names a dead
pid from the `.owner` sidecar, which is exactly the shape a genuinely stale lock would take, and a
reader cannot tell the two apart from the message. Worth either cross-checking holder liveness
before printing the pid, or saying explicitly that the pid comes from a sidecar that can outlive its
process. Not urgent: the lock itself is flock-based and does release on death.

## Format example

```markdown
