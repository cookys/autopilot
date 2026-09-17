# Implementation brief — blind-review-cleanroom-launcher-2026-09-17 (cut 1b-A)

ONE managed deliverable. The harness commits; never push, never `git stash`, never touch files
outside the sealed `output_paths`, never run a real reviewer model — stubs only, except the
isolation suite which drives the REAL `bwrap` (0.11.1, `/usr/bin/bwrap`) with a stub "codex".
Base for RED evidence and byte-identity: `ceb7c81d`.

## Read first
1. `docs/plans/2026-09-17-blind-review-cleanroom-launcher.md` — §1 items 1–7 NORMATIVE; §2.5, §2.6,
   §4, §4.1. The plan wins over this brief.
2. The `.rubric.md` (R1–R8) and `evidence/2026-09-17-blind-review-cleanroom-launcher/bwrap-probe-2026-09-17.md`.
3. `scripts/dispatch-review.sh`: blind gate ~`:286-295`, `emit_no_verdict` ~`:643`, codex block
   ~`:942-972`, cc-shim block ~`:1319-1332`. `hooks/tests/dispatch-review.test.sh`: `STUB_VERDICT`
   ~`:440-460`, codex parse ~`:720-770`, blind gate + parity ~`:1079-1125`;
   `dispatch-plan-review-live.test.sh:3-10` for the env-gated SKIP idiom.

## Product (plan §1 normative)
1. NEW `scripts/lib/cleanroom-launch.sh` (`chmod +x`, `set -euo pipefail`, bash + coreutils only):
   argv contract exactly as §1.3: launch mode (`--profile codex --packet-dir --prompt-file --out
   --err --timeout --model --effort --bin-dir --auth-file [--bwrap] [--seat-root] [--keep-seat]`) and
   preflight mode (`--preflight --deny-path <p>… [--bwrap] [--seat-root]` — no packet/prompt/
   credential/binary; empty `work/`). Seat root `mktemp -d -t cleanroom-seat.XXXXXX` or `--seat-root`
   (`home/.codex/{auth.json,config.toml}`, `work/`, `passwd`, `prompt`, `bwrap.args`). EVERY bwrap
   option goes into the NUL-separated `bwrap.args` and bwrap is invoked as `timeout <T> bwrap --args 9
   -- /bin/sh -c 'exec "$0" "$@"' /home/review/bin/codex exec … 9< bwrap.args` (so `/proc/1/cmdline`
   holds no host path; the release `bin/` is ro-bound at `/home/review/bin`, no wrapper script). Pass
   the inner rc through (124 untouched); print the one-line JSON (`cleanroom_launch`, `profile`
   `codex`|`preflight`, `seat_root`); trap `EXIT INT TERM HUP` → remove only a root it created
   (unless `--keep-seat`) and re-raise. Before bwrap close every fd 3..1023 (`exec {fd}>&-`), then
   open fd 9 on `bwrap.args`. `--timeout` = coreutils DURATION grammar forwarded untouched.
   `--seat-root`: `mkdir -m 0700` the exact path, exit 2 `seat root already exists` if present.
   `--preflight`: `test -e` each `--deny-path` on the host first (missing → exit 2 naming it), then a
   bundled POSIX probe via `/bin/sh` inside: every deny path unreadable and no host path in
   `/proc/1/cmdline`; exit 0 / 2 (bwrap missing or cannot start) / 3 (first readable path on
   stderr). Unknown profile → 2. Header: env vars, exit codes, release-layout-only note,
   orphan/credential/proxy notes.
2. `scripts/dispatch-review.sh`: add `review_seat_tier()` (packet: anthropic-compatible cc-shim
   claude-native qoderclicn; cleanroom: codex; none: rest); replace the blind `case` at ~`:290-295`
   with the tier switch (`none` message unchanged). Cleanroom+blind preconditions in §1.2 order,
   each `die_precondition`: `cleanroom seat requires a review packet`; `bwrap not found`; launcher
   `--preflight --deny-path "$AUTOPILOT_REVIEW_PACKET_DIR"` non-zero → `cleanroom runtime unusable:
   <first stderr line>`; codex via `command -v`+`readlink -f`, regular file with
   `codex-code-mode-host` beside it else `codex binary directory unresolved: <path> …`; `codex
   credential file not found`. Honour `AUTOPILOT_CLEANROOM_{LAUNCHER,BWRAP,CODEX_AUTH}`. Launch block = FIRST branch of the
   codex `if` (`[[ "$RUNNER" = codex && "${AUTOPILOT_BLIND_DISCOVERY:-0}" = 1 ]]`): call the launcher
   WITHOUT an outer `timeout` (its own is the cap) with `--out "$CODEX_OUT" --err "$CODEX_ERR"
   --timeout "$TIMEOUT" --seat-root "$AUTOPILOT_REVIEW_PACKET_DIR/../seat"`, append stdout, stderr
   and a `--- cleanroom launch ---`
   section (the launcher's JSON line) to `RAW_LOG`, non-zero → `emit_no_verdict "cleanroom codex
   exited non-zero (rc=N)"`, `PARSE_INPUT="$CODEX_OUT"`. The existing `--sandbox read-only` block
   stays byte-identical for non-blind codex. Header: env variables + tier table.
3. Mirrors: `sync-codex-plugin-skills.sh` then `--check`.

## Tests (§1.5/§1.6 normative; RED blocks `# RED at base ceb7c81d: <observed message>`)
- NEW `hooks/tests/cleanroom-launch.test.sh` (`chmod +x`): `AUTOPILOT_HOST_ISOLATION` unset →
  `SKIP: …` + `finalize_test`; set → drive the REAL launcher with a hostile stub `codex`
  (shell script in a temp `--bin-dir`) and assert §1.5 (a)–(h) exactly: host credential path as a
  LITERAL in the stub (denied) with `/home/review/.codex/auth.json` readable as the positive control,
  parent shell holding `exec 7<` on a host secret → `/proc/self/fd` shows no 7/9 and reopening
  fails, plain-argv control that DOES show host paths, seat-root removal on SIGTERM, pre-existing
  `--seat-root` → exit 2, nonexistent `--deny-path` → exit 2. Missing `bwrap` with the env set =
  FAIL, never skip.
- `hooks/tests/dispatch-review.test.sh`: §1.6 cases with a stub launcher via
  `AUTOPILOT_CLEANROOM_LAUNCHER` and a fake packet dir (`tree/`, `MANIFEST.json`): precondition
  order (no packet dir → exit 2; bwrap missing → exit 2 naming bwrap; stub launcher whose
  `--preflight` exits 2 → exit 2 `cleanroom runtime unusable`, launch mode never called; codex stub
  dir without `codex-code-mode-host` → exit 2), argument shape received by the stub (incl.
  `--seat-root`, `--timeout 5m` forwarded, no outer timeout), `--out` framed verdict → `status:
  reviewed`, stub exit 124 → `no_verdict` with rc in
  raw_log, JSON line in raw_log, grok under blind → unchanged message (preservation), non-blind
  codex → existing tests pass byte-identically; parity test extended (codex+blind reaches the
  launcher). Run each suite at base BEFORE edits; quote the messages; never weaken an assertion.

## Docs
- `references/blind-dispatch.md`: `## Cleanroom tier (v2.36.62)` after "Packet blinding": tiers,
  boundary as one list, what is / is not proven this cut (no live codex verdict: quota), pointer to
  1b-B. Regenerate the mirror.
- `docs/scripts-inventory.md`: one row for `scripts/lib/cleanroom-launch.sh` (shape of the
  `dispatch-detach.sh` row).
- `docs/BACKLOG.md` row "Blind review redesign: blind the packet and the process boundary, not the
  runner" — Context EXACTLY `packet (tree + git diff + spec, deny-list); packet/cleanroom
  tiers; intake canary; verify-once; parallel seats. 1a-A (v2.36.59), 1a-B (v2.36.61), 1b-A launcher
  (v2.36.62) shipped; 1b-B intake/resolver, 2 open. Detail in the pointer.` (Status `open`).
- `CLAUDE.md`: add `lib/cleanroom-launch.sh` to the **Dispatch rails** name list (one token, keep the
  line shape); `node scripts/check-claude-md-inventory.js` must exit 0. Do NOT touch `CHANGELOG.md`
  or version manifests.

## Verify (§4.1; one at a time, foreground, all exit 0)
```
bash hooks/tests/dispatch-review.test.sh
AUTOPILOT_HOST_ISOLATION=1 bash hooks/tests/cleanroom-launch.test.sh
bash hooks/tests/review-runner.test.sh
bash hooks/tests/review-packet.test.sh
node scripts/check-js-syntax.js
bash scripts/sync-codex-plugin-skills.sh --check
node scripts/check-claude-md-inventory.js
node scripts/check-backlog-entries.js --backlog docs/BACKLOG.md
git diff --stat ceb7c81d -- src schemas bin/autopilot.js scripts/resolve-review-loop.sh scripts/qualification-review-provider.js  # empty
test -x scripts/lib/cleanroom-launch.sh && test -x hooks/tests/cleanroom-launch.test.sh
```

## Sealed output_paths (ONLY files you may change)
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
Finish with a clean tree; report RED-at-base messages and suite counts.
