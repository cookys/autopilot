# Brief L — unit name for this run: `leasegc-l` (repair: `leasegc-l-r2`, retry: `leasegc-l-retry`)
clone = /home/cookys/projects/autopilot-par4-leasegc · base_sha = 964aaa4a63e61858d9ebe80d8ea231f1748cb2ce (clone HEAD, includes the shadow commit) · run_id = par5-l · run_dir = /tmp/claude-1000/-home-cookys-projects-autopilot/38a23a44-ca0a-4350-96bd-315ba7dd269d/scratchpad/par5/l/run

# Stale campaign leases must be garbage-collectable, so the ledger's rotation carry can shrink

BACKLOG row: "Managed rail: stale campaign leases are never released — 109 runs leased since July keep the ~2 MB carry alive" (S;
trigger fired: every append to `.git/autopilot/implementation-campaign.jsonl` rotates, carry ≈ whole ledger). Read the row
(`grep -n "stale campaign leases" docs/BACKLOG.md`) and plan `docs/plans/_archive/2026-09-16-ledger-rotation-order.md` §6.

Facts at base (depth-0 verified 2026-09-19; re-verify before coding — all in `scripts/run-ledger.sh`):
- Stage row: `kind:"stage"`, fields `run_id, stage, state, generation, nonce, pid, start_time, pgid, heartbeat_ts, git_ref, git_sha,
  worktree, resources, reason, …` (`:727-746`). `state` vocabulary `state_rank()` `:60-72`; transitions `is_allowed_transition()`
  `:78-105` — `leased → {committed,reviewed,verified,merged,stale_ignored,dead}`; `BLOCKED_STATES="stale_ignored quarantined dead"` `:58`.
- Carry (`atomic_append_ledger` `:3121`, jq `:3170-3187`): `$leases` = latest row per (run_id, stage) whose state is literally
  `"leased"`; `$active` = their run_ids; only those run_ids' journal rows are carried. Any non-`leased` latest state stops the
  carry — a GC that writes `leased → dead` needs NO carry-side change. Rotation at `RUN_LEDGER_MAX_BYTES` (256 KiB, `:47`), 4 segments.
- Liveness today: `stage-acquire` staleness (`:672-679`) = `is_process_alive(pid,start_time)` + `now − heartbeat_ts < DEFAULT_STALE_SECS`
  (120 s, `:46`); heartbeats are separate `kind:"heartbeat"` rows (`command_stage_heartbeat` `:754-826`) that are NOT folded into the
  stage row and NOT carried across rotation; `command_stage_probe` `:2008-2084` can drive a stale lease to `dead` but nothing calls it.
  `command_gc_check` `:2501-2601` handles terminal states only.
- Caveat (`scripts/agent-liveness-check.js:7-11`): `stage-acquire` records the INVOKING SHELL's pid — for a CC-native foreman that
  shell exits at once while the foreman lives for hours (13–33 h measured), so "pid dead" alone is NOT death. Detached leases
  (`scripts/lib/dispatch-detach.sh:69`, `dispatch-hetero.sh detached_main`) record the surviving pid. The shared liveness module is
  `scripts/lib/worktree-activity.js` (`lockHolderPid` via /proc/locks `:68-82`, `classifyWorktree` → `absent|active|idle|unreadable`
  `:102-124`), consumed by `agent-liveness-check.js` and `watch-foreman.js` so they never drift — reuse it, do not reinvent.
- Host (counts only): 5 × 2.5 MB segments; 184 latest-leased (run_id, stage) rows, 123 run_ids, 184/184 pids dead, oldest
  2026-07-27, newest 2026-09-18; zero non-leased stage rows survive. `expired` exists only as a directive-ack status — do NOT add
  a new stage state; reuse `dead` (already allowed from `leased`, already blocked, already stops the carry).

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

## How you work (foreman rules — identical for every unit)
- You ORCHESTRATE. You never edit code yourself, never merge, never push, never checkout, never `cd` the main
  checkout. All product work is done by ONE hand you dispatch; you verify by git artifacts (`git -C <clone> diff --stat`,
  `git -C <clone> log`, the hand's result JSON), never by its self-report. Depth 0 reaches the verdict from git after you
  finish. Every git/script command runs against YOUR clone: `git -C <clone> …` and `cd <clone> && bash scripts/…`.
- Your clone carries one clone-local commit ("PARALLEL-RUN LOCAL ONLY … enforcement_mode shadow") on top of the base;
  `<base_sha>` for the hand is that clone HEAD (given at the top of the brief). Depth 0 cherry-picks the hand's commit
  only; the shadow commit is never merged. Do not touch `.claude/owner-kernel-governance.json`.
- Hand dispatch (exact form; substitute <unit>, <clone>, <run_dir>, <base_sha>; keep every other flag). Run it with the
  Bash tool's `run_in_background: true` (it takes up to 40 min; a foreground call would time out) and **in the same
  turn** start a dead-man's switch, also `run_in_background: true`: `sleep 3000; echo WAKE-<unit>`. Then END YOUR TURN
  and wait for the harness notification (either one). Never foreground-poll, never `sleep` in the foreground, never
  read the background task's output file with a shell command.
  `cd <clone> && env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID bash scripts/dispatch-hetero.sh --branch hands/<run_id>/<unit> --base <base_sha> --ledger <run_dir>/hands.ledger --run-id <unit> --stage implement --runner cursor --model cursor-grok-4.6-low --effort low --timeout 40m --prompt-file <run_dir>/hand-<unit>.md > <run_dir>/<unit>.dispatch.json 2> <run_dir>/<unit>.dispatch.err; echo "rc=$?" >> <run_dir>/<unit>.dispatch.err`
  Write `<run_dir>/hand-<unit>.md` first (one heredoc; the file name is EXACTLY `hand-` + the unit name given at the top of the brief + `.md` — the dispatch fails `prompt file not readable` on any other name): paste the "Product", "Tests", "Verify" and "Allowed files"
  sections below VERBATIM plus: "Commit ONE commit on the branch you are on; do not touch other files; do not run sync
  scripts on the codex mirror by hand — run `bash scripts/sync-codex-plugin-skills.sh` then `--check` and include the
  mirror in the same commit if it changed; run every verify command in the foreground before committing (each with `< /dev/null`); every NEW `*.test.sh` you create must be `chmod +x` and must pass `test -x` — `run.sh` refuses 100644 suites; never set
  `AUTOPILOT_SESSION_ID`/`CLAUDE_CODE_SESSION_ID` in the environment of any command you run."
  On ANY wake (notification or dead-man): first `grep -c '^rc=' <run_dir>/<unit>.dispatch.err`. If 0 the hand is
  still running (the dispatch is detached and lands its result in the ledger even if the shell was killed): run
  `cd <clone> && node scripts/wait-dispatch-results.js --ledger <run_dir>/hands.ledger --expect <unit>.implement --timeout 500 --json`
  in the foreground once; if it reports landed, read the result from the ledger/dispatch JSON; if not, start another
  background dead-man (`sleep 1500; echo WAKE-<unit>`) and end your turn — at most 3 extra waits, then ESCALATION.md.
  When the result is there: read `<run_dir>/<unit>.dispatch.json` with `head -c 3000` (status, branch, head sha, acceptance) — never
  the raw hand log. `status: implemented` + `git -C <clone> log --oneline <base_sha>..hands/<run_id>/<unit>` showing
  exactly one commit is the only success signal.
- Review (decorrelated family, required before you report done): produce the diff with
  `git -C <clone> diff <base_sha>..hands/<run_id>/<unit> > <run_dir>/<unit>.diff` and run (also `run_in_background`
  + a `sleep 1200; echo WAKE-review-<unit>` dead-man; append `; echo "rc=$?" >> <run_dir>/<unit>.review.err` the same way):
  `cd <clone> && env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID bash scripts/dispatch-review.sh --runner claude-native --model claude-fable-5-1 --effort high --timeout 15m --diff-file <run_dir>/<unit>.diff --spec-file <run_dir>/hand-<unit>.md > <run_dir>/<unit>.review.json 2> <run_dir>/<unit>.review.err`
  Read the verdict with `node -e` printing only `verdict`, and each finding's severity + title (never the whole JSON).
  If the verdict is FIX-THEN-SHIP with 🔴/🟠 findings you judge real, dispatch ONE repair hand on branch
  `hands/<run_id>/<unit>-r2` with `--base <head sha of hands/<run_id>/<unit>>` and `--run-id <unit>-r2`, prompt =
  the original hand prompt + "## Repair round — fix these review findings" listing them verbatim; re-review the delta
  (`git diff <r1 head>..hands/<run_id>/<unit>-r2`). At most one repair round; then report.
- Budget: 40 Bash calls total (a guard denies the 41st). Plan them: write prompt (1), dispatch+deadman (2), read
  result (1), log/diff-stat (2), review+deadman (2), read verdict (1), optional repair (6), report (1). Do NOT read
  large files into your context; use `head`/`grep -n`/`sed -n`.
- If the hand fails before committing (precondition_failed, transport error, acceptance_failed with no commit), read
  `<unit>.dispatch.err` tail and the failure reason, then dispatch ONE retry with the same prompt plus the failure
  reason appended (`--run-id <unit>-retry`, branch `hands/<run_id>/<unit>-retry`). Two failures ⇒ write ESCALATION.md
  (exact reason, what you tried) and stop.
- Before you write REPORT.md, run the consumer sweep yourself (evidence-discipline §37/§39) in ONE Bash call: `cd <clone> && for s in $(grep -l '<identifiers the hand renamed/added/removed>' hooks/tests/*.test.sh | grep -v -e <each Verify suite>); do bash "$s" > <run_dir>/sweep.$(basename $s).log 2>&1 < /dev/null; echo "rc=$? $s"; done > <run_dir>/sweep.txt`; then `grep -v '^rc=0' <run_dir>/sweep.txt` and list the red ones in REPORT.md with their failing assertion names (`grep ^FAIL`). Do not fix them yourself; depth-0 decides.
- REPORT.md (write to `<run_dir>/REPORT.md`, ≤ 80 lines) must name: hand branch(es) and head sha(s), `diff --stat`
  vs base, the review verdict and every finding with accepted/refuted + one line why, the verify commands' tail lines
  as recorded in the dispatch JSON, anything NOT done, and any BACKLOG-row text you found to be wrong. Your final
  message to depth 0 is the REPORT.md content verbatim, nothing else.
