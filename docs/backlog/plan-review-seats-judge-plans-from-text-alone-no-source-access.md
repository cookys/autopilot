# Plan-review seats judge plans from text alone — no source access

- **Context**: `scripts/dispatch-plan-review.js` gives seats only the rubric and the plan text; non-codex runners start in an empty temp dir, so claims about code cannot be checked by the seat. FIRED in the mods plan G1 and G2 reviews (architecture seat had no source checkout).
- **Fix**: optional allowlisted, size-capped context files hashed into the session seal, or a read-only snapshot of the repo. Cleanroom stays the default.
- **Source**: mods plan G1+G2, `docs/plans/evidence/2026-10-03-mods-visible-dispatch-design/`.
