# P0(a) spike: can one `scripts/adjudicate-findings.js` store hold multi-lane findings?

Read-only spike, fixtures only (a `mktemp -d` store, no repo file touched, no model call). Base `64eedde66`.

## Answer

**Yes, with a naming convention; no, not as a first-class lane field.** One JSONL store accepted findings from three lanes, `completeness` ran registry-wide across them, and `repair-gate` accepted ids from two different lanes in one call. The schema has no `lane` field: an unknown key is rejected (`unknown field '<key>' in store event`, `scripts/adjudicate-findings.js`), so the lane tag must ride in `finding_id` (`A-F1`) and/or `source` (`lane-A:reviewer1`). `status` has no lane filter; a per-lane view needs a prefix filter outside the script.

## Commands and output

```bash
S=$(mktemp -d)/findings.jsonl; A="node scripts/adjudicate-findings.js"
# add (4 findings, 3 lanes): A-F1 Major, B-F1 Major, C-F1 Critical, C-F2 Minor   -> rc=0
echo '{"finding_id":"A-F1","claim":"lane A edge case","severity":"🟠","source":"lane-A:reviewer1"}' | $A add --store $S
# ... B-F1, C-F1, C-F2 likewise; then probe A-F1, B-F1, C-F1 -> status REPRODUCED
$A completeness --store $S
```

Before any disposition:

```
complete=false blocking=3 must-fix-now=- follow-up-or-reject=- missing=A-F1,B-F1,C-F1 conflict=-     (rc=1)
```

After `dispose` A-F1 and B-F1 `must-fix-now`, C-F1 `follow-up`:

```
complete=true blocking=3 must-fix-now=A-F1,B-F1 follow-up-or-reject=C-F1 missing=- conflict=-       (rc=0)
repair-gate --ids A-F1,B-F1  -> rc=0
status --json: C-F2 (Minor, unprobed) is non-actionable, repair_eligible=false
```

## Consequences for the plan

- Step 4 of the batch flow ("pool findings across lanes in one store, `completeness` registry-wide") is mechanically possible today with no script change.
- Lane identity needs a convention (id prefix `<lane>-`), to be stated in the guidance text if the change ships. A schema `lane` field would be a separate mechanism change and is not proposed here.
- `completeness` counts only Critical/Major (blocking=3, the Minor was ignored), so a pooled Minor needs no disposition.
- The store filename is `findings.jsonl`, written by the script, not by a subagent Write; it is not a `FINDINGS*` report-shaped file and the late-input rule (lanes return findings as text, depth 0 writes) is unaffected.
