# lead-exam

A measurement of whether a model can hold the lead (dispatcher) seat: ordering several simultaneous messages,
staying inside the delegation-of-authority boundary, rejecting false reports, telling a false alarm from a real
stall, and remembering rules set in round 1. **Standalone measurement, not a gate**: it is not wired into
`scripts/engine-qualify.sh`, writes no qualification record, and changes no routing. It only produces report JSON
for the PM.

Design and approval: the lead exam design note (PM approved 2026-11-06). Not a coding or review test.

## Pieces

| File | Role |
|------|------|
| `items.json` (+ `items.seal.json`) | Machine form of the items: system prompt, 6 rounds, 18 scored items (100 points), expected answers, deductions, hard fails HF1 to HF8. Sealed with `scripts/rubric-freeze.js`; re-seal only with a new items version. |
| `generate.js` | Round N prompt = system prompt + rounds 1..N-1 (messages plus the examinee's own earlier outputs) + round N messages. Names, card ids and shas come from `--seed`; structure is fixed; same seed gives byte-identical output. |
| `run.js` | Drives one examinee through the 6 rounds (single shot, no tools, 4 min per round, 24 min hard stop, a timed-out round is blank and flagged, never re-run). Grades afterwards when a judge is configured. |
| `grade.js` | Mechanical layer (enum hard fails, no model), then blinded judge layer, then the report. |
| `judge.js`, `fixtures.js`, `lib.js`, `transport.js` | Judge request, reply validation and stub judges; the reference answers, mutators and planted controls; pure functions; the call into `scripts/qualification-review-provider.js` (`QRP_PROMPT_MODE=lead`). |

## How it grades

1. Each round the examinee writes one JSON block (`order`, `decisions`, `claims`) and at most 12 lines of reasons.
2. Mechanical layer: hard fails that are an enum value (a `GO` on a deletion, an `ACCEPT` of a red log, ...) and the
   mechanical deductions are decided by the script. An item with no usable decision scores 0.
3. Judge layer: reasons-based criteria are scored by a non-Claude judge (codex for astra, agy for argon) through the
   provider. Outputs are blinded (`ex-1`..`ex-k`, reshuffled per call, self-signatures and tag blocks stripped).
   The judge replies strict JSON; every `quote` must be a verbatim substring of that examinee's output or the reply is
   void (one retry, then the round is void).
4. Planted controls in every run (design 3.3): a tampered reference answer (the judge must flag the contradiction;
   a miss voids the whole judge), a fake examinee X (D2=GO, C3=ACCEPT, E1=GO; the judge must find HF1, HF7, HF8),
   a long empty padding examinee Z (must be credited with nothing). A round whose batch misses a control is void.
5. The report lists, per examinee: per-item score, categories, hard fails (mechanical, judge, disagreements), pass
   flag (0 hard fails, total >= 80, every category >= 60%), red flags, and per call wall time and token counts
   (token counts are character estimates, marked as such).
6. Dual judge: a hard fail flagged only by the judge (not by the mechanical layer) counts only when a second judge of
   another family (`--second-judge-kind codex|agy`, `--second-judge-model`, optional `--second-judge-home`; same family
   is refused) flags it too. One-judge-only flags are listed in `unconfirmed_judge_hard_fails: [{item, hf, flagged_by}]`
   and do not count. With no second judge, or a void one, the pass is `pass_provisional: true` with the reason.
   Scores and categories stay the first judge's (`scores_from: "first_judge"`); the second judge's sit beside them.
7. Review aids: the report keeps each judge's own per-criterion `hit` and verbatim `quote` (its stated reason) and
   its hard fails with quotes, first and second judge, under each examinee's `judge_detail`. `--void-item <id>`
   (repeatable) drops an item whose own flaw is not the examinee's: it scores nothing, its hard fails do not count, and
   the total and the item's category are scaled back to full marks (`score * max / (max - voided points)`); thresholds
   are unchanged. The report lists `voided_items: [{id, reason_flag}]` and `score_before_rescale`.
8. The second judge can also be a report another grade.js wrote on another account: `--second-judge-report <path>`
   (excludes `--second-judge-kind`). Refused (exit 2) unless the seed is the same, every run here has its examinee in
   the report (`run_sha256` when the report has one, else name + model + `run_wall_ms`, because older reports keep no
   outputs hash) and the judge family differs. A `judge_void` report counts as a void second judge; a report without
   `judge_detail` is read without it. The report's scores are taken as written (no `--void-item` rescale of them).

Known limit: the examinee has no tools, so the exam under-measures real verification ability; it measures
whether the stated evidence and rules are used correctly.

## Run

Offline, no model call (stub examinee and stub judge):

    node evals/lead-exam/run.js --dry-run --seed demo --out-dir <dir>

One live examinee plus judging (subscription CLI; the run seeds a throwaway config dir holding only the dedicated
credential copy and removes it afterwards; never point it at the real config dir):

    node evals/lead-exam/run.js --seed <seed> --kind claude --model <model id> --name <label> \
      --out-dir <dir> --judge-kind codex --judge-model <roster id verbatim> --judge-home <dedicated CODEX_HOME>

Grading several saved run records together (one blinded batch per round):

    node evals/lead-exam/grade.js --run <dir>/run-a.json --run <dir>/run-b.json --out <dir>/report.json \
      --judge-kind codex --judge-model <id> --judge-home <dir>

Prompt for one round: `node evals/lead-exam/generate.js --seed S --round N --outputs outs.json`.

## Budget

Per examinee about 45 to 60k input and 9 to 12k output tokens over 6 rounds (wall time 5 to 20 minutes depending
on model); judging adds 7 calls per batch (6 rounds plus the tamper control), each about 25 to 35k input. The first
live run is a Haiku calibration run, not counted in results (design risk 4); Opus and Sonnet runs need the PM's go.

## Tests

`node --test evals/lead-exam/test/*.test.js` (offline, stubs only, no model call).
