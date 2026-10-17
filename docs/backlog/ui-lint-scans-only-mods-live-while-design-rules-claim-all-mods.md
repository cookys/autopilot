# ui-lint scans only mods/live, but the design rules claim every mod surface

Found 2026-10-17 (viewer mod). `mods/live/ui-lint.test.js` builds its file list from
`fs.readdirSync(__dirname)`, so `mods/viewer` is never scanned. Design plan section 12 (PALETTE, bold
whitelist, 12.9 buttons, 12.10 scroll frame) states it applies to all mod surfaces. The viewer drew plain
default-colour buttons and every lint stayed green; the owner found it from a screenshot.

Stopgap already in place: `buttonFindings` in the viewer render test (35f07d836).

Fix direction:

- Change each L-rule's file list to scan `mods/*` (tests excluded).
- Give every rule a negative control: plant one violation in viewer; the rule must block it. Show it red
  before green.

See `references/evidence-discipline.md` section 60.
