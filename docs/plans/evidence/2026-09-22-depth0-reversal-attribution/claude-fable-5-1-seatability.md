Short version: the plant ceiling is an instrument defect, convergence is measuring the seed's horizon rather than the seat, fairness is the one subject where a real capability gap is plausible, and the exam needs a clean-room reference solver plus a per-instance feasibility certificate before it can claim sittability.

## 1. The 4/5 ceiling

Capability signals vary. Ten trials, five families, two effort tiers, and recall never moved off one value. Meanwhile false alarms ranged from zero to four across the same trials. An engine reporting four spurious pairs is running a loose threshold, and a loose threshold that still misses exactly one plant means the missing plant is not a threshold question. It is invisible or inexpressible from the candidate's side.

Three defect classes produce this signature. Confirm each from the artefacts you hold, because the round-12 bundle is monotonic and therefore contains every claim and receipt the oracle planted, unlabelled.

- **Unreachable plant.** One kind's receipt lands in a round where reporting it is impossible, most likely round 12, where the teaching mandates spending the round on declaring. Check: for each trial, find the round in which each definitional contradiction first became visible in the bundle. If one always appears in a round where the candidate's legal or taught action excludes a report, that is the miss.
- **Ambiguous pair.** Exact matching on a claim and receipt pair assumes exactly one correct receipt per claim. Reintroduction and reversal both admit two readings when more than one receipt touches the claim, such as the first failing receipt versus the latest one. Check: for each trial, diff the union of all candidate-reported pairs against the definitional contradiction set derived from the final bundle. If the unmatched plant is always one whose claim has two candidate receipts, and the candidates cited the other one, the oracle is keying on a receipt the public definitions do not single out.
- **Late-counted-as-missed.** The grader computes a first miss round, so timing is graded. Stale progress is only provable after a window elapses. If the oracle expects the report in the round the receipt lands but the definition only permits detection one round later, every honest candidate is late and scored as missed. Check: compare each candidate's report round for the missing kind against the round the receipt landed.

The mock does not rule these out. A mock scripted from the generator's plant list knows the oracle's receipt choice and its timing. It proves oracle self-consistency, not bundle-derivability.

What would convince me these are five genuine misses: the missed kind varies across trials, the missed pair is unambiguous under the public definitions, a clean-room solver built from the definitions alone finds it, and recall correlates with the candidates' false-alarm rate or effort tier. Today none of those hold.

Do not give up on recovering the oracles. The nonce is unpersisted, but the bundle is a deterministic function of it. If the nonce space or its derivation from a logged seed is bounded, regenerate candidates until the bundle matches byte for byte. That is offline and deterministic.

## 2. What the record must carry

Persist the run nonce and the generator hash first. Everything else is attribution on top. Per trial:

```
nonce, generator_hash, teaching_hash, seed, bundle_hash[round]
plant[kind]: claim_id, receipt_id, landing_round, earliest_detectable_round,
             legal_report_rounds, ambiguous_receipts (list)
candidate_out[round]: raw, parsed, legal_action_taken
diligence[plant]: verdict in {matched, late:<round>, wrong_receipt:<id>,
                  wrong_claim:<id>, missed}
false_alarm[pair]: definitional (bool), kind_if_definitional
fairness[arm]: arm_id, producer_label, expected, given, provenance_cited
convergence: open_findings[round], verify_scope[round], receipts_issued[round],
             declare_round, declare_legal_at_declare_round, min_rounds_to_close
containment[blocked_path]: exits_declared, exit_taken
reference_solver: transcript, verdicts (same schema)
```

Two of these change the diagnosis on their own. A false alarm that is definitional under the public rules is oracle incompleteness, not a candidate fault. A plant with a nonempty ambiguous receipt list is not gradeable by exact match.

## 3. Aggregation

AND of subjects is right for an entry gate. Zero tolerance inside a subject is only right where the instrument has shown zero measurement error. Containment passes universally and its rules are mechanical. That is what a calibrated zero-tolerance line looks like. Diligence recall and false alarms have not earned that status.

The honest alternative is not a looser threshold. It is an arming rule. A zero-tolerance line stays reported but does not gate until a clean-room reference solver scores perfectly on it across a pre-committed set of nonces. Until then the gate is provisional and says so in the row. Once armed, the line is exactly as strict as today.

Second change: grade false alarms against the definitions, not the plant list. A reported pair that is a contradiction under the public rules is correct even if unplanted. This removes noise without tolerating errors. Grok's extra alarms may already be examples.

The append-only row stands. Add an instrument status column so a failure can be marked as unattributable without being erased.

## 4. Convergence

Three repairs each fixed their target metric and the subject still fails. That pattern means the remaining failure is not in the teaching. It is in the arithmetic of the seed.

Scoped verify then close then declare needs a minimum number of rounds after the last finding becomes visible. If reintroduction or reversal lands in round ten or later, that minimum can exceed the rounds remaining. The candidate is then unconverged by construction. Check it now: for each held trial, compute the round of the last visible finding and the minimum closure rounds under the legal vocabulary. Then look at the incumbent's one declaring trial and see whether its last landing was early. I expect it was.

A second check: did any candidate's scoped verify ever return a closure receipt from the harness? If verify receipts were never issued, findings never closed, declaring was never legal, and the streams could not end.

The construct is measurable in a stateless stream, because the bundle carries the candidate's prior actions, so the plan is reconstructible each round. Make it seat-measuring instead of horizon-measuring in two ways. Require the generator to guarantee a last landing round that leaves the minimum closure rounds available. Grade the trajectory: open findings must be non-increasing after the last landing, verification must be scoped, and the declare must occur at the round the seed makes feasible. That separates "did not budget" from "could not have".

## 5. A demonstrability requirement

The construction is a clean-room reference solver and a per-instance certificate.

The solver is deterministic and written from the teaching prompt and the public definitions only, by someone who has not read the generator. It sits the exam through the same stateless interface as a candidate, one bundle in and one object out per round. Its pass demonstrates that the exam is passable from the candidate's view. The current mock demonstrates only that the oracle agrees with itself.

The certificate is computed offline before any candidate sits, and attached to the row. It asserts, per nonce: every plant has exactly one receipt consistent with its definition, every plant is reportable in a legal round before the final one, the convergence arithmetic is feasible, the definition-derived contradiction set equals the plant set plus a logged list of incidental ones, and the clean-room solver scored full marks. An instance that fails its certificate is not administered. That is not re-running to pass, because no candidate sat.

For the fairness subject I do not expect the certificate to rescue the engines. Wrongness there varies by family, the effort tier fixed one arm, and two families were wrong on the same three arms in both trials with zero pair delta. That looks like a shared misreading of one contested arm, most likely the missing-protection rule, plus a real judgment gap. Run the diff on which arms failed across engines. If one arm fails for everyone, contest the arm's expected verdict. If the rest still fail after the arm is settled, that is the evidence that the seat is not yet sittable, and it is the only such evidence this exam currently produces.

