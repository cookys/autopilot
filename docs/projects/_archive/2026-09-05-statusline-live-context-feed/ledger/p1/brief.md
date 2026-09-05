# P1 brief — codeforge writes the live context files

Repo: `/home/cookys/projects/codeforge` (Rust, bin `codeforge`, currently on `main`, clean). Work in a worktree:
`git -C /home/cookys/projects/codeforge worktree add /home/cookys/projects/codeforge-wt-live -b feat/live-context-file main`
and do everything inside `/home/cookys/projects/codeforge-wt-live`. Commit there; do NOT merge, do NOT touch `main`,
do NOT run `cargo install`, do NOT edit `~/.claude/settings.json`.

Plan (read §2.5 and P1 only): `/home/cookys/projects/autopilot/docs/plans/2026-09-05-statusline-live-context-feed.md`.
Real payloads to build fixtures from: `/home/cookys/projects/autopilot/docs/projects/2026-09-05-statusline-live-context-feed/ledger/p0/{statusline,subagent}.json`.

## Global Constraints (verbatim from plan §2.5 — do not paraphrase)

- Rust side: no new crate beyond what codeforge already pulls (serde_json, chrono, tempfile are present).
- Live-dir resolution order is fixed: `$AUTOPILOT_LIVE_DIR` → `$XDG_RUNTIME_DIR/autopilot` → `/dev/shm/autopilot-<uid>` → `/tmp/autopilot-<uid>`. **Every** candidate, the override included, is accepted ONLY if `findmnt -T <dir> -o FSTYPE -n` prints `tmpfs` or `ramfs`; if `findmnt` is absent, fall back to longest-prefix match in `/proc/mounts`; if neither works the candidate is rejected. When every candidate is rejected, use `~/.autopilot` as the base and print exactly one warning line per process. Never assume a path is RAM. A rejected override is skipped, not fatal.
- Base-dir contract: the resolver returns a BASE; every consumer appends its own purpose segment (`context/`). Probe the candidate's nearest existing ancestor when the dir does not exist yet, then `create_dir_all` with mode 0700.
- Two live files, one writer each, no merge: `<base>/context/<sid>.json` (main status line) and `<base>/context/<sid>.tasks.json` (subagent status line). Mode 0600, same-directory temp + rename. Each carries its own `written_at`. Neither writer reads the other's file.
- `<sid>` sanitiser is normative: take the stdin `session_id` string; replace every Unicode scalar value not in `[A-Za-z0-9_-]` with one `_` (per scalar); then keep the first 64 scalars; empty input ⇒ `unknown`. Must pass the shared vector file you create at `/home/cookys/projects/autopilot/hooks/tests/fixtures/session-id-vectors.json` (array of `{input, expected}`: plain uuid, `a/b:c d`, CJK `會議123`, emoji, empty string, a 70-char string). Copy the same file into `tests/fixtures/` of codeforge and test against it.
- Schemas (`schema_version: 1`):
  main: `{"schema_version":1,"session_id":"<raw session_id>","written_at":"<RFC3339 UTC>","cc_version":"<version>","model":{"id":…,"display_name":…},"context_window":{"context_window_size":…,"used_percentage":…,"total_input_tokens":…,"current_usage":{…}}}`
  tasks: `{"schema_version":1,"session_id":"<raw>","written_at":"<RFC3339 UTC>","tasks":[{"id","type","status","description","label","startTime","model","cwd","contextWindowSize","tokenCount"}]}` — copy each field only when present in stdin (`name` too if present); never invent values.
- Build the records from the raw `serde_json::Value`, not from the display struct. A write failure is logged to stderr once per process and never changes rendering or exit code.

## Deliverables

1. `src/live.rs` (new): `pub fn resolve_live_base() -> (PathBuf, LiveBaseSource)`, `pub fn sanitize_session_id(&str) -> String`, `pub fn write_live_json(base: &Path, file_name: &str, value: &serde_json::Value) -> io::Result<()>`. Mount probe: shell out to `findmnt`; fallback parse `/proc/mounts` (path overridable for tests via env `CODEFORGE_PROC_MOUNTS`). Warn-once via a `OnceLock`/`AtomicBool`.
2. `src/cli/statusline.rs`: after `read_status_input` parses the line, also build the main record and write `context/<sid>.json`. Rendering unchanged (existing tests must stay green byte-for-byte).
3. `src/cli/subagent_statusline.rs` (new) + CLI wiring: `codeforge subagent-statusline` reads one JSON line, writes `context/<sid>.tasks.json`, prints nothing, exit 0 even on parse failure.
4. `src/cli/install.rs`: when `statusLine.command` already ends with `codeforge statusline`, idempotently add `"subagentStatusLine": {"type":"command","command":"<same binary path> subagent-statusline"}` — only when the flag `--subagent-statusline` is passed (opt-in; do not change default install behaviour).
5. Tests (unit, `cargo test live::` and per module): (a) fake `findmnt` script on `PATH` returning `tmpfs` for the XDG candidate ⇒ chosen; (b) fake `findmnt` returning `ext4` for every candidate ⇒ base is `~/.autopilot` and exactly one warning line on stderr; (c) `findmnt` absent + `CODEFORGE_PROC_MOUNTS` fixture ⇒ `/proc/mounts` path works; (d) ext4 override + tmpfs XDG ⇒ XDG chosen; (e) sanitiser vectors; (f) writer produces mode 0600 and atomic rename (no `.tmp` left); (g) statusline fixture from `p0/statusline.json` ⇒ main file matches schema, `context_window_size == 1000000`; (h) subagent fixture from `p0/subagent.json` ⇒ tasks file has one row with `id == "a9c9b5673eb39f842"` and `tokenCount == 47688`; main file untouched.
6. `CHANGELOG.md` entry + README section "Live context files" (schema, paths, knob `AUTOPILOT_LIVE_DIR`, opt-in install flag).

## Method (harness-verify-loop)

One change → `cargo test <module>` → `git add` that change → next. `cargo fmt` + `cargo clippy -- -D warnings` + full `cargo test` before the commit. Commit message starts `feat(live): statusline writes live context files (autopilot v2.36.1 P1)`.

## Report (write to `/home/cookys/projects/autopilot/docs/projects/2026-09-05-statusline-live-context-feed/ledger/p1/report.json`)

`{"status":"done|blocked","worktree":"…","branch":"feat/live-context-file","commit":"<sha>","tests":{"cmd":"cargo test","passed":N,"failed":N},"clippy":"clean|<msg>","files_changed":[…],"notes":"…"}` — JSON only; no prose claims of green without the numbers. Then reply with one line: the path of that report.
