# P1 evidence — per-skill ratchet red/green (2026-08-18)

Gate under test: `preflight-release.sh` check 8 per-skill block (new `check_per_skill_ratchet`),
consuming the `skills{}` map that `--update-baseline` now writes into
`docs/metrics/surface-lines.json`.

- **Map generation**: `--update-baseline` on v2.34.17 wrote 28 skill entries; spot values
  dev-flow=713, ceo-agent=550 (match `wc -l`).
- **Planted red**: baseline doctored to `skills["dev-flow"]=100`, no `prose-justification:` in
  the v2.34.17 CHANGELOG section → check 8 output
  `per-skill ratchet: SKILL.md grew past recorded baseline: skills/dev-flow/SKILL.md: 100 → 713`
  → ✗ (gate CAN go red; not a shadow of the answer it checks — the cap comes from the recorded
  baseline file, the measurement from the live tree).
- **Green**: cap restored to 713 → check 8 ✓.
- **Backward compat**: committed v2.34.16 baseline has no `skills{}` map → ratchet no-ops;
  full preflight 8/8 against it after restore.
- Companion rails after the P1 edits: `check-canonical-invariants.sh` OK, `validate.sh` 28/28,
  `sync-codex-plugin-skills.sh --check` OK (new reference auto-mirrored), `sync-all.sh --check`
  ok:true, `check-claude-md-inventory.js` clean (CLAUDE.md 15598/40000 bytes).

Baseline file restored to the committed v2.34.16 state — the official refresh (recording the
skills map for the first time) runs at P8 `--update-baseline` per plan §8/§10.
