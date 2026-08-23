# Test Integrity Gate — autopilot's own project config
#
# Derived from project-config-template/test-integrity-config.md on 2026-08-23.
# Reason this file exists: the template's `test_paths` are generic ecosystem
# conventions (**/*_test.go, **/*.test.js, tests/**, ...). autopilot's test
# surface is 300 `*.test.sh` / `*.test.js` files living in hooks/tests/,
# hooks/, scripts/, scripts/tests/, platforms/codex/plugin/scripts/ and
# evals/. NONE of the template globs match `hooks/tests/*.test.sh`, so before
# this file existed the gate reported `test_paths_matched: 0` and `ok: true`
# on ranges that rewrote test suites. See docs/BACKLOG.md and
# references/evidence-discipline.md §1 ("existing is not running").
#
# A second defect had to be fixed for this file to work at all: the engine's
# `##` section-heading branch sat below its `#` comment skip, so no project
# could declare `test_paths` — the attempt tripped `malformed_config` (which
# forces block mode) while the built-in defaults quietly stood in.

## Mode
# Values: block | warn | off
#
# DELIBERATELY `warn`, not `block`. Two reasons, both evidence-based:
#
#  1. The L0 engine raises a `deleted_line` violation for EVERY removed line in
#     a matched test file. In this repo, ordinary test maintenance (renaming a
#     case, fixing an `assert_eq` argument order, tightening a bound) removes
#     lines constantly. In `block` mode the gate would refuse nearly every
#     honest commit that touches a suite, and the first thing anyone would do
#     is turn it off — which is how it went blind in the first place.
#  2. `block` also promotes every `surface_touch` to a violation, and this
#     repo's own tests legitimately edit hooks/tests/lib.sh and fixtures.
#
# `warn` makes the gate *report* — reviewers and the depth-0 QC read the
# `violations` array. Do NOT flip this to `block` until there is recorded
# evidence that the violation stream is accurate enough to gate on; that
# evidence does not exist yet and is tracked as a BACKLOG follow-up.
mode: warn

## Test Paths
# autopilot's executable suite convention is exactly two shapes:
#   *.test.sh  — L2 integration suites (bash + hooks/tests/lib.sh assertions)
#   *.test.js  — L1 unit suites (node --test)
# 300 files carry those names. `hooks/tests/run.sh` EXECUTES 275 of them
# (hooks/tests/*.test.sh + scripts/*.test.sh + hooks/*.test.js +
# scripts/*.test.js); the other 25 are the codex mirrors, scripts/tests/,
# evals/skill-transport/test/, and three eval task fixture files. The gate
# covers all 300 — matching a fixture is harmless, and the wider net is the
# point. The globs below are intentionally
# path-agnostic so a suite added in a NEW directory is covered automatically —
# the previous failure was globs that could not keep up with where tests live.
# `hooks/tests/check-test-integrity.test.sh` asserts that every tracked
# *.test.sh / *.test.js file in the repo is matched by these patterns; add a
# new convention here and that regression will tell you if you missed one.
- '**/*.test.sh'
- '**/*.test.js'
# Future-proofing for conventions this repo does not use yet but would adopt
# under the same naming rule. Zero files match these today; they cost nothing
# and stop the next `.test.ts` suite from being invisible.
- '**/*.test.mjs'
- '**/*.test.cjs'
- '**/*.test.ts'

## Known gaps in shell skip detection
# Recorded here because the project README and docs/BACKLOG.md both cite this
# file as one of the three places the gaps are written down. If you close one,
# update all three and flip the matching control in
# hooks/tests/check-test-integrity.test.sh (they currently assert the CURRENT
# boundary, so closing a gap turns one red on purpose).
#
# 1. An `exit 0` / `return 0` spliced into the middle of a suite is NOT
#    detected. It deletes no line and carries no skip token, and at line level
#    it is indistinguishable from the legitimate bail-outs this repo already
#    writes: of 260 tracked `*.test.sh`, 19 contain a top-level `exit 0` and 41
#    contain one at some indentation (only 2 have it as the final line, so most
#    are guard clauses — exactly the shape a gaming early-exit takes). Telling
#    them apart needs "is there an assertion after this exit?", which is file
#    position context the L0 layer does not carry.
# 2. Named-uncovered command positions: a `time` / `coproc` prefix, and a
#    leading redirection (`>f skip`).
# 3. Named-uncovered data/code cases: a skip reached through `eval "skip"`, and
#    a skip inside a heredoc body. Both need multi-line or semantic context.
#    These are the accepted cost of blanking quoted spans, which is what stops
#    a suite that WRITES a skip into a fixture from being read as one that skips.
#
# Everything else in the shell grammar is enumerated and covered; the full
# enumeration is in docs/projects/2026-08-23-test-integrity-coverage/README.md.

## Integrity Surface Paths
# Files that DEFINE what the suites can detect. Editing one of these changes
# the measurement without touching a single test file, so they are called out
# separately (reported as `surface_touches`).
#
# hooks/tests/lib.sh is the single highest-value entry: it defines assert_eq,
# assert_contains, assert_exit_code and finalize_test. Weaken `assert_eq`
# there and all 252 hooks/tests suites go green while asserting nothing.
- 'hooks/tests/lib.sh'
- 'hooks/tests/lib/**'
- 'hooks/tests/run.sh'
# Fixture repos and golden inputs the suites read.
- 'hooks/tests/fixtures/**'
# Eval task fixture repos + frozen oracle expectations. These are the corpus
# the review/orchestration evals are graded against; editing an
# `*.expected.json` moves the goalposts rather than passing the test.
- 'evals/orchestration/tasks/**'
- 'evals/clean/**'
- 'evals/known-bad/**'
- 'evals/skill-transport/test/stub-*.sh'
- 'evals/**/*.expected.json'
- 'evals/*-corpus.json'
# CI definition.
- '.github/workflows/**'
# NOTE: there is deliberately no bare `- 'package.json'` entry. A pattern with
# no `/` is matched against every path segment, so it would sweep in
# website/package.json, .opencode/*, platforms/opencode/** and eval fixtures —
# 13 tracked files, none of which is a test-integrity surface. This repo has no
# root package.json to protect in the first place.
