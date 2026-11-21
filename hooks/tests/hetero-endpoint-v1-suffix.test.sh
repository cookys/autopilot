#!/usr/bin/env bash
# Reject duplicate API-version suffixes before starting a cc-shim worker.
. "$(dirname "$0")/lib.sh"
unset AUTOPILOT_SESSION_ID CLAUDE_CODE_SESSION_ID AUTOPILOT_LEVEL AUTOPILOT_ROOT_RUN_ID \
  AUTOPILOT_MISSION_ROOT_RUN_ID AUTOPILOT_PARENT_RUN_ID AUTOPILOT_RECONCILE_RECEIPT \
  AUTOPILOT_WORKTREE_ROOT_RUN_ID AUTOPILOT_DISPATCH_DEPTH REVIEW_LOOP_CONFIG_OVERRIDE \
  AUTOPILOT_QUALIFICATION_OVERRIDE 2>/dev/null || true
export AUTOPILOT_STRIKE_WRITER=off DISPATCH_QUIET=1 AUTOPILOT_ENDPOINT_PREPROBE=off
export AUTOPILOT_ENDPOINTS_ENV="$TEST_TMP/endpoints.env"
: > "$AUTOPILOT_ENDPOINTS_ENV"
chmod 600 "$AUTOPILOT_ENDPOINTS_ENV"
export AUTOPILOT_ENDPOINT_GPU1_TOKEN=fake-token-not-real
SBX="$TEST_TMP/repo"
mkdir -p "$SBX" "$TEST_TMP/bin" "$TEST_TMP/cap"
git -C "$SBX" init -q -b develop
git -C "$SBX" config user.email t@t
git -C "$SBX" config user.name t
git -C "$SBX" commit -q --allow-empty -m base
printf 'test prompt\n' > "$TEST_TMP/prompt"
for cli in claude codex grok agy opencode kimi cursor fleet; do
  printf '#!/bin/sh\nexit 97\n' > "$TEST_TMP/bin/$cli"
  chmod +x "$TEST_TMP/bin/$cli"
done
export PATH="$TEST_TMP/bin:$PATH" ENGINE_CAPABILITY_DIR="$TEST_TMP/cap"
for suffix in /v1 /v1/ ''; do
  export AUTOPILOT_ENDPOINT_GPU1_URL="http://127.0.0.1:9$suffix"
  (cd "$SBX" && timeout 30 "$REPO_ROOT/scripts/dispatch-hetero.sh" --no-verify-tip --runner cc-shim --model mini --branch feat/test --prompt-file "$TEST_TMP/prompt" --context-window off --endpoint gpu1 < /dev/null > "$TEST_TMP/out" 2> "$TEST_TMP/err")
  rc=$?
  err="$(cat "$TEST_TMP/err")"
  if [ -n "$suffix" ]; then
    if [ "$rc" = 2 ] && [[ "$err" == *'ends with /v1'* ]]; then
      assert_eq yes yes "$suffix rejected with precondition"
    else
      assert_eq yes no "$suffix rejected with precondition (exit $rc)"
    fi
  else
    assert_not_contains "$err" 'ends with /v1' 'bare URL is accepted by suffix check'
  fi
done
finalize_test
