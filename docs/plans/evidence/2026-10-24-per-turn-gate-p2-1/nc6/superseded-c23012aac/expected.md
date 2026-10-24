# NC6 live: expected readings (written and committed before any real call)

Hook under test: `hooks/per-turn-gate.js` at HEAD c23012aac. CLI 2.1.309, alias claude-haiku-4-5, credentials-only config dir, stub verifier (`stub-verifier.js`, always exit 1 with one violation asking for the word PINEAPPLE), `max_blocks` 1 in both runs so that "block once" is deterministic. Cost cap 0.5 USD.

- Knob OFF (`hooks.per-turn-gate` not enabled, verifier configured), the red case: the stream shows no block and no retry text; the hook log has exactly one record `{decision: allow, reason: off, turn: null, counter: 0}`; the model answers once.
- Knob ON, the green case: the first Stop produces `decision: block, reason: block, turn 1, counter 1`; the transcript carries the retry text (STUB-RULE ... PINEAPPLE) and the model replies PINEAPPLE or similar; the re-entry Stop (`stop_hook_active` true) is logged `allow, reason: cap, counter 1`. So 2 records, exactly 1 block, the session ends.
- Mutation shown red: the OFF configuration is the mutation of the ON configuration (same hook, same verifier, knob removed); it must produce zero blocks while ON produces one.
