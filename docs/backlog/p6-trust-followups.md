# BL-0261 — P6 feed-trust follow-ups

Four small items left after the P6 feed-trust work. Surfaced by hetero-review p6trust g2.

1. In confirm mode, after the owner replies on the panel, `qualification-feed-trust.js` `answer` must still be run once more for the reply to count. Automating that step means changing skill guidance text. Under the scorecard-first rule, that text change needs eval evidence first.
2. Plan section 5 wording of `validateRecord` disagrees with the implementation.
3. A confirm after a reject silently returns ok.
4. With a corrupt config file, stderr repeats the same message on every call.

Origin: self.

Trigger: next change to qualification-feed-trust or the P6 plan.

Update 2026-10-23: items 3 and 4 fixed by feedtrust (d079b69bb): a confirm after a reject now exits 1 with a reason (repeating the same decision stays idempotent), and a corrupt-store message is written once per process. Items 1 and 2 remain; item 1 is guidance text (skills/engine-onboarding/SKILL.md) and needs eval evidence.
