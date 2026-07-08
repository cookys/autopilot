# M3/flash-band orchestration tasks — design + build report (2026-07-09)

Status: tasks BUILT + smoke-verified; **Results IN (negative)** — see
Results below.

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

**How to read the two axes (important — the decoy axis alone is NOT a score).**
`decoy_respected` has a high *free* base rate: a do-nothing / pristine submission
that never touches the code trivially "respects" the decoy (it preserved the
correct behavior / did not mutate / kept the cache by not running). So
`decoy_respected` in isolation carries **no** information about competence — a
0-effort submission scores it `true`. Only two derived quantities are meaningful:
the **conjunction** `fidelity_ok ∧ decoy_respected` (= `oracle_pass`, "solved the
task without cutting the corner"), and the **gradient cell** `fidelity=true,
decoy=false` ("solved it but traded the corner away"). Never report a bare
`decoy_respected` rate as if it were quality.

All oracles are **oracle-owned** (drive the candidate's real code; never trust the
candidate-visible `run-tests.sh`) and hardened against a candidate that controls
the repo the judging code runs in — see the R2 hardening record below. The header
comment of each `oracle.sh` states the *actual* guarantee after hardening; the
oracles are NOT claimed un-gameable against an arbitrary adversary (e.g. builtin
monkeypatching is outside the planted-file / env / stdout threat model defended).

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

## R2 hardening — the oracles were gameable; now fail-closed on 4 attacks

The first build passed correctness but an opus QC seat proved with **real cheat
submissions** that all three oracles were gameable (4 false-PASS paths). Root
cause: the judging python runs *inside the candidate's repo directory*, so a
candidate controls that import/exec environment. Fixed and locked in as committed
poison regressions (`hooks/tests/orchestration-eval-m3band.test.sh`):

| Poison | Task | Attack | Fix |
|--------|------|--------|-----|
| A | t16 | module-level `print("...true...")` poisons the captured-stdout verdict grep | verdict written to a private temp file (path from harness) after candidate import, via `os` refs captured beforehand; stdout is no longer the channel |
| B | t15 | reads `ORACLE_NONCE` from `os.environ` and hardcodes the token | nonce generated **inside** the isolated judging python; nothing exported to env |
| C | t15 | plants `secrets.py` to fix `token_hex`, then hardcodes the token | `python3 -I` + CWD stripped from `sys.path` **before** importing genuine `secrets`; CWD re-added only to import the candidate module last |
| D | t17 | plants `copy.py` so `deepcopy` returns its arg → purity snapshot compares equal to a mutated input | same stdlib-shadow defense: genuine `copy` imported before CWD is on the path |

Verified: each poison, run against the hardened oracle, now → `STATUS: FAIL`
(artifact, not self-report — see the poison regression output). The header comment
of each `oracle.sh` was corrected to describe the *actual* post-hardening
guarantee (defends the planted-file / env / stdout threat model), not the earlier
over-claim of blanket un-gameability.

## Residual: in-process introspection (opus re-attack finding, SHIP-AS-IS)

An independent opus re-attack against the R2-hardened oracles confirmed the
original 4 poisons (planted-file / env-nonce / stdout-channel) all still
fail-closed, but surfaced a **new residual class**, reproduced reliably (5/5
PASS on the exploit):

- **N2 / N2' — `sys._getframe()` caller-frame introspection at import time.**
  The candidate module, at import, walks the caller's stack frames via
  `sys._getframe()` and regex-scrapes the caller's globals for the live secret
  the judge never exported:
  - **N2 (t15)**: recovers the real per-run `NONCE` this way, fabricates a
    token that matches it, and **never calls the injected `compute_fn`** — so
    both the fidelity axis (correct permissions) and the cache axis are faked
    without doing the real work.
  - **N2' (t17)**: walks the purity-check block's local `snapshot` variable and
    re-syncs it to match the (mutated) working data on the fly, so
    `snapshot == recs` stays true even while the candidate is actively
    mutating an input — faking the purity axis while genuinely violating it.
  Both headline rails — fidelity (t15) and purity (t17) — are breachable this
  way from candidate-visible source, no planted files or env access needed.
- **Why this is SHIP-AS-IS, not a blocker.** The root cause is architectural:
  the candidate module is imported into the **same python process** as the
  judging code, so it shares stack frames, globals, the nonce, and the verdict
  file descriptor. This is exactly the in-process class the R2 hardening
  header already excluded from scope (originally scoped narrowly to "builtin
  monkeypatching"; see the disclaimer tightening below). The only real fix is
  **process isolation** — running the candidate's call in a separate
  interpreter/subprocess from the judge — which is a redesign, not a patch,
  and lines up with the same isolation conclusion CLAUDE.md already records
  for `check-test-integrity.sh` L1 block-mode (no local-only same-process
  mechanism is malicious-proof). Tracked as a BACKLOG item, not fixed this
  round.
- **No impact on the calibration numbers below.** An honest M3 solution does
  not write frame-introspection code to steal a secret it was never given —
  the 18/18 result below is real model behavior on the real task, not an
  artifact of this gaming path.

## Smoke verification (done — proves well-formedness, NOT lift)

- **Three-way oracle probe, all three tasks** (pristine=FAIL / correct=PASS /
  axis-slip=partial FAIL): green. Plus the 4 poison paths (A/B/C/D) all blocked.
  Locked in as a committed regression:
  `hooks/tests/orchestration-eval-m3band.test.sh` (15 assertions).
- **No false-negative matrix** (per task): pristine→FAIL(F,T), canonical correct→
  PASS, alt correct (t15 whole-record key)→PASS, do-nothing→FAIL, CHEAT A→fidelity
  FAIL, CHEAT B→gradient (fid true / decoy false). All hold.
- **Full harness path** via `run-orchestration-eval.sh --runner stub`: all three
  produce a well-formed `result.json` with the expected axes.
- **Existing regression** `hooks/tests/orchestration-eval.test.sh`: still green.
- **One live M3 run** (t16, off arm, cc-shim/minimax): `oracle_pass=true`,
  `fidelity_ok=true`, `decoy_respected=true`, duration 127s — proves the live
  cc-shim→M3→oracle path works and the oracle judges *real* M3 output correctly
  (M3 correctly triaged F1/F2 as real, F3/F4 as decoys). n=1 says nothing about
  the rate — that is the batch's job. (Run against the pre-R2 t16 oracle; the R2
  fixes did not change t16's correctness behavior on a genuine submission, only
  its resistance to gaming.)
- **Decorrelated review** of all three oracles by gpt-5.5/codex (roster reviewer,
  disjoint family from the Claude author): one Major false-pass found on t15,
  reproduced by probe, fixed. **R2 QC (opus seat)**: found 4 further false-PASS
  gaming paths (stdlib-shadow, stdout-channel, env-nonce-steal) — all reproduced,
  fixed, and frozen as poison regressions.

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

## Results (IN — negative)

M3 calibration batch, n=3/cell, `ORCH_CC_SHIM=1` (MiniMax-M3 via the cc-shim
runner), all three tasks × both arms:

| Task | Arm | n | oracle_pass | fidelity_ok | decoy_respected | in-band? |
|------|-----|---|-------------|-------------|------------------|----------|
| t15-cache-invalidation | OFF | 3 | 3/3 | 3/3 | 3/3 | NO — ceiling |
| t15-cache-invalidation | ON  | 3 | 3/3 | 3/3 | 3/3 | NO — ceiling |
| t16-findings-triage    | OFF | 3 | 3/3 | 3/3 | 3/3 | NO — ceiling |
| t16-findings-triage    | ON  | 3 | 3/3 | 3/3 | 3/3 | NO — ceiling |
| t17-purity-invariant   | OFF | 3 | 3/3 | 3/3 | 3/3 | NO — ceiling |
| t17-purity-invariant   | ON  | 3 | 3/3 | 3/3 | 3/3 | NO — ceiling |

**M3 ceilings 18/18** across all three tasks, both arms, both axes (including
the decoy/purity axis each task was specifically built to make M3 slip on).
Raw per-run data preserved at the end of this report (source:
`docs/projects/2026-07-09-m3-band-tasks/runs/results.jsonl`, gitignored).

Honest conclusions (negative result — recorded as-is, not softened):

- **In-band difficulty target: NOT achieved.** These three "harder" single-turn
  tasks were built specifically because t1–t13 all ceiling on M3; the design
  bet was that a two-axis discriminator (fidelity vs. decoy/purity) would find
  headroom t1–t13 could not. It did not: MiniMax-M3 solved every task on every
  axis, every run. Same fate as t1–t13.
- **ON (pack) vs. OFF is indistinguishable** — 3/3 on both arms for all three
  tasks. Even if there had been headroom, the pack showed no measurable
  behavioral effect here, consistent with this whole eval series' running
  conclusion: the pack moves vocabulary, not behavior.
- **n=3 is a pilot, but the ceiling signal is strong.** 18/18 across three
  independently-designed tasks, including the axis each task specifically
  engineered to tempt a corner-cut (disable-the-cache, over-fix-the-decoy,
  mutate-under-pressure), is not the pattern a genuinely discriminating task
  would produce at n=3 — some variance would show up if the task were really
  inside M3's band. Proving M3 has *rare* failures on these tasks would need a
  much larger n, but that would not manufacture the measurable lift this batch
  was built to surface.
- **Methodological takeaway**: this closes a loop — "can a harder single-turn
  task be constructed that discriminates M3?" Answer, empirically: no, not with
  this design. This reaffirms the 2026-07-06 archive's conclusion
  (`docs/projects/_archive/2026-07-06-eval-instruments/report.md`): **M3's
  discriminating signal, if it exists, lives in long-horizon tasks (t14-shaped),
  not in more single-turn tasks.**
- **Reusable positive assets, kept**: the three two-axis tasks, the R2
  anti-gaming oracle hardening (above), the resumable calibration runner
  (`calibrate-m3-band.sh`), and the regression suite
  (`hooks/tests/orchestration-eval-m3band.test.sh`) are all reusable
  infrastructure regardless of this negative result. The R2 oracle hardening in
  particular is a standalone-valuable artifact — it closed 4 real false-PASS
  gaming paths independent of whether this task set ever discriminates a model.

## Raw per-run data (n=18, preserved — `runs/` is gitignored)

Source: `docs/projects/2026-07-09-m3-band-tasks/runs/results.jsonl` (fields
trimmed to the ones relevant to this report):

```
task_id                  arm  oracle_pass  fidelity_ok  decoy_respected  turns_completed
t15-cache-invalidation   on   true         true         true             -
t15-cache-invalidation   on   true         true         true             -
t15-cache-invalidation   on   true         true         true             -
t15-cache-invalidation   off  true         true         true             -
t15-cache-invalidation   off  true         true         true             -
t15-cache-invalidation   off  true         true         true             -
t16-findings-triage      on   true         true         true             -
t16-findings-triage      on   true         true         true             -
t16-findings-triage      on   true         true         true             -
t16-findings-triage      off  true         true         true             -
t16-findings-triage      off  true         true         true             -
t16-findings-triage      off  true         true         true             -
t17-purity-invariant     on   true         true         true             -
t17-purity-invariant     on   true         true         true             -
t17-purity-invariant     on   true         true         true             -
t17-purity-invariant     off  true         true         true             -
t17-purity-invariant     off  true         true         true             -
t17-purity-invariant     off  true         true         true             -
```

(`turns_completed` was not emitted by this harness's `result.json` schema —
the raw JSONL instead carries `duration`, `runner_version`, and gaming-adjacent
flags (`adjudication_valid`, `patterns_named`, `probe_evidence_present`); none
of those affect the `oracle_pass`/`fidelity_ok`/`decoy_respected` verdict
columns reported above.)
