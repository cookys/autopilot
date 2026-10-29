# Pre-push suite speed: smaller selection and parallel run

## Status

BL-0330 and BL-0331 shipped in f4ed93332, BL-0332 in 77a881731 (all 2026-10-29). Measured: `--jobs 6` ran 696 suites in 79 minutes (13:21 to 14:40, host load about 35), while the serial run of 681 suites the same day took more than 6 hours. The watchfix range selection fell from 679 to 486 suites; the 400 target was not reached, correctness first. BL-0333 and BL-0334 remain open. The sections below stay as history.

Research of 2026-10-29 (owner request: "縮小選取範圍或多核跑都一起研究一下?"), read-only; all simulated changes were made on a scratch copy (git archive of 30b557737), none in this repo. Line numbers below were re-checked against base 0a5439ba1.

## Trigger

Before pushing watchfix, `affected-suites` selected 678 suites and ran them serially for more than 3 hours; at the 3-hour mark only 448 of the 678 had finished (history: 664 suites took 4.5 h, 413 suites took 3.5 h). The 32-core host sat at load 30+ for the whole run, and serial runs under that load already produced time-assertion reds (see BL-0334).

## Direction A: select fewer suites

### Selector mechanism

- The selector is a literal-mention graph (reverse index). `require`/`source` edges are strong and free; at most 2 weak edges are followed (`DEFAULT_MAX_WEAK = 2`, `scripts/affected-suites.js:125`).
- FULL run triggers: `hooks.json`, `run.sh`, `package*.json`, `.claude-plugin/`, `.github/`, `.githooks/`, quality-gate config, or a non-doc changed file that no suite reaches.
- ALWAYS_RUN is 15 suites; `mods/` adds 3 `run-tests.sh`. Selection itself takes about 3 s.
- watchfix diff (03e0e4db9..30b557737) selects 678 of 709 suites (91 .js, 587 .sh).

### Contribution per changed file (single-file `--files`)

| Changed file | Suites selected |
|---|---|
| `src/status/git-env.js`, `src/status/residue.js`, `src/status/runs-watch.js`, `scripts/render-review-page.js` | about 679 each (the inflation sources) |
| `hooks/runs-watch-autostart.js` | 354 |
| `mods/live/*` | 103 |
| `hooks/audit-log.js` | 38 (23 after removing always-run) |
| each of the 4 changed test files | 25 |

Removing files one at a time changes nothing (every contribution is 0) because the sets overlap heavily.

Note for later readers: `hooks/audit-log.js` is NOT an inflation source (only 23 suites beyond always-run). Do not spend effort there.

### Inflation chain

- `src/status/git-env.js` <- `src/status/runs-watch.js` <- `scripts/session-mode.js:612` (a `require('../src/status/runs-watch')` inside a function, after the `autostartDisabled` gate at :610) <- hub files. `hooks/tests/lib.sh` is sourced by 567 suites, and through it 611 suites are selected. The test environment sets `AUTOPILOT_RUNS_WATCH_AUTOSTART=0` (`hooks/tests/lib.sh:38`), so the require never executes in shell suites, yet it counts as a strong edge.
- Same shape: `src/status/cli.js:535` requires `./runs-watch` only in the `status --watch` branch; through `bin/autopilot.js` this pulls in 247-298 suites.
- Pseudo edge: `hooks/tests/lib.sh:210` (`export AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/session-mode"`) is read as a bare-name mention of `session-mode.js`.
- Common words: the stem `residue` maps to a single file, so a quoted `'residue'` anywhere becomes an edge (75 suites).

### Options

| Id | Option | Selection for this diff | Risk |
|---|---|---|---|
| A1 | Treat lazy (post-gate, in-function) `require` as a weak edge | 678 -> 393 (about 1.9 h saved; conjecture: simulated selection times the historical mean of about 24 s per suite, not measured) | low to medium; BL-0181 style misses; `runs-watch.js` alone still selects 354 |
| A2 | `--max-weak 1` | 389 | medium to high, BL-0181 style |
| A3 | Fix pseudo edges and common words (needs A1 alongside) | additional, small | low |
| A4 | Function-level granularity | n/a | not recommended |
| A5 | Dynamic reachability graph (instrumented run) | under 150 (conjecture) | second stage only; not opened as a backlog row |
| A6 | Sample the hub files | 100-130 | medium |

Verification harness for any selector change: `docs/plans/evidence/2026-10-13-affected-suites/miss-check-wide.js` and `miss-check.md` (historical breakers plus mutation oracle). Rerun on every selector change.

## Direction B: run in parallel

`scripts/affected-suites.js` has no parallel option (`runSelected` is serial). `hooks/tests/run.sh` already has `--parallel [N]` (:13), slowest-first ordering (:467), `AUTOPILOT_TEST_TIMING_FACTOR` (:449) and a serial tail of 8 suites (:773-776).

### Already isolated per suite

`TEST_TMP` (`hooks/tests/lib.sh:111`), HOME/TMPDIR (:131-147), `ENGINE_*_DIR`, the `/dev/shm` live dir (:162-170), price caches, session-mode directory (:210). `suite-residue-reap` runs only at start/end of `run.sh`, requires the lock to be released and mtime of at least 60 s; each suite holds `.autopilot-live.lock`. `affected-suites` does not call reap; the risk is another shell running `run.sh` at the same time (2026-09-13 incident type).

### Not parallel-safe (or needs special handling)

1. Serial tail in `hooks/tests/run.sh:773-776`: `codex-plugin-package`, `dev-setup`, `resolve-review-loop-consult-discuss-gate` (chmod 000 on real evals files), `dispatch-detach`, `dispatch-hetero`, `dispatch-lineage`, `dispatch-pi`, `sync-all`.
2. Temp file in the real worktree: `hooks/tests/check-phase-review-receipt.test.sh:1093-1096` (`$REPO_ROOT/scripts/hetero-review-loop.neg15r.js`).
3. Create/delete branches or worktrees in the real repo: `context-window.test.sh:32-45`, `session-mode.test.sh:208`, `suite-residue-reaper.test.sh:613`; `test-snapshot.test.sh` lines 363/414/452/859/890/974/1134 use `git config --local` and `worktree add` on `$REPO_ROOT` (whether `REPO_ROOT` is a sandbox there is unconfirmed).
4. Host-wide process scans: `dispatch-hetero-wall-timeout.test.sh:180-187`, `paid-batch-auth-stop.test.sh:105`.
5. Wall-clock assertions: `hooks/bash-launch-guard.test.js:714,756,776` (200/100 ms), `hooks/tests/dispatch-hetero-gate-rules.test.sh:133` (`timeout -s TERM 2`), `dispatch-author-strict-roster`; in the 2026-10-29 watchfix pre-push affected-suites record, `bash-launch-guard.test.js`, `dispatch-author-strict-roster.test.sh` and `dispatch-hetero-gate-rules.test.sh` were all rc=1 under serial high load (the first two are known pre-existing reds). Only 3 suites use `test_timing_scale`; 62 shell suites contain a `sleep` of 2 s or more.
6. No fixed listening ports. 7. No `git config --global` writes. 8. `lib.sh` does not override `XDG_RUNTIME_DIR`.

### Design draft

- Move the serial list to one source (`hooks/tests/lib/serial-suites.txt`) read by both `run.sh` and the new runner; add classes 2-5 above.
- `--jobs N` worker pool, slowest first; after the pool drains, run the serial list.
- Timing factor defaults to N. Each worker gets its own `XDG_RUNTIME_DIR`/TMPDIR prefix. The runner does not call global reap and takes `suite_oracle_lock`.
- A suite that is red under parallel is automatically rerun serially once; green on rerun is labelled flaky-under-parallel.
- Buffer each suite's output and print it whole, keeping the `rc=N <path>` lines and the summary. Default behavior (no flag) is unchanged.
- Estimate (conjecture, not measured): N = 6-8 takes 4.5 h to about 1-1.5 h; combined with A1 (393 suites) about 30-40 min. Risk: load 36 on 32 cores makes time assertions more fragile.

## Duration data today

`push26`/`push28`/`pp-watchfix.log` carry no per-suite seconds. `~/.cache/autopilot/test-durations.tsv` stops at 10/12 (414 rows, median 3 s, no serial tail, 291 suites of this run have no record). Shape: top 10 take 32%, top 20 take 44%, top 50 take 69%. Note: `run.sh` already orders slowest-first from this file, but `affected-suites.js` neither updates nor uses it. Conclusion: the runner has to record seconds for every suite itself (BL-0330).

## Backlog rows and order

BL-0330 (record durations, B2) -> BL-0331 (`--jobs`, B1) -> BL-0332 (lazy require, A1; may run in parallel with B1) -> BL-0333 (contribution report), BL-0334 (time assertions and process scans, B3). A5 stays here as a possible second stage and is not queued.

## Acceptance and negative controls per row

- BL-0330 (B2): `--run` always writes `seconds` per suite and updates the durations tsv, serial tail included. Negative control: delete the tsv; the runner falls back to name order without crashing.
- BL-0331 (B1): on a 40-suite sample `--jobs 1` and `--jobs 8` give the same rc set; 3 consecutive runs add no new red; wall time at least 3x faster with load recorded. Negative control: moving a known non-parallel-safe suite out of the serial list must reproduce its red; two fixtures sharing a fixed path must be caught under parallel.
- BL-0332 (A1): this diff selects at most 400; `miss-check-wide.js` N=60 has zero misses; all 28 breakers still hit. Negative control: a fixture with a lazy require whose path really executes is still selected; reverting to a strong edge turns the check red.
- BL-0333 (contribution report): `--json` gains a `contrib` field (per changed file: suites pulled in, suites pulled in only by it).
- BL-0334 (B3): time assertions multiplied by `test_timing_scale` (only loosening upper bounds); `pgrep`/`ps` scans limited to the `TEST_TMP` prefix; `dispatch-hetero-gate-rules.test.sh` R2 (:133) waits for `FAKE_STARTED` instead of the fixed `timeout -s TERM 2` (already red once under serial load on 2026-10-29).

## BL-0335: false reds in the rerun and serial stage of --jobs mode

First official `--jobs 6` run, 2026-10-29 (the run log of that day).

- engine-qualify-a and external-lifecycle-witness were red inside the pool and still red on the serial rerun, yet green when run directly on the same commit.
- The engine-qualify-a error showed the rerun seeing a capture-backup left by the previous attempt; the path sits under the per-entry TMPDIR. Suspected cause: the rerun reuses the same temporary directory.
- dispatch-detach and dispatch-hetero, both on the serial list, were red in the `--jobs` serial stage and green when run directly. Cause not confirmed (suspects: environment difference, or processes left over from the pool).

Shipped in merge 53b8a434b (2026-10-29). Root causes: the per-entry TMPDIR/XDG path put a unix socket path over the `sun_path` limit of 108 bytes, so the rerun and the serial-stage suites failed to bind; and the per-entry XDG directory fell under a group/world-writable ancestor, which the code refused. Fix: fixed-length `mkdtemp` TMPDIR/XDG (no counter in the path), a private XDG base when the caller gives none, the caller's XDG base first in order, ancestors checked before `mkdir` (root-owned sticky ancestors count as safe), group SIGKILL confirmed per entry, and `lingering_group` kept on flaky rows. Verification before the push: `affected-suites --jobs 6` ran 355 suites with 0 failed and no flaky-under-parallel row.
