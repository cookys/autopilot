#!/usr/bin/env bash
# Red-check transcript generator (C9): mutate, run the guarding suite, show the exact assertions fail, restore.
set -u
cd "${REDCHECK_ROOT:?a throwaway worktree of the commit under test}" || exit 2
export TMPDIR=/tmp
RULES=scripts/lib/backlog-rules.js
RF=scripts/lib/record-files.js
redcheck() { # <label> <file> <sed expr> <suite>
  local label="$1" file="$2" expr="$3" suite="$4" bak rc
  bak="/tmp/rf-redcheck-bak.$$.$(basename "$file")"
  cp "$file" "$bak"
  echo "=== red-check: $label"
  echo "mutation: sed '$expr' $file"
  sed -i "$expr" "$file"
  if cmp -s "$file" "$bak"; then echo "MUTATION DID NOT APPLY"; cp "$bak" "$file"; return 1; fi
  diff "$bak" "$file" | sed 's/^/  /'
  echo "--- suite: hooks/tests/$suite.test.sh (mutated)"
  bash "hooks/tests/$suite.test.sh" 2>&1 | grep -E '^(FAIL|PASS)|^      - ' | head -12
  cp "$bak" "$file"
  if cmp -s "$file" "$bak"; then echo "--- restored"; else echo "RESTORE FAILED"; fi
  echo "--- suite: hooks/tests/$suite.test.sh (restored)"
  bash "hooks/tests/$suite.test.sh" 2>&1 | tail -1
  rm -f "$bak"
  echo
}
redcheck "validation: missing Problem accepted" "$RULES" "/^const WRITER_REQUIRED/s/'Origin', 'Problem', 'Impact'/'Origin', 'Impact'/" record-files
redcheck "validation: bad Trigger-Type accepted" "$RULES" "112s/return 'bad_trigger_type';/return null;/" record-files
redcheck "validation: peer without Reporter accepted" "$RULES" "306s/for (const f of missing) push('peer_field_missing', f, \`Origin peer needs \${f}\`);/for (const f of missing) void f;/" record-files
redcheck "byte-equal reply: extra byte written" "$RF" "224s/loc.lines.join('\\\\n')/loc.lines.join('\\\\n') + '\\\\n'/" record-files
redcheck "extraction is real: same Trigger-Type rule broken in backlog-rules.js, checker suite" "$RULES" "112s/return 'bad_trigger_type';/return null;/" check-backlog-entries
