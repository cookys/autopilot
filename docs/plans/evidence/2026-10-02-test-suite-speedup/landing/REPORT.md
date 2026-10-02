# land-speed REPORT
Picks -> landed (rewords, rebased onto origin/develop):
d15a45a5 release(v2.36.106): test suite speedup — shards, L2 wrapper dedupe, bash JSON e
3a542f0d fix(test-suite): pure-bash JSON escape in foreman-guard-roles (test-suite speedup
d309aba2 fix(test-suite): shard dispatch-review into a/b/c (test-suite speedup row 4)
c14498b9 fix(test-suite): split engine-qualify suite into a/b/badmode shards (test-suite s
e3f7591d fix(test-suite): shard resolve-review-loop into 4 files (test-suite speedup row 2
00be0eaf fix(test-suite): dedupe wrappers that re-ran L1 scripts/*.test.js (test-suite spe
Gate (full suite once, --parallel 16): 378 files, wall 1164s, 1 red (dispatch-hetero-watchdog-followups zombie case, load timing; solo reruns 2x 28/28 pass; not pre-existing-checked at base since green solo). check-js-syntax, sync --check, validate.sh: rc=0. The slash-entry-probe FAIL lines in full.log are expected fixture output inside a passing test.
Slowest 10 (s): 205 hooks/tests/engine-qualify-badmode.test.sh;186 hooks/tests/resolve-review-loop-d.test.sh;184 hooks/tests/autopilot-engine.test.sh;181 hooks/tests/engine-qualify-a.test.sh;179 hooks/tests/resolve-review-loop-b.test.sh;165 hooks/tests/engine-qualify-b.test.sh;161 hooks/tests/dispatch-plan-review.test.sh;159 hooks/tests/review-runner.test.sh;153 hooks/tests/resolve-review-loop-c.test.sh;147 hooks/tests/resolve-review-loop-a.test.sh;
Review: claude-fable-5-1 SHIP-AS-IS, id 3F6F2W (raw_log /tmp/dispatch-review-log-3F6F2W; manifest carries no id field), 4 blue follow-ups in CHANGELOG.
Version v2.36.106; preflight-release 9/9; pushed SHA d15a45a530e933d9f6f7b50e9c170eeeb32071a4 (ls-remote == HEAD).
