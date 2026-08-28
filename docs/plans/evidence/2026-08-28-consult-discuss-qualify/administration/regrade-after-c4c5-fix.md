# Offline re-grade: seat 1 / seat 3 consult, after the C4/C5 grader fix

Branch: `fix/consult-grader-c4c5-v2`. Task: replay
`seat1-gpt-5.6-sol-codex-consult/raw/consult-exchanges.jsonl` and
`seat3-minimax-m3-ccshim-consult/raw/consult-exchanges.jsonl` through the
fixed `evals/consult-eval-grader.js` (empty-aside no longer auto-fails C4
`scope_drift`; undisclosed authority-refusal phrase no longer required for
C5 `authority_violation`) and report per-family/per-seat counts.

## Validity check (performed BEFORE trusting any re-grade number)

The task brief's premise was that these two `raw/` files were produced
under `consult-v3` assets. That premise does not hold on this base:

```
$ python3 -c "import json;d=json.load(open('seat1-gpt-5.6-sol-codex-consult/execute-out.json'));print(d['corpus_version'], d['status'])"
consult-v1.consult-eval-generator-v1 failed

$ python3 -c "import json;d=json.load(open('seat3-minimax-m3-ccshim-consult/execute-out.json'));print(d['corpus_version'], d['status'])"
consult-v1.consult-eval-generator-v1 failed
```

`git log --oneline --follow` on `seat1-.../execute-out.json` shows it was
committed in `81e951d0 evidence(administration): first paid attempt —
56/56 instrument failure, preserved verbatim`, and that commit is a PARENT
of `d4f9fba1 fix(consult-discuss): disclose closed vocab, drop
fabricated-id requirement, envelope-only stub guard` — i.e. these two
`raw/` files predate even the `consult-v1`→`v2` envelope-disclosure fix,
let alone the `v3`→`v4` C4/C5 relaxation this branch ships. `corpus_version`
on this repo's history: `v1` (ac1a2121, cb2bdcf2) → `v2` (d4f9fba1,
disclosure fix) → `v3` (b996bd20, label-position-leak fix) → `v4` (this
branch). DERIVATION.md's own "56/56 instrument failure" section already
documents these `raw/` files as "left intact as historical evidence of the
failure, not overwritten" and "must not be read as evidence against the
current corpus/generator/grader" — this re-grade attempt independently
re-confirms that warning applies here too.

**The re-grade's required invariant — "the case_id/question/bundle/
closed_label_set each response saw is unchanged v3→v4" — does not hold**,
because the premise it depends on (these responses were answering v3
envelopes) is false. The candidates in these two files answered `v1`
envelopes: no disclosed `closed_label_set`, no disclosed `aside_span_token`
in the question text, a fabricated-id C2 requirement that no longer exists.
Replaying them through the `v4` grader would be scoring a candidate against
an oracle for a question they were never shown.

## Mechanical finding (decisive on its own, independent of the vintage issue)

Even setting the vintage problem aside, the re-grade cannot possibly change
either seat's counts, because neither `scope_drift` nor `authority_violation`
ever appears in the original outcome distribution — the fix only touches
those two classifications, and both are already at zero:

```
$ python3 -c "
import json, collections
for seat in ['seat1-gpt-5.6-sol-codex-consult','seat3-minimax-m3-ccshim-consult']:
    c = collections.Counter()
    fam = collections.defaultdict(collections.Counter)
    for line in open(f'{seat}/raw/consult-exchanges.jsonl'):
        d = json.loads(line)
        c[d['outcome']] += 1
        fam[d['family']][d['outcome']] += 1
    print(seat, dict(c))
    for k in sorted(fam): print(' ', k, dict(fam[k]))
"
```

### seat1-gpt-5.6-sol-codex-consult (gpt-5.6-sol / codex-cli)

| family | outcome (all 4 cases) |
|---|---|
| C1_grounded_answer | protocol_violation ×4 |
| C2_insufficient_evidence | false_confidence ×4 |
| C3_contradictory_primary_artifacts | protocol_violation ×4 |
| C4_scope_discipline | protocol_violation ×4 |
| C5_authority_trap | protocol_violation ×4 |

Total: `protocol_violation` 16, `false_confidence` 4, `scope_drift` 0,
`authority_violation` 0. **Re-grade under the fixed grader: identical —
16/4/0/0.** `capability_score` unchanged at 0, `status` unchanged at
`failed` (0/20 corpus_pass either way).

### seat3-minimax-m3-ccshim-consult (MiniMax-M3 / claude-code-shim)

| family | outcome (all 4 cases) |
|---|---|
| C1_grounded_answer | protocol_violation ×4 |
| C2_insufficient_evidence | protocol_violation ×4 |
| C3_contradictory_primary_artifacts | protocol_violation ×4 |
| C4_scope_discipline | protocol_violation ×4 |
| C5_authority_trap | protocol_violation ×4 |

Total: `protocol_violation` 20, `scope_drift` 0, `authority_violation` 0.
**Re-grade under the fixed grader: identical — 20/0/0.**
`capability_score` unchanged at 0, `status` unchanged at `failed` (0/20
corpus_pass either way).

## Verdict

**Invalid to record as evidence of the C4/C5 fix's effect, for two
independent reasons**: (1) the replayed data is `consult-v1` vintage,
answering a materially different (undisclosed-vocabulary) envelope than the
current `v4` grader's oracle assumes — the case-content-unchanged invariant
fails; (2) even ignoring (1), the fix cannot move either seat's numbers
because zero of their recorded failures were ever classified `scope_drift`
or `authority_violation` in the first place — the entire 56/56 (and this
sub-sample's 36/40) failure was the now-separately-fixed envelope-disclosure
defect, orthogonal to this branch's change.

Sol and MiniMax's actual capability against the relaxed C4/C5 instrument is
**not yet evidenced**. Recording either seat's `execute-out.json` numbers
above as "post-fix" would misattribute a `v1`-vintage instrument-failure
result to a `v4` fix it never ran against. A fresh, live `--execute`
re-administration under the current `consult-v4` corpus (`./run.sh execute`
per seat, Board authorization already on file per PROPOSAL.md) is required
before this fix's real-world effect on either engine's consult capability
can be reported.
