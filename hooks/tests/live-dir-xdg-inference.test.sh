#!/usr/bin/env bash
# live-dir-xdg-inference — XDG-unset hook readers infer /run/user/<uid>/autopilot
# and bounded group-bit tightening on a private parent.
#
# # RED at 8de1afa6: writer/reader split resolved source=shm (no xdg-inferred);
# 0775 candidate rejected and left mode 775; missing parent path was not a
# skipped candidate (suite FAIL=3 on split/group/missing before the production
# change).
# # RED at 8edb870e: 0775 under a 0700 parent still rejected (other-bits carve-out);
# production codeforge /run/user/<uid>/autopilot 0775 case fails until r3.
set -u

SELF_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SELF_DIR/../.." && pwd)"
LIB="$REPO_ROOT/scripts/lib/live-state-dir.js"
HOOK="$REPO_ROOT/hooks/context-budget.js"

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); printf 'ok — %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); printf 'FAIL — %s\n' "$1"; }

UID_N="$(id -u)"

assert_r1_split_env_reader_finds_writer() {
  local TMP ROOT PROC SID OUT
  TMP="$(mktemp -d "${TMPDIR:-/tmp}/r1-split-XXXXXX")"
  ROOT="$TMP/run-user"
  mkdir -p "$ROOT"
  PROC="$TMP/mounts"
  printf 'tmpfs %s tmpfs rw 0 0\nrootfs / ext4 rw 0 0\n' "$ROOT" > "$PROC"
  mkdir -m 0700 "$ROOT/$UID_N"
  SID="r1-split-sid"

  OUT="$(node -e '
const fs = require("fs");
const path = require("path");
const { resolveLiveDir, readLive } = require(process.argv[1]);
const runUserRoot = process.argv[2];
const procMountsPath = process.argv[3];
const uid = process.argv[4];
const sid = process.argv[5];
const execFile = () => { const e = new Error("not found"); e.code = "ENOENT"; throw e; };
const xdg = path.join(runUserRoot, uid);
const writer = resolveLiveDir({
  env: { XDG_RUNTIME_DIR: xdg },
  execFile, procMountsPath, runUserRoot, warn: () => {},
});
const ctx = path.join(writer.base, "context");
fs.mkdirSync(ctx, { recursive: true, mode: 0o700 });
fs.writeFileSync(path.join(ctx, sid + ".json"), JSON.stringify({
  schema_version: 1,
  written_at: new Date().toISOString(),
  context_window: { context_window_size: 1000000, total_input_tokens: 1 },
  context_window_size: 1000000,
}));
const reader = resolveLiveDir({
  env: {},
  execFile, procMountsPath, runUserRoot, warn: () => {},
});
const live = readLive(reader.base, sid);
process.stdout.write(JSON.stringify({ writer, reader, live }));
' "$LIB" "$ROOT" "$PROC" "$UID_N" "$SID")"

  if printf '%s' "$OUT" | grep -q '"source":"xdg"' \
    && printf '%s' "$OUT" | grep -q '"source":"xdg-inferred"' \
    && printf '%s' "$OUT" | grep -q '"context_window_size":1000000' \
    && printf '%s' "$OUT" | grep -vq '"live":null'; then
    ok "split env: writer xdg, reader xdg-inferred, live 1M"
  else
    bad "split env: $OUT"
  fi
  rm -rf "$TMP"
}

assert_r1_group_bits_tightened() {
  local TMP ROOT PROC CAND PARENT OUT
  TMP="$(mktemp -d "${TMPDIR:-/tmp}/r1-group-XXXXXX")"
  ROOT="$TMP/run-user"
  mkdir -p "$ROOT"
  PROC="$TMP/mounts"
  printf 'tmpfs %s tmpfs rw 0 0\nrootfs / ext4 rw 0 0\n' "$ROOT" > "$PROC"
  PARENT="$ROOT/$UID_N"
  CAND="$PARENT/autopilot"
  mkdir -m 0700 "$PARENT"
  mkdir -m 0770 "$CAND"
  chmod 0700 "$PARENT"
  chmod 0770 "$CAND"

  OUT="$(node -e '
const fs = require("fs");
const { resolveLiveDir } = require(process.argv[1]);
const runUserRoot = process.argv[2];
const procMountsPath = process.argv[3];
const cand = process.argv[4];
const execFile = () => { const e = new Error("not found"); e.code = "ENOENT"; throw e; };
const r = resolveLiveDir({
  env: {},
  execFile, procMountsPath, runUserRoot, warn: () => {},
});
const mode = (fs.statSync(cand).mode & 0o777).toString(8);
process.stdout.write(JSON.stringify({ source: r.source, base: r.base, mode }));
' "$LIB" "$ROOT" "$PROC" "$CAND")"

  if printf '%s' "$OUT" | grep -q '"source":"xdg-inferred"' && printf '%s' "$OUT" | grep -q '"mode":"700"'; then
    ok "group bits tightened to 0700 ($OUT)"
  else
    bad "expected xdg-inferred mode 700, got $OUT"
  fi
  rm -rf "$TMP"
}

assert_r3_0777_under_private_parent_accepted() {
  local TMP ROOT PROC CAND PARENT OUT
  TMP="$(mktemp -d "${TMPDIR:-/tmp}/r3-777-XXXXXX")"
  ROOT="$TMP/run-user"
  mkdir -p "$ROOT"
  PROC="$TMP/mounts"
  printf 'tmpfs %s tmpfs rw 0 0\nrootfs / ext4 rw 0 0\n' "$ROOT" > "$PROC"
  PARENT="$ROOT/$UID_N"
  CAND="$PARENT/autopilot"
  mkdir -m 0700 "$PARENT"
  mkdir -m 0777 "$CAND"
  chmod 0700 "$PARENT"
  chmod 0777 "$CAND"

  OUT="$(node -e '
const fs = require("fs");
const { resolveLiveDir } = require(process.argv[1]);
const runUserRoot = process.argv[2];
const procMountsPath = process.argv[3];
const cand = process.argv[4];
const execFile = () => { const e = new Error("not found"); e.code = "ENOENT"; throw e; };
const r = resolveLiveDir({
  env: {},
  execFile, procMountsPath, runUserRoot, warn: () => {},
});
const mode = (fs.statSync(cand).mode & 0o777).toString(8);
process.stdout.write(JSON.stringify({ source: r.source, base: r.base, mode }));
' "$LIB" "$ROOT" "$PROC" "$CAND")"
  if printf '%s' "$OUT" | grep -q '"source":"xdg-inferred"' && printf '%s' "$OUT" | grep -q '"mode":"700"'; then
    ok "0777 under private parent accepted and chmod 0700 ($OUT)"
  else
    bad "expected xdg-inferred mode 700 for 0777 under 0700 parent, got $OUT"
  fi
  rm -rf "$TMP"
}

assert_r3_production_0775_under_private_parent_accepted() {
  local TMP ROOT PROC CAND PARENT OUT
  TMP="$(mktemp -d "${TMPDIR:-/tmp}/r3-775-XXXXXX")"
  ROOT="$TMP/run-user"
  mkdir -p "$ROOT"
  PROC="$TMP/mounts"
  printf 'tmpfs %s tmpfs rw 0 0\nrootfs / ext4 rw 0 0\n' "$ROOT" > "$PROC"
  PARENT="$ROOT/$UID_N"
  CAND="$PARENT/autopilot"
  mkdir -m 0700 "$PARENT"
  mkdir -m 0775 "$CAND"
  chmod 0700 "$PARENT"
  chmod 0775 "$CAND"

  OUT="$(node -e '
const fs = require("fs");
const { resolveLiveDir } = require(process.argv[1]);
const runUserRoot = process.argv[2];
const procMountsPath = process.argv[3];
const cand = process.argv[4];
const execFile = () => { const e = new Error("not found"); e.code = "ENOENT"; throw e; };
const r = resolveLiveDir({
  env: {},
  execFile, procMountsPath, runUserRoot, warn: () => {},
});
const mode = (fs.statSync(cand).mode & 0o777).toString(8);
process.stdout.write(JSON.stringify({ source: r.source, base: r.base, mode }));
' "$LIB" "$ROOT" "$PROC" "$CAND")"
  if printf '%s' "$OUT" | grep -q '"source":"xdg-inferred"' && printf '%s' "$OUT" | grep -q '"mode":"700"'; then
    ok "production 0775 under private parent accepted and chmod 0700 ($OUT)"
  else
    bad "expected xdg-inferred mode 700 for production 0775 under 0700 parent, got $OUT"
  fi
  rm -rf "$TMP"
}

assert_r1_public_parent_rejected() {
  local TMP ROOT PROC CAND PARENT MODE_AFTER OUT
  TMP="$(mktemp -d "${TMPDIR:-/tmp}/r1-pubparent-XXXXXX")"
  ROOT="$TMP/run-user"
  mkdir -p "$ROOT"
  PROC="$TMP/mounts"
  printf 'tmpfs %s tmpfs rw 0 0\nrootfs / ext4 rw 0 0\n' "$ROOT" > "$PROC"
  PARENT="$ROOT/$UID_N"
  CAND="$PARENT/autopilot"
  mkdir -m 0755 "$PARENT"
  mkdir -m 0775 "$CAND"
  chmod 0755 "$PARENT"
  chmod 0775 "$CAND"

  OUT="$(node -e '
const fs = require("fs");
const { resolveLiveDir } = require(process.argv[1]);
const runUserRoot = process.argv[2];
const procMountsPath = process.argv[3];
const cand = process.argv[4];
const execFile = () => { const e = new Error("not found"); e.code = "ENOENT"; throw e; };
const r = resolveLiveDir({
  env: {},
  execFile, procMountsPath, runUserRoot, warn: () => {},
});
const mode = (fs.statSync(cand).mode & 0o777).toString(8);
process.stdout.write(JSON.stringify({ source: r.source, base: r.base, mode }));
' "$LIB" "$ROOT" "$PROC" "$CAND")"
  MODE_AFTER="$(stat -c '%a' "$CAND")"
  if printf '%s' "$OUT" | grep -q '"source":"xdg-inferred"'; then
    bad "public parent must reject candidate, got $OUT"
  elif [ "$MODE_AFTER" != "775" ]; then
    bad "must not chmod when parent is public (mode=$MODE_AFTER out=$OUT)"
  else
    ok "public parent rejected, not chmodded ($OUT)"
  fi
  rm -rf "$TMP"
}

assert_r1_missing_parent_skipped() {
  local TMP ROOT PROC PARENT OUT
  TMP="$(mktemp -d "${TMPDIR:-/tmp}/r1-missing-XXXXXX")"
  ROOT="$TMP/run-user"
  mkdir -p "$ROOT"
  PROC="$TMP/mounts"
  printf 'tmpfs %s tmpfs rw 0 0\nrootfs / ext4 rw 0 0\n' "$ROOT" > "$PROC"
  PARENT="$ROOT/$UID_N"

  OUT="$(node -e '
const { resolveLiveDir } = require(process.argv[1]);
const runUserRoot = process.argv[2];
const procMountsPath = process.argv[3];
const execFile = () => { const e = new Error("not found"); e.code = "ENOENT"; throw e; };
const r = resolveLiveDir({
  env: {},
  execFile, procMountsPath, runUserRoot, warn: () => {},
});
process.stdout.write(JSON.stringify({ source: r.source, base: r.base }));
' "$LIB" "$ROOT" "$PROC")"
  if [ -e "$PARENT" ]; then
    bad "must not create missing parent $PARENT (out=$OUT)"
  elif printf '%s' "$OUT" | grep -q '"source":"xdg-inferred"'; then
    bad "missing parent must not resolve xdg-inferred: $OUT"
  else
    case "$OUT" in
      *'"source":"shm"'*|*'"source":"tmp"'*|*'"source":"ssd-fallback"'*)
        ok "missing parent skipped, fell through ($OUT)" ;;
      *) bad "expected shm/tmp/ssd-fallback, got $OUT" ;;
    esac
  fi
  rm -rf "$TMP"
}

assert_r1_context_budget_reads_1m() {
  # context-budget.js calls resolveLiveDir() with no runUserRoot/execFile injection.
  # The only existing seam for which live-state directory it reads is
  # AUTOPILOT_LIVE_DIR (override). Falling back to that env var explicitly.
  local TMP LIVE SID TRANSCRIPT PAYLOAD RC ERR
  TMP="$(mktemp -d "/dev/shm/r1-ctxbudget-XXXXXX")"
  SID="bbbbbbbb-cccc-dddd-eeee-ffffffffffff"
  LIVE="$TMP/live"
  mkdir -p "$LIVE/context" "$TMP/state"
  chmod 0700 "$LIVE"
  TRANSCRIPT="$TMP/transcript.jsonl"
  printf '%s\n' \
    '{"timestamp":"2026-09-28T00:00:00.000Z","message":{"usage":{"input_tokens":2,"cache_read_input_tokens":160000,"cache_creation_input_tokens":411,"output_tokens":10}}}' \
    > "$TRANSCRIPT"
  PAYLOAD="{\"transcript_path\":\"$TRANSCRIPT\",\"session_id\":\"$SID\"}"
  cat > "$LIVE/context/$SID.json" <<JSON
{"schema_version":1,"session_id":"$SID",
 "context_window":{"context_window_size":1000000,"total_input_tokens":160413},
 "written_at":"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"}
JSON
  export AUTOPILOT_LIVE_DIR="$LIVE"
  export AUTOPILOT_CONTEXT_BUDGET_DIR="$TMP/state"
  export CLAUDE_CODE_SESSION_ID="$SID"
  unset XDG_RUNTIME_DIR || true
  printf '%s' "$PAYLOAD" | node "$HOOK" 2>"$TMP/err.txt"
  RC=$?
  ERR="$(cat "$TMP/err.txt")"
  unset AUTOPILOT_LIVE_DIR AUTOPILOT_CONTEXT_BUDGET_DIR CLAUDE_CODE_SESSION_ID
  if [ "$RC" != "0" ]; then
    bad "1M live window should not T2 at 160k, rc=$RC stderr=[$ERR]"
  else
    case "$ERR" in
      *"Context budget T2"*) bad "picked 200K path (T2) instead of 1M: $ERR" ;;
      *) ok "context-budget used 1M live window (no T2 at 160k)" ;;
    esac
  fi
  rm -rf "$TMP"
}

assert_r1_split_env_reader_finds_writer
assert_r1_group_bits_tightened
assert_r3_0777_under_private_parent_accepted
assert_r3_production_0775_under_private_parent_accepted
assert_r1_public_parent_rejected
assert_r1_missing_parent_skipped
assert_r1_context_budget_reads_1m

echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
