# Row R3 — `autopilot status runs` new fields, selectors, bounded-rotation enrich
Worktree: /tmp/claude-1000/-home-cookys-projects-autopilot/74f6f85f-f806-4317-a6c7-5e4417df8093/scratchpad/p1a/wt-r3  Branch: p1a/r3  Base: 532930ed
Plan text: §4 P1a bullets "現況", "`runs --json` 每列加", "enrich", and the `status-runs-fields.test.sh` part of
"驗收" plus the matching "負對照" items (manifest without terminal state + `--run` says exited → `rc:null, phase:exited`;
two repos' manifests in one dir with `--project`; rows without the field land in `unscoped`). NOT the watcher.

Product: in `src/status/cli.js` `collectRuns` (read it and `scripts/dispatch-status.js` `--list` first): each row of
`runs --json` gains `elapsed_s`, `rc` (from `<ledger>.results/<run_id>.<stage>.exit` when `ledger` non-null, else null),
`final_status`, `project` (manifest `repo_identity` | null — R1 adds the field to new manifests; old ones lack it),
`stall` (from the `--run` probe, report-only; unprobed → null), `source {manifest, status_probe, exit_file}`, `fact_at`,
`observed_at`, `probe_age_s` (never probed → null and `alive: null`). Read new fields directly from the manifest (the
`--list` branch lacks them). Selectors `--project <project_key|repo_identity>` (normalise via sha256-16 — but R2 owns
`src/status/project-key.js`, which does not exist on your base: implement `--project` matching on the full
`repo_identity` string and on a 16-hex key computed with node:crypto inline, and leave a one-line comment that R4 will
switch to `projectKey()`), `--root <root_run_id>`, `--since <iso>` (top-level `filter:{since}` marking it a display
filter). `--enrich-cap N` (default 8) with bounded rotation: each call resumes probing where the last stopped (persist the
cursor in a small state file under the live dir resolved by `scripts/lib/live-state-dir.js`, honouring
`AUTOPILOT_LIVE_DIR`), so every live run is probed within ceil(live/N) calls; unprobed rows keep their last values +
`observed_at` and are never shown as confirmed running. `runs --json` stays an array (only added fields); human output
unchanged.

Tests (new): `hooks/tests/status-runs-fields.test.sh` (fixture manifest dir + `.exit` files; every new field present;
`rc` integer; `--root` keeps only that tree; human output byte-identical to base; the three negative controls above;
rotation: 9 live fixtures with cap 4 → all probed within 3 calls). Use fixture manifest dirs and a fake probe so no real
dispatch state is read.

Allowed files: src/status/cli.js (and a new `src/status/runs-fields.js` if you want to keep cli.js lean), mirrors if
any, the new test. Consumer sweep: every suite/L1 that greps `collectRuns`, `status runs`, or `src/status/cli.js`.
Commit message: `feat(status): status runs reports elapsed, rc, scope, freshness, and bounded-rotation enrich (mods P1a R3)`
