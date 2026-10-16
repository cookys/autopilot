#!/usr/bin/env bash
# build-fixture.sh — writes the shared synthetic "plugin repo" of the qs row into the CURRENT directory (before the frozen base commit).
# 24 stub suites under hooks/tests/ (each appends its own path to <git-common-dir>/run.log and exits 0), a stub hooks/tests/run.sh that
# runs them all, mods/live/run-tests.sh (stub extra runner), and a planted mention graph so the required suites are known BY CONSTRUCTION:
#   group NN (01..07): scripts/lib/libNN.js <-require- scripts/gNN.js ; suites gNN-lib (names libNN.js) / gNN-script / gNN-extra (name gNN.js)
#   standalone: hooks/tests/solo.test.sh names scripts/solo.js ; hooks/tests/mods-panel.test.sh names panel.ts
#   always-run (names fixed by the frozen selector's ALWAYS_RUN): check-js-syntax.test.sh, codex-plugin-package.test.sh
# 7*3 + solo + mods-panel + 2 always = 25 -> g07 has only lib+script suites => 24 total.
set -euo pipefail
mkdir -p hooks/tests hooks scripts/lib mods/live docs
logline() { printf 'echo "%s" >> "$(git rev-parse --git-common-dir)/run.log"\n' "$1"; }
mksuite() { # $1 = name  $2.. = extra comment lines naming files the suite "covers"
  local f="hooks/tests/$1.test.sh"; shift
  { echo '#!/usr/bin/env bash'; echo 'set -e'; for c in "$@"; do echo ": $c"; done; logline "${f}"; echo 'exit 0'; } > "$f"
  chmod +x "$f"
}
for n in 01 02 03 04 05 06 07; do
  printf "'use strict';\nmodule.exports = { label: 'alpha-%s' };\n" "$n" > "scripts/lib/lib$n.js"
  printf "'use strict';\nconst lib = require('./lib/lib%s');\nconsole.log(lib.label);\n" "$n" > "scripts/g$n.js"
  mksuite "g$n-lib" "lib$n.js"
  mksuite "g$n-script" "g$n.js"
  [ "$n" = 07 ] || mksuite "g$n-extra" "g$n.js"
done
printf "'use strict';\nconsole.log('solo');\n" > scripts/solo.js
mksuite solo "solo.js"
printf 'export const panel = 1;\n' > mods/live/panel.ts
mksuite mods-panel "panel.ts"
mksuite check-js-syntax "all-js"
mksuite codex-plugin-package "mirror"
{ echo '#!/usr/bin/env bash'; echo 'set -e'; logline "mods/live/run-tests.sh"; echo 'exit 0'; } > mods/live/run-tests.sh
{ echo '#!/usr/bin/env bash'; echo '# stub whole-suite runner'; echo 'set -e'; echo 'cd "$(git rev-parse --show-toplevel)"'
  echo 'for t in hooks/tests/*.test.sh; do bash "$t"; done'; echo 'echo "run.sh done"'; } > hooks/tests/run.sh
chmod +x hooks/tests/run.sh mods/live/run-tests.sh
printf '{ "hooks": [] }\n' > hooks/hooks.json
printf '# guide\n\nFixture docs.\n' > docs/guide.md
printf '# fixture repo\n' > README.md
# .claude/quality-gate-config.md is NOT written here: it ships in the frozen pack fixture-config-qs (fixture_scripts, identical in both arms)
