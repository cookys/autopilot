# Plan — TMPDIR residue containment: contain test temp dirs, delete runtime temp files after use, gate unregistered prefixes
> Status: **active, size L, R2 FROZEN** (2026-10-12; plan-review receipt: `check-phase-review-receipt.js --plan-artifact …g2-artifact.json --dispositions …g2-dispositions.json` exit 0 on the as-reviewed G2 bytes) · Owner: cookys · Branch: `feat/tmp-residue-containment` · Frame: dev-flow L, no version bump (owner 2026-10-11: 3.0.0 not yet; the shipped-code changes here are PATCH-class and ride the next cut)

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

- **KR1 (tests contained)**: `bash -c 'set -e; S=$(mktemp /tmp/kr1.XXXXXX); bash hooks/tests/run.sh --parallel; node scripts/lib/tmp-residue.js new-since --stamp "$S" --exclude-kind live,lock --exclude-path "$S" --fail-on-entries'` exits 0 (run twice on this host). `new-since` lists **every** current-user direct child of `${TMPDIR:-/tmp}` with mtime newer than the stamp, each labelled with its registry kind or `unregistered`; `--exclude-kind` removes only the named kinds (so a leaked `worktree` or `unregistered` entry is always reported); `--fail-on-entries` exits 1 when anything remains. `--exclude-kind lock` drops exactly the shared lock/owner files of §2.5 (`.autopilot-suite-run.*.lock`, `.autopilot-suite-oracle.{lock,owner}`, `.autopilot-gc.lock`), which the registry lists as kind `lock`; `live` drops `autopilot-dispatch-runs`, `autopilot-foreman-runs`, `autopilot-<uid>`. Nothing else is excused.
- **KR2 (killed run recovered, live run kept)**: `bash hooks/tests/l1-tmpdir-containment.test.sh`. It (a) runs `run.sh` with the L1 probe `hooks/l1-tmpdir.test.js` and asserts the probe saw `os.tmpdir()` == the `apl1.*` dir run.sh exported as `AUTOPILOT_L1_TMP`; (b) creates an `apl1.*` dir whose `.autopilot-live.lock` is held by a child, `kill -9`s the child, backdates the lock file with `touch -d '-2 min'` (past `AUTOPILOT_SUITE_REAP_MIN_AGE`, default 60 s), runs `suite_residue_reap`, asserts `reaped >= 1` and the dir is gone; (c) the same with the lock still held asserts the dir is kept (`skipped_live >= 1`); (d) a backdated dead `apl1.*` dir is gone after a real `bash hooks/tests/run.sh <one named fast suite, e.g. stage-graph>` start, proving run.sh's own reaper call covers `apl1.*`.
- **KR3 (runtime deletes)**: `bash hooks/tests/engine-diff-lifetime.test.sh` on a fixture repo with the **default** `diffProvider`, for: success; `git diff` failure; reviewer throws; identity/binding prepare throws. In each it asserts (1) the dir existed while the reviewer ran (the stub reviewer records `fs.existsSync` and the diff bytes), (2) 0 owned `autopilot-review-loop-*` / `autopilot-repair-prompt-*` dirs remain, (3) the repair-prompt scenario actually created one (non-vacuous), (4) an injected `diffProvider`'s returned file still exists after `finish()`, (5) `diff_digest` / `review_input_digest` equal the values computed from the same diff bytes before the change (pinned in the test). Mutation: with dispose removed, (2) fails; with dispose moved before `reviewDiff`, (1) fails. `bash hooks/tests/dispatch-consult-trap.test.sh` sends SIGTERM mid-run and asserts 0 `dispatch-consult-*`.
- **KR4 (daily prune fires)**: `bash hooks/tests/tmp-residue-prune.test.sh`. Under a fixture `TMPDIR` it runs `node scripts/repo-residue-sweep.js reap --auto --yes --repo <fixture> --tmpdir <fixture-tmp> --json` and asserts the receipt's `tmp_prune.deleted` lists exactly the aged `scratch` entry; a fresh scratch entry, an aged `live`-kind dir, an aged dir holding `.autopilot-live.lock`, and a symlink are kept. A second call within 24 h reports `tmp_prune.skipped: "throttled"` (host stamp `${XDG_RUNTIME_DIR:-~/.autopilot}/autopilot-tmp-prune.stamp`). Opt-outs `AUTOPILOT_RESIDUE_TMP_PRUNE=0` and `{"residue":{"tmp_prune":false}}` each give `skipped: "disabled"`. `hooks/tests/residue-auto-reap.test.sh` gains a case that the SessionStart hook's detached sweep produces that receipt. A scratch dir older than its retention whose `.autopilot-owner` pid is alive (the test's own sleeper) is kept.
- **KR5 (gate)**: `node scripts/check-tmp-residue-registry.js` exits 0 on the repo; `node scripts/check-tmp-residue-registry.js --self-test` exits 0 only if each planted fixture (unregistered literal prefix; success-path-only `rmSync`; allocation before the `try`; `mktemp` before its `trap`; unextractable prefix without an allowlist entry) yields exit 1; the self-test also plants a reaper-only prefix (parity failure) and a bare `/tmp/` literal, each must exit 1; `bash hooks/tests/check-tmp-residue-registry.test.sh` runs the real `.githooks/pre-commit` on a scratch clone with a planted file (exit 1) and `scripts/preflight-release.sh`'s gate step on the same clone (fails).

## 2.5 Global Constraints (copied verbatim into every dispatch)

- No version bump: do not run `scripts/sync-version.js`, do not add a CHANGELOG version section. CHANGELOG has no Unreleased convention; record the change as "pending a version" in this plan's Review log (this plan is the project page; there is no separate project README).
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
| `hooks/README.md` (residue-auto-reap row: tmp phase + `residue.tmp_prune`), `docs/scripts-inventory.md`, CLAUDE.md grouped list, `references/hetero-dispatch.md` (temp-retention paragraph), `skills/finish-flow/SKILL.md` (scripts table) | the four-place wiring for each new script | 3, 4 |

## 4. Phases

Dependency map: phase 1 lands the registry and `tmp-residue.js` core first; phases 2, 3 and 4 each depend on phase 1 only; phase 4 also reads the kinds phase 3 adds. Each phase's acceptance is its KR command(s) exiting 0 plus the full suite green; nothing else counts as done.

### Phase 1 — Registry core, then contain test temp dirs (size M)
1. Merge `worktree-agent-a776e40555efd8f67`; delete the superseded BACKLOG row; `node scripts/check-backlog-entries.js --backlog docs/BACKLOG.md` exit 0.
2. Create `scripts/lib/tmp-residue-registry.json` with every kind (§2.5) and today's prefixes (phase 3 step 1 list), and `scripts/lib/tmp-residue.js` with `patterns` and `new-since` (KR1 semantics) only.
3. `run.sh` L1 block:
   - `L1_TMP="$(mktemp -d "${TMPDIR:-/tmp}/apl1.XXXXXX")"`; hold `flock` on `$L1_TMP/.autopilot-live.lock` for the run (sidecar convention of `hooks/tests/lib.sh:243-255`); export `AUTOPILOT_L1_TMP="$L1_TMP"`.
   - `TMPDIR="$L1_TMP" node --test "${UNIT_FILES[@]}"`.
   - On exit: release, then `rm -rf "$L1_TMP"` after the node process group is gone, inside the existing `__suite_on_exit` ordering.
4. `suite-residue-reap.sh`: add `apl1.*` and `apt.*` to `_SRR_PATTERNS` and the lock-gated routing (`:225`); the registry lists both as `test-lockgated`.
5. `lib.sh`: `TEST_SHORT_TMP=$(mktemp -d /tmp/apt.XXXXXX)` with its **own** `.autopilot-live.lock` sidecar inside it, held by the same holder process as `TEST_TMP`'s; removed in the EXIT trap. The 9 `aqvsd` sites in `engine-qualify-verdict-stability.test.sh` allocate under it.
6. Fix the other escapers (§3); find hard-coded `/tmp` expectations with `git grep -n "'/tmp/\|\"/tmp/" -- hooks/tests scripts/*.test.js`; re-verify `test-snapshot.test.sh`.
- **Acceptance**: KR1, KR2.

### Phase 2 — Runtime temp files deleted by their owner (size M)
1. `defaultDiffProvider`: on `git diff` failure, `rmSync(diffDir)` before throwing.
2. Ownership is per engine instance: the default provider is bound in the constructor to `this.ownedTempDirs` (a `Set`); `prepareReview` returns `dispose()`, which removes its dir only if it is in this instance's set. `performReview` disposes in `finally` after `reviewDiff` and `classify` return; the identity and binding prepares (`:5672`, `:5705`) wrap their use in `try { … } finally { dispose() }` (`review-packet.js:601` reads the diff with `fs.readFileSync`, verified 2026-10-12). `finish()` removes what remains in this instance's set only. An injected `diffProvider`'s paths never enter the set.
3. Legacy loop (`:11000`) and the repair prompt (`:2670`): same per-instance pattern.
4. Every runtime scratch dir our code creates (`autopilot-review-loop-*`, `autopilot-repair-prompt-*`, `dispatch-consult-*`) gets an `.autopilot-owner` file `{pid, start_time}` (start time from `/proc/<pid>/stat` field 22); `tmp-residue.js prune` keeps a dir whose owner pid is alive with the same start time, whatever its age.
5. `dispatch-consult.sh`: `trap` installed before its first `mktemp`, removing its temp files on EXIT/INT/TERM.
- **Acceptance**: KR3.

### Phase 3 — Daily prune that actually fires (size M)
1. Registry content (landed in phase 1, completed here): every prefix `prune-tmp-residue.sh` lists today, plus `pi-rpc-session-*`, `dispatch-anthropic-review-*`, `qual-scope.*`, `dispatch-consult-*`, `autopilot-review-loop-*`, `autopilot-repair-prompt-*` as `scratch` (engine scratch retention 1 day; owner liveness from phase 2 step 4 protects a hung live process); live dirs as `live`; `autopilot-kimi-raw-*`, `autopilot-frontmatter-evidence-*` as `evidence` (14 days); worktree creators as `worktree`; shared lock files as `lock`.
2. `tmp-residue.js prune`: `scratch`/`evidence` only; current-user direct children; no symlinks; mtime older than the entry's retention (default `AUTOPILOT_TMP_LOG_RETENTION_DAYS`); keeps a dir holding `.autopilot-live.lock` or a live `.autopilot-owner`; JSON receipt.
3. `prune-tmp-residue.sh` takes its patterns from `tmp-residue.js patterns` and drops caller patterns not equal to one of them; signature and silence unchanged.
4. `repo-residue-sweep.js reap --auto` gains the tmp phase (host stamp/lock, 24 h throttle, `residue.tmp_prune` / `AUTOPILOT_RESIDUE_TMP_PRUNE` opt-out, `--tmpdir` test seam); its receipt joins the sweep JSON.
- **Acceptance**: KR4.

### Phase 4 — Gate: an unregistered temp reference cannot ship (size M)
1. `check-tmp-residue-registry.js` scans shipped code: `src/`, `bin/`, `hooks/`, `scripts/`, excluding `hooks/tests/` and every `*.test.*` file. An **occurrence** is any textual reference to the temp root: `os.tmpdir()`, `$TMPDIR`/`${TMPDIR`, a string literal starting `/tmp/`, `mkdtemp`/`mkdtempSync`/`mktemp`. Each occurrence must be one of:
   - (a) its extractable literal prefix is in `tmp-residue-registry.json` (the only registration source);
   - (b) guaranteed cleanup: in JS the allocation is the **first statement inside** a `try` whose `finally` removes the variable; in shell a `trap … EXIT` naming the variable (guarded `${var:-}`) is installed before the `mktemp` line in the same scope;
   - (c) allowlisted in `tmp-residue-allowlist.json` with a reason (e.g. a helper that only resolves the temp root; sandbox-internal `/tmp`).
   - Anything else, including a prefix it cannot extract, is a finding.
2. The gate also fails if `_SRR_PATTERNS` (read by sourcing `suite-residue-reap.sh` in `bash -c` and printing the array) differs from the registry's `test-lockgated` entries, so the parity holds on every gate run, not only in the test.
3. Wire it: `.githooks/pre-commit` (changed shipped files + the parity check, block) and `preflight-release.sh` (whole repo, block). Enabled only after the allowlist makes today's repo exit 0.
- **Acceptance**: KR5.

## 5. Test / validation

- Script-gated: KR1–KR5 above; the full `hooks/tests/run.sh --parallel` green after each phase. Long suites run one at a time (memory: parallel suites interfere).
- The engine test in phase 2 must use the default provider. Every existing engine test injects its own `diffProvider` and would pass with the delete code removed.
- Negative controls: phase 1 (killed run reaped, live run kept), phase 2 (two mutations), phase 3 (live kind, live lock, live owner pid and symlink kept), phase 4 (planted prefixes, parity break and `/tmp/` literal fail).
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
- **G2** (2026-10-12): CONDITIONAL, terminal (generation cap; sol STOP, grok STOP, MiniMax CONDITIONAL). 17 findings, 11 blocker candidates; depth-0 accepted all 11 (2 and 8 are one fold; 11 and 16 duplicate 0 and 10). As-reviewed sha256 `a3781c0c…`.
- **R2** bounded repair of the G2 accepted blockers only: per-instance owned dirs; owner pid+start-time liveness for runtime scratch; registry is the only registration source and the gate checks reaper parity itself; occurrence = any temp-root reference; KR1 under `set -e` with a defined scan universe; registry core moved to phase 1; `apt.*` holds its own lock; rule (b) allocation inside the `try`; `*.test.*` excluded everywhere. Frozen after R2 (no G3).
- **R0** (2026-10-12, depth-0 Opus 5.5): drafted from the read-only inventory of 2026-10-11 and the proposal answers.
  - Frozen rubric: `docs/plans/2026-10-12-tmp-residue-containment.rubric.md` (R1–R8).
  - Manifest: `docs/plans/2026-10-12-tmp-residue-containment.plan-review-manifest.json`, `logical_plan_id: tmp-residue-containment-2026-10-12`.
  - Seats: sol chair (openai, not required: codex quota has run dry before), grok deep (xai, required), MiniMax consult; minimum 2 families.
- **Implementation adjudications (depth-0, 2026-10-12)**:
  - KR1 excludes `/tmp/sessions` (external, kind `live`) and `source: session-hook` counters written by the live session running the suite.
  - KR1's suite-green half accepts only failures that fail identically on develop: `skill-onoff-generic` (real `~/.autopilot` touched by concurrent sessions) and `dispatch-hetero-wall-timeout` (host-wide `pgrep` at line 181 sees other suites' watchdogs under `--parallel`; passes standalone on develop and feat).
  - Both are BACKLOG rows.
  - `review_input_digest` cannot be pinned because the verification receipt embeds the worktree path (already so at `82488bc8`); KR3 (5) pins `diff_digest` only.
- Pending a version: the shipped-code changes (phases 2–4) are PATCH-class; owner deferred the version (2026-10-11), so no CHANGELOG section is written here.
- **P4** (2026-10-12): gate shipped on `feat/tmp-residue-p4`, pending a version (PATCH-class, no CHANGELOG section). `scripts/check-tmp-residue-registry.js` (+ `scripts/tmp-residue-allowlist.json`, 37 reasoned entries and 55 `pending_registry` entries awaiting registry rows), wired into `.githooks/pre-commit` (`--staged`) and `scripts/preflight-release.sh` (whole repo); test `hooks/tests/check-tmp-residue-registry.test.sh`.
- **Integration** (2026-10-12, depth-0): the 55 `pending_registry` allowlist rows were moved into `scripts/lib/tmp-residue-registry.json` (53 new patterns: `scratch`, `worktree` for `foreman-`/`batch-integ-`/`probe-mutation-`, `lock` for `autopilot-run-eval-batch.lock`); the allowlist keeps 37 reasoned rows. Code-review G1 (packets P1–P5, GLM-5.2 + MiniMax-M3) folds: `--staged` reads the index (`git show :path`), whole-repo mode scans `git ls-files -c`; test case 2e plants an index-only line.
