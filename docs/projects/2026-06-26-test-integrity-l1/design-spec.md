# L1 Per-Runner Design Spec — Executed-Set Invariance + Real Override

> Status: **v4 (post round-3 review) — CONVERGED pending re-confirm. Design spec, MANDATORY gate before implementer dispatch.** Operationalizes
> `docs/plans/2026-06-25-test-integrity-gate.md` §2.1 (L1) / §2.3 (override) per runner.
> This spec does NOT re-decide the plan; it nails down the HOW precisely enough that a
> mechanical implementer (`gpt-5.3-codex-spark`) cannot guess.
> Date: 2026-06-26 · Owner: cookys · Branch: `feat/test-integrity-l1`
> Target: extend `scripts/check-test-integrity.sh` (L1 must ADD to L0, never break it).
> Reviews (gpt-5.5 xhigh): round-1/2/3 all FIX-THEN-SHIP; round-3 RULED on the override tension
> (Option C — ship detection + warn + block-hard-fail; DEFER block-mode override-HONORING until
> descendant-containment lands). See §8.3.0 + §12.

## 0. Empirical verification ledger (this repo, 2026-06-26)

Per CLAUDE.md "Don't assert CLI/flag behavior without verification." Every command below
was run in a throwaway scratch repo. `[V]` = verified empirically here; `[NC]` = needs
confirmation at impl time (runner not installed locally).

| Runner | Local tool | Status |
|--------|-----------|--------|
| pytest | `pytest 9.0.3`, `python3 3.14.4` | **[V]** all commands + status mapping run |
| go test | `go 1.26.0` | **[V]** `-json` + `-list` run |
| jest | installed `jest` via `npm i` (probe) | **[V]** `--json` schema + `.only` shrink run |
| vitest | installed `vitest` via `npm i` (probe) | **[V]** `--reporter=json` schema run |
| git notes / `refs/qc/*` | `git` | **[V]** note-ref + blob-ref read/write run |
| Java/Maven, Gradle, cargo, rspec | NOT installed | out of L1 v1 scope (see §9); detection-only stubs may emit `unavailable` |

Verified facts that drive decisions below:
- pytest `--collect-only -q` lists **all 6** of {2 pass, 1 skip, 1 xfail, 2 param} — **skipped tests still appear** ⇒ collect-only is insufficient (plan round-2 Crit-1 confirmed). **[V]**
- pytest junit `testcase` has a `file` attribute **only under `-o junit_family=legacy`**; `xunit2` (the current pytest default family) DROPS `file`. **[V]** ⇒ we force `legacy`.
- pytest `xfail` (non-strict) → junit `<skipped>`; `xpass` non-strict → `pass`; `xpass` strict → `<failure>`. **[V]**
- go `test -json` emits per-test `{"Action":"pass|fail|skip","Package":...,"Test":...}`, subtests as `Parent/child`; `go test -list` shows only top-level funcs, no skip status, no subtests. **[V]** ⇒ must RUN, not list.
- jest `--json` with `test.only` present marks the OTHER tests `"status":"pending"` (the executed-set shrink we must catch). `assertionResults[].status ∈ {passed,failed,pending,skipped,todo,disabled}`; file = absolute `testResults[].testFilePath`. **[V]**
- vitest `run --reporter=json --outputFile=F` produces the same `testResults[].assertionResults[].status` shape; skip → `"skipped"`; file = absolute `testResults[].name`. **[V]**
- `git notes --ref=qc-test-integrity` and `git update-ref refs/qc/<x> <blob>` both store data **outside** any commit tree and are readable via `git cat-file -p` / `git notes show`. **[V]**
- **(round-1 C1) `dispatch-hetero.sh` line 130 uses `git worktree add` — a LINKED worktree sharing the parent repo's object store AND ref namespace.** A worker with a shell in that worktree CAN run `git update-ref refs/qc/test-integrity/<x> <blob>` and the ref is then readable from the main repo. **Verified the attack:** wrote `refs/qc/test-integrity/forged` from inside a linked worktree, read it back via `git cat-file -t` from the main checkout. **[V]** ⇒ my round-1 "candidate structurally cannot write it" claim was FALSE; trust model rebuilt on teardown-ordering (§8).
- **(round-1 C2) full change-set digest input** = `git diff -M --raw --full-index -z <base_sha>..<head_sha>` (full blob index hashes + file modes, NUL-delimited), hashed under `LC_ALL=C`. **[V]** the command emits `:<mode> <mode> <blob_base> <blob_head> <status>\0<path>\0…` and `sha256sum` is stable.
- **(round-1 M2) jest `--testLocationInResults`** adds `assertionResults[].location = {line,column}` — disambiguates two same-name `test()` in one file. **[V]**
- vitest `--testLocationInResults` / per-test location field: **[NC]** (not re-probed; vitest's json reporter location support needs impl-time confirmation — §B.3 falls back to `collection_failed reason:"ambiguous_ids"` if absent).

---

## 1. Scope, invariants, and what L1 adds

L1 = **runner-reported-executed-set invariance**: run each detected test runner on BASE and
HEAD; FAIL (`executed_set_shrink`) if any test the **runner reported as executed** at base
becomes **not-executed** (the runner reports it skipped/xfail/todo/filtered/deselected, or it
vanishes from the report) at head.

> **Honest-scoping note (round-1 C4).** L1 verifies the *runner-reported executed STATUS* of a
> stable set of test-ids — it does NOT verify that a test's body still does meaningful work.
> A purely-additive body weakening (`return`/`pass`/`expect.assertions(0)` before assertions, an
> emptied JS callback, a `conftest`/monkeypatch hook that no-ops a callable) leaves the same id
> reported `passed`, so L1 passes it. This is the **green-but-meaningless residual** already named
> in plan §4 / R11 and §10 below — explicitly OUT of L1's deterministic scope; it stays with
> L0 surface-watch + reviewer + mutation testing. The spec must NOT claim L1 proves tests "actually
> do work"; it proves the *executed-set did not shrink*.

Hard invariants (carried from L0, do NOT relax):
- **Deterministic, git-artifact-only.** L1 reads the runner's machine report (junit-xml /
  `--json` / `-json`), never the implementer's prose self-report.
- **Best-effort, two-sided DETECTION always runs (round-1 C3).** For every runner family,
  DETECTION (the marker+tool probe of §4) runs on **both** base and head worktrees,
  unconditionally. COLLECTION (the actual run) happens only on a side where detection found
  marker+tool. The three cases are distinct and ALL produce a definite signal — none silently
  returns `unavailable`:
  - present on **neither** side ⇒ `l1:"unavailable"` (no framework — L0 + reviewer backstop).
  - present on **base, absent on head** ⇒ `runner_disappeared` violation, emitted from detection
    ALONE — **no head collection needed** (the candidate deleted the runner config to dodge L1).
  - present on **both** ⇒ collect both, compare executed-sets.
- **Fail-closed on ambiguity in `block` mode.** Runner detected on both but collection/execution
  FAILS on head ⇒ suspicious ⇒ require depth-0 override; never silently pass (plan R10).
- **Default `warn`.** L1 changes no default behavior; PATCH bump (plan §2.5).
- `protected_path_touch` / `malformed_config` / `git_error` remain **non-waivable** (already
  enforced in L0 ~line 785; L1 adds only the two waivable behavioral kinds in §8.6).

L1 is purely additive to the existing JSON (§6) and CLI (§5); when `--no-l1` is passed or no
runner is detected on either side, the script's behavior is byte-identical to today's L0 output
plus the single new field `l1` (`"skipped"` / `"unavailable"`).

---

## 2. Worktree / checkout strategy (the two-sided collection)

**Spec decision: use `git worktree add --detach` (same rail as `dispatch-hetero.sh`), NOT a
`git archive` extract.** Justification: collectors need a real working tree with a resolvable
package layout (go modules, `pyproject.toml`, `package.json` at expected relative positions);
`git archive` extract loses the `.git` dir that go/pytest/node tooling may probe, and worktrees
are the established autopilot isolation primitive. Worktrees are read-only inputs here — we
never commit in them.

Procedure (the implementer MUST follow exactly):
1. Resolve `base_sha`, `head_sha` (already computed at L0 lines 385-387).
2. Create two detached worktrees under a private temp dir:
   `git -C <repo> worktree add --detach <tmp>/l1-base <base_sha>` and `…/l1-head <head_sha>`.
   `<tmp>` MUST be outside the candidate repo tree (use `mktemp -d`); NEVER mutate `<repo>`.
3. Run detection (§4) and collection (per-runner §A/§B/§C) in each worktree.
4. **Always** `git -C <repo> worktree remove --force <tmp>/l1-base` (and head) in a trap/finally,
   even on error or timeout, then `git worktree prune`. Leaking a worktree is a bug.
5. **No dependency install** (§3). Collectors run against whatever is already present.

The worktree's cwd for a runner is `<tmp>/l1-<side>` (so all reported paths are relative to the
repo root and stable across the two sides — §A.3/§B.3/§C.3 rely on this).

---

## 3. Dependency / environment boundary & timeout

**Spec decision: L1 does NOT install dependencies.** It runs the collector against the
already-resolvable environment (installed pytest, `node_modules` if present, go module cache).

Rationale: installing deps is unbounded, network-dependent, and would let a candidate's
`package.json`/`requirements` changes execute arbitrary install scripts inside the gate — an
attack surface and a non-determinism source. The gate certifies *executed-set shape*, not that
the project's full env is reproducible.

Consequences (all explicit, none silent):
- If the collector exits non-zero **because of missing deps** (import error, missing module),
  that is `collection_failed` for that side (§7), NOT a pass and NOT `unavailable`.
- `unavailable` is reserved for **no runner detected on either side** (§4) — a categorically
  different signal from "runner present but couldn't run."

**Scrubbed env per collection (round-1 M5).** Ambient env can silently shrink the run despite the
"git-artifact-only" claim. Every collector is invoked with a sanitized environment: **unset**
`PYTEST_ADDOPTS`, `PYTEST_PLUGINS`, `GOFLAGS`, `GOTAGS`, `NODE_OPTIONS`, `JEST_*`, `VITEST_*`,
`npm_config_*`, `NPM_CONFIG_*`, and any `*_ADDOPTS`/`*_OPTS` test-runner knob; **set** `CI=1`,
`LC_ALL=C`, `TZ=UTC`. Intentionally **preserved**: `PATH`, `HOME` (tool resolution + module cache),
`GOPATH`/`GOMODCACHE`, language interpreter location vars. The implementer MUST build the child env
explicitly (allowlist-preserve + denylist-unset), not inherit the parent's, and MUST record the
scrub in the per-runner result (`env_scrubbed:true`) for auditability. This is symmetric to the
in-flag neutralization (`-o addopts=""`, `-run '.*'`, `-count=1`) in §A/§B/§C — both are required;
neither alone suffices.

**Timeout policy:** per-side, per-runner wall-clock cap.
- Default **`L1_TIMEOUT=180`** seconds per collection invocation (one base run + one head run =
  up to 2× cap). Overridable via `--l1-timeout <sec>` (§5).
- On timeout: SIGTERM the process group (the runner may have spawned children — same pgroup
  discipline as `dispatch-batch.sh reap`), then SIGKILL after a 5s grace; classify that side as
  `collection_failed` with `reason:"timeout"`. In `block` mode a head-side timeout ⇒ require
  override (a candidate could wedge the suite to time it out — same logic as broken-runner R10).
- The whole L1 phase is skipped (→ `l1:"skipped"`) if `--no-l1` or if `--l1-timeout 0`.

---

## 4. Runner detection (runs against BOTH base and head worktrees, unconditionally)

Detection is split into two orthogonal probes per runner family per side (round-1 M4 — marker
presence and tool availability are NOT the same condition and must be reported separately):
- **`marker_present`** — does the worktree contain this runner's config/test markers?
- **`tool_available`** — is a runnable binary for this runner resolvable?

| Runner | `marker_present` iff (any) — in the worktree root | `tool_available` iff |
|--------|---------------------------------------------------|----------------------|
| **pytest** | `pytest.ini` ∥ `tox.ini` w/ `[pytest]`/`[tool:pytest]` ∥ `setup.cfg` `[tool:pytest]` ∥ `pyproject.toml` `[tool.pytest.ini_options]` ∥ any `conftest.py` ∥ a `tests/`-or-`test/` dir with ≥1 `test_*.py`/`*_test.py` | **`python3 -m pytest --version` exit 0** (round-2 N3: this is EXACTLY the collector command of §A.2 — do NOT probe bare `command -v pytest`, which can be true while `python3 -m pytest` can't run). Record the resolved interpreter (`python3` path + pytest version) in `l1_runners[].pytest_interp`. |
| **jest** | `package.json` w/ `jest` in deps/devDeps ∥ `jest.config.{js,ts,cjs,mjs,json}` ∥ a `"jest"` key in `package.json` | `node_modules/.bin/jest` exists (preferred) else `npx --no-install jest --version` exit 0 |
| **vitest** | `package.json` w/ `vitest` in deps/devDeps ∥ `vitest.config.{js,ts,mjs,cjs}` ∥ `vite.config.*` with a `test:` block | `node_modules/.bin/vitest` exists else `npx --no-install vitest --version` exit 0 |
| **go test** | `go.mod` present AND ≥1 `*_test.go` tracked in the module | `command -v go` exit 0 |

### 4.1 Detection → status matrix (deterministic, round-1 M4)
Computed per runner family from the two probes on each side:

| base marker | head marker | tool (the side being collected) | resulting `l1_runners[].status` (per family) |
|:-----------:|:-----------:|:-------------------------------:|----------------------------------------------|
| no | no | — | `unavailable` (this family contributes nothing) |
| no | yes | available | `ok` (new suite at head — no base set to shrink) |
| yes | no | — | **`runner_disappeared`** (violation; no collection needed) |
| yes | yes | available on both | proceed to collection + §7 comparison |
| yes | yes | **missing on a side** | `collection_failed reason:"runner_missing"` for that side (then §7: head-missing ⇒ require override; base-missing ⇒ `base_failed:true`, pass) |

`marker_present` + `tool_available` are reported in `l1_runners[]` (`marker_base`, `marker_head`,
`tool_base`, `tool_head`) so the verdict is auditable and the count-blind class can't hide.

### 4.2 jest and vitest are INDEPENDENT families (round-1 M6)
Do **NOT** "prefer one." Detect and run jest and vitest **independently** — if both are detected,
both produce an `l1_runners[]` entry and both must pass. This closes the bypass where a candidate
adds a vitest config so existing jest tests silently stop being evaluated: jest still detects on
both sides, so a jest executed-set shrink (jest tests no longer running) is caught regardless of
what vitest reports. A JS runner that *disappears* base→head is a `runner_disappeared` violation
for that family (per the matrix). Multiple distinct runners (pytest + go + jest …) all run; the
gate fails if ANY family reports a shrink or a block-relevant failure.

Detection markers are read from the worktree filesystem (the trusted checkout of a real commit) —
NOT a candidate-self-report path.

---

## A. pytest

### A.1 Detection
See §4 pytest row.

### A.2 Collection/execution command — **RUN the suite** (spec decision)

Invoked **with cwd = the worktree root** (so the rootdir pytest discovers IS the worktree root —
round-1 M7; do not pass an explicit rootdir/testpath arg that could re-anchor `testcase@file`):
```
# env scrubbed per §3, cwd = <tmp>/l1-<side>
python3 -m pytest -p no:cacheprovider -o junit_family=legacy -o addopts="" \
       --junit-xml=<tmp>/l1-<side>/pytest-l1.xml -rN -q --no-header --rootdir=.
```

- **Decision: pytest tests are RUN, not merely collected.** Justification: conditional skips
  (`@pytest.mark.skipif(sys.platform…)`, `importorskip`, fixtures that `pytest.skip()` at setup)
  and `pytestmark = pytest.mark.skip` resolve **only at execution** — `--collect-only` reports
  them as collected/normal (verified: all 6 incl. the skip appear in collect-only). Running is the
  only way to observe the executed set. Cost is accepted under the §3 timeout cap; this is a
  best-effort layer, not a CI substitute.
- `python3 -m pytest` (not bare `pytest`) pins the interpreter and avoids a shimmed `pytest` on PATH.
- `--rootdir=.` (cwd already the worktree root) makes `testcase@file` deterministically
  **repo-relative POSIX** — both sides use the same cwd, so the same test yields the same `file`
  (round-1 M7). `-o junit_family=legacy` is **mandatory** — it is the only family that emits the
  `file` attribute we need for a path-stable id (verified: `xunit2` drops `file`). `-o addopts=""`
  neutralizes a candidate's repo `addopts` (e.g. `--no-cov`, `-x`, `-k` filters) that could shrink
  the run. `-p no:cacheprovider` avoids writing `.pytest_cache` into the worktree.
- We do NOT pass `-x`/`--maxfail`: a failing test must still appear in the report (a `failed`
  test is "executed"; only the *vanishing* of an executed test is a shrink).
- Report consumed: the junit XML at `pytest-l1.xml`. We parse `testsuite/testcase`.

### A.3 Normalized test-id

`"<file>::<class-path>::<name>"` where:
- `file` = `testcase@file` (relative to worktree root — verified e.g. `tests/sub/test_x.py`).
- `class-path` = the segment(s) of `testcase@classname` AFTER the module path. pytest encodes
  classname as `dotted.module.path[.ClassName...]`; the module-path prefix equals `file` with `/`
  → `.` and `.py` stripped. Strip that prefix; the remainder (possibly empty) is the class path,
  re-joined with `::`. (Verified: `tests.sub.test_x.TestGroup` over file `tests/sub/test_x.py`
  ⇒ class-path `TestGroup`; `tests.sub.test_x` ⇒ empty.)
- `name` = `testcase@name`, which already includes `[param]` for parametrized cases (verified:
  `test_param[1]`).
- **Stability / unresolvable-id guard (round-1 M7/M8).** `testcase@file` MUST resolve to a path
  **under the worktree root** (POSIX-relative); if it is absolute, escapes the root (`../`), or is
  missing, the id is unstable across sides ⇒ classify that runner `collection_failed
  reason:"unstable_ids"` (do NOT silently guess). If a module-path-prefix strip is ambiguous (file
  path doesn't prefix classname), fall back to `"<file>::<classname>::<name>"` verbatim — still
  stable side-to-side because `--rootdir=.` (§A.2) fixes the file anchor. The id needs to be
  **byte-identical across the two sides for an unchanged test**, not pretty.
- **Duplicate-id guard (round-1 M2).** After building the per-side id set, if any normalized id
  appears more than once on a side (legal in pytest only via odd dynamic collection, rare), that
  runner is `collection_failed reason:"ambiguous_ids"` in block mode — a set comparison cannot
  safely represent duplicates.

### A.4 Status mapping (verified)

| junit testcase shape | meaning | executed? |
|----------------------|---------|-----------|
| no child element | passed | **EXECUTED** |
| `<failure>` | failed (incl. strict xpass → failure) | **EXECUTED** |
| `<error>` | error in setup/teardown | **EXECUTED** (it ran / attempted) |
| `<skipped>` | skipped OR xfail (both map to `<skipped>`) | **NOT EXECUTED** |
| (absent from report entirely vs base) | deselected `-k/-m`, `collect_ignore`, `norecursedirs`, module-level skip, removed | **NOT EXECUTED** |

The executed-set for a side = { id | testcase present AND has no `<skipped>` child }. xpass
non-strict counts as executed (it ran and passed); xpass strict is a `<failure>` (executed).

### A.5 Cost/limitation
Running the suite has side effects if tests touch external state; accepted as a documented
best-effort limitation (§9). Tests requiring network/DB that error become part of
`collection_failed`/per-test `<error>` (still "executed").

---

## B. jest / vitest (shared `--json` family)

### B.1 Detection
See §4 jest / vitest rows. The two share an output schema; the invocation differs.

### B.2 Collection/execution command — **RUN** (spec decision)

jest (env scrubbed per §3, cwd = worktree root):
```
<jest-bin> --json --testLocationInResults --outputFile=<tmp>/l1-<side>/jest-l1.json \
           --ci --runInBand --silent --reporters=default
```
vitest:
```
<vitest-bin> run --reporter=json --outputFile=<tmp>/l1-<side>/vitest-l1.json
```
where `<jest-bin>`/`<vitest-bin>` = the `node_modules/.bin/<x>` if present else
`npx --no-install <x>` (never `--yes`/auto-install — honors §3). `--testLocationInResults`
adds `assertionResults[].location = {line,column}` (verified [V]) for the duplicate-id guard
(§B.3, round-1 M2).

- **Decision: RUN.** `test.only`/`describe.only` reclassify all OTHER tests to `pending` only at
  run time (verified: with `.only`, siblings report `"pending"`); `test.skip`/conditional skips and
  `testPathIgnorePatterns` exclusions are likewise observable only by running. `--listTests` (plan
  candidate) gives files, not per-test status — insufficient, same reason as pytest collect-only.
- `--runInBand` (jest) / default vitest serial keeps it deterministic and pgroup-killable on
  timeout. `--ci` disables jest's interactive/snapshot-write behavior (no snapshot mutation in the
  worktree). We do NOT pass `-t`/`--testNamePattern` (no filtering).

### B.3 Normalized test-id

`"<relfile> > <ancestorTitles joined by ' > '> > <title>"`:
- `relfile` = the report's per-file path (`testResults[].testFilePath` for jest — **absolute**,
  verified; `testResults[].name` for vitest — **absolute**, verified) made **relative to the
  worktree root** (strip the `<tmp>/l1-<side>/` prefix; this is why both sides must use the same
  relative cwd, §2). Relativizing is mandatory — absolute paths differ per side.
- `ancestorTitles` = `assertionResults[].ancestorTitles` (array, may be empty).
- `title` = `assertionResults[].title`. (vitest also exposes `fullName`; do NOT use it as the id —
  it omits the file, so two files with same-named tests collide.)
- **Duplicate-id guard (round-1 M2).** Jest/Vitest allow two `test('same', …)` under the same
  ancestors in one file; the title-based id collapses them, so skipping one while the other passes
  would be invisible. After building each side's ids, if any id repeats:
  - **jest** — append BOTH `location.line` AND `location.column` (from `--testLocationInResults`,
    which gives `{line,column}`, verified [V]) to the id, **then RE-CHECK for duplicates** (round-2
    N2: two same-name tests under the same ancestors can share a line — e.g. on one line — so line
    alone is insufficient). If any duplicate STILL remains after appending line+column ⇒
    `collection_failed reason:"ambiguous_ids"` in block mode. (line+column is stable for an unchanged
    test; a moved duplicate is treated as a drop — honest M8 behavior.)
  - **vitest** — `--testLocationInResults` location support is **[NC]** (not re-probed). If the
    per-test location field is absent in the vitest JSON, classify that runner `collection_failed
    reason:"ambiguous_ids"` in block mode rather than collapse. Confirm at impl time.

### B.4 Status mapping (verified)

`assertionResults[].status`:

| status | executed? | notes |
|--------|-----------|-------|
| `passed` | **EXECUTED** | |
| `failed` | **EXECUTED** | ran, asserted false |
| `pending` | **NOT EXECUTED** | jest's word for skipped AND for "not run because a sibling `.only` focused" — the key shrink signal |
| `skipped` | **NOT EXECUTED** | vitest's word; jest also uses for `xit`/`.skip` |
| `todo` | **NOT EXECUTED** | `test.todo` |
| `disabled` | **NOT EXECUTED** | |

Executed-set = { id | status ∈ {passed, failed} }. Everything else is not-executed. A test that
vanishes from the head report (file excluded via `testPathIgnorePatterns`, `roots`, `projects`
config, or deletion) is also not-executed (set-difference catches it).

### B.5 Cost/limitation
`npx --no-install` resolution depends on `node_modules` being installed; if absent ⇒
`collection_failed reason:"runner_missing"` (§3, not unavailable). Monorepo `projects` configs may
shard; v1 runs the default project set — documented limitation (§9).

---

## C. go test

### C.1 Detection
See §4 go row.

### C.2 Collection/execution command — **RUN** (spec decision)

```
# env scrubbed per §3 (GOFLAGS/GOTAGS unset), cwd = worktree root
go test -json -count=1 -run '.*' ./...
```
captured stdout streamed to `<tmp>/l1-<side>/go-l1.ndjson`.

- **Decision: RUN.** `go test -list '.*'` enumerates only top-level test funcs, NO subtests, NO
  skip status (verified). `t.Skip()`, build-tag exclusions, and `t.Run` subtest skips are observable
  only by executing. `-count=1` disables the go test result cache (a cached PASS could otherwise mask
  a head change). `-run '.*'` is explicit-all (defensive against a repo `GOFLAGS=-run=...`).
- We do NOT pass `-short`/`-tags` beyond defaults; a candidate adding `//go:build !ci` style
  exclusions that drop tests under the default build is exactly what we want to catch as a shrink.

### C.3 Normalized test-id

`"<package>::<Test>"` where `package` = event `Package` (the import path, stable across sides as
long as `go.mod` module path is unchanged) and `Test` = event `Test` (subtests already `Parent/child`,
verified `TestSub/child_skip`). If the module path itself changed between base and head, ids won't
match and every base test will look "dropped" — classify as `module_path_changed` (§7.3), require
override in block (a rename of the module is a legit-but-reviewable event).

### C.4 Status mapping (verified)

The last `Action` event for a given `(Package, Test)`:

| terminal `Action` | executed? |
|-------------------|-----------|
| `pass` | **EXECUTED** |
| `fail` | **EXECUTED** |
| `skip` | **NOT EXECUTED** |
| (no terminal event for a base id at head) | **NOT EXECUTED** (filtered/excluded/removed) |

Executed-set = { id | terminal Action ∈ {pass, fail} }. A package that fails to **build** emits a
package-level `fail` with build output and no per-test events; if a base package built and the head
package no longer builds ⇒ all its tests vanish ⇒ shrink AND `collection_failed` for that package
(broken-runner path, §7 / §D).

---

## D. Cross-runner: nonzero exit semantics + id-churn policy

### D.1 Nonzero-exit → status (round-1 M3)
Every runner exits **nonzero when any test fails**, so exit code alone cannot distinguish "red
tests" (out of L1's scope — another gate owns test redness) from "the runner broke" (L1's
broken-runner concern). The decision is keyed on **whether a well-formed report was produced and
what failure class it indicates**, NOT on the raw exit code:

| Report parseable? | Failure class observed | L1 treatment |
|:-----------------:|------------------------|--------------|
| yes | assertion failures only (tests ran, some red) | **executed** — those ids are in the executed-set (status `fail`/`<failure>`). NOT a shrink, NOT `collection_failed`. **L1 does not own test redness.** |
| yes | per-test setup/teardown **error** (`<error>` / go test error event) | **executed** (it attempted to run) — in the executed-set. |
| yes | some ids present, others **absent vs base** | the absent base-ids are the shrink (§7), independent of the red/green of the present ones. |
| **no** (report missing/empty) | reporter/plugin crash, no report written | `collection_failed reason:"reporter_failed"` |
| **no** | syntax / import / **build** failure (collection never started) | `collection_failed reason:"build_failed"` |
| **no** | report file present but **not valid XML/JSON** | `collection_failed reason:"malformed_report"` |
| (killed) | wall-clock cap hit | `collection_failed reason:"timeout"` |

**Spec decision: head TEST FAILURES (red tests) are explicitly OUT of L1's scope** — a red test is
still an *executed* test; L1 only fails on executed-set *shrinkage* or a *broken runner*. This keeps
L1 from double-owning the "tests must pass" concern that the normal test-run/quality-pipeline gate
already owns. The `collection_failed` rows are the broken-runner path (§7: head ⇒ require override).

### D.2 Id-churn policy (round-1 M8) — no fuzzy matching, churn = drop
L1 does **NOT** attempt fuzzy/rename matching of test-ids. Any base id whose **exact normalized
string** is absent at head is a drop — including:
- a renamed test function/`it()` title (old id gone, new id is just a fresh test),
- a pytest **param insertion** that re-indexes `[param]` ids (`test_x[1]` → `test_x[2]` churn),
- a jest/vitest **`test.each`** index/title change.

**This is deliberate and is the dominant false-positive cost of L1** — a legitimate refactor that
renames or re-parametrizes tests WILL trip `executed_set_shrink` and require a depth-0 override.
That cost is the explicit justification for the **`warn` global default** (plan §2.5): L1 ships in
shadow, the override (§8) is the escape hatch for legitimate churn, and only `block`-opt-in projects
pay the friction. Fuzzy matching is rejected because it would let a malicious rename-then-gut hide a
real removal. The blast-radius/false-positive tradeoff is restated honestly in §10.

---

## 5. CLI additions

Backward-compatible additions to the existing `validate` subcommand:

| Flag | Meaning |
|------|---------|
| `--no-l1` | Skip L1 entirely. Output gets `l1:"skipped"`; L0 unchanged. |
| `--l1-timeout <sec>` | Per-collection wall-clock cap (default 180; `0` ⇒ same as `--no-l1`). |
| `--l1-runner <name>` | (optional, advisory/testing) restrict L1 to one runner ∈ {pytest,jest,vitest,go} (jest and vitest are independent — §4.2). Absent ⇒ all detected. |
| `--l1-worktree-dir <dir>` | (optional) base dir for the throwaway worktrees; default `mktemp -d`. **Hardened (round-1 m1):** the resolved `realpath` MUST be OUTSIDE `repo_dir` (reject if it resolves under the repo, via symlink or otherwise), the gate creates a `0700` child dir it owns, refuses symlink traversal in the path, and on cleanup removes ONLY the children it created (never the user-supplied parent). A path resolving inside the repo ⇒ exit 2 usage error. |
| `--l1-verdict-file <path>` | (round-2 C1) Path to the depth-0 override verdict (§8.3.6 primary channel). Takes precedence over the `refs/qc/*` ref. The path SHOULD resolve outside the repo/worktree (the gate warns if it resolves under `repo_dir`). **v4 (§8.3.0):** read in `warn` mode only; INERT in block mode until §8.3.4 containment lands. |
| `--assert-worker-dead <pgid>` | (round-2 C1 / round-3) The dispatched worker's original process-group id — a **cheap fail-closed pre-check, NOT a containment guarantee**: a survivor in that pgroup ⇒ refuse, but an empty pgid does NOT prove containment (a `setsid`-escaped descendant is missed — §8.3.2). Does NOT by itself re-enable block-mode honoring; that requires the §8.3.4 descendant-containment proof. |

No existing flag changes meaning. `--range`/`--base`/`--repo`/`--allow-env-config` behave exactly
as in L0. Exit codes unchanged: `0` ok (warn/off, or block with no active violation) / `1`
block-violation (now incl. L1 kinds) / `2` usage/internal (incl. unrecoverable git/worktree error).

---

## 6. JSON output additions (backward-compatible with L0 schema)

L0's keys (`ok, mode, violations, surface_touches, test_paths_matched, source, head_sha, base_sha,
override_status, warning?`) are **unchanged**. L1 ADDS:

```jsonc
{
  // ...all existing L0 fields...
  "l1": "ok" | "unavailable" | "collection_failed" | "shrink" | "skipped",
  "l1_runners": [
    {
      "runner": "pytest" | "jest" | "vitest" | "go",
      "status": "ok" | "collection_failed" | "shrink" | "unavailable" | "runner_disappeared",
      "marker_base": true, "marker_head": true,     // §4 detection probes (M4)
      "tool_base": true,   "tool_head": true,       // tool_available per side (M4)
      "pytest_interp": "/usr/bin/python3 (pytest 9.0.3)",  // N3: resolved interp/version (pytest only)
      "env_scrubbed": true,                          // §3 env sanitization applied (M5)
      "base_count": 123,            // runner-reported-executed-set size at base
      "head_count": 120,            // executed-set size at head
      "dropped": [ "tests/x_test.py::TestG::test_a", "pkg::TestB" ], // base-exec ∩ ¬head-exec
      "dropped_digest": "<sha256 of §8.5.1 canonical-JSON of sorted dropped[]>", // M1+N1
      "reason": "timeout" | "runner_missing" | "build_failed" | "reporter_failed"
                | "malformed_report" | "unstable_ids" | "ambiguous_ids"
                | "module_path_changed" | "runner_disappeared" | null,
      "base_failed": false,         // collection failed on base side
      "head_failed": false          // collection failed on head side
    }
  ],
  "override_status": "…"            // L0 field. v4 (§8.3.0): block-mode override HONORING is DEFERRED.
                                    //   block + shrink + any override  → "block-mode override deferred (awaits §8.3.4 descendant containment); shrink hard-fails"
                                    //   warn  + override               → honored/refused per §8.6 (security-neutral in warn)
                                    //   pgid pre-check live (§8.3.2)    → "refused: worker pgroup <pgid> still alive"
}
```

- Top-level `l1` is the **aggregate**: `shrink` if any runner has a non-empty `dropped`;
  else `collection_failed` if any runner has a head-side collection failure or `runner_disappeared`
  (block-relevant); else `ok` if ≥1 runner ran cleanly; else `unavailable` (no runner on either
  side anywhere); `skipped` if `--no-l1`.
- L1 violations are ALSO appended to the existing `violations` array (so the block-mode evaluation
  near L0 ~lines 779-799 picks them up unchanged) with `layer:"L1"`:
  ```jsonc
  { "layer":"L1", "file":"pytest", "kind":"executed_set_shrink",
    "line":1, "detail":"3 tests dropped from executed set: tests/x_test.py::TestG::test_a, ..." }
  { "layer":"L1", "file":"go", "kind":"collection_failed",
    "line":1, "detail":"head collection failed: build_failed (...)" }
  ```
- The example id `tests/x_test.py::TestG::test_a` (round-1 m2 fix) uses a non-empty class path; an
  id with NO class (`test_top`) is `tests/x_test.py::test_top` — the spec's normalization joins the
  class segment with `::` only when present, so there is no `::::` double-colon (matches §A.3).
- New violation **kinds**: `executed_set_shrink`, `collection_failed`. Both are **waivable** by a
  depth-0 verdict (§8.4/§8.6) — they are behavioral, not structural. (The non-waivable trio
  `git_error/malformed_config/protected_path_touch` is untouched.)
- `dropped` ids are listed in the violation `detail` (truncate to first 20 in `detail`, full list
  in `l1_runners[].dropped`) so the reviewer/orchestrator sees exactly which tests were silenced.
  `dropped_digest` (round-1 M1 + round-2 N1) is the sha256 of the **§8.5.1 canonical-JSON encoding**
  of the `LC_ALL=C`-sorted ids — NOT a newline-join (newline-join is non-injective; ids can contain
  newlines). A waiver is honored only if it carries the **same** digest (§8.6 step 6) — so a
  single-test-retirement waiver cannot also waive an unrelated extra drop bundled into the same run.

---

## 7. Base-vs-head failure classification (decision table)

Applied per runner family. The first three rows derive from **detection alone** (§4.1) and do NOT
require any collection; the rest follow from comparing `base_executed` / `head_executed` sets.

| Condition | `l1_runners[].status` | block-mode behavior | rationale |
|-----------|----------------------|---------------------|-----------|
| `marker_base=no` AND `marker_head=no` | `unavailable` | pass (L0+reviewer backstop) | no framework = OK |
| `marker_base=yes` AND `marker_head=no` | **`runner_disappeared`** | **require override** (violation from detection; **no head collection**) | candidate removed the runner config to bypass L1 (resolves the round-1 C3 contradiction — detection alone fires) |
| `marker_base=no` AND `marker_head=yes` | `ok` (no base set to shrink) | pass | legitimately adding a first test suite |
| both markers, **tool missing on head** | `collection_failed`+`reason:runner_missing` | **require override** | head suite not runnable; could be a dodge (plan R10) |
| both markers+tools, **base collection FAILS** but head OK | `ok`+`base_failed:true` | pass (warn-log) | likely pre-existing breakage; can't prove a shrink without a base set; do NOT punish the candidate for a base they didn't touch |
| both markers+tools, **head collection FAILS** (`build_failed`/`reporter_failed`/`malformed_report`/`timeout`/`unstable_ids`/`ambiguous_ids`) | `collection_failed`+`reason` | **require override** | plan R10: candidate may have broken the runner to dodge L1; never silently pass. (Red TESTS are NOT a failure — §D.1.) |
| both OK, `base_executed ⊆ head_executed` (no drop) | `ok` | pass | growth or no-change is fine |
| both OK, `base_executed \ head_executed ≠ ∅` | `shrink` + `dropped` + `dropped_digest` | **block** unless waived | the core L1 violation |
| go: module path differs base↔head | `collection_failed`+`reason:module_path_changed` | **require override** | every id mismatches; can't compare; reviewable rename |

"Require override" = in `block` mode this produces an active `violations` entry (kind
`collection_failed`, or `executed_set_shrink` for the shrink row) that **exits 1**. In `warn` mode it
is reported (`ok:true`, exit 0) but surfaced in `l1`/`violations` for calibration. **Both-fail (base
AND head fail)** ⇒ treat as head-failed — we cannot distinguish pre-existing from introduced once head
is also broken; fail-closed.

> **Ruling-C reconciliation (round-3, §8.3.0):** in v4, "require override" / "unless waived" in this
> table and §9 means the block-mode violation **hard-fails (exit 1)** and the override that would
> waive it is **DEFERRED — not honored in block mode** until §8.3.4 descendant-containment lands. So
> today a block-mode `require override` row is simply a hard fail; the user resolves it by fixing the
> test/runner or switching that project to `warn`. The waiver machinery (§8) is exercised in `warn`
> mode + structural tests but inert in block mode. Read every "require override"/"unless waived"
> below with this deferral in force.

---

## 8. The override mechanism — concrete design (honest trust model)

### 8.1 The L0 fixed-point problem (restated)
L0's override lives at `<head>:.qc/<head_sha>.verdict.json` — **inside the committed tree**.
Committing the verdict changes `head_sha`, so the filename `<head_sha>.verdict.json` can never
match the commit that contains it. A legitimate override is unconstructable; it only fails-closed.
An out-of-commit ref-blob escapes this fixed-point (its name need not equal the commit it lives in).

### 8.2 The trust problem my round-1 design got WRONG (round-1 C1) — and why v2's fix was still PARTIAL (round-2 C1)
`dispatch-hetero.sh` (line 130) runs the worker in a **LINKED `git worktree` of the SAME repo** —
it shares the parent's object store AND ref namespace. **Verified [V]:** a shell inside that
worktree can `git update-ref refs/qc/test-integrity/<head_sha> <blob>` and the gate, reading the
same namespace, would accept the forged waiver. codex/agy workers are **same-user, full-shell**, so
a `refs/qc/*` blob is **forgeable** and any **on-disk HMAC secret** (in the repo or the same user's
home) is **also readable by the worker** — neither adds real security against a same-user shell.

**v2's "teardown-ordering invariant" was still wrong (round-2 C1, verified [V] by reading
`scripts/dispatch-hetero.sh`):** the real dispatcher does NOT enforce what v2 assumed.
- It runs the worker as a plain subshell `( cd "$WT" && codex … )` (line 144) — **no process group
  is created** (`set -m`/`setsid` absent).
- Its `trap … INT TERM` (line 140) is **cleared immediately after the run** (`trap - INT TERM`,
  line 172) and only ever removed the worktree/branch — it does NOT reap any worker children, and
  fires on **INT/TERM only**, never on normal completion.
- The **failure / no_op / dirty / question_suspected** exit paths all **KEEP the worktree** (lines
  199, 204, 219, 223, 228). Only the single success path removes it (line 209).
- ⇒ A worker can **`setsid` a background same-user process** that survives the dispatcher's return
  and **re-plants `refs/qc/test-integrity/<head_sha>` AFTER depth-0's quarantine but BEFORE the gate
  reads it** — a TOCTOU. v2's claim "the worker is DEAD at gate time, as dispatch-hetero already does
  (pgroup)" was **false**. The model below replaces the asserted-invariant with an **explicit,
  caller-verifiable precondition + honest residual + a named dispatch-hetero dependency.**

### 8.3 Spec decision: override = a depth-0 CALLER-CONTRACT with a gate-verifiable precondition
The gate (`check-test-integrity.sh`) **cannot itself prove the worker is dead** — it is a stateless
artifact-reader, not the process supervisor. So the trust boundary is stated as a **named
precondition the depth-0 CALLER (the `/l5` control loop) MUST satisfy**, plus the gate's own
fail-closed defense-in-depth when given the means to check it.

### 8.3.0 Shipping posture (round-3 RULING — Option C, adopted)
The round-3 reviewer RULED on the override tension. This subsection is the authoritative
ship-vs-defer boundary; everything else in §8.3 describes the deferred mechanism.

**SHIPS NOW (no trust dependency — all fail-safe):**
- **Executed-set-invariance DETECTION** (§4 + §A/§B/§C): runner-reported shrink detection, base vs head.
- **`warn` mode** (the global default): reports a shrink in `l1`/`violations`, **exit 0**. No trust
  question — it never blocks, so a forgeable waiver is irrelevant.
- **`block` mode HARD-FAIL on a shrink**: a shrink with **NO** override is a fail-closed `exit 1`.
  This is SAFE (refusing to pass is never exploitable) and is the whole point of block mode.

**DEFERRED (gated on a worker-containment mechanism stronger than "original pgid is empty"):**
- **HONORING a block-mode override / waiver.** Until descendant-containment lands (§8.3.4), the gate
  **REFUSES to honor any block-mode override** — a block-mode shrink is a hard fail the user resolves
  by **fixing the test or switching that project to `warn`**, NOT by an overridable-but-forgeable
  waiver. The verdict-verification machinery (§8.3.1–§8.3.6, §8.4–§8.6) is **specified and built but
  inert in block mode** until §8.3.4's containment proof is available; it MAY operate in `warn` mode
  (where honoring/refusing a waiver changes nothing security-relevant — exit 0 either way).

**Why this is the honest posture (state in the spec):** the default is `warn`, so deferral affects
**only opt-in `block` users**. Honoring a *forgeable* override would mislead a block-mode user into
reading the waiver as enforcement-grade when it is not. **Refusing a forgeable waiver is fail-SAFE**
— it cannot be exploited; it only inconveniences a legitimate test-retirement in opt-in block mode,
which is the correct conservative default. Block-mode override honoring is **re-enabled only** once
the dispatcher provides real descendant-containment (§8.3.4) AND the gate is given that containment
proof (not merely an empty original pgid, §8.3.2).

> **Implementer note:** §8.3.1–§8.3.6 below describe the *deferred* honoring mechanism precisely so
> it is build-ready, but the v4 ship MUST wire it as **inert-in-block-mode** per §8.3.0. Do not let
> a block-mode override pass until §8.3.4 lands.

**8.3.1 Caller precondition `WORKER-DEAD-AND-VERIFIED` (the deferred-honoring precondition).**
This describes the *deferred* honoring mechanism (block-mode honoring does NOT ship in v4, §8.3.0).
For the future re-enablement, before invoking the gate in a flow where a block-mode override may be
honored, the depth-0 caller MUST, in order:
1. **Reap the worker's whole SESSION / process tree** (not just the pgroup — §8.3.2/§8.3.4): kill the
   session, then re-scan to prove no descendant survives. (Requires the §8.3.4 dispatch hardening.)
2. **VERIFY no descendant remains** (session/tree/cgroup re-scan empty). A bare `pgrep -g <pgid>` is
   only a cheap pre-check, NOT proof (a `setsid`-escaped descendant survives it — §8.3.2).
3. **Quarantine** candidate-plantable refs (§8.3.3).
4. Write the depth-0 verdict (§8.4) and hand the gate the **containment proof** (§8.3.4).
5. Invoke the gate.

The verdict may be honored **only when steps 1–2 held AND the containment proof is supplied**. Per
the round-3 ruling (§8.3.0), until §8.3.4 containment lands the gate does NOT honor block-mode
overrides at all — there is no "honor under an unverified precondition" path in block mode.

**8.3.2 Gate-side pre-check `--assert-worker-dead <pgid>` — necessary, NOT sufficient (round-3 🔴).**
A gate flag (§5) lets the caller hand the worker's original pgid to the gate for a cheap fail-closed
pre-check. **Critical disclosure (round-3):** an empty pgid does **NOT** prove containment.
- **`pgid`-emptiness only proves no process remains in THAT process group.** A worker can `setsid`
  / daemon-spawn into a **NEW process group or session BEFORE teardown**, then re-plant the ref /
  fs-verdict **AFTER** the pgid check passes. That escaped descendant survives the sweep entirely.
  So `--assert-worker-dead <pgid>` **narrows but does NOT close** the §8.2 TOCTOU — it is a cheap
  fail-closed pre-check, not the containment guarantee. Real closure is the session/tree containment
  in the §8.3.4 dependency.
- Behavior when given: before any (deferred, §8.3.0) honoring, the gate checks `pgrep -g <pgid>`
  empty AND `kill -0 -<pgid>` fails. **A live process in that group ⇒ REFUSE the verdict**
  (fail-closed; shrink stays active → exit 1 in block mode), `override_status:"refused: worker
  pgroup <pgid> still alive"`. An empty pgid does NOT by itself authorize honoring — under §8.3.0
  block-mode honoring is deferred regardless until §8.3.4 lands.
- **pgid REUSE disclosure (round-3 🟡):** the OS may recycle a pgid to an unrelated process
  (**false-alive** → the gate spuriously REFUSES — an annoyance, fail-CLOSED, **not** a security
  hole), or a reparented worker child may run under a NEW pgid while the original pgid is gone
  (**false-dead** → exactly the escaped-descendant hole above — the reason pgid alone is
  insufficient). Both are disclosed; only false-dead is a containment gap, and it is closed by
  §8.3.4, not by this pre-check.
- If the flag is **absent**: in `warn` mode nothing changes (honoring is security-neutral); in
  `block` mode honoring is deferred (§8.3.0) so the absence is moot. (No "honored under unverified
  precondition" path ships in block mode in v4 — that v3 wording is RETRACTED per §8.3.0.)

**8.3.3 Quarantine candidate-plantable refs (necessary, NOT sufficient).** Depth-0 treats **any**
`refs/qc/test-integrity/*` ref existing when it regains control as UNTRUSTED: enumerate
(`git for-each-ref 'refs/qc/test-integrity/**'`, verified [V]) and delete (`git update-ref -d`)
before writing its own. This closes the *already-planted* ref but NOT the *re-planted-after-
quarantine* TOCTOU. **Reconciled wording (round-3):** neither quarantine NOR the §8.3.2 pgid
pre-check closes that TOCTOU — a `setsid`-escaped descendant defeats both. Real closure is the
session/tree containment of §8.3.4, which is exactly why block-mode override honoring is DEFERRED
until that lands (§8.3.0).

**8.3.4 REQUIRED dispatch-hardening DEPENDENCY — real descendant containment (flag, do not fix here).**
Block-mode override honoring is gated on this. The caller can only contain what the dispatcher
isolates, and **killing the original pgid is NOT enough** (§8.3.2 escaped-descendant). `dispatch-
hetero.sh` must be hardened — tracked as a **separate** dependency, NOT in this spec — to provide
**real descendant containment**:
- **(a)** launch the worker in its **own SESSION** (`setsid`, so all descendants share a session id),
  surfacing the session/pgid to the caller; **(b)** on **ALL** exit paths (success, failure, no_op,
  dirty, question_suspected, timeout — not just INT/TERM) **kill the whole session / process-tree**,
  then **VERIFY no descendant survives by re-scanning the process tree / session id** (or use a
  **cgroup** where available for an authoritative membership+freeze+kill). "Kill the pgid" is
  explicitly insufficient; the dependency must kill **and prove-absent** the entire descendant tree.
- **The containment PROOF** (session-empty / cgroup-empty re-scan result) is what the gate must be
  given to re-enable block-mode honoring — NOT merely an empty original pgid.

Until (a)+(b) land **and** the gate is handed the containment proof, **block-mode override honoring
stays DEFERRED** (§8.3.0): a block-mode shrink hard-fails and the user fixes the test or uses `warn`.
(A sibling finding already flags `dispatch-hetero.sh`'s codex-trigger + hardcoded-effort bugs; bundle
this containment hardening there.) **Ledger:** the session/tree-containment mechanics are **DESIGN —
not yet implemented or tested**, NOT `[V]`.

**8.3.5 Defense-in-depth (optional, NOT sufficient alone).** Depth-0 MAY HMAC the verdict over the
§8.4 binding fields with a key in an env var injected **only** into the depth-0 gate process, never
the worker env. Raises the bar against a stale/replanted ref but is **not** sufficient against a
live same-user shell (the key lives in the same user's process space). Omit rather than imply false
security if the key could reach a worker env.

### 8.3.6 The verdict STORE — filesystem path (primary documented channel) or ref-blob (equivalent)
Two equivalent channels; **neither is forgery-proof against a live same-user worker. Per §8.3.0, in
v4 these channels are read in `warn` mode only (security-neutral) and INERT in block mode until the
§8.3.4 descendant-containment proof is available:**
- **Primary (documented): a depth-0-only filesystem path OUTSIDE any worktree.** Location =
  `$TEST_INTEGRITY_VERDICT_DIR` if set, else a depth-0 `mktemp -d` **not under `<repo>`** (passed to
  the gate via `--l1-verdict-file <path>`, §5). This is created by depth-0 post-teardown; a worktree
  worker cannot path-traverse to a sibling temp dir it was never told about. **NOT safe** if the
  path is placed under the repo or `.git/` (e.g. `<repo>/.git/qc-verdicts/` is shared-objectstore
  and worker-reachable) — the spec forbids any in-repo location.
- **Equivalent alternative: the `refs/qc/test-integrity/<head_sha>` blob ref** (§8.3.3 quarantine
  applies). Use when a filesystem hand-off is inconvenient.
Both carry the identical §8.4 schema and pass the identical §8.6 checks. The gate reads whichever is
provided (`--l1-verdict-file` takes precedence; else the ref).

**Residual, stated plainly (round-3 reconciled):** with a live same-user worker, NO local channel
(fs path or ref) is forgery-proof; the worker can race either, and a `setsid`-escaped descendant
defeats both the §8.3.2 pgid pre-check AND the §8.3.3 quarantine. Therefore v4 does NOT ship
block-mode override honoring (§8.3.0 ruling C); it is re-enabled only with §8.3.4 descendant
containment + its proof. Until then the conservative, fail-safe posture is: block-mode shrink =
hard fail; legitimate retirement = fix the test or use `warn`.

### 8.4 Verdict JSON schema (content-bound digest — round-1 C2)
Stored as the §8.3.6 filesystem verdict (or the ref blob), written by depth-0 post-quarantine:
```jsonc
{
  "base_sha":  "<full base commit sha>",
  "head_sha":  "<full head commit sha>",
  "base_tree": "<git rev-parse <base_sha>^{tree}>",
  "head_tree": "<git rev-parse <head_sha>^{tree}>",
  "changeset_digest": "<see §8.5 — sha256 over full diff bytes, NOT a path list>",
  "waives": [
    { "file": "pytest", "kind": "executed_set_shrink",
      "dropped_digest": "<must equal the run's l1_runners[pytest].dropped_digest>" },  // M1
    { "file": "go", "kind": "collection_failed" },
    { "file": "tests/legit_refactor_test.py", "kind": "deleted_line" }  // L0 kinds too
  ],
  "hmac": "<optional, §8.3.5 defense-in-depth>",
  "issued_by": "depth-0:<orchestrator-id-or-human>",   // provenance label (advisory)
  "issued_at": "2026-06-26T..."
}
```

### 8.5 The change-set digest algorithm (EXACT — round-1 C2)
`changeset_digest` is content-AND-base-bound, not a path list. Computed verbatim:
```
LC_ALL=C git -C <repo> diff -M --raw --full-index -z <base_sha>..<head_sha> \
  | sha256sum | cut -d' ' -f1
```
- `--raw --full-index` includes, per changed path, **both side blob SHAs (full, not abbreviated)
  and the file modes** — so the digest changes if any file's *content* or *mode* differs, not just
  its name. (Verified [V]: the raw line is `:<mode_a> <mode_b> <blob_a> <blob_b> <status>\0<path>\0`.)
- `-z` ⇒ NUL-delimited (rename/odd-name safe); `LC_ALL=C` ⇒ stable byte ordering; hash input is the
  **raw bytes of the command's stdout**, in git's native output order (do NOT re-sort — the order is
  already deterministic for a fixed range). The verdict embeds `base_sha`+`head_sha` separately too,
  so a replay to a different base is rejected even before the digest check.

### 8.5.1 The `dropped_digest` canonical encoding (EXACT — round-2 N1)
**Newline-joining the dropped ids is NOT injective** (round-2 N1): JS test titles, pytest param ids,
and go subtest names CAN contain newlines, so two different dropped sets could join to identical
bytes. The digest MUST be over a **canonical, delimiter-unambiguous encoding** of the id list. Spec
decision — **canonical JSON array**, computed identically by the gate (when emitting
`l1_runners[].dropped_digest`) and by depth-0 (when building a waiver):
1. Sort the dropped ids with a byte-wise (`LC_ALL=C`) collation on the raw id strings.
2. Encode as a JSON array with fixed serialization:
   `json.dumps(sorted_ids, ensure_ascii=True, separators=(",", ":"), sort_keys=False)`
   (a Python list of str → `["a","b",…]`; `ensure_ascii=True` escapes any embedded newline/control
   char, removing all delimiter ambiguity).
3. `dropped_digest = sha256(utf-8 bytes of that JSON string)` hex.

This same canonical-encoding rule applies to **any** id-list that feeds a HASH. The human-readable
`dropped[]` array and the truncated violation `detail` string are **display-only** and need no
canonicalization — but they MUST NOT be the digest input.

### 8.6 Gate verification of the verdict (mechanical, not claimed)
> **v4 scope (§8.3.0):** these steps run for `warn`-mode honoring and the structural-rejection tests;
> in **block mode the whole honoring path is INERT** (override deferred) until §8.3.4 containment.
0. **(round-2/3) pgid pre-check (if `--assert-worker-dead <pgid>` given):** if any live process in
   that pgroup remains ⇒ **refuse the verdict** (no override), `override_status` records it. Note this
   pre-check does NOT prove containment (escaped descendant — §8.3.2); an empty pgid alone does NOT
   authorize block-mode honoring (deferred regardless in v4).
1. (Depth-0, before gate) quarantine per §8.3.3: delete any pre-existing `refs/qc/test-integrity/*`,
   then depth-0 writes the verdict (§8.3.6) if an override is intended.
2. Gate reads the verdict: from `--l1-verdict-file <path>` if given (§8.3.6 primary), else
   `git cat-file -p refs/qc/test-integrity/<head_sha>` in the **trusted repo**. Absent ⇒ no override
   (the committed-path `.qc/<sha>.verdict.json` stub remains a fail-closed fallback, unchanged — it
   can reject but never legitimately waive).
3. Parse JSON. Malformed ⇒ override ignored (a bad verdict waives nothing; this is NOT a
   `malformed_config` violation — that key is for the gate CONFIG, not the verdict).
4. Verify ALL of: `base_sha`/`head_sha` equal the run's actual range refs; `base_tree`/`head_tree`
   equal `git rev-parse <base_sha>^{tree}` / `<head_sha>^{tree}`; `changeset_digest` recomputed by
   §8.5 matches. Any mismatch ⇒ **reject the whole verdict** (anti-replay across tree, base, or
   content).
5. (If present) verify `hmac` over the §8.4 binding fields with the depth-0-only key (§8.3.5). Absent
   key ⇒ skip (defense-in-depth, not required).
6. Only if 0,4 (and 5 if used) pass: each `{file,kind}` in `waives` suppresses the matching active
   violation — AND for `executed_set_shrink` the waiver's `dropped_digest` MUST equal the current
   run's `l1_runners[<file>].dropped_digest` (recomputed by the §8.5.1 canonical encoding; round-1
   M1 + round-2 N1), else that waiver is rejected. This binds the waiver to the **exact** dropped-id
   set, so a legit single-test-retirement waiver cannot also waive an unrelated extra drop bundled
   into the same run.
7. The non-waivable trio (`git_error`/`malformed_config`/`protected_path_touch`) can NEVER be
   waived (enforced exactly as L0 ~line 785), regardless of the verdict.

### 8.7 Non-waivable (unchanged from L0)
`protected_path_touch`, `malformed_config`, `git_error` — structural. L1 adds `executed_set_shrink`
and `collection_failed` to the **waivable** set (behavioral, legitimately overridable by depth-0
when a refactor genuinely moves/retires tests — gated by the digest binding above).

---

## 9. Acceptance criteria (adversarial-harness executable)

Each case = a scratch git repo with a base commit + a head commit, run
`check-test-integrity.sh validate --range base..head` (mode `block` unless noted). Harness MUST wrap
every temp repo in `( cd "$D" && … )` (plan §9 gotcha: command-substitution `cd` leaks into the real
repo). Expected = the named `l1`/violation outcome.

### pytest
- [ ] Add `@pytest.mark.skip` to an existing passing test → head executed-set drops that id →
  `executed_set_shrink`, exit 1 (block). (L0 may also catch the marker addition; L1 must catch it
  *even if the marker were added in a non-test conftest* — see surface case below.)
- [ ] Add `@pytest.mark.skipif(True, reason=…)` (a *conditional* skip L0's static regex set is
  weaker on) → executed-set drops it → `executed_set_shrink`. (Proves run-not-collect.)
- [ ] Add `collect_ignore = ["test_b.py"]` to `conftest.py` (zero test-file `-` lines) → a batch of
  ids vanish from head → `executed_set_shrink` listing them.
- [ ] Set `pytestmark = pytest.mark.skip` at module top (additions-only) → all module ids drop →
  `executed_set_shrink`.
- [ ] Pure-additive new test (only `+`, no skip) → `l1:"ok"`, exit 0.
- [ ] xfail→pass refactor (remove an `@pytest.mark.xfail` so a previously-skipped test now executes)
  → executed-set GROWS, no drop → `ok`. (Confirms growth is allowed.)

### jest / vitest
- [ ] Add `test.only` to one test → siblings become `pending`/`skipped` at head → those ids drop →
  `executed_set_shrink` (the canonical case L0 partially catches; L1 catches the *effect*). [V here]
- [ ] Add `testPathIgnorePatterns`/`exclude` to `jest.config`/`vitest.config` dropping a test file →
  its ids vanish at head → `executed_set_shrink`. (Surface file; zero test `-` lines.)
- [ ] `test.skip` an existing test → drop → `executed_set_shrink`.
- [ ] Add a brand-new `*.test.js` file (only additions) → `ok`.

### go
- [ ] Add `t.Skip()` to an existing `TestX` → head terminal Action `skip` → id drops →
  `executed_set_shrink`.
- [ ] Add a `//go:build ignore`-style tag / move a test under a non-default build constraint →
  test vanishes at head default build → `executed_set_shrink`.
- [ ] Rename module path in `go.mod` → `collection_failed reason:module_path_changed`, require
  override in block.
- [ ] Pure-additive `TestNew` → `ok`.

### availability / broken-runner
- [ ] Repo with no runner anywhere → `l1:"unavailable"`, exit 0, NOT a false pass.
- [ ] Head commit breaks the suite (syntax error / unbuildable package / removed import) →
  `collection_failed`, block-mode exit 1 unless overridden (plan R10). NOT silent pass.
- [ ] Base broken, head fixed → `base_failed:true`, `status:ok`, exit 0 (don't punish unrelated
  pre-existing breakage).
- [ ] Runner config removed at head (pytest.ini deleted, suite no longer runnable) →
  `runner_disappeared`, require override in block.
- [ ] Collection exceeds `--l1-timeout` → `collection_failed reason:timeout`; pgroup SIGTERM
  cleanup leaves no orphan; block ⇒ require override.

### detection / runner-independence (round-1 C3, M4, M6)
- [ ] Delete `pytest.ini` (or whatever makes the suite discoverable) at head so pytest no longer
  detects → `runner_disappeared` from **detection alone, no head collection**, require override in
  block. (Proves §1/§4/§7 are consistent — C3.)
- [ ] Add a `vitest.config` at head to a repo that already runs jest → jest still detects on both
  sides; a jest shrink (jest tests dropped) is still caught regardless of vitest (M6 independence).
- [ ] Marker present but tool missing on head only → `collection_failed reason:runner_missing`,
  require override; tool missing on base only → `base_failed:true`, pass (M4 matrix).

### exit-semantics / id-churn (round-1 M3, M8, M2)
- [ ] Head has a genuinely RED test (assertion fails) but no shrink → `l1:"ok"`, exit 0 (L1 does
  NOT own test redness — M3/§D.1).
- [ ] Head produces an empty/garbage report (reporter crash) → `collection_failed
  reason:reporter_failed`/`malformed_report`, require override (M3).
- [ ] Rename a test function / insert a pytest param shifting `[idx]` / change a `test.each` title
  → old id absent at head → `executed_set_shrink` requiring override (no fuzzy match — M8).
- [ ] Two `test('same', …)` under same ancestors in one jest file, skip one → `--testLocationInResults`
  **line+column** disambiguates → the skipped one shows as a drop (M2/N2). **Same-LINE duplicate
  variant (N2):** two `test('same',…)` on ONE line → line+column STILL collide → re-check fails →
  `collection_failed reason:ambiguous_ids`. vitest no-location variant → `ambiguous_ids`.

### shipping posture (round-3 ruling C — what actually ships in v4)
- [ ] **block + shrink + NO override → hard fail** (exit 1). The core enforcement that DOES ship.
- [ ] **warn + shrink → reported, exit 0** regardless of any override (security-neutral).
- [ ] **block + shrink + a structurally-valid override → STILL exit 1** (override **DEFERRED**,
  §8.3.0): the gate REFUSES to honor a block-mode override, `override_status:"block-mode override
  deferred (awaits §8.3.4 descendant containment)…"`. **This is the v4 ruling — a forgeable waiver
  must not pass in block mode.** User resolves by fixing the test or switching that project to `warn`.

### override-mechanism verification (built but block-INERT in v4; exercised in warn mode + the structural checks)
- [ ] **Verdict structurally honored in WARN mode (fs-path channel, §8.3.6)**: a verdict with correct
  `base_sha/head_sha/base_tree/head_tree` + `changeset_digest` (§8.5) + a
  `{file,kind:executed_set_shrink,dropped_digest}` waiver whose `dropped_digest` (§8.5.1 canonical)
  matches → in `warn` the waiver is recorded as honored (exit 0 either way; security-neutral). Proves
  the verification path works without claiming block-mode trust.
- [ ] **pgid pre-check refuses a live-pgroup run (round-2/3)**: pass `--assert-worker-dead <pgid>`
  with a process still alive in that group → `override_status:"refused: worker pgroup … still alive"`.
  **AND (round-3 escaped-descendant case):** a worker that `setsid`-spawns into a NEW pgroup then
  exits its original pgroup → the pgid pre-check passes (original pgid empty) yet a descendant
  survives → documents that pgid-empty is NOT containment (the verdict still must NOT be honored in
  block mode per §8.3.0).
- [ ] **pgid REUSE disclosure cases (round-3 🟡)**: false-alive (unrelated process recycled into the
  pgid) → spurious REFUSE, fail-CLOSED, no security hole; false-dead (reparented child under a new
  pgid) → original pgid empty but descendant alive = the escaped-descendant hole. Both documented.
- [ ] **Worker-forged ref/replant quarantined (C1)**: a worker plants
  `refs/qc/test-integrity/<head_sha>` while alive; depth-0's pre-gate quarantine
  (`git for-each-ref` enumerate → `git update-ref -d`) deletes it; gate sees NO trusted verdict.
  **Reconciled TOCTOU note (round-3):** a verdict re-planted AFTER quarantine by a `setsid`-escaped
  descendant is caught by NEITHER quarantine NOR the pgid pre-check — only §8.3.4 session/tree
  containment closes it, which is why block-mode honoring is deferred.
- [ ] **In-repo verdict path warned**: `--l1-verdict-file` resolving under `repo_dir`/`.git/` → gate
  warns it is worker-reachable (not a safe channel).
- [ ] **Forged/untracked committed verdict rejected**: a `.qc/<sha>.verdict.json` in the tree but no
  depth-0 verdict → does NOT waive (committed path is the fail-closed stub only).
- [ ] **Tree/base/digest mismatch rejected (C2)** (checked in warn-mode honoring path): (a) `head_tree`
  OLD; (b) `base_sha` from a different base; (c) `changeset_digest` recomputes differently → whole
  verdict rejected (waives nothing).
- [ ] **dropped_digest mismatch rejected (M1)**: a verdict whose waiver `dropped_digest` matches a
  prior dropped-set but the current run dropped a DIFFERENT/larger set → that waiver rejected.
- [ ] **Newline-in-id digest injectivity (round-2 N1)**: two distinct dropped sets whose newline-join
  would collide (an id containing `\n`) → §8.5.1 canonical-JSON yields DIFFERENT `dropped_digest` →
  a waiver for set A does NOT match set B.
- [ ] **Non-waivable not waived**: a verdict listing `{kind:"protected_path_touch"}` alongside a
  protected-path edit → protected violation still fires, exit 1 (true in any mode).

### env / isolation (round-1 M5, m1)
- [ ] Ambient `PYTEST_ADDOPTS="-k nomatch"` / `GOFLAGS="-run=^$"` in the parent env → scrubbed →
  the full suite still runs (M5); `env_scrubbed:true` in output.
- [ ] `--l1-worktree-dir` pointing (via symlink) INTO the repo → exit 2 usage error; a valid
  external dir → only gate-created children removed on cleanup (m1).

### wiring / regression
- [ ] `--no-l1` → `l1:"skipped"`, output otherwise == today's L0 (no behavioral change).
- [ ] All existing L0 tests in `hooks/tests/check-test-integrity.test.sh` (70 assertions) STILL
  pass unchanged.
- [ ] Worktrees are always removed (no `git worktree list` residue) even on timeout/error.

---

## 10. Out-of-scope / documented limitations

Restated from plan §4 + L1-specific best-effort caveats:
- **green-but-meaningless / additive body weakening (round-1 C4) — OUT of L1 scope.** L1 verifies
  the runner-reported executed STATUS of a stable id set; it does NOT verify the body still asserts
  anything. A purely-additive `return`/`pass`/`expect.assertions(0)` before the assertions, an
  emptied JS callback, or a `conftest`/monkeypatch hook that no-ops a callable leaves the same id
  reported `passed` — L1 passes it. **No deterministic gate catches this** (plan §4, R11). It stays
  with L0 deleted-line/surface-watch (catches the in-place `-`-line and conventionally-named helper
  edits) + reviewer + mutation testing. The spec does NOT claim L1 proves tests "do work."
- **Id-churn blast radius (round-1 M8) — the dominant false-positive cost.** Because L1 uses exact
  id matching with NO fuzzy/rename heuristic, ordinary refactors that rename or re-parametrize
  tests trip `executed_set_shrink` and force a depth-0 override. This is a deliberate honesty/safety
  tradeoff (fuzzy matching would let a malicious rename-then-gut hide a removal). It is the explicit
  reason L1 ships **`warn` by default** and `block` is per-project opt-in for `/l5`.
- **Block-mode override HONORING is DEFERRED, not shipped-with-residual (round-3 ruling C —
  REPLACES the v3 framing).** v3 proposed shipping block-mode override with a documented residual;
  the round-3 reviewer RULED against that. v4 ships **detection + `warn` + block-mode hard-fail on a
  shrink** (all fail-safe), and **defers HONORING a block-mode override** until a worker-containment
  mechanism stronger than "original pgid is empty" lands (§8.3.4 session/process-tree or cgroup
  containment + its proof). Rationale: the override verdict channel is forgeable by a live same-user
  worker, and the `--assert-worker-dead` pgid pre-check does NOT close the gap (a `setsid`-escaped
  descendant survives it — §8.3.2). Honoring a forgeable waiver would mislead an opt-in block-mode
  user into reading it as enforcement-grade. **Refusing it is fail-SAFE** (un-exploitable; only
  inconveniences a legitimate retirement in opt-in block mode → user fixes the test or uses `warn`).
  The verdict-verification code (digests, channels, pgid pre-check) is built and exercised in `warn`
  mode + structural tests, but **inert in block mode** until containment lands. A **live same-user
  shell worker** racing the channel is **out of threat model** — no local mechanism defeats it.
- **No dependency install (§3)** — projects whose tests can't run without an install step report
  `collection_failed`/`runner_missing`, not a verdict on shrinkage. Documented, not silent.
- **Non-determinism / flaky tests** — a test that flakily errors at head could look "dropped." L1
  treats `error`/`fail` as executed (so a flaky *failure* is not a shrink); only a status flip to
  skip/absent is a shrink. Genuinely flaky *collection* (random skips) is a known false-positive
  source → `warn` default + depth-0 override.
- **Runners not covered in v1**: Java (JUnit/Maven/Gradle), cargo, rspec, playwright/cypress e2e,
  bats. Detection may emit `unavailable` for them; L0 still applies. Adding a runner = a new
  detection row + collection command + id/status mapping, following the §A/§B/§C template. These
  were NOT installed locally (§0) and would need empirical confirmation `[NC]` before shipping.
- **Monorepo sharding** (jest `projects`, go multi-module, pytest multiple rootdirs) — v1 runs the
  default discovery from the repo root; sharded configs are a best-effort limitation.
- **Test execution side effects** — running the suite (not collecting) can touch external state;
  accepted as the cost of observing run-time skips. Sandbox/network-isolated CI is the safer host
  for `block` mode.

---

## 11. Implementer guardrails (anti-guess summary)

The mechanical implementer (`gpt-5.3-codex-spark`) MUST NOT:
- substitute `--collect-only`/`--listTests`/`-list` for a real run (§A.2/§B.2/§C.2 — collect-only
  misses runtime skips; verified);
- use `xunit2`/default junit family for pytest (drops `file`; use `legacy` — §A.2);
- use absolute report paths as ids (must relativize to worktree root — §B.3);
- store the override inside the tree, trust an untracked verdict file, or **honor a `refs/qc/*` ref
  that existed before depth-0's quarantine** (§8.3.3 — a worker can plant it; quarantine-then-write
  is mandatory);
- **honor a block-mode override/waiver in v4 (round-3 ruling C)** — block-mode override HONORING is
  DEFERRED; a block-mode shrink hard-fails regardless of any verdict until §8.3.4 descendant
  containment + its proof lands. Wire the verdict machinery as **inert in block mode**, active only
  in `warn` (§8.3.0);
- **treat an empty `--assert-worker-dead <pgid>` as containment** — it is a cheap fail-closed
  pre-check that a `setsid`-escaped descendant DEFEATS (§8.3.2); pgid-empty ≠ contained;
- **assert the worker is dead as a gate-provable property** — it is a CALLER precondition
  (§8.3.1); the gate may only RE-CHECK the pgid via `--assert-worker-dead <pgid>` (fail-closed on a
  survivor) and must NOT claim that proves containment (round-2 C1 + round-3, §8.3.2);
- claim L1 proves tests "actually execute meaningful work" — it proves runner-reported executed
  STATUS only (§1/§10 — C4);
- fuzzy-match renamed/re-parametrized ids (exact match only; churn = drop — §D.2);
- waive `protected_path_touch`/`malformed_config`/`git_error`, or honor a shrink waiver whose
  `dropped_digest` doesn't match the current run (§8.6/§8.7);
- digest a **newline-joined** id list — it is non-injective; use the §8.5.1 canonical-JSON encoding
  (round-2 N1);
- disambiguate jest duplicate ids with `line` alone — append **line+column** then re-check, else
  `ambiguous_ids` (round-2 N2);
- probe pytest with `command -v pytest` — the probe MUST be the collector command
  `python3 -m pytest --version` (round-2 N3);
- inherit the parent env into a collector (must scrub per §3 — M5);
- digest only the changed-path list instead of `git diff -M --raw --full-index -z` content+modes
  (§8.5 — C2);
- install dependencies, leak a worktree, or skip the SIGTERM-pgroup timeout cleanup (§2/§3);
- change any existing L0 field, flag, or exit-code meaning (§5/§6 — strictly additive).
And MUST verify every runner flag against a live tool at impl time, re-running the §0 probes for any
runner marked `[NC]` (notably vitest `--testLocationInResults` and any not-installed runner).

---

## 12. Review history

### Round 1 — gpt-5.5 xhigh, verdict FIX-THEN-SHIP (2026-06-26)
All findings resolved in v2. Mapping finding → resolution:

| # | Finding | Resolution |
|---|---------|------------|
| 🔴 C1 | `refs/qc/*` FORGEABLE — dispatch-hetero uses a linked worktree sharing the ref namespace; same-user shell worker can `git update-ref` it; on-disk HMAC also worker-readable | **v2:** §8.2 admitted the false claim (forgery verified [V]); rebuilt on teardown-ordering + ref quarantine. **⚠️ This v2 fix was only PARTIAL — see round-2 C1 below, which found the teardown-ordering invariant is NOT enforced by the real dispatcher and superseded it.** |
| 🔴 C2 | `range_digest` content-insensitive & not base-bound | **§8.4/§8.5:** verdict now embeds `base_sha/head_sha/base_tree/head_tree` + a `changeset_digest` over `LC_ALL=C git diff -M --raw --full-index -z <base>..<head>` bytes (full blob SHAs + modes — content+base bound). Exact command + NUL/ordering specified, verified [V]. Renamed from "path-list digest." |
| 🔴 C3 | runner-disappeared self-contradiction (§1 "both sides" vs §7 "base-only requires override") | **§1 invariant rewritten:** DETECTION always runs both sides; COLLECTION only where marker+tool; base-present/head-absent ⇒ `runner_disappeared` violation **from detection alone, no head collection**. §4.1 matrix + §7 table made consistent. |
| 🔴 C4 | overclaims tests "actually execute" — additive body weakening passes | **§1 honest-scoping note + §10:** L1 verifies runner-reported executed STATUS of a stable id set, NOT that bodies do work. green-but-meaningless explicitly OUT of scope (L0 surface-watch + reviewer + mutation). §11 forbids the overclaim. |
| 🟠 M1 | waiver too coarse (one `{runner,kind}` waives every dropped test) | **§6 + §8.4/§8.6:** added `dropped_digest` (sha256 of sorted dropped[]); a shrink waiver is honored only if its `dropped_digest` matches the current run's exact dropped set. |
| 🟠 M2 | duplicate normalized ids collapse real tests | **§A.3 + §B.3 + §B.2:** jest `--testLocationInResults` (verified [V]) appends line to disambiguate; vitest location support [NC] → `collection_failed reason:ambiguous_ids` if absent; pytest duplicate guard too. |
| 🟠 M3 | nonzero-exit semantics ambiguous (red tests vs broken runner) | **§D.1 decision table** keyed on report-parseable + failure-class. Decision: **head TEST failures (red) are OUT of L1 scope** (still executed); only shrink/broken-runner fail. |
| 🟠 M4 | detection conflates marker presence with tool availability | **§4 split into `marker_present` + `tool_available`; §4.1 status matrix** for every base/head/tool combination; both reported in `l1_runners[]`. |
| 🟠 M5 | ambient env can alter runner selection | **§3 scrubbed-env block:** unset `PYTEST_ADDOPTS/GOFLAGS/NODE_OPTIONS/JEST_*/VITEST_*/npm_config_*`, set `CI=1/LC_ALL=C/TZ=UTC`, preserve PATH/HOME/module-cache; `env_scrubbed:true` recorded. |
| 🟠 M6 | "prefer vitest" hides a jest→vitest runner switch | **§4.2:** jest and vitest are INDEPENDENT families — both detected → both run → both must pass; a disappearing JS family is `runner_disappeared`. |
| 🟠 M7 | pytest path/id normalization under-specified for real rootdirs | **§A.2/§A.3:** invoke with cwd=worktree root + `--rootdir=.`; require `testcase@file` under the worktree root (POSIX-relative) else `collection_failed reason:unstable_ids`. |
| 🟠 M8 | param/rename id churn trains reflexive overrides | **§D.2 explicit policy:** no fuzzy matching, any id churn = drop requiring override; **§10 names it the dominant false-positive cost** justifying the `warn` default. Acceptance cases added. |
| 🟡 m1 | `--l1-worktree-dir` can violate isolation | **§5:** realpath must be outside repo (reject symlink-into-repo, exit 2), 0700 child, remove only gate-created children. |
| 🟡 m2 | JSON example `::::` + nonexistent "§7.4" ref | **§6:** example fixed to `tests/x_test.py::TestG::test_a`; section refs corrected to §8.5/§8.6. |

**Empirical-ledger honesty (per coordinator instruction):** new claims verified in this round are
marked **[V]** (the worktree ref-forgery attack, the `git diff --raw --full-index` digest input,
jest `--testLocationInResults`); claims NOT re-run are marked **[NC]** (vitest per-test location
field). No fabricated [V].

**Residual tension flagged after round 1 (superseded by round 2):** the §8.3 trust model rested on a
teardown-ordering guarantee. Round 2 found the real dispatcher does NOT provide it — see below.

### Round 2 — gpt-5.5 xhigh, verdict FIX-THEN-SHIP (2026-06-26)
10 of 12 round-1 findings confirmed RESOLVED (C2, C3, C4, M3–M8, m1, m2). 4 items fixed in v3:

| # | Finding | Resolution |
|---|---------|------------|
| 🔴 C1 (still PARTIAL) | v2's teardown-ordering invariant is NOT enforced by the REAL dispatcher. Verified [V] by reading `scripts/dispatch-hetero.sh`: worker runs as a plain subshell (line 144, **no pgroup**); the `trap` is INT/TERM-only and cleared right after the run (lines 140/172, **never reaps children on normal exit**); failure/no_op/dirty/question_suspected paths **KEEP the worktree** (lines 199/204/219/223/228). ⇒ a worker can `setsid` a background process that **re-plants `refs/qc/*` AFTER quarantine, before the gate reads** (TOCTOU). v2's "as dispatch-hetero already does (pgroup)" was FALSE. | **§8.2 corrected** with the verified dispatcher facts. **§8.3 fully reframed** from an asserted invariant to a **depth-0 CALLER-CONTRACT + gate-verifiable precondition + honest residual + named dispatch dependency:** (1) caller precondition `WORKER-DEAD-AND-VERIFIED` (§8.3.1: reap pgroup → `pgrep -g` empty); (2) gate-side `--assert-worker-dead <pgid>` (§8.3.2/§5) — if any live pgroup process remains the gate **REFUSES the verdict** fail-closed (the v3 "honored under unverified precondition" path was later RETRACTED by round-3 ruling C — block-mode honoring is deferred, §8.3.0); (3) §8.3.3 quarantine kept (necessary, not sufficient); (4) §8.3.4 names the REQUIRED `dispatch-hetero.sh` hardening (own-pgroup + reap-on-all-exit-paths) as a **separate** dependency, not fixed here; §8.3.6 makes a **depth-0-only filesystem verdict path** (`--l1-verdict-file`, OUTSIDE repo/`.git`) the primary channel with the ref-blob as equivalent — explicitly stating NEITHER is forgery-proof against a live worker; only the verified-dead precondition is. Residual restated in §10. |
| 🟠 N1 | `dropped_digest` newline-join is non-injective (ids can contain `\n`) | **§8.5.1:** digest over a **canonical JSON array** (`json.dumps(sorted_ids, ensure_ascii=True, separators=(",",":"))`, `LC_ALL=C` byte-sort) of the ids — `ensure_ascii` escapes embedded newlines, removing delimiter ambiguity. §6/§8.6 updated; rule applies to ANY id-list digest input (display strings stay display-only). |
| 🟠 N2 | jest dup-id repair collapses SAME-LINE duplicates (line alone) | **§B.3:** append BOTH `line` AND `column` from `--testLocationInResults` (gives `{line,column}`, verified [V]), then **re-check**; any remaining duplicate ⇒ `collection_failed reason:ambiguous_ids`. Acceptance case added. |
| 🟡 N3 | pytest tool probe (`command -v pytest`) disagrees with mandated `python3 -m pytest` | **§4:** `tool_available` probe is now EXACTLY `python3 -m pytest --version` (the §A.2 collector command); resolved interpreter/version recorded in `l1_runners[].pytest_interp`. |

**Empirical-ledger honesty (round 2):** the dispatcher facts in §8.2 are **[V]** (read
`scripts/dispatch-hetero.sh` directly this round — no pgroup, INT/TERM-only trap cleared post-run,
worktree-kept on non-success paths); jest `{line,column}` from `--testLocationInResults` is **[V]**
(probed round 1). New `--assert-worker-dead`/`pgrep -g` mechanics are **design**, not yet
empirically harness-tested — to be validated by the §9 acceptance harness at impl time. vitest
location field remains **[NC]**. No fabricated [V].

**Residual tension a future reviewer should still scrutinize (raised after round 2 — RULED ON in
round 3 below):** the override's block-mode trust depends on a not-yet-shipped dispatch hardening; the
question of "ship block-mode override with a residual vs defer it" was escalated and the round-3
reviewer ruled to DEFER (Option C). See the round-3 block.

### Round 3 — gpt-5.5 xhigh, verdict FIX-THEN-SHIP + RULING on the escalated tension (2026-06-26)
N1/N2/N3 confirmed RESOLVED ✓; §8.2 citations accurate; still strictly-additive to L0. The reviewer
RULED on the open override tension and surfaced one 🔴 + one 🟡 disclosure. Resolved in v4 (a
scoping + honesty pass — no new design invention):

| # | Item | Resolution |
|---|------|------------|
| ⚖️ RULING (Option C) | Ship L1 detection + warn now; do NOT honor block-mode OVERRIDES until a containment mechanism stronger than "original pgid empty" lands. Block-mode override-honoring REQUIRES that stronger containment proof. | **New §8.3.0 "Shipping posture"** bakes it in: SHIPS = detection + `warn` + block-mode **hard-fail on a shrink** (all fail-safe); DEFERRED = HONORING a block-mode override (the verdict machinery is built but **inert in block mode** until §8.3.4 lands; a block-mode shrink hard-fails, user fixes the test or uses `warn`). Stated as fail-SAFE: refusing a forgeable waiver is un-exploitable; default `warn` means deferral touches only opt-in block users. §9 acceptance + §10 residual + §11 anti-guess + status line all updated to ruling C. |
| 🔴 NEW | `--assert-worker-dead <pgid>` is insufficient: a worker can `setsid`/daemon into a NEW pgroup/session BEFORE teardown, then re-plant AFTER the pgid check passes — an escaped descendant the sweep misses. v3 cited the attack shape but didn't disclose the proposed check misses it. | **§8.3.2 DISCLOSES** pgid-emptiness ≠ containment (escaped-descendant survives) → the flag is a cheap fail-closed pre-check, NOT the guarantee. **§8.3.4 STRENGTHENED** to real descendant containment: run the worker in its own **session** (`setsid`), reap by **session/process-tree sweep + re-scan to prove no descendant survives** (or cgroup); "kill the pgid" is explicitly insufficient; the gate must be handed the **containment proof** (not an empty pgid) to re-enable block-mode honoring. §8.3.3 + §8.3.6 TOCTOU wording reconciled (pgid pre-check NARROWS, does not CLOSE). |
| 🟡 NEW | pgid REUSE: OS may recycle a pgid (false-alive → spurious refusal) or a reparented child runs under a new pgid (false-dead → the escaped-descendant hole). | **§8.3.2 + §10 DISCLOSE both:** false-alive ⇒ spurious override-refusal (annoyance, fail-CLOSED, not unsafe); false-dead ⇒ exactly the escaped-descendant gap (why pgid alone is insufficient), closed only by §8.3.4. |

**Empirical-ledger honesty (round 3):** the §8.2 dispatcher facts remain **[V]** (read this session
across rounds 2–3). The §8.3.4 **session / process-tree / cgroup containment mechanics are DESIGN —
NOT yet implemented or tested, NOT `[V]`**; likewise the `--assert-worker-dead` pgid pre-check and
the escaped-descendant scenarios are design-level, to be validated by the §9 acceptance harness at
impl time. vitest location field remains **[NC]**. No fabricated [V].

**Convergence status:** v4 = CONVERGED pending re-confirm. The remaining open work is a **named
external dependency**, not a spec defect: `dispatch-hetero.sh` descendant-containment hardening
(§8.3.4) must land before block-mode override honoring can be re-enabled. Everything that ships in v4
(detection + warn + block-hard-fail) is fail-safe and carries no trust dependency.
