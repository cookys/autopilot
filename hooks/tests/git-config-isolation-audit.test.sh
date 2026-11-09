#!/usr/bin/env bash
# hooks/tests/git-config-isolation-audit.test.sh — repo audit: a test that builds a fixture git repo must not run the account's
# global/system git config (core.hooksPath hooks such as the lab hook, templateDir, filters).
#
# Incident: skill-onoff-g8.test.sh `git init` + `git commit` ran the real HOME's global core.hooksPath, so a host hook fired 21 times
# on fixture commits (gitleaks false positives, PM 01M6YVEDH1). Mechanism: scripts/lib/test-git-env.{sh,js} export
# GIT_CONFIG_GLOBAL=scripts/lib/test-gitconfig + GIT_CONFIG_NOSYSTEM=1; hooks/tests/lib.sh sources the sh one.
#
# Rule: every tracked *.test.sh / *.test.js / *.test.mjs and every hooks/tests/lib/ fixture file whose code lines create a repo
# (git init, git clone, 'init' / 'clone' as a git argv element) must, on a code line, source lib.sh, source or require test-git-env,
# or set GIT_CONFIG_GLOBAL itself (an intentional own config). Comments do not count.
# Negative control: the same scan over a fixture holding an unisolated file must flag it (and only it).
. "$(dirname "$0")/lib.sh"

scan() { # scan <root> <file>... -> prints each offending file
  node - "$@" <<'NODE'
const fs = require('fs'); const path = require('path');
const root = process.argv[2];
const isolated = [
  /^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*(?:\.|source)\s+[^#]*(?:\/|")lib\.sh/,
  /^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*(?:\.|source)\s+[^#]*test-git-env\.sh/,
  /require\([^)]*test-git-env/,
  /GIT_CONFIG_GLOBAL/,
];
const creates = [/(^|[\s;|&(`$])git(\s+-C\s+\S+|\s+-c\s+\S+)*\s+(init|clone)\b/, /(\bgit\w*\(|['"]git['"]).*['"](init|clone)['"]/];
for (const rel of process.argv.slice(3)) {
  let text; try { text = fs.readFileSync(path.join(root, rel), 'utf8'); } catch { continue; }
  const code = text.split('\n').filter((l) => !/^\s*(#|\/\/|\*|\/\*)/.test(l));
  if (!code.some((l) => creates.some((re) => re.test(l)))) continue;
  if (code.some((l) => isolated.some((re) => re.test(l)))) continue;
  process.stdout.write(rel + '\n');
}
NODE
}

mapfile -t FILES < <(git -C "$REPO_ROOT" ls-files -- '*.test.sh' '*.test.js' '*.test.mjs' 'hooks/tests/lib/*.js' 'hooks/tests/lib/*.sh' | sort)
[ "${#FILES[@]}" -gt 100 ] || fail "tracked test file listing looks wrong: ${#FILES[@]}"
OFFENDERS="$(scan "$REPO_ROOT" "${FILES[@]}")"
assert_eq "" "$OFFENDERS" "every fixture-repo test isolates the global git config"

# Negative control: unisolated copies must be flagged; isolated and comment-only variants must not.
FX="$TEST_TMP/fx"; mkdir -p "$FX"
printf '%s\n' '#!/usr/bin/env bash' 'git init -q repo' 'git -C repo commit -q --allow-empty -m x' > "$FX/bad-sh.test.sh"
printf '%s\n' "const { execFileSync } = require('child_process');" "execFileSync('git', ['init', '-q', 'r']);" > "$FX/bad-js.test.js"
printf '%s\n' '#!/usr/bin/env bash' '. "$(dirname "$0")/lib.sh"' 'git init -q repo' > "$FX/good-lib.test.sh"
printf '%s\n' "require('./lib/test-git-env');" "execFileSync('git', ['init']);" > "$FX/good-js.test.js"
printf '%s\n' '#!/usr/bin/env bash' '# . lib.sh' 'git init -q repo' > "$FX/bad-comment.test.sh"
printf '%s\n' '#!/usr/bin/env bash' 'git status' > "$FX/nogit.test.sh"
GOT="$(scan "$FX" bad-sh.test.sh bad-js.test.js good-lib.test.sh good-js.test.js bad-comment.test.sh nogit.test.sh | sort | tr '\n' ' ')"
assert_eq "bad-comment.test.sh bad-js.test.js bad-sh.test.sh " "$GOT" "scanner flags exactly the unisolated fixtures"

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
