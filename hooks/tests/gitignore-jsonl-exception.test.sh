#!/usr/bin/env bash
# A contributor-global `*.jsonl` ignore (core.excludesFile) must not hide committed fixtures or
# plan evidence: the repo .gitignore carries the exception, and the repo file outranks the
# global one (gitignore(5), order of precedence). Negative control: the same temp repo WITHOUT
# the exception lines must report the fixture path as ignored.
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
pass=0; fail=0
ok() { echo "PASS: $1"; pass=$((pass+1)); }
bad() { echo "FAIL: $1"; fail=$((fail+1)); }
echo '*.jsonl' > "$T/global-ignore"
mkrepo() { # name gitignore-file
  git init -q "$T/$1"; cp "$2" "$T/$1/.gitignore"
  mkdir -p "$T/$1/hooks/tests/fixtures/x/sub" "$T/$1/docs/plans/evidence/p" "$T/$1/other"
  : > "$T/$1/hooks/tests/fixtures/x/sub/a.jsonl"; : > "$T/$1/docs/plans/evidence/p/b.jsonl"; : > "$T/$1/other/c.jsonl"
}
ignored() { git -C "$T/$1" -c core.excludesFile="$T/global-ignore" check-ignore -q "$2"; }
mkrepo with "$ROOT/.gitignore"
ignored with hooks/tests/fixtures/x/sub/a.jsonl && bad "fixture jsonl is ignored despite the repo exception" || ok "fixture jsonl is not ignored with the repo .gitignore"
ignored with docs/plans/evidence/p/b.jsonl && bad "plan-evidence jsonl is ignored despite the repo exception" || ok "plan-evidence jsonl is not ignored with the repo .gitignore"
ignored with other/c.jsonl && ok "a jsonl outside the two exception trees is still ignored by the global rule (scope is narrow)" || bad "exception is too broad"
grep -v -E '^!(hooks/tests/fixtures|docs/plans/evidence)/' "$ROOT/.gitignore" > "$T/gi-noexc"
mkrepo without "$T/gi-noexc"
ignored without hooks/tests/fixtures/x/sub/a.jsonl && ok "negative control: without the exception the fixture jsonl IS ignored" || bad "negative control did not go red (global ignore not applied?)"
echo "gitignore-jsonl-exception harness: $pass passed, $fail failed"
[ "$fail" = 0 ]
