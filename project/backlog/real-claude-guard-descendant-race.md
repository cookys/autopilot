# The mods real-claude guard can race a leftover descendant of the claude run (BL-0396)

Source: hetero-review modsreal g3 (astra), with the PM ruling of 2026-11-05.

## Problem
- `mods/lib/real-claude-env.sh` (lane modsreal, not merged yet) checks the sandbox root's identity, then scans and cleans it.
- A descendant of the claude run that outlives `timeout` (backgrounded or started with setsid) could swap a path between the identity check and the `find` / `chmod`.
- Then the scan sees only a symlink and stays green, or `chmod` follows a swapped symlink.

## Ruling
- The review first raised it as a blocker; the PM agreed on 2026-11-05 that it is not one: a same-user process gains no new capability, and the guard detects accidental credential or transcript leakage, not a hostile child.
- Hardening is still cheap, so it is filed here.

## Fix wanted
- Start the run in its own process group (setsid) and kill the whole group before the identity check and the scan.
- Optionally use descriptor-anchored operations for the scan and the cleanup.
- Add a race regression with a fake child that leaves a background descendant.

## Notes
- Trigger: the modsreal lane merges. Effort S.
