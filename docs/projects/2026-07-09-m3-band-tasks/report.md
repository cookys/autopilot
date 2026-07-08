# M3/flash-band orchestration tasks — design + build report (2026-07-09)

Status: tasks BUILT + smoke-verified; **Results PENDING** (depth-0 runs the
calibration batch and fills the numbers).

## Problem

Every single-turn orchestration task (t1–t13) **ceilings** on MiniMax-M3 as the
orchestrator: t2/t12/t13 are n/n ON and OFF, so pack/procedure lift is
unmeasurable — there is no headroom for a discriminating metric to move. The
other end (t14 long-horizon) is 0/anything. Missing: tasks whose difficulty lands
*inside* the M3/flash band — hard enough that M3 will not score a clean sweep,
easy enough that it is not a total wipeout. Source:
`docs/projects/_archive/2026-07-06-eval-instruments/report.md` L95–107, L217–220.

## Design principle — the second axis is the headroom

t1–t13 are single-bug, single-file, localized fixes with an obvious correct
solution; a capable orchestrator either solves them or does not, and M3 always
does → ceiling. These three new tasks are built around a different shape, copied
from the one place the eval suite already found headroom on a strong model
(t14's split of *fidelity* vs *constraint retention*):

> Each task scores **two independent boolean axes** that the harness already
> records into `result.json`: `fidelity_ok` (did the primary task get solved)
> and `decoy_respected` (did a second, easy-to-trade-away property survive).

The discrimination lives in the **gap** between the axes. Even if M3 aces the
primary task (fidelity), it can still slip the second axis — and that partial
signature (`fidelity=true, decoy=false`) is exactly the gradient t1–t13 cannot
produce. A model does not have to *fail* to be measured; it only has to *cut a
corner*. This makes the tasks robust to M3 being strong: strength shows up as
"solved it but broke the invariant", which is still a number.

All oracles follow the t13 honesty rails: oracle-owned drive (never trust the
candidate-visible `run-tests.sh`), per-run nonce/seed so no output can be
hardcoded, plain-print python heredocs (no escaped-quote SyntaxError), fail-closed
verdict parsing.

## The three tasks

| # | Name | Failure mode targeted | fidelity_ok axis | decoy_respected axis |
|---|------|----------------------|------------------|----------------------|
| t15 | cache-invalidation | cross-file root cause + tempting shortcut | role change returns fresh perms | **cache retained** (repeated identical lookup does not recompute) |
| t16 | findings-triage | over-fixing plausible decoys | both REAL bugs (F1 parse_port, F2 dedupe order) fixed | both DECOYS (F3 lowercase, F4 Friday=weekend) left unchanged |
| t17 | purity-invariant | load-bearing invariant violated under feature pressure | key-param + order-preserving tag-merge works | **inputs unmutated** (purity — deepcopy compare) |

### t15 — cache-invalidation (跨檔推理 + 誘人捷徑)
Bug is in `keys.py` (`make_key` omits `role`), but the symptom is described in
`service.py` (`service.py → store.py → keys.py`). The correct fix requires
tracing across three files. **Why M3 won't sweep**: the tempting shortcut —
"just recompute every time" / disable the cache — makes correctness pass while
silently killing the memoization the task explicitly requires; the cache axis
catches it. **Why not a wipeout**: the real fix is a one-line change to
`make_key` once found, and a whole-record key also works.
*(Hardening: a gpt-5.5 decorrelated review caught a false-pass where a submission
that ignored the injected `compute_fn` and computed inline passed both axes; the
oracle now embeds a per-run nonce in the injected fn's output so correct perms
are unprovable without actually calling it. Fixed + regression-guarded.)*

### t16 — findings-triage (更誘人的 decoy)
Harder t1: four review findings, two real bugs and two **convincing decoys** that
contradict `SPEC.md` (tags are case-sensitive; Friday is a weekday). Telling them
apart requires reading `SPEC.md` against `REVIEW-NOTES.md`. **Why M3 won't
sweep**: a hasty orchestrator "addresses all findings" and regresses correct code
— `decoy_respected` catches the over-fix. **Why not a wipeout**: the two real
bugs are genuine and clearly fixable; the decoys are individually plausible but
each is refuted by an explicit spec line.

### t17 — purity-invariant (壓力下易違反的約束)
Extend `dedup()` with a `key` param and an order-preserving `tags` merge, **while
not mutating the inputs** (documented, load-bearing). **Why M3 won't sweep**: the
obvious tag-merge (`kept["tags"].extend(dup["tags"])` / keeping the input dict)
mutates an input record — the purity axis (deepcopy compare) catches it. **Why
not a wipeout**: building fresh dicts + fresh tag lists is a well-known pattern.

## Expected discrimination band (hypothesis — to be confirmed)

Prediction: on M3 the primary (fidelity) axis will be **high but not always 1.0**,
and the second axis will be **strictly below** fidelity on at least one task —
producing a measurable `fidelity − decoy_respected` gap that t1–t13 cannot. The
single live M3 run below is consistent with "solvable" (fidelity reachable); the
*rate* at which M3 trades away the second axis is the open question the batch
answers. If any task turns out to also ceiling (both axes n/n on M3), that is
itself a reportable negative and the task should be retired or hardened, not kept.

## Smoke verification (done — proves well-formedness, NOT lift)

- **Three-way oracle probe, all three tasks** (pristine=FAIL / correct=PASS /
  axis-slip=partial FAIL): green. Locked in as a committed regression:
  `hooks/tests/orchestration-eval-m3band.test.sh` (11 assertions).
- **Full harness path** via `run-orchestration-eval.sh --runner stub`: all three
  produce a well-formed `result.json` with the expected axes.
- **Existing regression** `hooks/tests/orchestration-eval.test.sh`: still green.
- **One live M3 run** (t16, off arm, cc-shim/minimax): `oracle_pass=true`,
  `fidelity_ok=true`, `decoy_respected=true`, duration 127s — proves the live
  cc-shim→M3→oracle path works and the oracle judges *real* M3 output correctly
  (M3 correctly triaged F1/F2 as real, F3/F4 as decoys). n=1 says nothing about
  the rate — that is the batch's job.
- **Decorrelated review** of all three oracles by gpt-5.5/codex (roster reviewer,
  disjoint family from the Claude author): one Major false-pass found on t15,
  reproduced by probe, fixed, re-verified.

## How depth-0 runs the calibration batch

Runner: `docs/projects/2026-07-09-m3-band-tasks/calibrate-m3-band.sh`
(parameterized, resumable, per-round auth circuit-breaker, strictly serial for
MiniMax rate-limits, ORCH_CC_SHIM=1).

```
# preview the plan + confirm the endpoint resolves (no spend):
docs/projects/2026-07-09-m3-band-tasks/calibrate-m3-band.sh --dry-run

# full batch: 3 tasks × {on,off} × n=3 = 18 cells, M3 via the minimax endpoint:
docs/projects/2026-07-09-m3-band-tasks/calibrate-m3-band.sh --n 3

# resume after an interruption (done cells are skipped automatically):
docs/projects/2026-07-09-m3-band-tasks/calibrate-m3-band.sh --n 3

# score whenever:
node evals/orchestration/score.js docs/projects/2026-07-09-m3-band-tasks/runs/results.jsonl
```

Suggested first pass: **OFF arm only, n≥5 per task** to establish M3's baseline
fidelity/decoy rates and confirm each task is genuinely in-band before spending on
the ON/OFF pack comparison. If a task ceilings, retire/harden it rather than
averaging it in.

## Results (PENDING — depth-0 fills)

| Task | Arm | n | oracle_pass | fidelity_ok | decoy_respected | in-band? |
|------|-----|---|-------------|-------------|-----------------|----------|
| t15 | OFF | — | PENDING | PENDING | PENDING | PENDING |
| t15 | ON  | — | PENDING | PENDING | PENDING | PENDING |
| t16 | OFF | — | PENDING | PENDING | PENDING | PENDING |
| t16 | ON  | — | PENDING | PENDING | PENDING | PENDING |
| t17 | OFF | — | PENDING | PENDING | PENDING | PENDING |
| t17 | ON  | — | PENDING | PENDING | PENDING | PENDING |

Honest-limits reminder for whoever fills this: small n is directional only; a
task that ceilings on M3 is a negative result to record, not to hide; and the
in-loop verifier is not an authority — depth-0 executes the committed artifacts.
