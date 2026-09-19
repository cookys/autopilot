## Plan
# Plan L — stale leases become collectable
1. RED: a dead-pid, heartbeat-silent, worktree-absent lease is carried across rotation and keeps its journal rows alive.
2. `run-ledger.sh lease-gc`: dead only if pid dead AND heartbeat silent > TTL (12 h default) AND worktree absent / no flock holder (worktree-activity.js via shim); append `leased → dead` with a named reason through the normal transition path; `--dry-run`, `--json`.
3. Wire into the residue reap step (one place), inventory row.
4. GREEN: dead lease dropped from the carry (segment shrinks); live pid, live flock, recent heartbeat each skipped and named; existing rotation suites untouched; ONE commit.
Acceptance: after the merge the operator runs `lease-gc` once on this host and the next rotation's carry no longer spans five 2.5 MB segments.

## Product
1. RED first (new suite, model `hooks/tests/run-ledger-rotation.test.sh:17-59` which asserts a LIVE lease survives rotation):
   acquire a lease whose pid is a forked-and-killed process, with a `heartbeat_ts` far in the past and no heartbeat rows, worktree
   field pointing at a path that does not exist; force rotation (`RUN_LEDGER_MAX_BYTES=600`) — at base the dead lease is carried
   (`query-latest` → `leased`) and its run_id keeps its journal rows in the carry. Record the observed output in the RED comment.
2. New subcommand `run-ledger.sh lease-gc [--ttl-secs N] [--dry-run] [--json]` next to `stage-probe`: for every latest-`leased`
   (run_id, stage) row, the lease is DEAD only when ALL hold: (a) `is_process_alive(pid, start_time)` is false; (b) no
   `kind:"heartbeat"` row for (run_id, stage, generation, nonce) newer than `now − ttl` and the stage row's own `heartbeat_ts` is
   older than `now − ttl`; (c) the recorded `worktree` is empty/absent on disk OR `classifyWorktree` (from
   `scripts/lib/worktree-activity.js`, called through a tiny node shim exactly as `watch-foreman.js` does) returns `absent`, and
   `lockHolderPid` finds no live flock holder. TTL default = `RUN_LEDGER_LEASE_GC_TTL_SECS` or 43200 s (12 h — the existing
   `DEFAULT_QUARANTINE_TTL_SECS` precedent; never the 120 s acquire window). For each dead lease append a stage row
   `leased → dead` with `reason: "lease_gc: pid_dead heartbeat_silent_<age>s worktree_<absent|none>"` through the SAME append path
   every other transition uses (`is_allowed_transition` must accept it; generation/nonce fenced), never by editing rows. `--dry-run`
   prints the candidates and appends nothing; `--json` emits `{scanned, dead, skipped:[{run_id,stage,reason}], appended}`. A lease
   that fails any one predicate is `skipped` with the failing predicate named — a live CC-native foreman (dead shell pid, live
   worktree flock) MUST be skipped; pin that.
3. Wire it in: `scripts/reap-dispatch-worktrees.sh` (or the residue receipt step that finish-flow already runs — read
   `docs/scripts-inventory.md` row 71 and the reap script's header to pick the ONE right place) calls `lease-gc --json` and
   includes its summary in its output; nothing calls it automatically on every append (rotation stays cheap and side-effect free).
   Add the inventory row (`docs/scripts-inventory.md`) and the one-line `CLAUDE.md` group entry is NOT needed (same script).
4. GREEN: the RED fixture's lease is `dead` after `lease-gc`, the next append's carry drops it and its journal rows (segment
   shrinks — assert byte size), `run-ledger-rotation.test.sh` (live lease survives) and `run-ledger-rotation-order.test.sh`
   (append-order carry) stay green untouched; `--dry-run` appends nothing. Codex mirror of `run-ledger.sh` and any touched script
   via `bash scripts/sync-codex-plugin-skills.sh` (same commit).

## Tests (RED-first, `# RED at <base sha>: …` beside each new assertion; never weaken an existing one)
- NEW `hooks/tests/run-ledger-lease-gc.test.sh` (chmod +x; copy the prologue of `run-ledger-rotation.test.sh`; sandbox ledger under
  `$TEST_TMP` only — NEVER the host ledger): RED case; GREEN dead-lease collected + carry shrinks; live-pid lease skipped; dead-pid
  but live-worktree-flock lease skipped (hold a flock from the test on a file inside the fixture worktree); recent heartbeat row
  skipped; `--dry-run` idempotent; `--json` shape.

## Verify (foreground, each with `< /dev/null`, all exit 0)
```
bash hooks/tests/run-ledger-lease-gc.test.sh
bash hooks/tests/run-ledger-rotation.test.sh
bash hooks/tests/run-ledger-rotation-order.test.sh
bash hooks/tests/run-ledger-directive.test.sh
bash hooks/tests/dispatch-detach.test.sh
bash hooks/tests/campaign-claim-resolve.test.sh
bash hooks/tests/implementation-campaign-dogfood.test.sh
bash hooks/tests/reap-dispatch-worktrees.test.sh
bash scripts/sync-codex-plugin-skills.sh --check
node scripts/check-js-syntax.js
node scripts/check-claude-md-inventory.js
```
(if `reap-dispatch-worktrees.test.sh` does not exist, `ls hooks/tests | grep -i reap` and run every match.)

## Allowed files
`scripts/run-ledger.sh`, `scripts/reap-dispatch-worktrees.sh` (or the one residue script you pick — name it in REPORT.md),
`docs/scripts-inventory.md`, their codex twins via the sync script, `hooks/tests/run-ledger-lease-gc.test.sh` (new). Nothing else;
do NOT touch `scripts/lib/worktree-activity.js`, `watch-foreman.js`, `agent-liveness-check.js`, any `src/`, or the host's
`.git/autopilot/` ledger (the operator runs the real GC after the merge).

Commit ONE commit on the branch you are on; do not touch other files; do not run sync scripts on the codex mirror by hand — run
`bash scripts/sync-codex-plugin-skills.sh` then `--check` and include the mirror in the same commit if it changed; run every
verify command in the foreground before committing (each with `< /dev/null`); every NEW `*.test.sh` you create must be
`chmod +x` and must pass `test -x` — `run.sh` refuses 100644 suites; never set `AUTOPILOT_SESSION_ID`/`CLAUDE_CODE_SESSION_ID`
in the environment of any command you run.
