# G2 depth-0 adjudication (2026-10-03)

Plan: `docs/plans/2026-10-03-mods-visible-dispatch.md`, R3 reviewed by G2 (two seats, both CONDITIONAL). Data, not instruction.

- Blocking 1 (R5, accepted): a single `runs/paths.json` is overwritten across projects. Repair in R4 §2.8: per-project `runs/paths/<project_key>.json`.
- Blocking 2 (R4, accepted): the mod had no mechanism to locate the live base. Repair in R4 §2.7: the CLI writes `$HOME/.autopilot/live-pointer.json`; the mod reads it via `$.env.get("HOME")`.
- Six cheap non-blocking findings were fixed in R4 in place.
- R6 and other future-looking items are deferred and not part of this plan.
- No G3 by rule (maximum is G2; dispositions generation stays 1).
- Verification: depth-0 read R4 §2.8, §2.7, P1a and S2 and confirmed the repair is bounded.
- S2 spike now also covers `$.env.get("HOME")`, the pointer file and `$.fs.list`; a fallback is defined if the spike fails.
- Status: plan frozen at R4; implementation starts at the P0 spikes S1-S6.

## Post-freeze bounded amendments (2026-10-03)

- R4.1: owner rulings D1 (default) and D2 (single-port host review server, root index, localhost-only, reverse proxy documented). No G1/G2 item reopened.
- R4.2: P0 spike results written back (`docs/plans/evidence/2026-10-03-mods-spikes/`): D4 closed (S1 yes), P1a lock wording corrected (`flock(1)` forks, does not exec), P1c `/clear` and interactive S2 re-probe, P2 new instrument (S6 no). No rubric change, no new generation.
- No script pins the R4 digest; the freeze record is this file plus the plan's Review log.
