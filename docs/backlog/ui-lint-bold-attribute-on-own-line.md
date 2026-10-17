# ui-lint: bold attribute on its own JSX line escapes L9

Source: uilint review generation 1 (e3973182), 2026-10-18.

Every ui-lint rule matches per line. A JSX attribute written as a bare `bold` on its own line is not seen by the L9 bold whitelist, in any mod.

## Fix direction
- Add an alternative `^\s*bold\s*$` to `BOLD_ANY` in `mods/live/ui-lint.test.js`.
- Plant a multi-line JSX negative control (bold on its own line, outside the whitelist) that must be flagged; show it red before green.

Effort S. Trigger: next edit of `mods/live/ui-lint.test.js`, or an owner-spotted bold violation.
