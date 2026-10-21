# Pending owner-decision panel is unused by long-running sessions

BL-0270. Reported by llm-playground lead (c4140). Report 01M5EQF6YGW98MRG4TBW90YS2W. Reply 2026-10-21 01M5EQFP73V0Z6FFQQ3YEFF9ZS.

Shipped mechanism, merge 6e428fd6c (dmech):

- The owner-question guard block reason is a copy-ready command with the absolute open-decision.js path, every flag from the script's usage, the 0-or-at-least-2 option rule, the card id in the reply, and how the card closes.
- UserPromptSubmit: a prompt whose first line is [待決回覆] closes every card id at the start of its lines. Failures are swallowed. Opt out with AUTOPILOT_DECIDE_REPLY_CLOSE=off.
- SessionStart injection says how to open a card, what [待決回覆] means, and lists open cards when there are any.

Shipped entry for non-Claude agents, merge 9aa45ce1b (dskill A): AGENTS.md carries how to open, list and close owner decision cards and what a [待決回覆] answer means.

Remaining: skill text (ceo-agent, dev-flow, l3 through l6) waits on the eval ON/OFF result. Trigger-Type event.
