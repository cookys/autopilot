# shellcheck shell=bash
# hooks/tests/lib/hippo-sandbox.sh - C6 isolation harness for suites that run the real hippo binary (plan
# 2026-11-02-oc-a3-writers-use-hippo, §2.5 C6). Source it AFTER hooks/tests/lib.sh (needs TEST_TMP, REPO_ROOT, fail, assert_*):
#   . "$(dirname "$0")/lib.sh"; . "$(dirname "$0")/lib/hippo-sandbox.sh"; hs_setup
#
# hs_setup builds, under TEST_TMP: a sandbox HOME, a temp HIPPO_CONFIG_DIR, HIPPO_ACTOR=test/a3, a fixed git identity (author and
# committer env, plus a global gitconfig file copied from scripts/lib/test-gitconfig: identity only, no hooksPath), scrubs the
# caller's git environment (every repo-selecting name, GIT_CONFIG_PARAMETERS/COUNT and every GIT_CONFIG_KEY_<n>/VALUE_<n>), and
# records this checkout's `git status --porcelain` and `.hippo/` listing; an EXIT trap asserts both are unchanged.
#   hs_mkrepo <name> [store]   temp git repo $HS_ROOT/<name> (one empty commit); with `store`, `hippo init --visibility internal`
#   hs_preflight <repo>        asserts toplevel == path and core.hooksPath empty or inside the temp tree; returns 1 otherwise
#   hs_corrupt_record <repo>   C1's sole exception: append garbage to one record file, only after asserting it is under TEST_TMP
#   hs_slow_hippo              prints a HIPPO_BIN wrapper that sleeps before `new` (makes unlocked races deterministic)
#   hs_leak_guard              writes a stand-in leak pattern (hostx-[a-z0-9]+) into HIPPO_CONFIG_DIR/leak-guard.toml
# Double-source is a no-op.
[ -n "${_HS_SOURCED:-}" ] && return 0
_HS_SOURCED=1

hs_scrub_git_env() {
  local v
  for v in GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_PREFIX \
           GIT_CONFIG_PARAMETERS GIT_CONFIG_COUNT GIT_TEMPLATE_DIR; do
    unset "$v"
  done
  # shellcheck disable=SC2046
  unset $(compgen -e | grep -E '^GIT_CONFIG_(KEY|VALUE)_[0-9]+$' || true)
}

hs_setup() {
  hs_scrub_git_env
  HS_ROOT="$TEST_TMP/hs"
  mkdir -p "$HS_ROOT/home/.config" "$HS_ROOT/hippo-config"
  # shellcheck disable=SC2034
  HS_REAL_HOME="$HOME"
  export HOME="$HS_ROOT/home" XDG_CONFIG_HOME="$HS_ROOT/home/.config" HIPPO_CONFIG_DIR="$HS_ROOT/hippo-config"
  export HIPPO_ACTOR="test/a3"
  export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
  cp "$REPO_ROOT/scripts/lib/test-gitconfig" "$HOME/.gitconfig"
  export GIT_CONFIG_GLOBAL="$HOME/.gitconfig" GIT_CONFIG_NOSYSTEM=1
  HS_CHECKOUT_BEFORE="$(hs_checkout_state)"
  __HS_TOP_BASHPID="$BASHPID"
  trap 'hs_exit_check; cleanup_test_tmp' EXIT
}

hs_checkout_state() {
  git -C "$REPO_ROOT" status --porcelain
  echo "--- .hippo"
  if [ -d "$REPO_ROOT/.hippo" ]; then find "$REPO_ROOT/.hippo" -type f -exec cksum {} + | sort; fi
}

hs_exit_check() {
  [ "$BASHPID" = "$__HS_TOP_BASHPID" ] || return 0
  local after
  after="$(hs_checkout_state)"
  if [ "$after" != "$HS_CHECKOUT_BEFORE" ]; then
    echo "FAIL [hippo-sandbox] this checkout's git status or .hippo/ changed during the suite" >&2
    diff <(printf '%s\n' "$HS_CHECKOUT_BEFORE") <(printf '%s\n' "$after") >&2
    exit 1
  fi
}

# hs_preflight <repo>: C6 pre-flight. Reads git config the way a fixture commit would see it.
hs_preflight() {
  local repo="$1" top real val tmp
  top="$(git -C "$repo" rev-parse --show-toplevel 2>/dev/null)" || return 1
  real="$(cd "$repo" && pwd -P)"
  [ "$top" = "$real" ] || { echo "preflight: toplevel $top != $real" >&2; return 1; }
  val="$(git -C "$repo" config --get core.hooksPath 2>/dev/null || true)"
  [ -z "$val" ] && return 0
  case "$val" in /*) ;; *) val="$real/$val" ;; esac   # a relative hooksPath is resolved from the worktree top
  val="$(realpath -m "$val")"
  tmp="$(cd "$TEST_TMP" && pwd -P)"
  case "$val" in
    "$tmp"/*) return 0 ;;
  esac
  echo "preflight: core.hooksPath value $val is outside the temp tree" >&2
  return 1
}

hs_mkrepo() {
  local name="$1" store="${2:-}" repo="$HS_ROOT/$1"
  git init -q --template= "$repo" || fail "hs_mkrepo: git init $name"
  git -C "$repo" commit -q --allow-empty -m init || fail "hs_mkrepo: commit $name"
  hs_preflight "$repo" || fail "hs_mkrepo: pre-flight failed for $name"
  if [ "$store" = store ]; then
    "$HIPPO_BIN" --json -C "$repo" init --visibility internal --id "hs-$name" >/dev/null || fail "hs_mkrepo: hippo init $name"
  fi
  printf '%s' "$repo"
}

hs_corrupt_record() {
  local repo="$1" f
  case "$repo" in "$TEST_TMP"/*) ;; *) fail "hs_corrupt_record: $repo is not under TEST_TMP" ;; esac
  f="$(find "$repo/.hippo/records" -type f | head -1)"
  [ -n "$f" ] || fail "hs_corrupt_record: no record in $repo"
  echo "hand edit" >> "$f"
  printf '%s' "$f"
}

hs_slow_hippo() {
  local w="$HS_ROOT/slow-hippo.sh"
  if [ ! -f "$w" ]; then
    printf '#!/bin/sh\ncase " $* " in *" new "*) sleep 0.4;; esac\nexec "%s" "$@"\n' "$HIPPO_BIN" > "$w"
    chmod +x "$w"
  fi
  printf '%s' "$w"
}

hs_leak_guard() {
  printf 'patterns = [{id="host-name", regex="hostx-[a-z0-9]+"}]\n' > "$HIPPO_CONFIG_DIR/leak-guard.toml"
}
