# Blind review redesign — cut 1b-A: a cleanroom launcher, and `dispatch-review.sh` learns seat tiers

> Status: draft for plan hetero loop · Size: L · Base: `ceb7c81d` (v2.36.61) · Parent plan:
> `docs/plans/_archive/2026-09-16-blind-review-packet.md` §7 item 3 (this is the first half of "1b"; the
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
  holds 4 pids; **`/proc/1/cmdline` still shows the bwrap argv** (host paths). pid 1 inside the
  namespace is bwrap's own reaper, so a wrapper around the runner cannot clean it; probed instead:
  `bwrap --args 9 -- /bin/sh …` with the options in a NUL-separated file read through fd 9 makes
  `/proc/1/cmdline` exactly `bwrap --args 9 -- /bin/sh /home/review/bin/…` — no host path
  (`bwrap-probe-2026-09-17.md`). Host `/tmp` is on the root fs (`rw,relatime`, not `noexec`), but a
  `noexec` `/tmp` elsewhere would break an exec of a script bound from it, so scripts inside are run
  through `/bin/sh` explicitly. `codex exec` under a sanitized `CODEX_HOME` (only `auth.json` + a two-line
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
   `bwrap` resolvable on `PATH` (or `AUTOPILOT_CLEANROOM_BWRAP=<path>`) AND working: the launcher is
   run once as `--preflight --deny-path <packet host dir>` (no model, milliseconds) and a non-zero
   exit is `die_precondition` naming the runtime (`cleanroom runtime unusable: <first stderr line>`
   — a present bwrap whose user namespaces are blocked by AppArmor is refused here, not turned into a
   `no_verdict` an hour later); the runner binary: `command -v` then `readlink -f`, the resolved file
   must be a regular file and `codex-code-mode-host` must sit beside it (else `codex binary
   directory unresolved: <path>`) — the directory of the resolved file is the release `bin/` to
   bind; a credential source (`AUTOPILOT_CLEANROOM_CODEX_AUTH` or `$CODEX_HOME/auth.json` or
   `~/.codex/auth.json`) exists and is a regular file. Then `scripts/lib/cleanroom-launch.sh` is
   invoked with `--seat-root <blind dir>/seat` (the launcher-controlled dir beside the packet; the
   `mktemp` default is for direct callers). `AUTOPILOT_CLEANROOM_BWRAP` must name a binary the host
   AppArmor policy allows to create user namespaces (header note). Test seam:
   `AUTOPILOT_CLEANROOM_LAUNCHER=<path>` replaces the launcher script (same role as `--bin`), so the
   portable suite pins the gate order and the argument shape without `bwrap`.
3. **`scripts/lib/cleanroom-launch.sh` (NEW, + mirror) is the one isolation launcher.** Contract
   (argv, no globals). Launch mode: `cleanroom-launch.sh --profile codex --packet-dir <packet>
   --prompt-file <f> --out <stdout capture> --err <stderr capture> --timeout <Ns|Nm> --model <m>
   --effort <e> --bin-dir <release bin dir> --auth-file <auth.json> [--bwrap <path>] [--seat-root
   <dir>] [--keep-seat]` (all nine non-bracketed options required). Preflight mode:
   `cleanroom-launch.sh --preflight --deny-path <p> [--deny-path <p>…] [--bwrap <path>] [--seat-root
   <dir>]` — no packet, no prompt, no credential, no binary (intake in 1b-B runs it before any packet
   exists); it mounts an EMPTY `work/` where the tree would be. Both modes print the JSON line. It:
   - creates a private seat root (`mktemp -d -t cleanroom-seat.XXXXXX`, `0700`; `--seat-root` uses
     that path — `dispatch-review.sh` passes `<blind dir>/seat` — a fixed `cleanroom-seat.` prefix so
     an operator can sweep orphans) with `home/` (`.codex/auth.json` copied `0600`;
     `.codex/config.toml` WRITTEN by the launcher: exactly `model = "<m>"` and
     `model_reasoning_effort = "<e>"` — no `[projects.*]`, no MCP, no `history.jsonl`), `work/`
     (empty mount point), `passwd` (two lines: `review` and `nobody`), `prompt` (the prompt bytes,
     `0400`), and `bwrap.args` (the complete bwrap option list, NUL-separated).
   - runs `timeout <T> bwrap --args 9 -- /bin/sh -c 'exec "$0" "$@"' /home/review/bin/codex exec …
     9< <seat>/bwrap.args`, where `bwrap.args` holds `--unshare-all --share-net --die-with-parent
     --new-session --hostname review --ro-bind /usr /usr --symlink usr/lib /lib --symlink usr/lib64
     /lib64 --symlink usr/bin /bin --ro-bind /etc/resolv.conf /etc/resolv.conf --ro-bind /etc/ssl
     /etc/ssl --ro-bind-try /etc/ca-certificates /etc/ca-certificates --ro-bind <seat>/passwd
     /etc/passwd --proc /proc --dev /dev --tmpfs /tmp --bind <seat>/home /home/review --ro-bind
     <packet>/tree /home/review/work --ro-bind <seat>/prompt /home/review/prompt --ro-bind <bin-dir>
     /home/review/bin --clearenv --setenv HOME /home/review --setenv CODEX_HOME /home/review/.codex
     --setenv PATH /home/review/bin:/usr/bin --setenv TERM dumb --chdir /home/review/work`; the
     inner command is `codex exec --model <m> --sandbox danger-full-access --skip-git-repo-check
     --ignore-user-config -c model_reasoning_effort="<e>" --output-last-message
     /home/review/last-message` with the prompt on stdin (`< <seat>/prompt`), stdout → `--out`,
     stderr → `--err`. Every host path lives in the args FILE, so `/proc/1/cmdline` inside is
     exactly `bwrap --args 9 -- /bin/sh -c … /home/review/bin/codex …` (probed 2026-09-17); the
     probe script in preflight mode is likewise run through `/bin/sh` (a `noexec` seat mount cannot
     break it). `--sandbox danger-full-access` is legal ONLY here: the bwrap boundary is the sandbox
     (probe 2026-09-16; nested `read-only` cannot create its userns). Nothing under the operator
     HOME, the repository, `.autopilot`, host `/tmp` or a sibling seat is bound; the network stays on
     (model transport; on a proxied / private-CA host `HTTPS_PROXY`/`HTTP_PROXY`/`NO_PROXY`/
     `SSL_CERT_FILE` are NOT passed through in this cut — a recorded follow-up, §3).
   - the launcher's `timeout` is the ONLY wall cap (`dispatch-review.sh` does not wrap it again); exit
     code = the inner exit code (124 passes through untouched); prints one JSON line on ITS stdout
     `{ "schema_version": 1, "artifact_type": "cleanroom_launch", "profile": "codex"|"preflight",
     "exit_status": <n>, "timed_out": <bool>, "seat_root_removed": <bool>, "seat_root": <path> }`;
     traps `EXIT INT TERM HUP`: removes the seat root (unless `--keep-seat`) and re-raises the signal
     after cleanup. It never reads the repository, never writes outside the seat root and the two
     capture files. Header notes: an orphaned `cleanroom-seat.*` dir after a SIGKILL holds a copied
     credential and must be swept; the copied `auth.json` means a token refresh performed inside a
     seat is discarded (limitation, checked in §5).
   - `--profile` accepts only `codex`; any other value exits 2 with `unsupported cleanroom
     profile`. `--preflight` runs a bundled POSIX probe script (written into the seat root) inside
     the identical boundary: every `--deny-path` must be unreadable (`cat` fails), and
     `/proc/1/cmdline` must contain none of the `--deny-path` strings, the seat root path, or the
     packet/bin host paths (the assertion is "no host path in argv", not a fixed prefix); exit 0 only
     then, 2 when bwrap is missing or cannot start (userns blocked), 3 otherwise with the first
     offending path on stderr.
4. **`dispatch-review.sh` cleanroom path.** After the preconditions: `CODEX_OUT`/`CODEX_ERR` as
   today; the launcher is called WITHOUT an outer `timeout` (its own is the wall cap) with the seat's
   `--model`, `--effort` (codex vocabulary as the existing block maps it), `--timeout "$TIMEOUT"`,
   the packet dir, the prompt file, `--seat-root "$AUTOPILOT_REVIEW_PACKET_DIR/../seat"`, and the bin
   dir of the resolved codex binary; its JSON line is appended to `RAW_LOG` after the stdout/stderr
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
   reads byte-equal, and `/proc/1/cmdline` contains no host path (not the seat root, packet dir,
   bin dir or repository root) — a control run WITHOUT `--args` (plain argv) shows the host paths,
   proving the assertion can fail (RED at base: launcher absent); (b) the stub sleeps past `--timeout 2s` → launcher exit 124, JSON `timed_out:
   true`, seat root removed; (c) the stub writes into `/home/review/.codex` and `/tmp` → succeeds, and
   nothing appears outside the seat root on the host; the seat root is gone after exit; (d) the
   stub's stdout/stderr land byte-equal in `--out`/`--err`; (e) `--preflight --deny-path <repo>
   --deny-path <home>` exits 0 on this host, and with `--bwrap /nonexistent` exits 2 (never 0) with a
   named message, and with a `--deny-path` that IS readable (a file the stub can read because the
   test binds nothing extra — e.g. `/usr/bin/sh`) exits 3 naming it; (f) two launchers run
   concurrently with `--keep-seat`: each stub tries the other's seat root → denied; (g) a stub
   `codex` dir WITHOUT `codex-code-mode-host` → `dispatch-review.sh` exit 2 `codex binary directory
   unresolved` (portable, in the dispatch-review suite). This suite is in this host's `verification_commands` with the env set; it is
   NOT in CI's job.
6. **Portable tests in `hooks/tests/dispatch-review.test.sh`** (no bwrap; `AUTOPILOT_CLEANROOM_LAUNCHER`
   stub): blind codex without `AUTOPILOT_REVIEW_PACKET_DIR` → exit 2 `cleanroom seat requires a review
   packet`; with a packet dir but `AUTOPILOT_CLEANROOM_BWRAP=/nonexistent` → exit 2 naming bwrap; a
   stub launcher whose `--preflight` exits 2 → exit 2 `cleanroom runtime unusable` and the stub was
   never called in launch mode; a codex stub dir lacking `codex-code-mode-host` → exit 2;
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
  launcher; `docs/BACKLOG.md` redesign row Context becomes
  EXACTLY `packet (tree + git diff + spec, deny-list); packet/cleanroom tiers; intake canary;
  verify-once; parallel seats. 1a-A (v2.36.59), 1a-B (v2.36.61), 1b-A launcher (v2.36.62) shipped;
  1b-B intake/resolver, 2 open. Detail in the pointer.` (Status `open`). `CHANGELOG.md` and version
  manifests NOT sealed (depth-0 release commit; `v2.36.62` in text is a pin). `CLAUDE.md` is a
  root-level file and the campaign scope session turns prefixes into `<prefix>/**`, so depth-0 adds
  the `lib/cleanroom-launch.sh` name to the Dispatch rails group in the release commit and runs
  `check-claude-md-inventory.js` there (not in the hand's §4.1).

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
docs/BACKLOG.md
```

Created (`authorized_creates`): the launcher, its mirror, `hooks/tests/cleanroom-launch.test.sh`.
Every other path exists at base. `max_changed_files` is sealed at 14 (> 10).

### 2.6 Global constraints (copied verbatim into every dispatch)

- A cleanroom seat runs ONLY inside `cleanroom-launch.sh`; `--sandbox danger-full-access` appears
  nowhere else; the non-blind codex block keeps `--sandbox read-only` byte-for-byte.
- Preconditions (packet dir, bwrap present AND `--preflight` green, binary dir with
  `codex-code-mode-host`, credential file) fail closed with exit 2 before any model process starts;
  a launcher failure is `no_verdict` with the rc, never a parsed verdict; the launcher's `timeout`
  is the only wall cap.
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
- Seccomp, `--unshare-net` with a proxy: the residual channel is the model transport itself (both
  consults). Proxy / private-CA pass-through (`HTTPS_PROXY`, `HTTP_PROXY`, `NO_PROXY`,
  `SSL_CERT_FILE` via `--setenv` when set on the host) is a recorded follow-up for the first proxied
  host; this host is not proxied. Whether a stale `auth.json` `last_refresh` should be a preflight
  refusal is decided in 1b-B.

## 4. Acceptance

| id | criterion | evidence |
|----|-----------|----------|
| `tier-gate` | under blind mode: packet-tier runners unchanged; `none`-tier refused with the unchanged message; codex routed to the launcher only after packet dir, bwrap-present-and-preflight-green, binary dir (with `codex-code-mode-host`) and credential preconditions, each refusing with exit 2 and a named message; codex without blind mode byte-identical (`--sandbox read-only`); no outer `timeout` around the launcher | dispatch-review suite |
| `launcher-contract` | the stub launcher receives profile, packet dir, timeout, model, effort, bin dir, auth file; its `--out` is what the parser reads; its exit 124 → `no_verdict` with rc in `raw_log`; its JSON line is in `raw_log` | dispatch-review suite |
| `boundary` | through the REAL launcher on this host: host repo, operator HOME, credentials, sibling seat, `/etc/hostname`, packet host path all denied; packet tree readable byte-equal; `/proc/1/cmdline` carries no host path (control without `--args` shows them); writes stay inside the seat root, which is removed on exit and on INT/TERM; `--timeout` → 124 + `timed_out: true`; two concurrent seats cannot read each other | cleanroom-launch suite (`AUTOPILOT_HOST_ISOLATION=1`) |
| `preflight` | `--preflight --deny-path …` (no packet, prompt, credential or binary needed) exits 0 on this host with a `profile: "preflight"` JSON line; with a missing bwrap exits 2, never 0; with a path that IS readable exits 3 naming it | cleanroom-launch suite |
| `no-regression` | each command in §4.1 exits 0 at the candidate (detached checkout, sequential); at base the seven pre-existing commands were green and `cleanroom-launch.test.sh` is recorded as `absent at base (created by this cut)` in the evidence dir | suite output + evidence |
| `scope-integrity` | `git diff --name-only <base> HEAD` ⊆ §2.5 plus committed plan/mission docs; `src/**`, `schemas/**`, `bin/autopilot.js`, `resolve-review-loop.sh`, `qualification-review-provider.js`, `CLAUDE.md` byte-identical; new launcher and test file `test -x` | command output |

### 4.1 No-regression commands (exact; also the graph's `verification_commands`)

```
bash hooks/tests/dispatch-review.test.sh
AUTOPILOT_HOST_ISOLATION=1 bash hooks/tests/cleanroom-launch.test.sh
bash hooks/tests/review-runner.test.sh
bash hooks/tests/review-packet.test.sh
node scripts/check-js-syntax.js
bash scripts/sync-codex-plugin-skills.sh --check
node scripts/check-backlog-entries.js --backlog docs/BACKLOG.md
```

The second line is host-only by design (this host has `bwrap`); in CI the same suite prints `SKIP`.
Expected exit 0 for every line at the candidate. At base the second line's file does not exist
(created by this cut) and the evidence file records it as absent. Depth-0 runs
`node scripts/check-claude-md-inventory.js` after adding the launcher's name to `CLAUDE.md` in the
release commit.

## 5. Dogfood proof (depth-0)

Before merge, on this host: run `cleanroom-launch.sh --profile codex` with the REAL codex binary
against a real packet built from this repo; the expected outcome while quota is exhausted is the
quota error INSIDE the boundary (proving auth was read from the seat HOME and the transport left
the sandbox) with rc≠0 → `no_verdict`, and a seat root that is gone afterwards. Record `sha256sum
~/.codex/auth.json` before and after and confirm the host credential still authenticates (a
`codex --version`-class call is not enough; a quota-gated `exec` is): the copied-credential refresh
limitation is stated, not hidden. Record it in the evidence dir. The first real verdict from a
cleanroom seat is 1b-B's dogfood after 2026-09-19.

## 6. Risks + inversion

- **CI runners cannot create user namespaces.** The isolation suite is env-gated so CI prints
  `SKIP`; this host's `verification_commands` invoke it with the env. Inversion: a host with the env
  set and no working bwrap gets a red suite, which is the truth.
- **codex writes into its HOME.** The seat HOME is writable and discarded; nothing of the operator
  HOME is present to be modified. The suite asserts the host is untouched.
- **Nested sandbox.** `--sandbox danger-full-access` reads badly; it is confined to the launcher
  and the header says why (probe 2026-09-16: `read-only` cannot nest). The portable suite asserts the
  non-blind block never gained it.
- **Argv leak.** All bwrap options ride in an args file (`--args FD`), so pid 1's cmdline holds no
  host path; the suite reads `/proc/1/cmdline` from inside and a no-`--args` control proves the
  assertion bites.
- **Timeout ownership / orphaned seats.** One timer (the launcher's); INT/TERM/HUP traps; a fixed
  `cleanroom-seat.` prefix for sweeping a SIGKILLed seat's credential copy.
- **Quota.** No live codex verdict this cut — the acceptance table does not claim one.
- **Hand scope.** One new lib script + its mirror, one script edit + mirror, two test files, one
  doc + mirror, one inventory row, one BACKLOG line — one round.

## 7. Where this sits

Parent §7: 1a-A ✓ → 1a-B ✓ → **1b-A (this)** → 1b-B (intake/resolver/tier table/codex pin) →
configurable deny-list → 2.

## Review log

- (to be filled by the plan hetero loop)
