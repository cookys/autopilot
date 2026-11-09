#!/usr/bin/env bash
# hooks/tests/git-config-isolation-audit.test.sh — repo audit: a test that builds a fixture git repo must not run the account's
# global/system git config (core.hooksPath hooks such as the lab hook, templateDir, filters).
#
# Incident: skill-onoff-g8.test.sh `git init` + `git commit` ran the real HOME's global core.hooksPath, so a host hook fired 21 times
# on fixture commits (gitleaks false positives, PM 01M6YVEDH1). Mechanism: scripts/lib/test-git-env.{sh,js} export
# GIT_CONFIG_GLOBAL=scripts/lib/test-gitconfig + GIT_CONFIG_NOSYSTEM=1; hooks/tests/lib.sh sources the sh one.
#
# Rule: every tracked test file (*.test.sh / *.test.js / *.test.mjs), every fixture-builder file (hooks/tests/lib/*, scripts/lib/*.{sh,js,mjs},
# any *fixture* / *helper* .sh/.js/.mjs) and their platforms/codex mirror copies whose code creates a repo must, in code, source lib.sh,
# source or require test-git-env, or ASSIGN GIT_CONFIG_GLOBAL itself (an intentional own config; reading or unsetting it does not count). Comments do not count. "Creates a repo"
# is matched against the comment-stripped WHOLE file, so every spelling counts: a bare line, a quoted shell string (execSync("git init x"),
# sh -c "git clone ..."), and an argv split over lines (execFileSync('git', [ newline 'init' ])).
# Out of scope by design: docs/, the frozen eval packs under evals/skill-onoff/packs/ (byte-pinned copies), and the byte-frozen
# hooks/tests/fixtures/backlog-gate-legacy-*.js (run only by backlog-gate-legacy-parity.test.sh, which sources lib.sh).
# Negative control: the same listing + scan over a fixture git repo holding one unisolated file per spelling and per path must flag each.
. "$(dirname "$0")/lib.sh"

scan() { # scan <root> <file>... -> prints each offending file
  node - "$@" <<'NODE'
const fs = require('fs'); const path = require('path');
const root = process.argv[2];
const isolated = [
  /^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*(?:\.|source)\s+[^#\n]*(?:\/|")lib\.sh/m,
  /^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*(?:\.|source)\s+[^#\n]*test-git-env\.sh/m,
  /require\([^)]*test-git-env/,
  /(?<![\w$])GIT_CONFIG_GLOBAL=(?!=)/,
  /(?<![\w${])GIT_CONFIG_GLOBAL['"]?\s*:/,
  /\.GIT_CONFIG_GLOBAL\s*=(?!=)/,
  /\[\s*['"]GIT_CONFIG_GLOBAL['"]\s*\]\s*=(?!=)/,
];
const creates = [
  /(^|[\s;|&(`$'"])git(\s+-C\s+\S+|\s+-c\s+\S+)*\s+(init|clone)\b/,
  /(\bgit\w*\(|['"]git['"])[^;]{0,300}?['"](init|clone)['"]/,
];
for (const rel of process.argv.slice(3)) {
  let text; try { text = fs.readFileSync(path.join(root, rel), 'utf8'); } catch { continue; }
  const code = text.split('\n').filter((l) => !/^\s*(#|\/\/|\*|\/\*)/.test(l)).join('\n');
  if (!creates.some((re) => re.test(code))) continue;
  if (isolated.some((re) => re.test(code))) continue;
  process.stdout.write(rel + '\n');
}
NODE
}

list_files() { # list_files <repo> -> tracked files in audit scope (platforms/codex mirrors match the same globs)
  git -C "$1" ls-files -- '*.test.sh' '*.test.js' '*.test.mjs' 'hooks/tests/lib/*' 'scripts/lib/*.sh' 'scripts/lib/*.js' 'scripts/lib/*.mjs' \
    'platforms/codex/plugin/hooks/tests/lib/*' 'platforms/codex/plugin/scripts/lib/*.sh' 'platforms/codex/plugin/scripts/lib/*.js' 'platforms/codex/plugin/scripts/lib/*.mjs' \
    '*fixture*.sh' '*fixture*.js' '*fixture*.mjs' '*helper*.sh' '*helper*.js' '*helper*.mjs' \
    ':!docs' ':!evals/skill-onoff/packs' ':!hooks/tests/fixtures/backlog-gate-legacy-*.js' | sort -u
}

mapfile -t FILES < <(list_files "$REPO_ROOT")
[ "${#FILES[@]}" -gt 100 ] || fail "tracked test file listing looks wrong: ${#FILES[@]}"
OFFENDERS="$(scan "$REPO_ROOT" "${FILES[@]}")"
assert_eq "" "$OFFENDERS" "every fixture-repo test isolates the global git config"

# Negative control: unisolated copies must be flagged (one per spelling and per path); isolated and comment-only variants must not.
FX="$TEST_TMP/fx"; mkdir -p "$FX/scripts/lib" "$FX/platforms/codex/plugin/hooks/tests/lib" "$FX/platforms/codex/plugin/scripts/lib" "$FX/docs"
git init -q "$FX" >/dev/null 2>&1
printf '%s\n' '#!/usr/bin/env bash' 'git init -q repo' 'git -C repo commit -q --allow-empty -m x' > "$FX/bad-sh.test.sh"
printf '%s\n' "const { execFileSync } = require('child_process');" "execFileSync('git', ['init', '-q', 'r']);" > "$FX/bad-js.test.js"
printf '%s\n' "const { execSync } = require('child_process');" 'execSync("git init -q r");' > "$FX/bad-dq.test.js"
printf '%s\n' "const { execSync } = require('child_process');" "execSync('git clone -q a b');" > "$FX/bad-sq.test.js"
printf '%s\n' '#!/usr/bin/env bash' 'sh -c "git init -q r"' > "$FX/bad-shc.test.sh"
printf '%s\n' "const { execFileSync } = require('child_process');" "execFileSync('git', [" "  'init'," "  '-q', 'r',"  ']);' > "$FX/bad-multiline.test.js"
printf '%s\n' "const { execFileSync } = require('child_process');" "execFileSync('git', [" "  '-C', 'r',"  "  'clone', 'a',"  ']);' > "$FX/bad-multiline-c.test.js"
printf '%s\n' "execFileSync('git', ['init', 'r']);" > "$FX/scripts/lib/make-fixture.js"
printf '%s\n' '#!/usr/bin/env bash' 'git init -q repo' > "$FX/platforms/codex/plugin/hooks/tests/bad-mirror.test.sh"
printf '%s\n' "execFileSync('git', ['init', 'r']);" > "$FX/platforms/codex/plugin/scripts/lib/mk-repo.js"
printf '%s\n' '#!/usr/bin/env bash' 'git init -q repo' > "$FX/platforms/codex/plugin/hooks/tests/lib/mk.sh"
printf '%s\n' '#!/usr/bin/env bash' 'unset GIT_CONFIG_GLOBAL' 'git init -q repo' > "$FX/bad-unset.test.sh"
printf '%s\n' "execFileSync('git', ['init', 'r']);" > "$FX/docs/skipped.test.js"
printf '%s\n' '#!/usr/bin/env bash' 'export GIT_CONFIG_GLOBAL=/x/cfg' 'git init -q repo' > "$FX/good-assign.test.sh"
printf '%s\n' '#!/usr/bin/env bash' '. "$(dirname "$0")/lib.sh"' 'git init -q repo' > "$FX/good-lib.test.sh"
printf '%s\n' "require('./lib/test-git-env');" "execFileSync('git', ['init']);" > "$FX/good-js.test.js"
printf '%s\n' "require('./lib/test-git-env');" "execFileSync('git', [" "  'init'," ']);' > "$FX/good-multiline.test.js"
printf '%s\n' '#!/usr/bin/env bash' '# . lib.sh' 'git init -q repo' > "$FX/bad-comment.test.sh"
printf '%s\n' '#!/usr/bin/env bash' 'git status' > "$FX/nogit.test.sh"
git -C "$FX" add -A >/dev/null 2>&1
mapfile -t FXFILES < <(list_files "$FX")
GOT="$(scan "$FX" "${FXFILES[@]}" | sort | tr '\n' ' ')"
assert_eq "bad-comment.test.sh bad-dq.test.js bad-js.test.js bad-multiline-c.test.js bad-multiline.test.js bad-shc.test.sh bad-sh.test.sh bad-sq.test.js bad-unset.test.sh platforms/codex/plugin/hooks/tests/bad-mirror.test.sh platforms/codex/plugin/hooks/tests/lib/mk.sh platforms/codex/plugin/scripts/lib/mk-repo.js scripts/lib/make-fixture.js " "$GOT" "scanner flags exactly the unisolated fixtures"

# The shared mechanism itself: sourcing the shared snippet leaves fixture git blind to a hostile global config.
HOSTILE="$TEST_TMP/hostile"; mkdir -p "$HOSTILE/hooks"
printf '#!/bin/sh\ntouch "%s/hook-ran"\n' "$HOSTILE" > "$HOSTILE/hooks/pre-commit"; chmod +x "$HOSTILE/hooks/pre-commit"
printf '[core]\n\thooksPath = %s/hooks\n[user]\n\tname = h\n\temail = h@h\n' "$HOSTILE" > "$HOSTILE/gitconfig"
fixture_commit() { # fixture_commit <name> -> runs a fixture commit under the current env
  git init -q "$HOSTILE/$1" && git -C "$HOSTILE/$1" commit -q --allow-empty -m x
}
( export GIT_CONFIG_GLOBAL="$HOSTILE/gitconfig"; unset GIT_CONFIG_NOSYSTEM; fixture_commit control >/dev/null 2>&1 )
assert_file_exists "$HOSTILE/hook-ran" "control: the hostile global hook fires without the snippet"
rm -f "$HOSTILE/hook-ran"
( export GIT_CONFIG_GLOBAL="$HOSTILE/gitconfig"; . "$REPO_ROOT/scripts/lib/test-git-env.sh"; fixture_commit isolated >/dev/null 2>&1 )
assert_file_absent "$HOSTILE/hook-ran" "isolated: test-git-env.sh keeps the global hook from firing"
JSOUT="$(GIT_CONFIG_GLOBAL="$HOSTILE/gitconfig" node -e "require('$REPO_ROOT/scripts/lib/test-git-env'); const {execFileSync:x}=require('child_process'); x('git',['init','-q','$HOSTILE/jsiso']); x('git',['-C','$HOSTILE/jsiso','commit','-q','--allow-empty','-m','x'])" 2>&1)"
assert_file_absent "$HOSTILE/hook-ran" "isolated: test-git-env.js keeps the global hook from firing${JSOUT:+ ($JSOUT)}"

finalize_test
