# `autopilot decision` - the decision-card API

`autopilot decision list|show|answer --json` lets a program list the operator's open decision cards and answer one. It is the **shared card API** for the fleet console web page (calls it with execFile, no shell) and the ux-v7 merged TUI (codeforge). The JSON carries no console-specific field: a reader must not need to know which front end asked. Identity gating (who may answer) is fleet's job; this CLI records `--source` and `--device` verbatim and decides nothing about identity.

Code: `src/decision/cli.js` (argv, exit codes), `scripts/lib/decision-answer.js` (list/view shape, `answerCard`). Test: `hooks/tests/decision-cli.test.sh`.

## Commands

```
autopilot decision list [--all] [--cwd <repo>] --json
autopilot decision show <id> [--cwd <repo>] --json
autopilot decision answer <id> (--option <label> | --free-text <text>) [--note <text>] --source console|pane --device <token> [--cwd <repo>] --json
```

`--cwd` picks the repo whose decision store is read (default: the process cwd). Every `--json` result is one JSON line on stdout.

## Card shape (schema `autopilot.decision/1`)

`list` -> `{schema, cards:[card]}` (open cards, oldest first; `--all` adds every other state). `show` -> `{schema, card}`.

| field | meaning |
|---|---|
| `id` | card id, `d-xxxxxxxx` |
| `question`, `background`, `why`, `recommendation` | text (null when absent); `recommendation` is an option label |
| `options` | `[{label, desc}]`; `[]` for a free-text card |
| `free_text` | true: the card takes `--free-text` only; false: `--option` (with an optional note) |
| `executor` | fleet address that carries out the answer |
| `opened_at` | ISO UTC |
| `state` | `open` \| `awaiting_operator_action` \| `pending_dispatch` \| `closed` |
| `answer` | null, or `{text, option, free_text, answer_id, at}` once answered |

## Answering

`answerCard` is the only writer. It checks the input, then takes the same courier claim as `open-decision.js close --option` (`fleet decision claim`; a host without it uses a local answer id), then calls open-decision.js `deliverAnswer` - the function the live pane's answer reaches through `hooks/advisory-relay.js` (the pane types a `[待決回覆]` prompt, the hook verifies it and calls `deliverAnswer`; the CLI has no session prompt, so it calls `deliverAnswer` directly). That parks the answer on the card and sends the `[操作員答覆] <id>` message to the executor with `fleet send`, then closes the card (or moves it to awaiting_operator_action when the card has operator steps; a decline answer such as "晚點" keeps it open with a re-ask time). One audit row is appended to `<git-common-dir>/autopilot/decisions/answers-audit.jsonl`:

```
{"at":"<ISO>","card_id":"d-..","option":"<label>" | "free_text_len":N,"note_len":N,"source":"console","device":"web-1"}
```

No answer text is stored in the audit beyond the option label.

Nothing is written on any refusal. A failed delivery (fleet send fails, courier unreachable) is rolled back: the card returns to its stored open state, no audit row, so the same call can be retried.

## Exit codes

| exit | `code` | when |
|---|---|---|
| 0 | - | ok (`{schema, ok:true, card_id, state, answer_id, message_id, executor}`) |
| 2 | `usage` | bad argv, `--source` not console/pane, `--device` not `^[A-Za-z0-9._:@-]{1,128}$`, neither/both of `--option`/`--free-text` |
| 4 | `not_found` | no such card |
| 5 | `closed` | card not open (closed, awaiting, pending: a duplicate answer), or already claimed on the courier |
| 6 | `bad_option` | option is not one of the card's labels; free text on an options card; option on a free-text card; `--note` with a free-text answer |
| 7 | `too_long` | free text over 4000 characters, note over 2000, or a control character other than `\n` `\t` |
| 8 | `delivery_failed` | fleet send or claim failed, or no courier probe: answer not recorded, card stays open |

Error JSON: `{ok:false, code, message}`.
