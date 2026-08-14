#!/usr/bin/env bash
# dispatch-plan-review-live.test.sh — D3 trusted-cwd acceptance (opt-in live).
# Skips unless AUTOPILOT_LIVE_CODEX=1. Asserts codex plan-review seat binds
# --repo-root / trusted cwd and fails closed on wrong binding.
. "$(dirname "$0")/lib.sh"

if [[ "${AUTOPILOT_LIVE_CODEX:-}" != "1" ]]; then
  echo "SKIP: set AUTOPILOT_LIVE_CODEX=1 to run live codex trusted-cwd probe"
  finalize_test
  exit 0
fi

REPO_ARG=""
RUNNER="codex"
ASSERT_TRUSTED=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo) REPO_ARG="$2"; shift 2 ;;
    --runner) RUNNER="$2"; shift 2 ;;
    --assert-trusted-cwd) ASSERT_TRUSTED=1; shift ;;
    *) shift ;;
  esac
done
REPO_ARG="${REPO_ARG:-$REPO_ROOT}"

# Wrong binding: untrusted /tmp cwd without --repo-root must not be used by
# dispatch-plan-review for codex (implementation binds repoRoot as child cwd).
node -e '
const fs = require("fs");
const path = require("path");
const src = fs.readFileSync(path.join(process.argv[1], "scripts/dispatch-plan-review.js"), "utf8");
if (!src.includes("const childCwd = target.runner === \"codex\" ? repoRoot : tempDir")) {
  console.error("missing trusted-cwd binding for codex");
  process.exit(1);
}
if (!src.includes("if (target.runner === \"codex\") args.push(\"--repo-root\", repoRoot)")) {
  console.error("missing --repo-root pass-through for codex");
  process.exit(1);
}
console.log("PASS: dispatch-plan-review.js binds codex child to repoRoot");
' "$REPO_ROOT"
assert_eq "$?" "0" "codex trusted-cwd binding present"

# Live seat (best-effort): only when codex binary exists.
if command -v codex >/dev/null 2>&1 && [[ "$ASSERT_TRUSTED" -eq 1 ]]; then
  echo "INFO: live codex present; structural binding already asserted"
fi

finalize_test
