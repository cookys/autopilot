#!/usr/bin/env bash
# hooks/tests/pm-inbox-adapter.test.sh — regression tests for pm-inbox-adapter.js fleet CLI resolution.
. "$(dirname "$0")/lib.sh"

DONE_JS="${REPO_ROOT}/scripts/pm-inbox-done.js"
BIN_DIR="${TEST_TMP}/bin"
EMPTY_BIN="${TEST_TMP}/empty-bin"
mkdir -p "$BIN_DIR" "$EMPTY_BIN"

# Case 1: PATH-only — fake inbox-cli on PATH, no AUTOPILOT_FLEET_REPO.
cat > "${BIN_DIR}/inbox-cli" << 'EOF'
#!/usr/bin/env bash
cmd="${1:-}"
shift || true
case "$cmd" in
  mark)
    printf '{"ok":true,"marked":true,"args":"%s"}\n' "$*"
    exit 0
    ;;
  list)
    printf '[]\n'
    exit 0
    ;;
  *)
    printf '{"ok":true}\n'
    exit 0
    ;;
esac
EOF
chmod +x "${BIN_DIR}/inbox-cli"

OUT_PATH_ONLY="$(env -u AUTOPILOT_FLEET_REPO -u AUTOPILOT_PM_INBOX_ADAPTER PATH="${BIN_DIR}:${PATH}" node "$DONE_JS" msg-123 --ref ref-456 2>&1)"
RC_PATH_ONLY=$?
assert_eq "0" "$RC_PATH_ONLY" "PATH-only pm-inbox-done exits 0"
assert_contains "$OUT_PATH_ONLY" "done msg-123" "PATH-only pm-inbox-done returns ok"

# Case 2: Neither PATH nor AUTOPILOT_FLEET_REPO — exits 3 naming both places.
# Keep node and which available via a minimal symlinked dir without inbox-cli.
NODE_BIN="$(command -v node)"
WHICH_BIN="$(command -v which)"
ln -sf "$NODE_BIN" "${EMPTY_BIN}/node"
ln -sf "$WHICH_BIN" "${EMPTY_BIN}/which"

OUT_NEITHER="$(env -u AUTOPILOT_FLEET_REPO -u AUTOPILOT_PM_INBOX_ADAPTER PATH="${EMPTY_BIN}" node "$DONE_JS" msg-123 --ref ref-456 2>&1)"
RC_NEITHER=$?
assert_eq "3" "$RC_NEITHER" "neither PATH nor repo exits 3"
assert_contains "$OUT_NEITHER" "PATH" "error message mentions PATH"
assert_contains "$OUT_NEITHER" "AUTOPILOT_FLEET_REPO" "error message mentions AUTOPILOT_FLEET_REPO"

# Case 3: Repo fallback — PATH lacks inbox-cli, AUTOPILOT_FLEET_REPO is set.
FAKE_REPO="${TEST_TMP}/fleet-repo"
mkdir -p "${FAKE_REPO}/plugins/claude/src"
cat > "${FAKE_REPO}/plugins/claude/src/inbox-cli.ts" << 'EOF'
const cmd = process.argv[2] || '';
if (cmd === 'mark') {
  console.log(JSON.stringify({ ok: true, via: 'repo' }));
} else {
  console.log('[]');
}
EOF

OUT_REPO="$(env -u AUTOPILOT_PM_INBOX_ADAPTER AUTOPILOT_FLEET_REPO="${FAKE_REPO}" PATH="${EMPTY_BIN}" node "$DONE_JS" msg-789 --ref ref-000 2>&1)"
RC_REPO=$?
assert_eq "0" "$RC_REPO" "repo fallback pm-inbox-done exits 0"
assert_contains "$OUT_REPO" "done msg-789" "repo fallback pm-inbox-done returns ok"

finalize_test
