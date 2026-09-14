# Foreman rail residuals (v2.36.34) — accepted and named, not hidden

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14


- **Trigger**: **NOT FIRED — recorded at ship time, 2026-09-13.** Fires when a real foreman run trips one of them.
- **Containment is `setsid`, not cgroup.** `dispatch-hetero.sh`'s `run_worker` has a `systemd-run --scope` branch that proves an empty cgroup; the foreman rail kills the process group only. A foreman that `setsid`s its own child escapes the cap kill. Follow-up: share the cgroup branch the way the boundary lib is shared.
- **Egress is unbounded and the result says so** (`egress_policy: "unbounded"`). kimi has MCP http/sse; nothing at the rail bounds outbound traffic. A mechanism needs a measured design (network namespace? proxy env?) — not a prompt clause.
- **Hands dispatched inline die with the foreman.** The protocol tells the foreman to pass `--ledger/--run-id` so hands detach; a foreman that ignores it loses in-flight hands at the cap kill. The rail cannot tell the two apart from outside.
- **Tool cap counts `Bash` only** — the same scope as `foreman-guard`. Native `Write`/`Edit` calls are uncounted in both implementations; whether that is a gap belongs to the guard, not this rail.
- **`-p` + `--auto` unmeasured** (peer says the CLI refuses the pair; bare `-p` already runs tools, so nothing depends on it).
- **ACP transport not used.** `-p`/`-c` is proven and file-based; ACP would give session fork/list. Revisit only if a resume path needs it.
- **Source**: `docs/plans/2026-09-13-foreman-rail-b-build.md`, ship-time adjudication.

