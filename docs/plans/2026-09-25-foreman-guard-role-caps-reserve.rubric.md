# Rubric — 2026-09-25-foreman-guard-role-caps-reserve.md

> Source plan: docs/plans/2026-09-25-foreman-guard-role-caps-reserve.md

R1: Node ≥ 20.10, built-ins only; foreman-guard stays fail-open (an internal error ⇒ exit 0, no output).
R2: Default-on behavior under an ACTIVE l4–l6 marker is unchanged for any agent without a `Role:` line (still 40, still denied).
R3: A hook never trusts the child's own later output for its role. The role comes only from the child's FIRST user message
R4: New cases go in a NEW suite `hooks/tests/foreman-guard-roles.test.sh` (`chmod +x`). Do not append to `foreman-guard.test.sh`.
R5: Do not edit CHANGELOG, the version, or `.claude-plugin/plugin.json` in the implementation commits; depth-0 lands the release.
R6: 🟠 **Role laundering**: a foreman spawns a `Role: worker` child to run its polling loop. That is accepted for now, because polling and Monitor rules still apply to every
R7: 🟠 **P0 route (a) fails**, e.g. `transcript_path` is the parent's transcript. Then foreground workers stay at 40, the gain is smaller, and this is stated honestly in the CHANGELOG.
R8: 🟡 **The reserve allowlist is too tight** and a legitimate close-out command is denied. `warn` mode still exists as an escape hatch, and the directive names the allowed verbs.
R9: Inversion: what guarantees failure? A role read from anything the child writes itself, or an advisory that goes to stderr. Both are excluded by §2.5 and P1.
