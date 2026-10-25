#!/usr/bin/env bash
# Live agy model alias in probe-harness-capabilities.sh. Fakes only; never the real CLIs.
. "$(dirname "$0")/lib.sh"

PROBE="$REPO_ROOT/scripts/probe-harness-capabilities.sh"
# RED at 6e4601ab5740500706f6fe06b0f4af5974c84555: case 1 against the unmodified script exited 1, stderr "error: agy structured probe failed (exit 1)" because the paid command still passed --model gemini-3.6-flash-high and the 3.8-only fake rejected it.

install_version_fake() {
  local name="$1" version="$2"
  cat > "$BIN/$name" <<EOF
#!/usr/bin/env bash
case "\${1:-}" in
  --version) printf '%s\n' '$version'; exit 0 ;;
  --help) printf '%s help\n' '$name'; exit 0 ;;
  *) printf '%s unexpected: %s\n' '$name' "\$*" >&2; exit 1 ;;
esac
EOF
  chmod +x "$BIN/$name"
}

install_agy() {
  local mode="$1"
  cat > "$BIN/agy" <<EOF
#!/usr/bin/env bash
printf '%s\n' "\$*" >> "$AGY_LOG"
case "\${1:-}" in
  --version) printf '1.4.5\n'; exit 0 ;;
  --help) printf 'agy help -p --model\n'; exit 0 ;;
  models)
    if [ "$mode" = flash ]; then
      printf 'gemini-3.8-flash-low\tGemini 3.8 Flash (Low)\n'
      printf 'gemini-3.8-flash-medium\tGemini 3.8 Flash (Medium)\n'
      printf 'gemini-3.8-flash-high\tGemini 3.8 Flash (High)\n'
    else
      printf 'gemini-4-argon-high\tGemini 4 Argon (High)\n'
    fi
    exit 0
    ;;
  # BL-0298: the paid probe sends its prompt on stdin as stream-json; a -p on argv is a bug.
  --model|-p)
    [ "\${1:-}" = "-p" ] && { printf 'agy -p on argv is not the stdin transport\n' >&2; exit 2; }
    cat >> "$AGY_STDIN"
    model=""
    prev=""
    for arg in "\$@"; do
      if [ "\$prev" = "--model" ]; then model="\$arg"; fi
      prev="\$arg"
    done
    case "\$model" in
      gemini-3.8-flash-low|gemini-3.8-flash-medium|gemini-3.8-flash-high)
        printf '%s\n' '{"event":"result","result":{"status":"SUCCESS","response":"AGY_CAPABILITY_OK","usage":{"cache_read_tokens":1,"input_tokens":2,"output_tokens":3,"thinking_tokens":4,"total_tokens":10}}}'
        exit 0
        ;;
      *)
        printf 'model %s is not recognized\n' "\$model" >&2
        exit 1
        ;;
    esac
    ;;
  *) printf 'agy unexpected: %s\n' "\$*" >&2; exit 1 ;;
esac
EOF
  chmod +x "$BIN/agy"
}

setup_fakes() {
  BIN="$TEST_TMP/bin"
  AGY_LOG="$TEST_TMP/agy.log"
  AGY_STDIN="$TEST_TMP/agy.stdin"
  export AGY_STDIN
  mkdir -p "$BIN" "$TEST_TMP/home"
  : > "$AGY_LOG"
  export PATH="$BIN:$PATH"
  export HOME="$TEST_TMP/home"
  install_version_fake codex "codex-cli 0.163.0"
  install_version_fake grok "grok 1.0.67"
  install_version_fake opencode "opencode 1.19.4"
  install_version_fake claude "claude 2.1.308"
}

setup_fakes
install_agy flash
OUT_JSON="$TEST_TMP/claims.json"
set +e
OUT="$(bash "$PROBE" --all --output "$OUT_JSON" 2>"$TEST_TMP/probe.err")"
EXIT=$?
set -e
assert_exit_code "$EXIT" 0 "3.8 inventory probe exits 0"
assert_file_exists "$OUT_JSON" "claims file written"
assert_contains "$(cat "$OUT_JSON")" "gemini-3.8-flash-high" "agy claims bind to the resolved 3.8 high id"
# Every --model the fake saw must be a listed id.
while IFS= read -r line; do
  case "$line" in
    --model*)
      model=""
      prev=""
      for arg in $line; do
        if [ "$prev" = "--model" ]; then model="$arg"; fi
        prev="$arg"
      done
      case "$model" in
        gemini-3.8-flash-low|gemini-3.8-flash-medium|gemini-3.8-flash-high) ;;
        *) fail "fake agy -p saw a model outside its list: $model" ;;
      esac
      ;;
  esac
done < "$AGY_LOG"
assert_contains "$(grep -- '--input-format' "$AGY_LOG")" "gemini-3.8-flash-high" "paid probe used the resolved id"
# BL-0298: the prompt travels on stdin, never on argv.
assert_contains "$(cat "$AGY_STDIN")" "Return exactly AGY_CAPABILITY_OK" "paid probe prompt arrived on stdin"
assert_not_contains "$(cat "$AGY_LOG")" "Return exactly" "paid probe argv does not carry the prompt"
assert_not_contains "$(cat "$AGY_LOG")" " -p " "paid probe argv has no -p"

install_agy noflash
: > "$AGY_LOG"
set +e
bash "$PROBE" --all --output "$TEST_TMP/neg.json" >"$TEST_TMP/neg.out" 2>"$TEST_TMP/neg.err"
NEG_EXIT=$?
set -e
assert_neq "0" "$NEG_EXIT" "missing flash inventory fails closed"
assert_contains "$(cat "$TEST_TMP/neg.err")" "no current canonical model" "stderr carries the library reason"
assert_not_contains "$(cat "$AGY_LOG")" "--input-format" "failed resolution never makes the paid agy call"

assert_not_contains "$(cat "$PROBE")" "gemini-3.6" "probe script has no gemini-3.6 literal"

finalize_test
