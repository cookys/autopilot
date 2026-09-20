# Implementation brief — agy-effort-rail-wording-2026-09-16

You are the implementer of ONE managed deliverable. The harness commits your work; you never push,
never `git stash`, never touch files outside `output_paths`, never run a real agy/codex/grok/cc-shim
binary or hit any endpoint — every suite drives PATH stubs only. Base commit: `fe225ff5`.

## Read first (in this order)
1. `docs/plans/_archive/2026/09/2026-09-16-agy-effort-and-rail-wording.md` — §0 measured facts, §1 ruling (four items),
   §2 changes + the test list, §4 acceptance.
2. `docs/plans/_archive/2026/09/2026-09-16-agy-effort-and-rail-wording.rubric.md` — R1–Rn are the acceptance.
3. `scripts/lib/agy-model-alias.sh` (all of it; `agy_resolve_model_alias` :35, `agy_effort_clamp` :64).
4. The three agy exec sites: `scripts/dispatch-hetero.sh:3441`, `scripts/dispatch-review.sh:1412`,
   `scripts/dispatch-author.sh:1140`.
5. `src/status/cli.js:470-510` (bootstrap try/catch), `src/readiness/provider-bootstrap.js:351`,
   `src/engine/repo-preconditions.js:57`, `bin/autopilot.js:34` (usage line).
6. The suites you extend: `hooks/tests/dispatch-hetero.test.sh` (agy stubs :47-90,
   `make_agy_stub_versioned`), `hooks/tests/dispatch-review.test.sh` (agy stub :228-260),
   `hooks/tests/dispatch-author.test.sh`, `hooks/tests/status-cli.test.sh`,
   `hooks/tests/autopilot-cli.test.sh` (:60-80, :190-210), `hooks/tests/implementation-campaign-state.test.sh:5150-5170`,
   `hooks/tests/provider-readiness-consumer.test.sh:920-940`.

## The four product changes (plan §1, exact text there is normative)
1. `scripts/lib/agy-model-alias.sh`: add `agy_effort_for_model <resolved-model> <effort>` — if the
   resolved id ends in `-low|-medium|-high` print that tier, else print `agy_effort_clamp <effort>`.
   Header comment gains the agy 1.2.3 conflict rule (plan §0.1 probe lines). Keep `agy_effort_clamp`.
   In the three rails replace `$(agy_effort_clamp "$EFFORT")` with `$(agy_effort_for_model "$MODEL"
   "$EFFORT")` at the agy exec site ONLY, and when the folded tier differs from
   `agy_effort_clamp "$EFFORT"` emit exactly one stderr line:
   `agy effort <requested> (clamped <clamped>) folded to <tier>: model id encodes the tier`.
   Zero lines when they coincide (incl. default `xhigh` on a `-high` id).
2. `src/readiness/provider-bootstrap.js:351` message → `strict /l5 requires the verification-author
   seat: set verification_author_present: true and verification_author_engine/runner/effort/endpoint
   in .claude/review-loop-config.md (l4 does not require it)`. Code unchanged.
3. `src/status/cli.js` catch block: write one stderr line `readiness: strict bootstrap unavailable
   (<error.code || error.message>) — qualification axis reads unknown; the engine path would refuse
   with the same reason`, then continue exactly as today (same JSON, exit 0). `bin/autopilot.js`
   usage for `status`: document `--probe` as "bounded live spend: runs per-seat transport and live
   probes" and that `quota --probe` stays a no-spend safe probe, in the same line.
4. `src/engine/repo-preconditions.js:57` → `dirty: repository has uncommitted changes (commit them,
   or pass a clean checkout/worktree as --cwd)`. Code and `dirty:` prefix unchanged.
Mirror every touched product file to `platforms/codex/plugin/...` byte-for-byte (`bash
scripts/sync-codex-plugin-skills.sh` then `--check`).

## Tests (plan §2 test list is normative; summary)
- In EACH of the three dispatch suites (stub agy via PATH; capture the argv the stub receives into a
  file and assert on it): (i) `--model gemini-flash-medium`, no `--effort` → stub sees `--effort medium`
  (RED at base: `high`); (ii) `gemini-flash-high --effort low` → `--effort high` AND exactly one stderr
  line containing `low`, `high` and `model id encodes the tier` (RED at base: no note); (iii)
  `gemini-flash-high --effort high` → `--effort high`, zero such lines (preservation); (iii-b)
  `gemini-flash-high` with no `--effort` → `--effort high`, zero lines (preservation); (iv) a bare
  (non-suffixed) agy id from the stub inventory under default effort → `--effort high` (preservation);
  (v) grok / codex / cc-shim: complete recorded argv byte-identical to a literal expected string
  (preservation; add argv capture to the stub if the suite lacks it). The `agy models` stub inventory
  must list the `-low/-medium/-high` ids the alias resolver needs (see dispatch-review.test.sh:13-16).
- `status-cli.test.sh`: a roster fixture whose bootstrap throws `strict_l5_provider_roster_unavailable`
  → stdout JSON deep-equals the provider-less receipt (capture at base as the expected object,
  normalize digest/timestamp fields), exactly one stderr line matching
  `^readiness: strict bootstrap unavailable \(strict_l5_provider_roster_unavailable`, exit 0 (RED at
  base: zero stderr lines); a successful bootstrap → no such line (preservation).
- `autopilot-cli.test.sh`: help text contains `--probe`, `bounded live spend`, `per-seat transport and
  live probes` (RED at base).
- `implementation-campaign-state.test.sh:5160`: reason matches
  `^dirty: repository has uncommitted changes \(commit them, or pass a clean checkout/worktree as --cwd\)$`
  (RED at base) and `rejection.code === 'campaign_repo_precondition_failed'` (preservation).
- `provider-readiness-consumer.test.sh` (+ `autopilot-cli.test.sh` where it asserts the text): the VA
  refusal contains `verification_author_present: true` and `.claude/review-loop-config.md` (RED at
  base); code unchanged (preservation).
Every change-pinning assertion carries `# RED at base fe225ff5: <observed>` in its block header (run
the suite BEFORE touching product code and quote the real message); preservation guards are labelled
`(preservation, green at base)`. Do not weaken or delete any existing assertion.

## Docs
`docs/BACKLOG.md`: correct the Context of the three source rows (308-8f agy flash-medium row: the
CONFLICT `--model <tier id> --effort <other>` on agy ≥ 1.2, not a missing flag; the VA/readiness
wording row; the dirty-tree row) — Status lines untouched (depth-0 stamps them at release). Then
`node scripts/check-backlog-entries.js --backlog docs/BACKLOG.md` must exit 0. Do NOT touch CHANGELOG.md.

## Verify (all, one at a time, foreground; all green)
```
bash hooks/tests/dispatch-hetero.test.sh
bash hooks/tests/dispatch-review.test.sh
bash hooks/tests/dispatch-author.test.sh
bash hooks/tests/implementation-campaign-state.test.sh
bash hooks/tests/provider-readiness.test.sh
bash hooks/tests/provider-readiness-consumer.test.sh
bash hooks/tests/autopilot-cli.test.sh
bash hooks/tests/status-cli.test.sh
node scripts/check-js-syntax.js
bash scripts/sync-codex-plugin-skills.sh --check
node scripts/check-backlog-entries.js --backlog docs/BACKLOG.md
```

## Sealed output_paths (the ONLY files you may change)
```
scripts/lib/agy-model-alias.sh
scripts/dispatch-hetero.sh
scripts/dispatch-review.sh
scripts/dispatch-author.sh
src/readiness/provider-bootstrap.js
src/status/cli.js
src/engine/repo-preconditions.js
bin/autopilot.js
platforms/codex/plugin/scripts/lib/agy-model-alias.sh
platforms/codex/plugin/scripts/dispatch-hetero.sh
platforms/codex/plugin/scripts/dispatch-review.sh
platforms/codex/plugin/scripts/dispatch-author.sh
platforms/codex/plugin/src/readiness/provider-bootstrap.js
platforms/codex/plugin/src/status/cli.js
platforms/codex/plugin/src/engine/repo-preconditions.js
platforms/codex/plugin/bin/autopilot.js
hooks/tests/dispatch-hetero.test.sh
hooks/tests/dispatch-review.test.sh
hooks/tests/dispatch-author.test.sh
hooks/tests/status-cli.test.sh
hooks/tests/autopilot-cli.test.sh
hooks/tests/implementation-campaign-state.test.sh
hooks/tests/provider-readiness-consumer.test.sh
docs/BACKLOG.md
```
Finish with a clean tree, changes committed as the harness instructs; report the RED-at-base messages
you recorded and every suite's pass/fail count.
