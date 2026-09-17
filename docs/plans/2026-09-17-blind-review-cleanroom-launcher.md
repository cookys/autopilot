# Blind review redesign — cut 1b-A: a cleanroom launcher, and `dispatch-review.sh` learns seat tiers

> Status: draft for plan hetero loop · Size: L · Base: `ceb7c81d` (v2.36.61) · Parent plan:
> `docs/plans/2026-09-16-blind-review-packet.md` §7 item 3 (this is the first half of "1b"; the
> intake/resolver half is 1b-B, §7 below). Evidence dir:
> `docs/plans/evidence/2026-09-17-blind-review-cleanroom-launcher/` (`bwrap-probe-2026-09-17.md` = the
> no-model probe run before this plan; `base-suites-<base>.txt` = §4.1 at base, detached checkout).

## 0. What is actually true today (verified 2026-09-17, base `ceb7c81d`)

- Blind mode is still a runner allow-list: `scripts/dispatch-review.sh:290-295` refuses every runner
  outside `qoderclicn|cc-shim|claude-native|anthropic-compatible` when `AUTOPILOT_BLIND_DISCOVERY=1`;
  `src/engine/final-panel-qualification.js` `BLIND_DISCOVERY_CAPABLE_RUNNERS` is the canonical copy,
  `campaign-intake.js:1423` refuses other seats at intake (`final_panel_seat_blind_incompatible`),
  `resolve-review-loop.sh:2113-2133` mirrors the set as a ⚠, and `dispatch-review.test.sh:1091-1125`
  is the parity test. So a tool-capable seat (codex) cannot sit on a managed panel at all.
- Since v2.36.61 every managed review is packet-backed: `src/runners/review.js` builds
  `<blindCwd>/packet/{tree,diff.patch,spec.md,MANIFEST.json}` and launches `dispatch-review.sh` with
  cwd = the blind dir and env `AUTOPILOT_BLIND_DISCOVERY=1`, `AUTOPILOT_REVIEW_PACKET_DIR`,
  `AUTOPILOT_REVIEW_PACKET_HASH`; `dispatch-review.sh` reads NONE of the packet variables (only the
  rewritten `--diff-file`/`--spec-file` paths). The packet tree is exactly what a cleanroom seat
  should be allowed to see, and it already exists at launch time.
- The codex path (`dispatch-review.sh:942-972`) runs `codex exec --model … --sandbox read-only -c
  model_reasoning_effort=…` with the prompt on stdin, captures `CODEX_OUT`/`CODEX_ERR`, appends both
  to `RAW_LOG`, fails closed on non-zero rc before the parser (`emit_no_verdict`), and sets
  `PARSE_INPUT="$CODEX_OUT"`. `timeout "$TIMEOUT"` is the wall cap; `wait_output_quiescent` settles.
- Host probe (this session, `bwrap-probe-2026-09-17.md`; bubblewrap 0.11.1, kernel
  `unprivileged_userns_clone=1`, `apparmor_restrict_unprivileged_userns=1` with the distro
  `bwrap-userns-restrict` profile): a stub inside `bwrap --unshare-all --share-net --die-with-parent
  --clearenv` with `/usr`, `/etc/resolv.conf`, `/etc/ssl` ro-bound, a two-line `/etc/passwd`, `/proc`,
  `/dev`, `/tmp` tmpfs and ONLY the seat dir bound at `/home/review` gets `DENIED` on the host repo,
  `~/.codex/auth.json`, a sibling seat dir and `/etc/hostname`; `/home` lists `review` only; `/proc`
  holds 4 pids; **`/proc/1/cmdline` still shows the bwrap argv** (host paths) — an exec wrapper
  removes that. `codex exec` under a sanitized `CODEX_HOME` (only `auth.json` + a two-line
  `config.toml`) with `--ignore-user-config` authenticates (probed: the request reached the quota
  gate), and codex WRITES into `CODEX_HOME` (`sessions/`, `*.sqlite`, `shell_snapshots/`, `plugins/`,
  `cache/`) — the seat HOME must be writable and thrown away. The 2026-09-16 probe showed
  `--sandbox read-only` cannot nest inside bwrap (needs its own userns) while `--sandbox
  danger-full-access` works because the outer boundary is the sandbox; `codex-code-mode-host` must
  sit next to `codex` (bind the whole release `bin/`).
- codex usage quota is exhausted until 2026-09-19 16:26; a live codex-in-cleanroom review cannot be
  run during this cut. Everything this plan claims is provable without a model call.
- Test convention: `hooks/tests/run.sh` discovers every `hooks/tests/*.test.sh`; suites that need a
  live/host resource gate themselves on an env variable and print `SKIP:` + `finalize_test` when it
  is unset (`dispatch-plan-review-live.test.sh:3-10`). CI runs `run.sh --parallel` on GitHub Ubuntu
  runners, where unprivileged userns is AppArmor-restricted.

## 1. Ruling and shape

1. **Seat tiers replace the allow-list in `dispatch-review.sh`.** A runner belongs to exactly one
   tier, decided by name, no new config: `packet` = `anthropic-compatible cc-shim claude-native
   qoderclicn` (prompt-only, runs as today); `cleanroom` = `codex` (tool-capable, runs inside the
   launcher); `none` = every other runner (`agy grok kimi cursor opencode`). A shell function
   `review_seat_tier <runner>` prints the tier; it is the ONLY place the table lives in the script
   (the JS/resolver copies move in 1b-B — this cut does not touch them, §3). Under
   `AUTOPILOT_BLIND_DISCOVERY=1`: `packet` → unchanged path; `none` → the existing
   `die_precondition` (message unchanged: `blind review requires an enforceable no-tools runner
   profile (got: <runner>)`); `cleanroom` → the launcher path (§1.2). Without
   `AUTOPILOT_BLIND_DISCOVERY=1` nothing changes for any runner (the codex `--sandbox read-only`
   block stays byte-identical and is what non-blind codex reviews still use).
2. **Cleanroom preconditions fail closed BEFORE any spend.** A `cleanroom` seat under blind mode
   requires, in this order, each a `die_precondition` (exit 2 → the engine records
   `precondition_failed`, no model call): `AUTOPILOT_REVIEW_PACKET_DIR` set and
   `<dir>/tree` + `<dir>/MANIFEST.json` present (a cleanroom seat never runs on the legacy copy);
   `bwrap` resolvable on `PATH` (or `AUTOPILOT_CLEANROOM_BWRAP=<path>`); the runner binary resolves to
   a real file and its directory is the release `bin/` to bind; a credential source
   (`AUTOPILOT_CLEANROOM_CODEX_AUTH` or `$CODEX_HOME/auth.json` or `~/.codex/auth.json`) exists and
   is a regular file. Then `scripts/lib/cleanroom-launch.sh` is invoked. Test seam:
   `AUTOPILOT_CLEANROOM_LAUNCHER=<path>` replaces the launcher script (same role as `--bin`), so the
   portable suite pins the gate order and the argument shape without `bwrap`.
3. **`scripts/lib/cleanroom-launch.sh` (NEW, + mirror) is the one isolation launcher.** Contract
   (argv, no globals): `cleanroom-launch.sh --profile codex --packet-dir <packet> --prompt-file <f>
   --out <stdout capture> --err <stderr capture> --timeout <Ns|Nm> --model <m> --effort <e>
   --bin-dir <release bin dir> --auth-file <auth.json> [--bwrap <path>] [--seat-root <dir>]`. It:
   - creates a private seat root (`mktemp -d`, `0700`; `--seat-root` for tests) with `home/`
     (`.codex/auth.json` copied `0600`; `.codex/config.toml` WRITTEN by the launcher: exactly
     `model = "<m>"` and `model_reasoning_effort = "<e>"` — no `[projects.*]`, no MCP, no
     `history.jsonl`), `work/` (empty mount point), `bin/` holding a wrapper `codex` whose only
     content execs `/home/review/bin.real/codex "$@"`, `passwd` (two lines: `review` and `nobody`),
     and `prompt` (the prompt bytes, `0400`);
   - runs `timeout <T> bwrap --unshare-all --share-net --die-with-parent --new-session --hostname
     review --ro-bind /usr /usr --symlink usr/lib /lib --symlink usr/lib64 /lib64 --symlink usr/bin
     /bin --ro-bind /etc/resolv.conf /etc/resolv.conf --ro-bind /etc/ssl /etc/ssl
     --ro-bind-try /etc/ca-certificates /etc/ca-certificates --ro-bind <seat>/passwd /etc/passwd
     --proc /proc --dev /dev --tmpfs /tmp --bind <seat>/home /home/review --ro-bind <packet>/tree
     /home/review/work --ro-bind <seat>/prompt /home/review/prompt --ro-bind <seat>/bin
     /home/review/bin --ro-bind <bin-dir> /home/review/bin.real --clearenv --setenv HOME
     /home/review --setenv CODEX_HOME /home/review/.codex --setenv PATH /home/review/bin:/usr/bin
     --setenv TERM dumb --chdir /home/review/work -- codex exec --model <m> --sandbox
     danger-full-access --skip-git-repo-check --ignore-user-config -c
     model_reasoning_effort="<e>" --output-last-message /home/review/last-message` with the prompt on
     stdin (`< <seat>/prompt`), stdout → `--out`, stderr → `--err`. `--sandbox danger-full-access` is
     legal ONLY here: the bwrap boundary is the sandbox (probe 2026-09-16; nested `read-only` cannot
     create its userns). Nothing under the operator HOME, the repository, `.autopilot`, `/tmp` of the
     host or a sibling seat is bound; the network stays on (model transport).
   - exit code = the inner exit code (124 from `timeout` passes through untouched); prints one JSON
     line on ITS stdout `{ "schema_version": 1, "artifact_type": "cleanroom_launch", "profile":
     "codex", "exit_status": <n>, "timed_out": <bool>, "seat_root_removed": <bool> }`; removes the seat
     root on EXIT (trap) — `--keep-seat` keeps it for the isolation suite. It never reads the
     repository, never writes outside the seat root and the two capture files.
   - `--profile` accepts only `codex` in this cut; any other value exits 2 with `unsupported
     cleanroom profile`. `--preflight` (used by 1b-B's intake probe, exposed now so the isolation
     suite exercises the same code): instead of the runner it execs a bundled POSIX probe script
     inside the identical boundary that attempts to read a caller-given list of host paths
     (`--deny-path <p>`, repeatable) and asserts `/proc/1/cmdline` starts with `/home/review/bin/` — exit
     0 only when every read is denied and the argv is clean; exit 3 otherwise with the first
     offending path on stderr.
4. **`dispatch-review.sh` cleanroom path.** After the preconditions: `CODEX_OUT`/`CODEX_ERR` as
   today; the launcher is called with the seat's `--model`, `--effort` (codex vocabulary as the
   existing block maps it), `--timeout "$TIMEOUT"`, the packet dir, the prompt file, and the bin dir
   of the resolved codex binary; its JSON line is appended to `RAW_LOG` after the stdout/stderr
   sections (same three-part raw log shape as the existing block, plus a fourth
   `--- cleanroom launch ---` section); non-zero exit → the existing fail-closed
   `emit_no_verdict` with reason `cleanroom codex exited non-zero (rc=<n>)`; `PARSE_INPUT="$CODEX_OUT"`
   so the shared parser, leak scan, proof checks and `--timeout` semantics are unchanged. The prompt
   is the same prompt file the packet-tier path builds (diff as text + spec + nonce protocol) — a
   cleanroom seat gets the tree in addition, never instead.
5. **The isolation suite is host-gated, and when invoked it refuses rather than skips.**
   `hooks/tests/cleanroom-launch.test.sh` (NEW, `test -x`): when `AUTOPILOT_HOST_ISOLATION` is unset
   → `SKIP: set AUTOPILOT_HOST_ISOLATION=1 …` + `finalize_test` (the live-suite idiom; CI stays
   green); when set → `bwrap` missing or `--preflight` failing is a FAIL, never a skip. It plants a
   hostile stub as the "codex" binary (`--bin-dir` pointing at a dir whose `codex` is a shell script)
   and runs the REAL launcher: (a) the stub tries to read the real repository root, the operator
   HOME, `$CODEX_HOME/auth.json`, a planted sibling seat file, `/etc/hostname`, the packet's host
   path and `/proc/1/cmdline`; every read is denied (`cat` fails) except the packet tree, which it
   reads byte-equal, and `/proc/1/cmdline` starts with `/home/review/bin/codex` (RED at base:
   launcher absent); (b) the stub sleeps past `--timeout 2s` → launcher exit 124, JSON `timed_out:
   true`, seat root removed; (c) the stub writes into `/home/review/.codex` and `/tmp` → succeeds, and
   nothing appears outside the seat root on the host; the seat root is gone after exit; (d) the
   stub's stdout/stderr land byte-equal in `--out`/`--err`; (e) `--preflight --deny-path <repo>
   --deny-path <home>` exits 0 on this host, and with `--bwrap /nonexistent` exits 2 (never 0) with a
   named message; (f) two launchers run concurrently with `--keep-seat`: each stub tries the other's
   seat root → denied. This suite is in this host's `verification_commands` with the env set; it is
   NOT in CI's job.
6. **Portable tests in `hooks/tests/dispatch-review.test.sh`** (no bwrap; `AUTOPILOT_CLEANROOM_LAUNCHER`
   stub): blind codex without `AUTOPILOT_REVIEW_PACKET_DIR` → exit 2 `cleanroom seat requires a review
   packet`; with a packet dir but `AUTOPILOT_CLEANROOM_BWRAP=/nonexistent` → exit 2 naming bwrap;
   with a stub launcher: it receives `--profile codex`, `--packet-dir <the env dir>`, `--timeout
   <the --timeout value>`, `--model`, `--effort`, a `--bin-dir` that contains the resolved binary,
   `--auth-file`, and its stdout capture is what the parser reads (stub writes a framed
   `VERDICT: SHIP-AS-IS` into `--out` → `status: reviewed`); stub exit 124 → `status: no_verdict`
   with the cleanroom reason and rc in `raw_log`; the launcher JSON line is present in `raw_log`; a
   `none`-tier runner (grok) under blind mode still gets the unchanged message (preservation); codex
   WITHOUT blind mode still runs the `--sandbox read-only` block byte-identically (preservation: the
   existing stub tests at `:720-770` keep passing). The existing parity test (`:1091-1125`) keeps
   the JS set as-is: it asserts only that the four packet-tier runners reach the stub — extend it
   with "codex under blind mode with a stub launcher reaches the LAUNCHER, not the binary".
7. **Nothing else moves.** `final-panel-qualification.js`, `campaign-intake.js`,
   `resolve-review-loop.sh`, `review.js`, `review-packet.js`, the engine, schemas and pins are
   byte-identical to `ceb7c81d` (intake still refuses a codex seat — 1b-B lifts that). No new CLI
   flag on `dispatch-review.sh`; new env variables only (`AUTOPILOT_CLEANROOM_LAUNCHER`,
   `AUTOPILOT_CLEANROOM_BWRAP`, `AUTOPILOT_CLEANROOM_CODEX_AUTH`, `AUTOPILOT_HOST_ISOLATION`), all
   documented in the script header.

## 2. Changes by file

- `scripts/lib/cleanroom-launch.sh` (NEW, + mirror `platforms/codex/plugin/scripts/lib/…`): §1.3.
  Bash, `set -euo pipefail`, no `jq`/`python`; JSON via `lib/json-emit.sh`. Header documents the
  boundary, the env variables, exit codes (0 inner ok / inner rc passthrough / 2 usage or
  precondition / 3 preflight denied-read failure / 124 timeout).
- `scripts/dispatch-review.sh` (+ mirror): §1.1 `review_seat_tier`, the blind gate at `:290-295`
  becomes a tier switch; §1.2 preconditions; §1.4 launch block inserted as the first branch of the
  codex `if` (`if [[ "$RUNNER" = codex && blind ]]`), the existing block unchanged after it; header
  USAGE gains the env variables and the tier table.
- `hooks/tests/cleanroom-launch.test.sh` (NEW, `test -x`): §1.5.
- `hooks/tests/dispatch-review.test.sh`: §1.6 (each change-pinning block `# RED at base ceb7c81d:
  <observed message>`; preservation guards labelled).
- Docs: `references/blind-dispatch.md` (+ mirror) new section "Cleanroom tier (v2.36.62)" after
  "Packet blinding": tiers, the boundary in one list, what is and is not proven this cut (no live
  codex run until quota returns), pointer to 1b-B; `docs/scripts-inventory.md` one row for the
  launcher; `CLAUDE.md` Dispatch rails group gains `lib/cleanroom-launch.sh`
  (`check-claude-md-inventory.js` enforces it); `docs/BACKLOG.md` redesign row Context becomes
  EXACTLY `packet (tree + git diff + spec, deny-list); packet/cleanroom tiers; intake canary;
  verify-once; parallel seats. 1a-A (v2.36.59), 1a-B (v2.36.61), 1b-A launcher (v2.36.62) shipped;
  1b-B intake/resolver, 2 open. Detail in the pointer.` (Status `open`). `CHANGELOG.md` and version
  manifests NOT sealed (depth-0 release commit; `v2.36.62` in text is a pin).

### 2.5 Sealed `output_paths` (exact)

```
scripts/lib/cleanroom-launch.sh
platforms/codex/plugin/scripts/lib/cleanroom-launch.sh
scripts/dispatch-review.sh
platforms/codex/plugin/scripts/dispatch-review.sh
hooks/tests/cleanroom-launch.test.sh
hooks/tests/dispatch-review.test.sh
references/blind-dispatch.md
platforms/codex/plugin/references/blind-dispatch.md
docs/scripts-inventory.md
CLAUDE.md
docs/BACKLOG.md
```

Created (`authorized_creates`): the launcher, its mirror, `hooks/tests/cleanroom-launch.test.sh`.
Every other path exists at base. `max_changed_files` is sealed at 14 (> 11).

### 2.6 Global constraints (copied verbatim into every dispatch)

- A cleanroom seat runs ONLY inside `cleanroom-launch.sh`; `--sandbox danger-full-access` appears
  nowhere else; the non-blind codex block keeps `--sandbox read-only` byte-for-byte.
- Preconditions (packet dir, bwrap, binary dir, credential file) fail closed with exit 2 before any
  model process starts; a launcher failure is `no_verdict` with the rc, never a parsed verdict.
- The seat sees: the packet tree (ro), its own writable HOME with one copied credential and a
  launcher-written config, the runtime and TLS/DNS; it does not see the repository, the operator
  HOME, `.autopilot`, host `/tmp`, sibling seats or the host argv.
- No `jq`, no `python`, no `git` in the launcher; Node not required either.
- `src/**`, `schemas/**`, `bin/autopilot.js`, `scripts/resolve-review-loop.sh`,
  `scripts/qualification-review-provider.js` byte-identical to `ceb7c81d`.
- Tests: portable suite uses stubs only; the isolation suite runs only under
  `AUTOPILOT_HOST_ISOLATION=1` and then never skips.

## 3. Out of scope

- **1b-B**: intake `cleanroomProbe` adapter (same `adapters.x || defaultX` shape as `readiness`,
  `campaign-intake.js:1825`) calling `cleanroom-launch.sh --preflight` per cleanroom seat and
  refusing with a new code when the boundary is not enforceable; `final-panel-qualification.js`
  tier table replacing `BLIND_DISCOVERY_CAPABLE_RUNNERS`; `resolve-review-loop.sh:2113-2133` ⚠
  becoming a tier lookup; the parity test extension; the routing fixture at `:3302` (codex is no
  longer "incompatible", it is "cleanroom-unprobed"); codex back on the pinned panel (`pin-seat` after
  a recorded live probe once quota returns 2026-09-19).
- Configurable deny-list: touches `review-loop-contract.schema.json` + resolver + the three-way
  `check-contract-schema` parity; least value, most drift — its own cut after 1b-B.
- Other cleanroom profiles (`grok`, `cursor-agent`, `kimi`, `opencode`): each needs its own probe
  (auth layout, config surface, argv); codex first, as the parent plan says.
- Cut 2 (verify-once, concurrent seats, standby, snapshot).
- Seccomp, `--unshare-net` with a proxy, `/proc/1/cmdline` beyond the wrapper: the residual channel
  is the model transport itself (both consults).

## 4. Acceptance

| id | criterion | evidence |
|----|-----------|----------|
| `tier-gate` | under blind mode: packet-tier runners unchanged; `none`-tier refused with the unchanged message; codex routed to the launcher only after packet dir, bwrap, binary dir and credential preconditions, each refusing with exit 2 and a named message; codex without blind mode byte-identical (`--sandbox read-only`) | dispatch-review suite |
| `launcher-contract` | the stub launcher receives profile, packet dir, timeout, model, effort, bin dir, auth file; its `--out` is what the parser reads; its exit 124 → `no_verdict` with rc in `raw_log`; its JSON line is in `raw_log` | dispatch-review suite |
| `boundary` | through the REAL launcher on this host: host repo, operator HOME, credentials, sibling seat, `/etc/hostname`, packet host path all denied; packet tree readable byte-equal; `/proc/1/cmdline` starts with `/home/review/bin/codex`; writes stay inside the seat root, which is removed on exit; `--timeout` → 124 + `timed_out: true`; two concurrent seats cannot read each other | cleanroom-launch suite (`AUTOPILOT_HOST_ISOLATION=1`) |
| `preflight` | `--preflight --deny-path …` exits 0 on this host; with a missing bwrap exits 2, never 0; with a path that IS readable exits 3 naming it | cleanroom-launch suite |
| `no-regression` | each command in §4.1 exits 0 at the candidate (detached checkout, sequential); same set recorded at base in the evidence dir | suite output + evidence |
| `scope-integrity` | `git diff --name-only <base> HEAD` ⊆ §2.5 plus committed plan/mission docs; `src/**`, `schemas/**`, `bin/autopilot.js`, `resolve-review-loop.sh`, `qualification-review-provider.js` byte-identical; new test file `test -x`; `check-claude-md-inventory.js` passes | command output |

### 4.1 No-regression commands (exact; also the graph's `verification_commands`)

```
bash hooks/tests/dispatch-review.test.sh
AUTOPILOT_HOST_ISOLATION=1 bash hooks/tests/cleanroom-launch.test.sh
bash hooks/tests/review-runner.test.sh
bash hooks/tests/review-packet.test.sh
node scripts/check-js-syntax.js
bash scripts/sync-codex-plugin-skills.sh --check
node scripts/check-claude-md-inventory.js
node scripts/check-backlog-entries.js --backlog docs/BACKLOG.md
```

The second line is host-only by design (this host has `bwrap`); in CI the same suite prints `SKIP`.
Expected exit 0 for every line.

## 5. Dogfood proof (depth-0)

Before merge, on this host: run `cleanroom-launch.sh --profile codex` with the REAL codex binary
against a real packet built from this repo; the expected outcome while quota is exhausted is the
quota error INSIDE the boundary (proving auth was read from the seat HOME and the transport left
the sandbox) with rc≠0 → `no_verdict`, and a seat root that is gone afterwards. Record it in the
evidence dir. The first real verdict from a cleanroom seat is 1b-B's dogfood after 2026-09-19.

## 6. Risks + inversion

- **CI runners cannot create user namespaces.** The isolation suite is env-gated so CI prints
  `SKIP`; this host's `verification_commands` invoke it with the env. Inversion: a host with the env
  set and no working bwrap gets a red suite, which is the truth.
- **codex writes into its HOME.** The seat HOME is writable and discarded; nothing of the operator
  HOME is present to be modified. The suite asserts the host is untouched.
- **Nested sandbox.** `--sandbox danger-full-access` reads badly; it is confined to the launcher
  and the header says why (probe 2026-09-16: `read-only` cannot nest). The portable suite asserts the
  non-blind block never gained it.
- **Argv leak.** Wrapper exec; the suite reads `/proc/1/cmdline` from inside.
- **Quota.** No live codex verdict this cut — the acceptance table does not claim one.
- **Hand scope.** One new lib script + its mirror, one script edit + mirror, two test files, two docs,
  two inventory lines, one BACKLOG line — one round.

## 7. Where this sits

Parent §7: 1a-A ✓ → 1a-B ✓ → **1b-A (this)** → 1b-B (intake/resolver/tier table/codex pin) →
configurable deny-list → 2.

## Review log

- (to be filled by the plan hetero loop)
