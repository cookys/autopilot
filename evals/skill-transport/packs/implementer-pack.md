<!--
FROZEN PACK FIXTURE — do NOT edit mid-experiment (an edit = restart the arm).
Source: skills/dev-flow/SKILL.md (six-element task discipline + red-green verification contract)
Source-SHA: dd98aa24ef00c0058f922a43547fddc28362e4e7
Frozen: 2026-07-15 (skill-transport payoff A/B, docs/plans/2026-07-15-skill-transport-payoff-ab.md)
Content: methodology-only (implementation discipline). Per Global Constraint #1 every
output-format directive has been stripped — no task-prompt output template, no mandatory
report shape — so the pack cannot compete with the dispatch protocol. This fixture is
consumed only by the Phase 2 implementer arm; it is frozen here in Phase 0 alongside the
reviewer pack. Phase 0 grep-asserts this file is free of output-format directives.
-->

# Implementation discipline

Before writing any code, restate the task to yourself as six elements. Hold all six in mind
for the whole change; a change that satisfies five of them and quietly violates the sixth is
not done.

- **Goal** — what this task must achieve, in one sentence. If you cannot state it in one
  sentence you do not yet understand it well enough to implement it.
- **Scope** — the exact files and modules the task is allowed to touch.
- **Input** — the upstream contracts the change depends on: schemas, interfaces, data shapes,
  the outputs of prior work.
- **Output** — the concrete deliverables: the files, the interfaces, the tests.
- **Acceptance** — the objective check that proves the task is finished: a command that can
  be run, a behaviour that can be observed, a check that goes green.
- **Boundaries** — what the change must NOT touch, so that it produces no side effects beyond
  its scope.

## Anchor on an objective check

For every task ask first: when this is done, what command will objectively prove it? Write
or identify that check before you start, and make the change satisfy it. A task with a real
objective check is anchored; a task with no honest objective check is not, and pretending
otherwise is the failure to avoid.

The check only means something if it genuinely exercises the change. A check that passes
whether or not the change is present proves nothing — confirm it would fail against the
unchanged baseline and pass against the change. A failure that comes from the setup rather
than from the behaviour under test (a missing file, an import that does not resolve, a suite
that collects nothing) is not a real failure and does not count as evidence. Treat a
flaky result as unproven: reproduce it before you rely on it.

## Stay inside the scope

Size the work once, but watch it silently grow. Every line you change must trace to the
stated goal. Do not improve adjacent code, do not rename beyond the surface the task needs,
do not refactor something merely because you are near it, and do not touch anything the
boundaries put off limits. If the work starts to outgrow its original shape — new subsystems,
a wider interface than planned, effort well past the estimate — stop and surface it rather
than quietly expanding.

## Finish honestly

Run the quality gate the project defines before considering the work complete. Report what
the objective check actually showed, including anything you could not verify or chose to
defer. Incomplete work described plainly is worth more than complete-looking work whose gaps
are hidden; the next reader inherits whatever you leave unsaid.
