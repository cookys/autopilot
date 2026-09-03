# `--runner opencode` implementer rail (dispatch-hetero) + first administration: muse-spark-1.3 (OpenCode Go)

**Date**: 2026-09-03 · **Target**: v2.35.12 · **Size**: L (new runner across 5 modules)
**Trigger**: Board asked to examine `muse-spark-1.3` as implementer through OpenCode. The only
route to that model on this box is the OpenCode Go plan (`opencode-go/muse-spark-1.3-contributor`);
`dispatch-hetero.sh` has no opencode runner, so the live-rail exam cannot reach it.

## Stage-0 spike (2026-09-03, opencode 1.18.25, this box)

| Gate | Result |
|---|---|
| G0 endpoint | `opencode models` lists `opencode-go/muse-spark-1.3-contributor` and `-1.2-`; auth.json has `opencode-go` |
| G1 single op | `opencode run --dir <repo> -m opencode-go/muse-spark-1.3-contributor --format json "<task>"` created the requested file in `<repo>`, exit 0 (also 1.2) |
| prompt via STDIN | `printf … \| opencode run --dir … -m …` → file created, exit 0 (no ARG_MAX wall) |
| `--pure` (no external plugins) | file created, exit 0; JSON `step_finish` events carry `tokens{input,output,reasoning,cache{read,write}}` |
| edit-only | opencode did not commit; edits left in the working tree (wrapper-commit rail applies) |
| G2 e2e | this plan (real `dispatch-hetero.sh --runner opencode` → `committed`, cgroup contained) |

## Design

- **Rail shape**: grok/qoderclicn-shaped — EDIT-ONLY directive prepended to the prompt, prompt via
  STDIN from a temp file, `cd "$WT" && exec opencode run --dir "$WT" --pure -m "$MODEL" --format json`,
  wrapper commits, verdict from git artifacts. `--opencode-bin` test seam. EXPLICIT-only (`auto`
  never selects it: a model id is `provider/model`, no family match). No effort flag (opencode has
  none for this route; the seat's effort label is nominal, as for cc-shim).
- **Registration** (every place a runner token lives): `dispatch-hetero.sh` (flags, labels, enum,
  preconditions, cleanup, detach `declare -p`), `lib/runner-binary.js` (`opencode` → `opencode`),
  `engine-qualify.js` `implRunnerBinFlag`, `src/engine/implementer-ladder.js`,
  `resolve-review-loop.sh` implementer_runner enum. Reviewer rails (`dispatch-review.sh`,
  `dispatch-author.sh`) are OUT of scope — implementer only.
- **log_format**: `plain` (usage stays `null`; parsing opencode's event stream is a follow-up —
  BACKLOG with the observed `step_finish.tokens` shape).
- **Tests**: `hooks/tests/dispatch-opencode.test.sh` (stub binary: reads STDIN, honors `--dir`,
  writes a file → committed; no-edit → no_op; nonzero → failure; asserts `runner: opencode`,
  `--pure`/`--format json`/`-m` argv, EDIT-ONLY directive present in the prompt); runner-binary,
  implementer-ladder, resolve-review-loop enum assertions.
- **Administration**: `qualification-sweep.sh` roster seat `opencode-go/muse-spark-1.3-contributor`,
  runner `opencode`, family `meta`, effort `high` (label), endpoint `-`. Bundle under
  `docs/plans/evidence/2026-09-03-muse-spark-opencode-qualify/`.

## Acceptance

- New test file green; full suite green; preflight-release 8/8 for v2.35.12.
- Real dispatch: `dispatch-hetero.sh --runner opencode --model opencode-go/muse-spark-1.3-contributor`
  returns `committed` with `contained: true`.
- Exam row recorded (qualified or failed — an honest FAILED is a successful administration).

## Out of scope
- opencode as reviewer/author rail; usage parsing from the JSON event stream; auto-routing.
