# Uncovered-TLD fixture — a second, narrower blind spot inside the structured class

The `fqdn` pattern is NOT a general FQDN matcher — it only recognizes hostnames ending
in one of eight hardcoded suffixes: `com net org io dev ai local internal`. Any other
suffix is silently uncovered, even though it names a real, structured hostname shape.

The following lines contain real hostnames the scanner will NOT catch, on purpose:

- registrar.example.edu
- university-portal.example.ac.uk
- partner-system.example.co.jp

This is a deliberate, PINNED boundary — same intent as `negative-scope.md`, but for a
gap inside the structured class rather than the whole unstructured class. If this
fixture ever starts producing findings (the pattern was widened) or the pattern is
narrowed further, this test must go red and force the prose describing the covered
suffix set (`references/knowledge-routing.md` §5, `skills/distill/SKILL.md` Step 3,
`docs/scripts-inventory.md`, this script's own header/`--help`) to move with it.
