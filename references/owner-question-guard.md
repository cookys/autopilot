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
`pending_dispatch`, `closed`, unknown and unreadable cards do not (store lookup
errors fail closed as uncovered, never escaping into the hook's fail-open catch).
Opening a card elsewhere in the turn, or listing it in a footer, never covers
another sentence. In a non-root session, an unbound or other-root live card in
the same project is resolved by that same reader; in a root-scoped session, a
card this session opened without `--root-run-id` (unbound scope) does not exempt
a sentence, and naming it blocks with `close --id <id>` + `open --root-run-id <root>`
guidance.

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

Status-only reports and footers listing live cards pass when every card id carries
a plain-language subject. A bare id (`d-` plus eight hex digits, case insensitive)
is its own hit, class `bare_card_id`, even when a live card would exempt a question
in that sentence. The subject sits immediately beside the id: optional spaces then
`（…）` or `(…)` with at least two non-space characters inside, or the id immediately
after `「…」` (same minimum) or a title label (`標題：`, `章節：`, `題目：`, `主題：`,
`title:`, `heading:`, `section:`). Pass shape: `d-47602dd8（週一手機重連 Wi-Fi）`.
Ids inside fenced blocks, any inline code span, Markdown `>` lines, `//` lines,
block comments and quoted text are not bare hits. The false-positive line names
the id itself: `OWNER-GUARD-FALSE-POSITIVE [bare_card_id] d-47602dd8 :: 理由`.
`AUTOPILOT_BARE_CARD_ID_LINT=off` (`false`/`0`/`no`) disables only this check.
A non-PM lane is still silenced by an annotated id or an `r-` id; a bare id blocks
that lane with the subject message only.

Markdown `>` quote lines, corner/curly quoted blocks (including multiline lane
quotations), quoted inline text and source comments are ignored. Text outside a
quote is still checked.

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

## Opt-in reply language check (`zh-Hant`)

Set `AUTOPILOT_REPLY_LANGUAGE=zh-Hant`, or `"reply_language": "zh-Hant"` in
`~/.autopilot/config.json` when the environment variable is unset, to enforce
Traditional Chinese replies on `lastAssistantText`. The environment variable beats
`config.json`; any other value or absent leaves the check off so other lanes are
unaffected. `AUTOPILOT_OWNER_QUESTION_GUARD=off` (`false`/`0`/`no`, or
`owner_question_guard: false`) still disables the entire hook.

`stripForLanguage()` removes fenced code blocks, inline code spans, `http`/`https`
and bare `host/path` URLs, file paths (tokens containing `/` or ending in a file
extension such as `.js`, `.sh`, `.md`, `.json`), card ids (`d-` + 8 hex), request
ids (`r-` + 8 hex), 26-char Crockford base32 ULIDs, and 7–64 hex shas while
keeping quoted `「…」` Chinese text. On what remains:

- **Ratio check**: counts CJK ideographs (`U+4E00`–`U+9FFF`, `U+3400`–`U+4DBF`)
  and ASCII letters (`[A-Za-z]`). Skipped when `letters + CJK < 20` (short replies
  such as `go` or pure-code replies pass). Blocks when `CJK / (letters + CJK) < 0.60`.
- **Simplified-character check**: blocks when any of the 60 tracked simplified-only
  characters (`SIMPLIFIED_TO_TRADITIONAL`) appears, naming up to 5 unique hits
  with their Traditional replacements (for example `这→這`).

The block reason starts with `回覆要用正體中文（技術名詞和 id 可保留原文）；請改寫。`,
followed by the measured percentage and/or hit list. When question, card or
bare-id checks also fire on the same reply, one combined block is returned with
the language reason first.

## Replay and regression checks

Run `node scripts/replay-stop-guard.js --dir <transcript-directory>` from the
project whose local cards should be used. It evaluates every regular `.jsonl` file
in basename order through the guard, ignoring runtime opt-out switches. Each line
is `<basename>: BLOCK <comma-separated unresolved classes>` or `<basename>: PASS -`;
no reply text is printed. Exit 0 means evaluation succeeded, **not** that every
file blocked. Usage errors, no inputs or no final assistant text return 2.

Regression commands:

```sh
node --test hooks/owner-question-guard.test.js scripts/replay-stop-guard.test.js hooks/session-root-liveness.test.js
bash hooks/tests/owner-question-guard.test.sh
```

Fixtures are synthetic and stores are temporary. The Node suite runs three isolated
source mutations: allowing any card id must make `closed card must block` fail
with exit 1; reinstating the second-Stop bypass must make `second Stop must block
again` fail with exit 1; setting `LANGUAGE_MIN_CJK_RATIO` to `0` must make
`reply language zh-Hant blocks pure English reply` fail with exit 1. Production
source is not overwritten by those controls.
Real replay inputs belong outside the repository and must not be copied into it.
