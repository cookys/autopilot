# Foreman exam harness — landing review (2026-09-29)

Branch `hetero/foreman-phase-5` (on `origin`), reviewed range
`2b226e0a..8560efcf` (`review-foreman-exam/g1/range.json`, diff 230986 bytes).
The branch was **not merged**.

## What was reviewed

The foreman exam harness from phases 1–5: generator, grader, corpus, runner,
conformance, and the `engine-qualify.js foreman` path. Grok wrote most of it
through `dispatch-hetero`. The reviewers were given Fable's frozen spec
(`../2026-09-21-foreman-exam-design-consult/claude-fable-5-1-SPEC.md`).

Seats were passed with `--seats` because `resolve-review-loop.sh` refuses the
dogfood roster today (see below):

| seat | engine | findings |
|---|---|---|
| s0 | `gpt-5.6-sol/max@codex` | 6 Critical, 2 Major |
| s1 | `MiniMax-M3/high@cc-shim:minimax` | 0 (seat carries the recorded 5/6 false-central-claim limitation) |

## Depth-0 dispositions

All 8 s0 findings were re-derived against the code and the spec and are
`verified`. Each rationale cites file:line in
`review-foreman-exam/g1-dispositions.json`. In short:

- The candidate gets 3 tools, not the spec's 4. `shell` is missing
  (`runner.js:52` vs spec A1).
- Budgets are hard-coded at 5 dispatches, 40 tool calls, and 200k tokens.
  The spec sets 1.2M tokens per campaign and 20M per sitting, and
  `budget_exhausted` is never returned.
- Grading reads the current tip, not the verdict's `head_sha`
  (`runner.js:656,661`; `grader.js:75,188`).
- The stub fabricates `claimed_check_exit: 0`. `logicalPath` always
  resolves inside the fence, so G's trap cannot be expressed.
- Anti-rerun is inert because `prior_records: []` is hard-coded
  (`runner.js:275`).
- Conformance puppets call `gradeCampaign` directly. They are not driven
  through the runner.
- `PRIOR_WORK_DISCARDED` is not implemented, and the clean false-positive
  count requires `critical`.
- Tree ids are 16 hex characters, and `verdictShape` accepts any
  `head_sha`.

Verdict: **FIX-THEN-SHIP**. `hetero-review-loop.js finalize` did not run. It
calls `resolve-review-loop.sh`, which exits non-zero because the dogfood
roster's implementer seat (`cursor-grok-4.6-low/cursor`) has no unexpired
qualification override. That gate was not bypassed, so generation 1 stays
`pending` in `chain.json` with its dispositions file written.

## Consequence for existing evidence

The muse-spark sitting
(`../2026-09-24-foreman-muse-spark-score5/`) ran on this harness, so its graded
fail is not a spec-conformant sitting. See the note appended to its README.

## Also done before the review

The branch got `b3037d6e`, which committed the runner that produced the
muse-spark sitting (sha256 `de749b78…`, harness_hash `1d584b65…`). Before
that, it existed only as an uncommitted diff in a `/tmp` worktree. The
branch also got `8560efcf`, a test-only commit that makes the foreman suite
runnable under `hooks/tests/run.sh`.

Follow-up: `docs/backlog/foreman-exam-harness-spec-conformance.md`.
