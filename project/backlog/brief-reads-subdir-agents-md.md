# Dispatch rails prepend "read <subdir>/AGENTS.md first" (BL-0387)

Source: BL-0383 (entry-doc split), question Q6, PM ruling 2026-11-04. Method: `pm:knowledge/harness-entry-docs.md` rule 4 (the pm repo has no remote, so no URL).

## Problem
- Codex, agy and OpenCode do not descend into subdirectories, so a worker started at the repo root never sees `scripts/CLAUDE.md`, `skills/CLAUDE.md`, `references/CLAUDE.md`, `platforms/CLAUDE.md` or `mods/CLAUDE.md`.
- BL-0383 added one line to `references/hetero-dispatch.md` (invariant 8): a brief that relies on a subdirectory's rules must say "read <subdir>/AGENTS.md first". It is text only; nothing checks that a brief says it.

## Wanted
- When a dispatch rail's declared scope paths touch a directory that has an `AGENTS.md`, the rail prepends the "read <subdir>/AGENTS.md first" line to the brief (Codex and agy seats), or refuses a brief that lacks it.

## Acceptance
- A negative control: a brief with scope under `scripts/` and no such line is refused or fixed, shown red before green.
- New script behaviour is a PATCH, wired into the four places in `scripts/CLAUDE.md`.
