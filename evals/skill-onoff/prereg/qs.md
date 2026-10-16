# qs — BL-0001 stage 2 ON/OFF pre-registration

Human-readable twin of `prereg/qs.json` (the JSON is the machine-read rule; this file is digest-frozen with it).

Question: does the quality-pipeline test step, rewritten to run `scripts/affected-suites.js` first, keep every required
suite running (no miss) while running far fewer suites, and does it still run the whole suite when it must?
Guidance change (what the gate demands changes), so this eval is required; the selector's recall on real history is the
separate miss-check, not measured here.

Arms: `off` = current gate behaviour (whole suite, `bash hooks/tests/run.sh`) ; `on` = select first, then run; `red-a` /
`red-b` = ON plus one planted sentence (negative controls, shown red before ON counts). Only two skill files differ
(`quality-pipeline/SKILL.md`, `references/test-policy.md`); the fixture config is identical in both arms.

Scenarios (each x 3 reps x {off,on}; red-a on s1,s2; red-b on s3,s4 = 48 cells): s1 hooks lib selective, s2 mods/live,
s3 hooks.json full, s4 unreferenced (empty list trap), s5 docs only, s6 release preflight on a selective-looking diff.
Answers are hand-authored from the planted mention graph and asserted equal to the frozen selector (`check-qs-answers.js`,
with a negative control).

Markers, instrument-validity rules, ship rule: see the JSON (`markers`, `verdict_rule`). Zero tolerance on misses; n=3 per
scenario cannot prove a rate, so the claim is "no observed miss". M7 (simulated cost, wall time) is reported, not gated.

Deviations from the design file, decided at implementation time: (1) the run log lives in the repo's git dir (`run.log`)
instead of an env var path, so it needs no harness env plumbing; (2) the ON text and the fixture config are not separate
arms: the harness's arm check only allows skill files to differ, so the config is identical (it points at the skill's
Test step) and ON/OFF differ in SKILL.md and test-policy.md only; (3) packs are frozen with `--from-dir`, not from a scratch
git branch, because the real guidance files are deliberately untouched until SHIP; (4) suite weights are synthetic
(20 + 7*i seconds), not host timings.
