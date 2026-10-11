# Plan — TMPDIR residue containment: contain test temp dirs, delete runtime temp files after use, gate unregistered prefixes
> Status: **active, size L** (2026-10-12) · Owner: cookys · Branch: `feat/tmp-residue-containment` · Frame: dev-flow L, no version bump (owner 2026-10-11: 3.0.0 not yet; the shipped-code changes here are PATCH-class and ride the next cut)

## Project Goal

> **Final goal**: temp directories and files that autopilot's shipped code and its test suites run through `hooks/tests/run.sh` create under `${TMPDIR:-/tmp}` stop accumulating on a long-lived host, including ones a future test or script forgets to clean. A test file run standalone (`node --test <file>`) is outside this goal (D3, §7).
> **Success criteria**: KR1–KR5 in §2, each measured on this host with the command named there (counts before/after, reaper and prune receipts, the gate's exit code on the repo and on its negative control).
> **Scope boundary**: includes L1 test containment, owner-side deletion in the engine and `dispatch-consult.sh`, one registry with a daily prune, and a gate on shipped code. Excludes the items in §7.

### Requirements ledger (owner, verbatim)

| # | Requirement | Phase |
|---|---|---|
| R1 | "應該要修吧? 你跳掉下一次不是依樣還會累積? 看怎樣讓她是系統化根更堅固可靠的方式來架構?" (2026-10-11) | 1–4 (KR1–KR5) |
| R2 | "殘留架構開工" (2026-10-12) | all |
| R3 | "先不用 bump version , 我還不打算出 3.0.0" (2026-10-11) | §2.5 first constraint |

### Scope completeness audit

| Dimension | Applies | Where |
|---|---|---|
| Source code + tests | yes | phases 1–4 |
| User-facing docs | yes | `docs/scripts-inventory.md` rows, `hooks/README.md` (residue-auto-reap row gains the tmp phase), the residue reference |
| API / interface reference | no | internal-only (§2.6); `prune_tmp_residue` signature unchanged |
| Config templates / examples | yes | `residue.tmp_prune` documented next to `residue.auto_reap` in `hooks/README.md` and `docs/scripts-inventory.md` |
| CHANGELOG entry | deferred | owner: no version now (R3); the next cut writes it. Recorded in the Review log |
| Version bump | no | R3 |
| Version sync grep | no | no bump |
| Migration notes | no | no breaking change |
| Dependent repos / consumers | no | consumers receive it with the plugin; no config they must change |
| Credit / attribution | no | no external source absorbed |
| Dogfood | yes | the KRs are measured on this host's `/tmp` |

## 0. Context / thesis

On 2026-10-11 this host held 983 `/tmp/autopilot-*` directories (15 GB). `/tmp` is ext4 here and is not cleared on reboot. 934 were test residue, deleted by hand. 14.8 GB came from two L1 tests (`scripts/engine-qualify-{consult,discuss}.test.js`), about 32 MB per run each, over 260 runs since 2026-08-28.

Nothing reaped them because the cleanup design relies on enumerating known prefixes:
- `scripts/lib/prune-tmp-residue.sh` holds a fixed list of patterns and excludes the whole `autopilot-*` family on purpose (`autopilot-foreman-runs/` is a live run dir). It only fires when one of four dispatch scripts starts (`dispatch-review.sh:173`, `dispatch-author.sh:146`, `dispatch-explore.sh:70`, `dispatch-hetero.sh:246`).
- `hooks/tests/lib/suite-residue-reap.sh` reaps `autopilot-test-*` (from `hooks/tests/lib.sh:110`), not the prefixes the Node tests choose.
- L2 suites already get a per-test `TMPDIR` (`hooks/tests/lib.sh:123-134`). L1 (`node --test`, `hooks/tests/run.sh:552`) inherits the real `TMPDIR` with no isolation. 16 L1 files have no cleanup at all.
- Shipped code leaks too. `src/engine/autopilot-engine.js:2015` (`autopilot-review-loop-*/range.diff`, one directory per `prepareReview`) and `:2670` (`autopilot-repair-prompt-*`) are never removed. Neither are `scripts/dispatch-consult.sh:137,168,222,273` (no trap) or several others (inventory: §3).

A new test or script that picks a new prefix and forgets to clean will leak again. The thesis: **contain by construction where we can (tests), delete at the owner where the lifetime is known (runtime), and make an unregistered prefix fail a gate before it ships.**

Prior commit already verified, to be merged in phase 1: branch `worktree-agent-a776e40555efd8f67` (`49f98412`) adds success-path cleanup to the consult/discuss/validate-json-schema tests (before/after count unchanged, re-run by depth-0) and a BACKLOG row this plan supersedes.

## 1. Problem

The owner wants residue to stop accumulating systematically, not one leak at a time: "應該要修吧? 你跳掉下一次不是依樣還會累積? 看怎樣讓她是系統化根更堅固可靠的方式來架構?" (2026-10-11).

## 2. OKR / KRs

Each KR is one command that exits 0 on pass; the new test files encode the scenario, its fixtures and its negative control.

- **KR1 (tests contained)**: `S=$(mktemp /tmp/kr1.XXXXXX); bash hooks/tests/run.sh --parallel; node scripts/lib/tmp-residue.js new-since --stamp "$S" --exclude-kind live,lock --json` prints `"entries":[]` (run twice on this host). `--exclude-kind lock` drops exactly the shared lock/owner files of §2.5 (`.autopilot-suite-run.*.lock`, `.autopilot-suite-oracle.{lock,owner}`, `.autopilot-gc.lock`), which the registry lists as kind `lock`; `live` drops `autopilot-dispatch-runs`, `autopilot-foreman-runs`, `autopilot-<uid>`. Nothing else is excused.
- **KR2 (killed run recovered, live run kept)**: `bash hooks/tests/l1-tmpdir-containment.test.sh`. It (a) runs `run.sh` with the L1 probe `hooks/l1-tmpdir.test.js` and asserts the probe saw `os.tmpdir()` == the `apl1.*` dir run.sh exported as `AUTOPILOT_L1_TMP`; (b) creates an `apl1.*` dir whose `.autopilot-live.lock` is held by a child, `kill -9`s the child, backdates the lock file with `touch -d '-2 min'` (past `AUTOPILOT_SUITE_REAP_MIN_AGE`, default 60 s), runs `suite_residue_reap`, asserts `reaped >= 1` and the dir is gone; (c) the same with the lock still held asserts the dir is kept (`skipped_live >= 1`).
- **KR3 (runtime deletes)**: `bash hooks/tests/engine-diff-lifetime.test.sh` on a fixture repo with the **default** `diffProvider`, for: success; `git diff` failure; reviewer throws; identity/binding prepare throws. In each it asserts (1) the dir existed while the reviewer ran (the stub reviewer records `fs.existsSync` and the diff bytes), (2) 0 owned `autopilot-review-loop-*` / `autopilot-repair-prompt-*` dirs remain, (3) the repair-prompt scenario actually created one (non-vacuous), (4) an injected `diffProvider`'s returned file still exists after `finish()`, (5) `diff_digest` / `review_input_digest` equal the values computed from the same diff bytes before the change (pinned in the test). Mutation: with dispose removed, (2) fails; with dispose moved before `reviewDiff`, (1) fails. `bash hooks/tests/dispatch-consult-trap.test.sh` sends SIGTERM mid-run and asserts 0 `dispatch-consult-*`.
- **KR4 (daily prune fires)**: `bash hooks/tests/tmp-residue-prune.test.sh`. Under a fixture `TMPDIR` it runs `node scripts/repo-residue-sweep.js reap --auto --yes --repo <fixture> --tmpdir <fixture-tmp> --json` and asserts the receipt's `tmp_prune.deleted` lists exactly the aged `scratch` entry; a fresh scratch entry, an aged `live`-kind dir, an aged dir holding `.autopilot-live.lock`, and a symlink are kept. A second call within 24 h reports `tmp_prune.skipped: "throttled"` (host stamp `${XDG_RUNTIME_DIR:-~/.autopilot}/autopilot-tmp-prune.stamp`). Opt-outs `AUTOPILOT_RESIDUE_TMP_PRUNE=0` and `{"residue":{"tmp_prune":false}}` each give `skipped: "disabled"`. `hooks/tests/residue-auto-reap.test.sh` gains a case that the SessionStart hook's detached sweep produces that receipt.
- **KR5 (gate)**: `node scripts/check-tmp-residue-registry.js` exits 0 on the repo; `node scripts/check-tmp-residue-registry.js --self-test` exits 0 only if each planted fixture (unregistered literal prefix; success-path-only `rmSync`; allocation before the `try`; `mktemp` before its `trap`; unextractable prefix without an allowlist entry) yields exit 1; `bash hooks/tests/check-tmp-residue-registry.test.sh` runs the real `.githooks/pre-commit` on a scratch clone with a planted file (exit 1) and `scripts/preflight-release.sh`'s gate step on the same clone (fails).

## 2.5 Global Constraints (copied verbatim into every dispatch)

- No version bump: do not run `scripts/sync-version.js`, do not add a CHANGELOG version section. CHANGELOG has no Unreleased convention; record the change as "pending a version" in this plan's Review log and the project README.
- New code that parses JSON or may run in a sandbox is Node (built-ins only, Node ≥ 20.10); git/shell glue may stay Bash.
- The per-run L1 temp dir is short and outside any git worktree: `${TMPDIR:-/tmp}/apl1.XXXXXX` (AF_UNIX sun_path ≤ 108 bytes; codex leaves empty `.git` mount points in writable roots).
- Locks and registration files that coordinate across runs stay in the shared `${TMPDIR:-/tmp}`. Never move `suite_run_lock`, `suite_oracle_lock` or `.autopilot-gc.lock`, and never set `TMPDIR` globally at the top of `run.sh` (`suite-residue-reap.sh:293` re-resolves `${TMPDIR}` at EXIT).
- Never write a second reaper. Killed-run recovery reuses `suite-residue-reap.sh` (flock + minimum age); worktree reaping stays with the marker/lock reapers (`lib/worktree-reap.sh`, `repo-residue-sweep.js`).
- mtime-only deletion applies only to registry entries with `kind: "scratch"`. A live directory (`autopilot-foreman-runs`, `autopilot-<uid>`, `autopilot-dispatch-runs`) is never mtime-pruned.
- The engine's `diffProvider` injection signature `{ base, commit, branch, round, currentBase, cwd } -> path` does not change. Diff files are deleted in place, never moved (moving them changes digests that may embed the path; see §6 R4).
- One registry file is the single statement of "which temp prefixes exist and who cleans them": `scripts/lib/tmp-residue-registry.json`, kinds `scratch` · `evidence` · `test-lockgated` · `live` · `lock` · `worktree`. Every prune path and the gate read it. `suite-residue-reap.sh`'s `_SRR_PATTERNS` must equal the registry's `test-lockgated` entries (parity test `hooks/tests/tmp-residue-registry.test.sh`). Age-only deletion (`tmp-residue.js prune` and the `prune_tmp_residue` wrapper) acts only on `scratch`/`evidence`; `tmp-residue.js patterns` emits only those kinds, and a caller-passed pattern to `prune_tmp_residue` is honoured only if it equals one of them, else dropped.
- Every acceptance check records observed behavior (counts before/after, receipts, a negative control's exit code), never "the code exists".

## 2.6 Change-policy decisions

- **Compatibility impact**: `internal-only`.
  - `prune_tmp_residue <days> <pattern>...` keeps its signature and its "always return 0, silent" contract for the four dispatch callers. Its fixed pattern array is replaced by the registry; caller-passed patterns are still honoured.
  - `AUTOPILOT_TMP_LOG_RETENTION_DAYS` (default 3, 0 disables) keeps its meaning.
  - No consumer-visible CLI or config breaks. New config key: `residue.tmp_prune` (bool, default true), next to the existing `residue.auto_reap`.
- **Dependency decision**: `existing`.
  - Registry and prune are Node built-ins: `fs`, `path`, `os`.
  - The daily trigger reuses `hooks/residue-auto-reap.js` → `repo-residue-sweep.js reap --auto`, which is already default-on, detached, flock-guarded and throttled. Its stamp is per repo; the tmp phase adds a host-level stamp/lock under `$XDG_RUNTIME_DIR` (fallback `~/.autopilot/`) because `/tmp` is host-wide.
  - Why not source the Bash lib from the hook: CLAUDE.md language rule (JSON + sandbox ⇒ Node), and the registry is JSON.
- **One statement, two deleters**: the test reaper's lock-gated semantics (TOCTOU rechecks, live-run detection) stay in `suite-residue-reap.sh`; its prefixes are registry entries of kind `test-lockgated`, held equal by the parity test, so the gate reads only the registry.

## 3. File-structure map

| File | Change | Phase |
|---|---|---|
| `scripts/engine-qualify-{consult,discuss}.test.js`, `scripts/validate-json-schema.test.js` + codex mirrors | merge `49f98412` | 1 |
| `docs/BACKLOG.md` | drop the row "Engine review-loop diff files are never deleted" (superseded) | 1 |
| `hooks/tests/run.sh` (L1 block near :526-560) | create `apl1.XXXXXX`, hold `.autopilot-live.lock` in it, run `node --test` with `TMPDIR=<dir>`, remove on exit | 1 |
| `hooks/tests/lib/suite-residue-reap.sh` (`_SRR_PATTERNS` :212) | add `apl1.*` as lock-gated | 1 |
| `scripts/qualification-consult-discuss-transport.test.js:44` | use the inherited `TMPDIR` when its path is short enough, else a short dir it removes | 1 |
| `hooks/tests/lib.sh` + `engine-qualify-verdict-stability.test.sh` (9 `/tmp/aqvsd*` sites) | lib.sh exports `TEST_SHORT_TMP=$(mktemp -d /tmp/apt.XXXXXX)` covered by the test's existing live-lock holder (`.autopilot-live.lock` sidecar); the 9 sites allocate under it (path stays < 60 bytes); `apt.*` is `test-lockgated` | 1 |
| `hooks/tests/autopilot-engine.test.sh:6015,6032` | write debug JSON under `$TEST_TMP`, not `/tmp` | 1 |
| `hooks/tests/test-snapshot.test.sh` | re-verify its TMPDIR assertions; add one for the L1 per-run dir | 1 |
| `src/engine/autopilot-engine.js` (`defaultDiffProvider` :2014, `prepareReview` :5096, `performReview` :5173, identity/binding prepares :5672/:5705, legacy loop :11000, repair prompt :2670, `finish` :9665) | dispose diff dir per prepared review; delete on throw; repair prompt same; `finish()` backstop | 2 |
| `scripts/dispatch-consult.sh` | `trap` cleanup for its temp files | 2 |
| `scripts/lib/tmp-residue-registry.json` (new) | prefix · kind (`scratch` / `live` / `evidence` / `worktree`) · owner script · retention days · reason | 3 |
| `scripts/lib/tmp-residue.js` (new) | load registry; `prune --days N [--tmpdir D] [--json]`; `patterns` (scratch/evidence only); `new-since --stamp F --exclude-kind K[,K]` (KR1); refuses `live`/`worktree`; skips entries holding `.autopilot-live.lock` or `.autopilot-worktree.lock` | 3 |
| `scripts/lib/prune-tmp-residue.sh` | patterns come from the registry (via `node scripts/lib/tmp-residue.js patterns`); keep signature/silence | 3 |
| `scripts/repo-residue-sweep.js` (`reap --auto`) + `hooks/residue-auto-reap-lib.js` | add the tmp phase under a host-level stamp/lock; `residue.tmp_prune` opt-out | 3 |
| `scripts/lib/residue-config.js` | `tmp_prune` key | 3 |
| `scripts/check-tmp-residue-registry.js` (new) + test | the gate (§4 phase 4) | 4 |
| new tests: `hooks/l1-tmpdir.test.js`, `hooks/tests/l1-tmpdir-containment.test.sh` (1); `hooks/tests/engine-diff-lifetime.test.sh`, `hooks/tests/dispatch-consult-trap.test.sh` (2); `hooks/tests/tmp-residue-registry.test.sh`, `hooks/tests/tmp-residue-prune.test.sh` (3); `hooks/tests/check-tmp-residue-registry.test.sh` (4) | encode KR1–KR5 | 1–4 |
| `scripts/tmp-residue-allowlist.json` (new) | bare `mktemp`, worktree creators, deliberate evidence, sandbox-internal `/tmp` — each with a reason | 4 |
| `.githooks/pre-commit`, `scripts/preflight-release.sh` | wire the gate | 4 |
| `docs/scripts-inventory.md`, CLAUDE.md grouped list, `references/hetero-dispatch.md` (temp-retention paragraph), `skills/finish-flow/SKILL.md` (scripts table) | the four-place wiring for each new script | 3, 4 |

## 4. Phases

Every phase is a deliverable with its own acceptance; phase 4 depends on the registry from phase 3; phases 1 and 2 are independent.

### Phase 1 — Contain L1 test temp dirs (size M)
1. Merge `worktree-agent-a776e40555efd8f67`; delete the superseded BACKLOG row; `node scripts/check-backlog-entries.js --backlog docs/BACKLOG.md` exit 0.
2. `run.sh` L1 block:
   - `L1_TMP="$(mktemp -d "${TMPDIR:-/tmp}/apl1.XXXXXX")"`.
   - Hold `flock` on `$L1_TMP/.autopilot-live.lock` for the run (same sidecar convention as `hooks/tests/lib.sh:243-255`).
   - `TMPDIR="$L1_TMP" node --test "${UNIT_FILES[@]}"`.
   - On exit: release, then `rm -rf "$L1_TMP"` after the node process group is gone. Hook into the existing `__suite_on_exit` ordering; do not reorder it.
3. `suite-residue-reap.sh`: add `apl1.*` to `_SRR_PATTERNS` and to the lock-gated routing (`:225` case).
4. Fix the three escapers in §3; add `apt.*` to `_SRR_PATTERNS` and the registry. Find other hard-coded `/tmp` expectations with `git grep -n "'/tmp/\|\"/tmp/" -- hooks/tests scripts/*.test.js` and re-verify `test-snapshot.test.sh`.
- **Acceptance**:
  - KR1 measured twice (serial and `--parallel`).
  - KR2: start `run.sh`, `kill -9` its process group during L1, assert the `apl1.*` dir remains, run `run.sh <one fast suite>`, and assert the reaper JSON shows it reaped. Also show a concurrently live run's dir is kept.
  - Full suite green.

### Phase 2 — Runtime temp files deleted by their owner (size M)
1. `defaultDiffProvider`: on `git diff` failure, `rmSync(diffDir)` before throwing.
2. `prepareReview` returns `dispose()` (removes its diff dir).
   - `performReview` calls it in `finally` after `reviewDiff` and `classify` return.
   - The identity and binding prepares (`:5672`, `:5705`) call it after `buildPacketOnce` / digest; `review-packet.js:601` reads the diff with `fs.readFileSync` before returning (verified 2026-10-12), so the bytes are in memory before dispose.
   - `defaultDiffProvider` records each dir it creates in a module-level `Set` of owned dirs; `dispose()` and the `finish()` backstop remove only members of that set. A path returned by an injected `diffProvider` is never in it, so neither ever touches it.
   - The identity and binding prepares wrap their use in `try { … } finally { dispose() }`.
3. Legacy loop (`:11000`) and the repair prompt (`:2670`): same pattern.
4. `dispatch-consult.sh`: one `trap` that removes its temp files on EXIT/INT/TERM.
- **Acceptance**:
  - New engine test on a fixture repo with the **default** provider: success path, `git diff` failure path, and a reviewer that throws. Each run leaves 0 new `autopilot-review-loop-*` and `autopilot-repair-prompt-*` dirs.
  - Mutation check: disable the `finally` dispose and the test fails.
  - `dispatch-consult.sh` killed with SIGTERM mid-run leaves 0 `dispatch-consult-*`.
  - The existing engine suite is green.

### Phase 3 — One registry, daily prune that actually fires (size M)
1. `tmp-residue-registry.json`:
   - Every prefix `prune-tmp-residue.sh` lists today, plus `pi-rpc-session-*`, `dispatch-anthropic-review-*`, `qual-scope.*`, `dispatch-consult-*`, `autopilot-review-loop-*` and `autopilot-repair-prompt-*` (`scratch`, retention 1 day: a killed engine's leftovers; a live loop's dir is younger than its 7200 s wall cap).
   - Live dirs (`autopilot-foreman-runs`, `autopilot-dispatch-runs`, `autopilot-<uid>`) as `live`.
   - `autopilot-kimi-raw-*` and `autopilot-frontmatter-evidence-*` as `evidence` with an explicit retention (14 days).
   - Worktree creators as `worktree`.
2. `tmp-residue.js prune`:
   - Only `scratch` and `evidence` kinds; current-user, direct children only, no symlinks.
   - mtime older than the entry's retention, which defaults to `AUTOPILOT_TMP_LOG_RETENTION_DAYS`.
   - Skips anything holding a live lock file; prints a JSON receipt.
3. `prune-tmp-residue.sh` reads patterns from the registry; behaviour otherwise unchanged.
4. `repo-residue-sweep.js reap --auto` gains the tmp phase: a host-level stamp and lock, a 24 h throttle, and the `residue.tmp_prune` opt-out. Its receipt is folded into the sweep's JSON.
- **Acceptance**:
  - KR4 with fixtures under a test `TMPDIR`: aged scratch deleted, fresh kept, live-locked kept, `live` kind never touched even when aged, a symlink not followed.
  - Real-host run: the receipt lists the actual entries deleted.
  - Opt-out via config and env each verified.
  - Four-place wiring passes `node scripts/check-claude-md-inventory.js`.

### Phase 4 — Gate: an unregistered temp prefix cannot ship (size M)
1. `check-tmp-residue-registry.js` scans shipped code: `src/`, `bin/`, `hooks/` (not `hooks/tests/`), and `scripts/` (not `*.test.*`). It looks for `mkdtemp`/`mkdtempSync`/`mktemp` and `os.tmpdir()`/`${TMPDIR`-joined fixed prefixes, then extracts the literal prefix. Each occurrence must be one of:
   - (a) registered in `tmp-residue-registry.json` or `suite-residue-reap.sh`'s list;
   - (b) guaranteed cleanup: in JS the allocation is the first statement of a `try` (or the assignment immediately before it, with nothing between) whose `finally` removes the variable; in shell a `trap … EXIT` naming the variable (guarded `${var:-}`) is installed **before** the `mktemp` line in the same scope. A bare `rmSync` on the success path does not count;
   - (c) allowlisted in `tmp-residue-allowlist.json` with a reason.
   - A non-literal prefix it cannot extract is a finding unless allowlisted.
2. Test files are not gated: phase 1 contains them by construction. The gate prints that scope in its header.
3. Wire it: `.githooks/pre-commit` (changed shipped files only, block) and `preflight-release.sh` (whole repo, block).
- **Acceptance**:
  - Exit 0 on the repo.
  - `--self-test` negative control exits 1 on a planted unregistered prefix and on a success-path-only `rmSync`.
  - Shown firing from the real pre-commit hook on a scratch commit (then reset) and from `preflight-release.sh`.
  - Four-place wiring passes `check-claude-md-inventory.js`.

## 5. Test / validation

- Script-gated: KR1–KR5 above; the full `hooks/tests/run.sh --parallel` green after each phase. Long suites run one at a time (memory: parallel suites interfere).
- The engine test in phase 2 must use the default provider. Every existing engine test injects its own `diffProvider` and would pass with the delete code removed.
- Negative controls: phase 1 (killed run reaped, live run kept), phase 2 (mutation), phase 3 (live and symlink kept), phase 4 (planted prefix fails).
- Human-gated: none. The owner sees the result as `/tmp` no longer growing.

## 6. Risks + inversion

- **R1**: Setting `TMPDIR` globally in `run.sh` would split the cross-run locks and make the reaper scan the wrong dir. Mitigation: L1-only child env (§2.5).
- **R2**: A deep per-run dir breaks AF_UNIX socket tests (EINVAL). Mitigation: `apl1.XXXXXX` directly under `/tmp`; the transport test keeps its short-dir fallback.
- **R3**: mtime pruning a live dir. Mitigation: `kind` field; `live`/`worktree` never pruned; lock-file skip; a fixture proves it.
- **R4**: Moving diff files to a stable path changes `canonicalDigest(fullDiff)` (`campaign-composition.js:2132`) if the path is embedded. Mitigation: delete in place, never move; out of scope.
- **R5**: The gate is too noisy (bare `mktemp`, generated prefixes) and gets switched off. Mitigation: allowlist with reasons and a scope header. Phase 4 acceptance includes exit 0 on today's repo after the allowlist is written, not before.
- **R6**: The wired-but-off failure (CLAUDE.md 2026-08-06 caution). Mitigation: every phase's acceptance shows the mechanism firing on the real entry point (run.sh, SessionStart sweep, pre-commit, preflight).
- **R7**: Dispose runs before an async consumer reads the diff. Mitigation: all readers are synchronous (`spawnSync`); a test asserts the reviewer saw the diff content before dispose.

## 7. Out of scope

- A `node --import` preload that isolates `node --test scripts/x.test.js` run outside `run.sh`. Standalone runs can still leak; the phase-1 merged cleanup covers the two largest offenders. Backlog it if standalone runs show up as residue.
- Moving `autopilot-dispatch-runs/` or other live dirs out of `/tmp`.
- Sandbox-internal `/tmp` (bwrap `--tmpfs`) and codex mount-point residue.
- hooks' per-session counters (`claude-tool-count-<sid>`, `claude-intent-tool-count-<sid>`): tiny, registered as `scratch` with 3-day retention in phase 3 rather than changed in the hooks.
- Version bump / CHANGELOG version section (owner, 2026-10-11).

## 8. Open questions

None for the Board. Owner approved the three-layer direction on 2026-10-11 ("殘留架構開工").

### Proposal decisions (owner, 2026-10-12: "照推薦"; page https://claude.ai/artifact/WQ94ejAFcUtN9fJx2Jsq2R)

| # | Decision | Picked | Rejected |
|---|---|---|---|
| D1 | Where the gate blocks | pre-commit on changed shipped files + `preflight-release.sh` on the whole repo; enabled only after the allowlist makes today's repo green | release-only; advisory-only |
| D2 | Daily prune trigger | a tmp phase in the SessionStart `residue-auto-reap` sweep, host-level 24 h throttle, `residue.tmp_prune` opt-out | dispatch-startup only (status quo); cron |
| D3 | L1 containment scope | tests run through `hooks/tests/run.sh` only | a `node --import` preload for standalone runs (§7) |

Assumptions carried: the AF_UNIX 108-byte limit bounds the per-run dir path; all diff readers are synchronous (R7); `/tmp` here is ext4 (no reboot cleanup).

## Review log

- **G1** (2026-10-12): CONDITIONAL (sol STOP, grok STOP, MiniMax CONDITIONAL; transport complete). 16 findings, 10 blocker candidates; all 10 accepted (two merged: KR1 allowlist into the acceptance-commands fold, wrapper live-kind into the registry fold). As-reviewed bytes sha256 `bdd93be3…`.
- **R1** bounded repair of the accepted G1 blockers only: final goal narrowed to D3; KR1–KR5 rewritten as single commands backed by named tests (KR2 backdates the lock past the reaper's min age; KR3 non-vacuous, injected-provider survival, digest pin); registry kinds incl. `test-lockgated`/`lock` with a parity test and wrapper kind filter; owned-dir set for dispose/`finish()`; `apt.*` short lock-held dir for the AF_UNIX tests; gate rule (b) requires allocation dominated by the `try`/`trap`. Non-blocking folds: concrete doc paths, 1-day retention for engine scratch, `buildPacketOnce` read verified. Growth 1.15x.
- **R0** (2026-10-12, depth-0 Opus 5.5): drafted from the read-only inventory of 2026-10-11 and the proposal answers.
  - Frozen rubric: `docs/plans/2026-10-12-tmp-residue-containment.rubric.md` (R1–R8).
  - Manifest: `docs/plans/2026-10-12-tmp-residue-containment.plan-review-manifest.json`, `logical_plan_id: tmp-residue-containment-2026-10-12`.
  - Seats: sol chair (openai, not required: codex quota has run dry before), grok deep (xai, required), MiniMax consult; minimum 2 families.
- Pending a version: the shipped-code changes (phases 2–4) are PATCH-class; owner deferred the version (2026-10-11), so no CHANGELOG section is written here.
