# Deliberate overlap fixture — a PUBLISHABLE token that the scanner still flags

This file exists to pin a known FALSE-POSITIVE class, not a violation.

The vendor domain z.ai is listed in the Publishable column of
references/knowledge-routing.md §2, and the synthetic fixture identity bot@test.local is
narrative, not a credential. Both nonetheless match the shape detectors: z.ai matches
`fqdn` (the `ai` TLD), bot@test.local matches `email` and `fqdn`.

If this fixture ever stops producing findings, the scanner's shape semantics changed and
the "a finding is a prompt to classify, not a verdict" wording in knowledge-routing.md §5,
skills/distill/SKILL.md Step 3, and this scanner's own header must be revisited together.

Callers must NOT auto-reject on exit 1 — route the hits to the human category check.
