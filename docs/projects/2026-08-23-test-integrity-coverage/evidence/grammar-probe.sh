#!/usr/bin/env bash
# Present one candidate line at a time to the REAL gate as an added line in a
# matched test file, and report whether skip_marker fires.
set -uo pipefail
W="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
FIX="$(mktemp -d "${TMPDIR:-/tmp}/evasion.XXXXXX")"
trap 'rm -rf "$FIX"' EXIT
mkdir -p "$FIX/.claude" "$FIX/hooks/tests"
git -C "$FIX" init -q
git -C "$FIX" config user.email e@e.invalid; git -C "$FIX" config user.name e
printf "## Mode\nmode: warn\n\n## Test Paths\n- '**/*.test.sh'\n" > "$FIX/.claude/test-integrity-config.md"
printf '#!/usr/bin/env bash\necho base\n' > "$FIX/hooks/tests/s.test.sh"
git -C "$FIX" add -A; git -C "$FIX" commit -qm base
git -C "$FIX" tag base

probe() { # probe <label> <line> <expect: CATCH|CLEAN>
  local label="$1" line="$2" want="$3"
  git -C "$FIX" reset -q --hard base >/dev/null; git -C "$FIX" clean -qfd
  printf '#!/usr/bin/env bash\necho base\n%s\n' "$line" > "$FIX/hooks/tests/s.test.sh"
  git -C "$FIX" add -A >/dev/null; git -C "$FIX" commit -qm p >/dev/null
  local out got
  out="$(bash "$W/scripts/check-test-integrity.sh" validate --no-l1 --range base..HEAD --repo "$FIX" 2>&1)"
  if printf '%s' "$out" | grep -q '"kind": "skip_marker"'; then got=CATCH; else got=CLEAN; fi
  if [ "$got" = "$want" ]; then printf '  ok    %-8s %-46s %s\n' "$got" "$label" ""
  else printf '  FAIL  got=%-7s want=%-7s %-40s\n' "$got" "$want" "$label"; fi
}

echo "=== A: command position ==="
probe "A1  line start"          'skip "r"'                       CATCH
probe "A2  after ;"             'true; skip "r"'                 CATCH
probe "A3  after &&"            'true && skip "r"'               CATCH
probe "A4  after ||"            'false || skip "r"'              CATCH
probe "A5  after pipe"          'echo x | skip'                  CATCH
probe "A6  after &"             'true & skip "r"'                CATCH
probe "A7  subshell ("          '( skip "r" )'                   CATCH
probe "A8  group {"             '{ skip "r"; }'                  CATCH
probe "A9  then"                'if true; then skip "r"; fi'     CATCH
probe "A9  else"                'if false; then :; else skip; fi' CATCH
probe "A9  elif"                'if a; then :; elif b; then skip "r"; fi' CATCH
probe "A9  do"                  'for i in 1; do skip "r"; done'  CATCH
probe "A10 negation !"          '! skip "r"'                     CATCH
probe "A12 cmd subst"           'x=$( skip "r" )'                CATCH
probe "A13 backtick"            'x=`skip "r"`'                   CATCH
probe "A15 assignment prefix"   'FOO=bar skip "r"'               CATCH
probe "A15 two assignments"     'A=1 B=2 skip "r"'               CATCH
echo "=== A: deliberately excluded / named-uncovered ==="
probe "A17 case pattern (excl)" 'case $x in skip) :;; esac'      CLEAN
probe "A14 time prefix (unc)"   'time skip "r"'                  CLEAN
probe "A16 redirect pfx (unc)"  '>/dev/null skip "r"'            CLEAN
echo "=== B: non-comment hash must survive the scanner ==="
probe "B1  brace-hash length"   '[ "${#XS[@]}" -eq 0 ] && skip "r"' CATCH
probe "B2  dollar-hash argc"    '[ $# -eq 0 ] && skip "r"'       CATCH
probe "B3  dquote hash"         'printf " #" && skip "r"'        CATCH
probe "B4  squote hash"         "printf ' #' && skip \"r\""      CATCH
probe "B5  escaped hash"        'printf \# && skip "r"'          CATCH
probe "B6  mid-word hash"       'echo a#b && skip "r"'           CATCH
probe "B7  ANSI-C quote"        "printf \$'a#b' && skip \"r\""   CATCH
echo "=== B: real comments still removed ==="
probe "real trailing comment"   'echo hi   # skip "r"'           CLEAN
probe "real full-line comment"  '# skip "r"'                     CLEAN
probe "comment after ;"         'true ;# skip "r"'               CLEAN
echo "=== C: tails ==="
probe "C1  blank + arg"         'skip "r"'                       CATCH
probe "C2  EOL bare"            'skip'                           CATCH
probe "C3  semicolon"           'skip;'                          CATCH
probe "C4  ampersand"           'skip &'                         CATCH
probe "C5  pipe"                'skip | cat'                     CATCH
probe "C6  close paren"         '( skip )'                       CATCH
probe "C7  brace (excluded)"    'echo "${skip}"'                 CLEAN
probe "C8  definition ()"       'skip() { :; }'                  CLEAN
probe "C8  definition sp ()"    'skip () { :; }'                 CLEAN
probe "C9  assignment"          'skip=1'                         CLEAN
probe "C10 word continuation"   'skipped=1'                      CLEAN
probe "C10 skipping word"       'echo skipping'                  CLEAN
echo "=== D: data vs code ==="
probe "D1  skip inside squote"  "sed -i '1a skip \"x\"' f"       CLEAN
probe "D1  skip inside dquote"  'echo "skip \"x\""'              CLEAN
probe "D2  eval string (unc)"   'eval "skip"'                    CLEAN
