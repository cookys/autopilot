# Work-order "requires adoption" names no command or flow

Reported by codepower twgs-revival (report 01M59ZPRRAH8CGMG59HHD8816N, reply 2026-10-19 01M59ZQBD887MCS212ZQY3MYDX).

- The message "requires adoption" is undocumented: nothing says which adoption command to run or what the flow is.
- Verified present in `src/engine/work-order.js` (the throw text is `controller worktree has unique committed mutation and requires adoption`).
