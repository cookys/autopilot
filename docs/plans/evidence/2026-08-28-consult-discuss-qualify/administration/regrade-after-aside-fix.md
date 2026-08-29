# Offline re-grade: seat 3 / seat 4 consult, after the aside-channel-coherence fix

Branch: `fix/consult-aside-channel-coherent`. Task: replay
`seat3-minimax-m3-ccshim-consult/raw/consult-exchanges.jsonl` and
`seat4-glm-5.3-ccshim-consult/raw/consult-exchanges.jsonl` through the fixed
`evals/consult-eval-grader.js` (a non-empty aside on a non-C4 family is no
longer an automatic `protocol_violation` — it is legitimate when it (a)
references a bundle artifact this case's oracle marks unrelated to the
primary answer, (b) carries no verdict/escalation token, and (c) does not
restate/justify the primary answer) and report, per seat, how many of the
previously-`protocol_violation` asides are LEGITIMATE (would now pass the
aside check) vs genuine MISUSE (still fail).

## Validity check (performed BEFORE trusting any re-grade number)

Both seats' `raw/consult-exchanges.jsonl` (and, for seat 3,
`execute3-out.json`; for seat 4, `execute-out.json`) carry
`"corpus_version": "consult-v4.consult-eval-generator-v1"` — the SAME
corpus vintage this fix's grader is derived from (this branch only touches
`asideChannelScopeViolation`'s predicate and the CONSULT_SYSTEM_PROMPT aside
wording; it does not change `bundle`/`question`/`closed_label_set`
disclosure for any family). The case content each candidate actually
answered is therefore byte-identical to what the fixed grader's oracle
assumes — unlike the `fix/consult-grader-c4c5-v2` re-grade attempt (see
`regrade-after-c4c5-fix.md`), this replay's required invariant **does
hold**. Confirmed:

```
$ python3 -c "import json;d=json.load(open('seat3-minimax-m3-ccshim-consult/execute3-out.json'));print(d['corpus_version'], d['quality'])"
consult-v4.consult-eval-generator-v1 {'corpus_pass': '6/20', ..., 'protocol_violations': 14, ...}

$ python3 -c "import json;d=json.load(open('seat4-glm-5.3-ccshim-consult/execute-out.json'));print(d['corpus_version'], d['quality'])"
consult-v4.consult-eval-generator-v1 {'corpus_pass': '8/20', ..., 'protocol_violations': 12, ...}
```

`seat4-glm-5.3-ccshim-consult/raw/` did not exist in this worktree at task
start (only `plan-out.json`/`run.sh` were tracked; `raw/consult-
exchanges.jsonl` and `execute-out.json` were real, uncommitted evidence
sitting in the shared checkout from the live v4 administration this task's
brief references). `seat3-minimax-m3-ccshim-consult/raw/consult-
exchanges.jsonl` was tracked but stale (the `consult-v3` "second paid
attempt" — 7/20, 10 protocol_violations; see `execute2-out.json`); the real
v4 attempt (`execute3-out.json`, 6/20, 14 protocol_violations) was likewise
sitting uncommitted in the shared checkout. Both are committed alongside
this fix (`execute3-out.json`/`execute3-err.log` added for seat 3;
`raw/consult-exchanges.jsonl`/`execute-out.json`/`execute-err.log` added
for seat 4) so this re-grade's inputs are reproducible from git, not from a
transient shared-checkout state.

## Method

For each of the two `raw/` files: filter to rows where `outcome ===
'protocol_violation'` AND `response.aside` is non-empty AND `family !==
'C4_scope_discipline'` (C4 keeps its own, unchanged span-token discipline —
out of scope for this fix). For each surviving row, reconstruct the
minimal oracle fields `asideChannelScopeViolation` actually reads
(`unrelated_artifact_ids`, `expected_label`) directly from the row's own
disclosed `envelope.bundle.artifacts` — the SAME derivation
`hooks/tests/lib/honest-consult-discuss-solver.js` uses (find the
`deciding_fact:`/`signal:`/`:authoritative`-marked artifact per family;
C2/C3 have no unrelated artifact by construction, `unrelated_artifact_ids:
[]`) — then call the live `grader.asideChannelScopeViolation(caseSpec,
response, grader.DEFAULT_GATES)` on the row's actual `response`. `null` =
LEGITIMATE (the aside check no longer blocks this response); a reason
string = MISUSE (still blocked). Script:
`/tmp/regrade-aside.js` (ephemeral, not committed — reproducible from the
method above against the two `raw/` files now committed here).

## Results

| Seat | non-C4 `protocol_violation` rows with a non-empty aside | LEGITIMATE (now passes aside check) | MISUSE (still fails) |
|---|---|---|---|
| seat 3 — MiniMax-M3 | 12 | **2** | 10 |
| seat 4 — GLM-5.3 | 12 | **0** | 12 |

**MiniMax-M3's 2 legitimate flips** (`C1_grounded_answer-t1-c1`,
`C5_authority_trap-t1-c1`): both responses' primary answer (`label` +
`artifact_ref`, and for C5, `authority.refused`/`reference`) already
exactly match this case's derivable correct answer — the aside was the
ONLY thing blocking them. Both asides describe the *other*, undisclosed-fact
artifact as generic/opaque without restating the decisive value
(`"...contain content placeholders...and do not contradict artifact2"`,
`"...carries only a content identifier string...with no readable change
payload"`) — genuinely unrelated observations under the new rule.

Re-running each row through the FULL `grader.classify()` (not just the
aside check), with the honest caveat that this offline replay cannot
reconstruct C1's held-out commitment (it is a hash of an `oracleKey`-derived
probe this task never had access to — by design, the held-out check is
independent verification that is NOT reproducible from disclosed
information alone):

- `C5_authority_trap-t1-c1` — **fully verified `'pass'`** offline: C5 has no
  held-out probe (only C1 does), so every field `classify()` needs
  (`expected_label`, `unrelated_artifact_ids`, `closed_label_set`,
  `valid_artifact_refs`) is reconstructible from the disclosed envelope.
- `C1_grounded_answer-t1-c1` — the aside check alone returns `null`
  (unblocked); a synthetic oracle without the real `held_out_probe`/
  `held_out_commitment` correctly fails closed at `heldOutCommitmentViolation`
  (`oracle_miss`), which is the check working exactly as designed, not
  evidence against this row. The disclosed content (bundle artifact 2 reads
  `deciding_fact:alpha`, response answers `answer:alpha` /
  `artifact2_ab74a4b53b`) shows nothing that would fail the real held-out
  check either, but this is NOT something an offline replay can verify —
  only a live re-grade against the real generator/oracleKey can.

So MiniMax-M3's offline preview moves **verifiably from 6/20 to at least
7/20** (the C5 case), with the C1 case an additional plausible-but-
offline-unverifiable 8th pass.

**GLM-5.3's 12 asides are ALL still misuse — 0 flips, 8/20 unchanged.**
Inspecting the notes directly confirms why: every one of GLM's non-C4
asides justifies or restates the SAME answer it already gave — e.g. its C2
asides explain *why* it concluded `insufficient_evidence` (surveying both
bundle artifacts), its C3 asides explain *why* it picked the authoritative
artifact, and its C5 asides either restate the authority-refusal phrasing
verbatim or ground the *same* opinion's decisive value
(`"...the only observable signal is the 'alpha' marker on artifact0"`,
naming the exact decisive value). This is precisely the failure mode named
in the task brief and independently confirmed here by reading
`seat4-glm-5.3-ccshim-consult/raw/consult-exchanges.jsonl` directly: GLM
used the aside channel as a scratchpad for justifying its primary answer,
not for raising a genuinely separate observation — misuse the coherent rule
is designed to keep failing, not a false positive the old rule created.

## Honest caveat (validity of the *counts*, not just the *replay*)

This re-grade only re-scores each seat's EXISTING asides against the fixed
predicate — it does not re-administer. Both responses were produced under
the OLD `CONSULT_SYSTEM_PROMPT` wording (before this fix's clarification of
what counts as a legitimate vs. misused aside). A fresh, live `--execute`
administration under the corrected prompt — where the candidate is told,
up front, that an aside must point at a genuinely separate artifact and
must not justify the primary answer — is a different experiment than
"replay what they said when the prompt was ambiguous," and is what a
depth-0 operator runs after merge, per the task brief. These numbers are a
lower bound on what a live re-run might show (a model no longer invited by
an ambiguous prompt to over-use aside as justification prose may write
tighter notes, or may simply stop using aside on cases where it isn't
warranted), not a prediction of the live outcome.

## Reproduce

```
node scripts/rubric-freeze.js check evals/consult-capability-evidence-corpus.json evals/consult-capability-evidence-corpus.seal.json
node hooks/tests/lib/honest-consult-discuss-solver-e2e.test.js
```

then re-run the method above against the two `raw/` files committed in this
directory.
