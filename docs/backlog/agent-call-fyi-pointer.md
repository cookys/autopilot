# agent-call SKILL.md does not point at the FYI sending rule (BL-0361)

Reported by hangar (report 01M6ACKW3XX6KSGQDVA31SQDKR); hangar's own BACKLOG row waits on our sha.

`skills/agent-call/SKILL.md` links to `references/peer-addressing.md` only in the Addressing section, and only asks the reader to open it before sending to an `@channel`. A plain `send` or `reply` never reads the section "Mark no-reply messages FYI" added in db0fb565a, so messages that need no answer go out unmarked and wake idle sessions.

Fix direction: add one line to SKILL.md pointing at that section. This is a guidance change (it alters what the skill asks for), so apply the CLAUDE.md mechanism-vs-guidance test before editing and decide whether eval evidence is needed. When done, reply to hangar with the sha.
