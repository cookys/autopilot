# Plan — Containment is asserted against the right object, and the question depends on the method

> Status: **R0 — DRAFT** (depth-0, 2026-09-12) · Deliverable node: `p23-input-containment-gates` ·
> Depends on: `p1-integration-receipt-sha-ledger` ·
> Shared context: [`2026-09-12-integration-ledger-and-marker-gates.md`](2026-09-12-integration-ledger-and-marker-gates.md)

## 1. Problem

Two halves of one gap, on either side of integration.

**Before a phase spends**: there is a campaign contract and a pinned base SHA, but nothing asserts that a
phase's declared inputs are actually in the tree being worked on. The peer's G1 measurement phase existed
solely to measure six lanes and ran for two days without anyone checking the lanes were in the build
being measured.

**After merge-back**: `skills/ceo-agent/references/level-front-door.md` §4 already says in prose that a
cherry-pick copies a commit without making the source an ancestor. Prose did not stop them. They moved a
foreman's work with `git diff --binary | git apply --index`, integrated a pre-fix version carrying a
regression the foreman had already caught on its own branch, and when they went back for the fix git saw
no common ancestry and conflicted.

## 2. The load-bearing semantic

The containment assertion is **selected by `integration_method`**:

| `integration_method` | Required post-condition |
|---|---|
| `merge`, `ff` | `git merge-base --is-ancestor <source_sha> <target>` MUST succeed |
| `cherry-pick`, `rebase`, `squash`, `apply+fresh-commit` | that command MUST fail, and that is **correct**; containment is asserted instead on `accepted_sha` being an ancestor of the target |

A check that asserts ancestry unconditionally reproduces the peer's false negative **with a gate's
authority behind it**. That is the whole reason this deliverable exists, and an implementation that gets
this wrong is worse than no gate.

## 3. Scope

Two new scripts under `scripts/` — `check-inputs-landed.js` and `check-containment.js` — their `hooks/tests` coverage, a row each in
`docs/scripts-inventory.md` and in the grouped script list in `CLAUDE.md`, and the codex mirrors. Node,
not shell — both parse JSON.

## 4. Out of scope

- The repo-level residue sweep.
- Changing how integration is performed. These gates only observe.
- Wiring either gate into a default-on hook. They ship callable and documented; switching them on is a
  separate decision with its own evidence, per the "a script existing is not evidence it is running"
  caution in `CLAUDE.md`.

## 5. Phase — inputs-landed gate

Eats `{"inputs":[{"id":"...","sha":"..."}]}` plus a target ref. Asserts each `sha` is an ancestor of the
target. Exits non-zero naming **every** failing entry in one run, not the first — a gate that stops at
the first failure makes the operator re-run it once per broken input.

## 6. Phase — containment assertion

Eats an integration receipt edge (from `p1`) and a target ref, and applies the method-selected
post-condition in §2. When the method is apply-style it additionally requires the `source_sha` to appear
in the accepted commit's message, and reports — never enforces — whether the source branch still exists.

## 7. Acceptance

```
node scripts/check-inputs-landed.js --inputs <fixture: 3 inputs, 2 absent> --target <ref>
    # non-zero; stdout/stderr names BOTH absent ids and their SHAs in one run
node scripts/check-inputs-landed.js --inputs <fixture: 3 present> --target <ref>          # exit 0
node scripts/check-containment.js --edge <fixture: method "merge", source IS ancestor>    # exit 0
node scripts/check-containment.js --edge <fixture: method "merge", source NOT ancestor>   # non-zero
node scripts/check-containment.js --edge <fixture: method "apply+fresh-commit",
     source NOT ancestor, accepted IS ancestor, source sha in message>                    # exit 0
node scripts/check-containment.js --edge <fixture: method "apply+fresh-commit",
     accepted NOT ancestor>                                                               # non-zero
node scripts/check-js-syntax.js
node scripts/check-claude-md-inventory.js
bash scripts/sync-codex-plugin-skills.sh --check
```

Row five is the decisive one: an unconditional `is-ancestor` implementation fails it, and that is
exactly the implementation a hurried reading of the peer's report produces. Its fixture must be a
receipt **emitted by `scripts/record-integration.js`** (shipped by `p1-integration-receipt-sha-ledger`)
against a real sandbox `apply+fresh-commit`, not hand-authored JSON. A hand-authored fixture would make
the decisive case unfalsifiable in exactly the way the D4 admission bypass was.

## 8. Acceptance IDs

- `p2-inputs-landed-gate-refuses-per-entry`
- `p3-containment-assertion-is-method-selected`
- `p3-apply-style-non-ancestor-source-passes`
