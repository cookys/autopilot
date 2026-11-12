# Owner question guard v2

`hooks/owner-question-guard.js` is the single default-on Claude Stop hook for owner
asks. It absorbs the retired PM Stop hook's ask phrases. The registration remains
in `hooks/hooks.json`; no second hook or store is needed.

The last assistant text after the last genuine user prompt is scanned. The one
`HIT_PATTERNS` table defines three classes: `question` (questions and decision
asks), `operator-step` (instructions for the operator, including login and visits),
and `promise` (future cards, reminders and checklist commitments). A sentence can
have multiple classes. The existing question-mark, rhetorical and negated-clause
rules still apply. This is phrase detection, not semantic understanding.

## Sentence-local coverage

Each hit needs a card id (`d-` plus exactly eight hex digits, case insensitive) in
the **same sentence**. The hook uses `scripts/open-decision.js`'s `findCard` reader
across the invocation cwd's project scopes and checks the canonical `cardState`.
Only `open` (including legacy absent status) and `awaiting_operator_action` qualify.
`pending_dispatch`, `closed`, unknown and unreadable cards do not. Opening a card
elsewhere in the turn, or listing it in a footer, never covers another sentence.
An unbound or other-root live card in the same project is resolved by that same reader.

Sentence ends are `。？！`, newlines, or ASCII `.?!` followed by whitespace, end of
text or a CJK/full-width character. Put the id **before** the question mark or final
period: `Please confirm d-1234abcd.` A citation after that period is a new sentence.

Alternatively the same sentence can contain either:

- `fleet task <arguments> --due YYYY-MM-DD` (also `--due=YYYY-MM-DD`).
- `task_id=<id> due=YYYY-MM-DD`, where the id is 3–64 ASCII letters, digits,
  underscores or hyphens, starting with a letter or digit.

A due may instead be an ISO timestamp `YYYY-MM-DDTHH:mm[:ss]Z` or have a numeric
offset (`+HH:mm` or `-HH:mm`). Calendar days and timestamps must parse; a bare
`--due`, relative word such as `tomorrow`, or task id without due does not count.
These are accepted **textual references**; the guard does not query fleet or
verify that a task was created. Inline backticks around these references, card
ids and `/login` preserve them; ordinary inline code and fenced blocks are ignored.

Status-only reports and footers listing live cards pass. Markdown `>` quote lines,
corner/curly quoted blocks (including multiline lane quotations), quoted inline
text and source comments are ignored. Text outside a quote is still checked.

## Repeated Stops and false positives

`stop_hook_active` never waives unresolved hits. The next Stop blocks again until
the reply is corrected, covered, or explicitly marks each false positive:

```text
Please run the example.
OWNER-GUARD-FALSE-POSITIVE [operator-step] Please run the example. :: documentation example
```

The marker must be its own unquoted, unfenced line. Copy the full normalized
sentence and **all** classes printed by the guard (`[question,operator-step]`,
for example; class order does not matter). The reason must be 1–240 characters.
No wildcard or reply-wide escape exists. At most eight marker lines are accepted
per reply; more disables all marker exemptions. A marker covers only the exact
named sentence and class set, leaving other hits blocked. This explicit assertion
is an escape for a genuine false positive, not a substitute for scheduling work.

The existing runtime opt-out remains `AUTOPILOT_OWNER_QUESTION_GUARD=off`
(`false`/`0`/`no` also work), or `owner_question_guard: false` in the config. Runtime
input errors remain fail-open with a stderr diagnostic. The hook never writes
cards or tasks. Reverting the v2 commit restores the previous behavior; consumers
must account for its reply-wide id and second-Stop bypasses before doing that.

## Replay and regression checks

Run `node scripts/replay-stop-guard.js --dir <transcript-directory>` from the
project whose local cards should be used. It evaluates every regular `.jsonl` file
in basename order through the guard, ignoring runtime opt-out switches. Each line
is `<basename>: BLOCK <comma-separated unresolved classes>` or `<basename>: PASS -`;
no reply text is printed. Exit 0 means evaluation succeeded, **not** that every
file blocked. Usage errors, no inputs or no final assistant text return 2.

Regression commands:

```sh
node --test hooks/owner-question-guard.test.js scripts/replay-stop-guard.test.js
bash hooks/tests/owner-question-guard.test.sh
```

Fixtures are synthetic and stores are temporary. The Node suite runs two isolated
source mutations: allowing any card id must make `closed card must block` fail
with exit 1; reinstating the second-Stop bypass must make `second Stop must block
again` fail with exit 1. Production source is not overwritten by those controls.
Real replay inputs belong outside the repository and must not be copied into it.
