# Skill frontmatter `tier:` migration — the one prong of skill-metadata-portability-hygiene that never landed

Plan `docs/plans/_archive/2026/08/2026-08-02-skill-metadata-portability-hygiene.md` shipped the probe
(`scripts/probe-skill-frontmatter-portability.sh`) but `grep -rln '^tier:' skills/*/SKILL.md` is empty on
develop (2026-09-20 orphan triage): no skill carries a `tier:` key, so the portability probe has nothing to
check. The other prongs (OpenCode re-probe, CLAUDE.md capacity, doc-gate fix) are unverified.

Size S: decide whether `tier:` is still wanted (plan §2); if yes, add it to every SKILL.md + the probe's
expectation; if no, drop the key from the probe and the plan's §0 note.
