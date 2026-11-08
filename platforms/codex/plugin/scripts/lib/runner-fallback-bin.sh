#!/usr/bin/env bash
# runner-fallback-bin.sh — where a bare runner binary name resolves when it is NOT on PATH.
#
# WHY: on the team account `codex` and `agy` live in ~/.local/bin and `grok` in ~/.grok/bin
# (also ~/.local/bin), and a normal session PATH holds neither. The dispatchers ran
# `command -v codex` and refused with "binary not found" even though the runner was installed,
# so a plan-review seat was lost for a reason that has nothing to do with the model.
#
# CONTRACT: runner_bin_fallback <name-or-path>
#   - a value containing "/" (an explicit --bin / --codex-bin path) is returned untouched;
#   - a bare name that PATH resolves is returned untouched (PATH always wins, so a sentinel or
#     fixture dir placed first on PATH is what runs, never the real runner);
#   - only when PATH misses does it look at the fixed per-runner locations below under $HOME and
#     return the first executable regular file, as an absolute path;
#   - AUTOPILOT_RUNNER_HOME_FALLBACK=off turns the HOME lookup off (default on): a test that removes a
#     runner from PATH on purpose must not find the real ~/.local/bin/codex and spend money. The shell
#     suite lib (hooks/tests/lib.sh) exports off; only runner-fallback-bin.test.sh turns it on, with a fixture HOME;
#   - otherwise it returns the name unchanged and the caller's own `command -v` refuses as before.
# It never exits or dies (callers run it inside `$( )`).
#
# The table is mirrored by RUNNER_BINARY_FALLBACK_PATHS in scripts/lib/runner-binary.js (the JS
# resolvers: topology, version probe); hooks/tests/runner-fallback-bin.test.sh asserts they agree.
#
#   CODEX_BIN="$(runner_bin_fallback "${BIN:-codex}")"
runner_bin_fallback() {
  local name="${1-}" rel rels
  case "$name" in
    ""|*/*) printf '%s' "$name"; return 0 ;;
  esac
  if command -v "$name" >/dev/null 2>&1; then
    printf '%s' "$name"
    return 0
  fi
  case "$name" in
    codex) rels=".local/bin/codex" ;;
    agy)   rels=".local/bin/agy" ;;
    grok)  rels=".grok/bin/grok .local/bin/grok" ;;
    kimi)  rels=".kimi-code/bin/kimi" ;;
    *)     rels="" ;;
  esac
  if [ "${AUTOPILOT_RUNNER_HOME_FALLBACK:-on}" != "off" ] && [ -n "${HOME:-}" ]; then
    for rel in $rels; do
      if [ -f "$HOME/$rel" ] && [ -x "$HOME/$rel" ]; then
        printf '%s' "$HOME/$rel"
        return 0
      fi
    done
  fi
  printf '%s' "$name"
}
