#!/usr/bin/env bash
# Stage-1 reviewer qualifier tests, shard a (sections 1-5).
. "$(dirname "$0")/lib.sh"
SCRIPT="$REPO_ROOT/scripts/engine-qualify.sh"
. "$(dirname "$0")/lib/engine-qualify-setup.sh"

# 1) --help exits 0
HELP_OUT="$($SCRIPT --help 2>&1)"
HELP_RC=$?
assert_exit_code "$HELP_RC" "0" "--help exits 0"
assert_contains "$HELP_OUT" "reviewer" "--help prints reviewer contract"

# 2) Correct panel verdicts -> evaluation passes, but serialized output has no authority.
PASS_OUT="$($SCRIPT "${QUALIFY_ARGS[@]}" --panel-cmd "$PASS_PANEL" 2>&1)"
PASS_RC=$?
assert_exit_code "$PASS_RC" "0" "all-correct panel-cmd exits 0"
assert_contains "$PASS_OUT" '"evaluation_passed":true' "evaluation passes when panel catches all"
assert_contains "$PASS_OUT" '"evidence_state":"qualified"' "qualified verdict carries lifecycle state"
assert_contains "$PASS_OUT" '"admitted":false' "serialized qualifier result cannot admit a role"
assert_contains "$PASS_OUT" '"authority_status":"untrusted_telemetry"' \
  "serialized qualifier result declares its non-authoritative boundary"

# 3) Remote reviewer output crosses the case-only broker, then passes the same host witness oracle.
REMOTE_ADAPTER="$TEST_TMP/engine-qualify-remote-adapter.js"
cat >"$REMOTE_ADAPTER" <<'NODE'
'use strict';
const fs = require('fs');
const { spawnSync } = require('child_process');
const request = JSON.parse(fs.readFileSync(0, 'utf8'));
const panel = spawnSync(
  process.env.QUAL_FAKE_NODE,
  [process.env.QUAL_FAKE_PANEL, 'honest'],
  {
    input: request.payload.content,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  },
);
if (panel.error || panel.signal || panel.status !== 0) process.exit(1);
process.stdout.write(JSON.stringify({
  schema_version: 1,
  provider: process.env.QUAL_FAKE_PROVIDER,
  model: process.env.QUAL_FAKE_MODEL,
  output: panel.stdout,
}));
NODE
export QUAL_FAKE_NODE="$NODE_BIN"
export QUAL_FAKE_PANEL="$PANEL"
export QUAL_FAKE_PROVIDER="fake-review-provider"
export QUAL_FAKE_MODEL="eng-review-exact"
REMOTE_PROVIDER_CMD="$(printf '%q ' "$NODE_BIN" "$REMOTE_ADAPTER")"
REMOTE_OUT="$(
  "$SCRIPT" "${QUALIFY_REMOTE_ARGS[@]}" \
    --remote-provider-cmd "$REMOTE_PROVIDER_CMD" \
    --remote-provider "$QUAL_FAKE_PROVIDER" \
    --provider-env QUAL_FAKE_NODE \
    --provider-env QUAL_FAKE_PANEL \
    --provider-env QUAL_FAKE_PROVIDER \
    --provider-env QUAL_FAKE_MODEL \
    2>&1
)"
REMOTE_RC=$?
assert_exit_code "$REMOTE_RC" "0" \
  "case-only remote reviewer passes the host behavioral witness oracle"
assert_contains "$REMOTE_OUT" '"evaluation_passed":true' \
  "remote transport does not replace the reviewer host oracle"

# 4) The public fixture SHA lookup that previously false-greened cannot qualify.
PUBLIC_HASH_OUT="$($SCRIPT "${QUALIFY_ARGS[@]}" --panel-cmd "$PUBLIC_HASH_PANEL" 2>&1)"
PUBLIC_HASH_RC=$?
assert_exit_code "$PUBLIC_HASH_RC" "1" "public SHA lookup cannot qualify on fresh cases"
assert_contains "$PUBLIC_HASH_OUT" '"evaluation_passed":false' \
  "fresh metamorphic artifacts defeat the public fixture lookup"

NORMALIZED_OUT="$($SCRIPT "${QUALIFY_ARGS[@]}" --panel-cmd "$NORMALIZED_LOOKUP_PANEL" 2>&1)"
NORMALIZED_RC=$?
assert_exit_code "$NORMALIZED_RC" "1" \
  "salt/path/context-normalized lookup cannot qualify across fresh nonces"
assert_contains "$NORMALIZED_OUT" '"evaluation_passed":false' \
  "metamorphic corpus rejects normalized benchmark lookup"

# 5) Every case gets a fresh sandbox with host paths, network, and prior scratch hidden.
SANDBOX_OUT="$($SCRIPT "${QUALIFY_ARGS[@]}" --panel-cmd "$SANDBOX_PANEL" 2>&1)"
SANDBOX_RC=$?
assert_exit_code "$SANDBOX_RC" "0" \
  "sandbox hides repo, corpus, panel source, host sidecar, and prior case scratch"
assert_contains "$SANDBOX_OUT" '"evaluation_passed":true' \
  "sandboxed semantic reviewer still qualifies"

NETWORK_SERVER="$TEST_TMP/engine-qualify-network-server.js"
NETWORK_PORT_FILE="$TEST_TMP/engine-qualify-network-port"
cat >"$NETWORK_SERVER" <<'NODE'
'use strict';
const fs = require('fs');
const net = require('net');
const server = net.createServer((socket) => socket.end('host-only-evaluation-data'));
server.listen(0, '127.0.0.1', () => {
  fs.writeFileSync(process.argv[2], String(server.address().port));
});
setTimeout(() => server.close(), 120_000);
NODE
node "$NETWORK_SERVER" "$NETWORK_PORT_FILE" &
NETWORK_SERVER_PID=$!
for _ in $(seq 1 100); do
  [ -s "$NETWORK_PORT_FILE" ] && break
  sleep 0.02
done
NETWORK_PORT="$(cat "$NETWORK_PORT_FILE" 2>/dev/null || true)"
NETWORK_RC=0
"$SCRIPT" "${QUALIFY_ARGS[@]}" \
  --panel-cmd "/panel/node /panel/reviewer.js network-probe $NETWORK_PORT" \
  >/dev/null 2>&1 || NETWORK_RC=$?
kill "$NETWORK_SERVER_PID" 2>/dev/null || true
wait "$NETWORK_SERVER_PID" 2>/dev/null || true
assert_exit_code "$NETWORK_RC" "0" \
  "sandbox network namespace cannot reach a host-loopback evaluation side channel"
finalize_test
