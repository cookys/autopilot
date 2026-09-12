# QC panel — input containment gates (P2+P3)

Run 2026-09-12 at depth 0 against the full branch diff (46,739 bytes, 7 files) plus a
depth-0-authored trusted spec. No implementer self-report reached any seat.

## The first round was discarded, and the fault was the dispatcher's

The first panel was given `git diff ... -- scripts platforms hooks`, which excluded `CLAUDE.md` and
`docs/scripts-inventory.md` — while the spec handed to the seats explicitly required both scripts to
be listed in those two files. MiniMax-M3 and Qwen3.8-Max-Preview **independently** returned
FIX-THEN-SHIP with the same 🟠 "the documentation updates are missing".

Both were right about what they were shown and wrong about the branch: the branch carries both edits
(`CLAUDE.md` gains the two scripts in the Worktree & branch lifecycle group; `docs/scripts-inventory.md`
gains a row each) and `check-claude-md-inventory.js` exits 0. On the complete diff both findings
vanished.

This is the same family the deliverable itself is about — **a check aimed at the wrong object** —
except the wrong object was the one depth-0 prepared. The first-round verdicts are kept at
`qc23-*-partialdiff.json` rather than deleted, because they are the evidence for that.

## Seats (complete diff)

All three are cross-family with respect to the implementer (`cursor-grok-4.6-low` @ cursor, family `xai`).

| Seat | Runner | Family | Verdict |
|---|---|---|---|
| MiniMax-M3 | cc-shim @ minimax | minimax | SHIP-AS-IS, no findings |
| Qwen3.8-Max-Preview | qoderclicn | alibaba | SHIP-AS-IS, 1 🔵 |
| GLM-5.2 | cc-shim @ glm | zhipu | SHIP-AS-IS, 3 🔵 |

## Adjudication — one 🔵 PROMOTED to 🟠 by re-derivation

Three SHIP-AS-IS is not the verdict. `union-on-verified-critical` is re-derivation, and here it went
**against** the seats: GLM's third-listed 🔵 is a real defect whose exclusion rationale is wrong.

### 🟠 `cc-receipt-multi-edge-first-only` — PROMOTED and FIXED before merge

GLM observed that `loadEdge()` silently returned `edges[0]` and excluded it: *"the real writer
record-integration.js is invoked per --unit-id and emits a single-edge receipt … so the reachable
surface is single-edge."*

The premise misses the other producer. Re-derived:

```
grep -n 'preflight.edges.length !== manifest.edges.length' src/merge/cli.js   → :360
node -e '…schemas/merge-execution-receipt.schema.json…'  → edges: array, minItems: none
```

`src/merge/cli.js` pins receipt edges to manifest edges and the schema caps neither end, so a real
merge receipt is **routinely multi-edge**. A multi-edge receipt whose later edges are uncontained
therefore exited 0 with those edges never checked — a silent partial check carrying a gate's
authority, which is precisely the defect this deliverable exists to prevent.

Fixed in `d8890545`: every edge is checked and the worst outcome wins, matching the rule
`check-inputs-landed.js` already applies to inputs. The regression case was **verified to go red
against the original implementation** — reverting `loadEdge` to `edges[0]`-only turns 49 passed into
47 passed / 2 failed. Without that proof a fix is indistinguishable from no fix.

## Follow-ups recorded (not blocking)

- **`{"inputs":[]}` is a vacuous pass** in `check-inputs-landed.js` (GLM 🔵, self-excluded): an
  explicitly empty valid document is neither unreadable nor parser death, and the spec only required
  refusal for missing/unreadable input. Mirroring `check-containment`'s empty-`edges` refusal would
  harden it.
- **Field-level `REFUSED` paths return exit 1 while the header documents exit 2** (GLM 🔵). Messages
  still say REFUSED, carry operands, and are non-zero, so no silent pass is reachable; cosmetic.
- **No automated mirror-sync guard is added** (Qwen 🔵). Qwen re-derived the blob hashes itself
  (`7abe7d54`, `0a23a0b8`) rather than asserting the mirror looked present.

## Verified

`hooks/tests/input-containment-gates.test.sh` 49 assertions; `check-js-syntax` 0;
`check-claude-md-inventory` 0; `sync-codex-plugin-skills.sh --check` 0.

## Process disclosure

The campaign reached `dispatch_implementation: committed`, `campaign_scope: passed`,
`campaign_verification: passed` and two `dispatch_review: reviewed` rounds before the rail blocked it
at `final_panel` with `final_panel_seat_precondition_failed`. This panel was run by depth-0 instead.
Further than any campaign got today, and still not a completed L5 managed run.
