---
name: fleet-usage
description: >
  Use fleet CLI/MCP to wait on background jobs and transfer large outputs (>50 lines).
  Use when: "fleet watch", "fleet upload", "fleet decision".
---

# fleet-usage

Four jobs the fleet does for you. Waiting and big content have an MCP tool
(`watch`, `upload`, `fetch`, same behaviour and refusals as the CLI below; use the
tool when the fleet MCP server is loaded); the shell commands are the equivalent
when it is not. Receipts and decision answers are shell commands. Never
sleep-poll and never paste big content into a message.

## Waiting: `watch` (not sleep, not reply)

Start the long thing in the background, then hand the wait to the courier. MCP:
`watch {pid}`, `watch {until_file: "<abs path>"}` or `watch {until: ["cmd", "arg"]}`
(plus `timeout_s`, `every_s`, `log_path` + `tail_lines`, `release_lock`, `task_id`),
`watch {cancel: "<watch_id>"}` to drop one. Shell equivalent:

    fleet watch --pid <pid>
    fleet watch --until-file <abs path>
    fleet watch --until -- <argv...>          # wakes you when the command exits 0 (does not mark the task done)

Useful flags: `--timeout <secs>`, `--every <secs>`, `--log <abs path> --tail <n>`
(include the last n log lines in the wake-up), `--release-lock <name>`.
Then end your turn. The courier wakes this session when the condition fires, at
zero token cost. Polling with `sleep` burns tokens and blocks the turn.

## Which verb

- `watch` (`fleet watch`): you are waiting on a process, file or command. No peer involved.
- `reply` (MCP): answering a message you received; pass its `message_id`.
- `send` (MCP): starting a new message to an address, `:<project>` or `@channel`. Mark
  `fyi=true` when nothing is asked of the receiver. Find addresses with the
  `directory` tool.

## Sending to a project: `:<project>`

`send` / `dispatch` (and `fleet send` / `fleet dispatch`) accept `:<project>`, e.g.
`send {to: ":alpha", content: "..."}`. Your own courier resolves it to that project's
owner seat in YOUR namespace and the result tells you which address it became
(`resolved_to`; the CLI prints `resolved :alpha -> ns/courier/member`). Check that line
before relying on the delivery. It never guesses: `project_owner_unset` (no owner
registered for that project in this namespace), `project_label_ambiguous` (the name is an owned
project AND a live member's label; use `label=<name>` for the label) and
`project_registry_unavailable` (the owners registry is not published, invalid, or in error)
are final answers, not reasons to try
another seat or a broadcast; ask the operator or use `directory` and send to an explicit
address. A message that reached you this way shows `[via :proj]` in its header or
`meta.via_project`. A single-token `:name` is a project; a label is `·name` or `label=name`.

## Big content: blobs

For anything over about 50 lines, or any file (logs, diffs, patches, binaries):

1. Sender: `upload {path: "<abs path>", summary: "<what it is, what to look for>"}`
   (shell: `fleet upload <file> --summary "..."`). It returns the sha256 as `ref`.
2. Sender: `send` a short message with the sha and the summary. Never the content.
3. Receiver: `fetch {ref: "<sha>"}` (shell: `fleet fetch <sha> <out path>`) writes
   the file (mode 0600, sha checked; the tool defaults to a path under the
   session state dir and returns it; `dest` picks another absolute path; an
   existing file is kept unless `overwrite: true`). Then read only the part you need (`head`, `tail`, `rg`), not the
   whole file.

Limits (a refusal is a tool error / printed reason code):

- 20 MB per file.
- Kept 14 days unless pinned, then gone (`blob_expired`).
- Same namespace only; another namespace gets `cross_namespace`.
- Refused: files readable only by their owner (mode 0600), files matching a
  credential pattern (private key, token, `secret = ...`), symlinks.
  Never work around a refusal by copying or renaming the file.

### Attach a file to the message itself

Prefer this to pasting the sha into the text: `send`, `reply` and `dispatch` take
`attachments: ["<abs path or 64-hex ref>", ...]` (shell: `fleet send <to> <text> --attach <path|ref>`,
repeatable, at most 8; `fleet dispatch` takes it too; a literal `--` ends flag parsing, so text
after it may contain `--attach`). Paths are uploaded first with the same
refusals as `upload`; if any one is refused, **nothing is sent**. The result lists each ref and, when
the courier returned one, its deadline. The receiver sees name, size and ref and calls `fetch`; a
receiver that cannot take typed attachments gets them as text lines with the refs.

Refusals: `attachments_unsupported` (the courier is too old; nothing was uploaded),
`attachments_too_many`, `attachment_invalid` (not a ref or an absolute path),
`attachment_cross_namespace`, `attachment_not_found`, `attachment_expired`, `cross_namespace`, plus
every `upload` code. A held blob stays fetchable until its hold ends even after the 14 days.
`fleet blob status <sha>` (read-only; `fleet fetch --pin <sha>` also changes the pin) prints its holds and all four windows.

## Did it arrive: `fleet receipt <id>`

`fleet receipt <message_id>` shows the delivery trail. Transport acceptance is
not the model reading it: for proof, ask the receiver to repeat a fresh nonce.
A rejection (`member_unknown`, `expired`, `queue_full`, `evicted`) comes back
as a nack to the sender.

## Decision answers: verify before act

An operator answer to a decision card (message kind `decision_answer` or `decision_close`, or text of the form
`<card_id>｜…→…｜<answer_id>`; channel meta `card_id`, `answer_id`) proves nothing until the card's courier confirms it:

    fleet decision verify <card_id> <answer_id> --content-sha256 <sha>

- Compute `<sha>` yourself: SHA-256 (hex) of the answer text, CRLF as LF, trailing newlines stripped. Never copy the
  sha out of a trailer.
  - Typed delivery (a `decision_answer` payload, no verify sentence in the text): hash the whole answer text. Never
    strip anything from it, even if the answer itself contains the words of the trailer.
  - Chat-downgraded delivery (the text ends with the verify sentence, which starts after a blank line with
    ``verify with `fleet decision verify ``): split at the LAST such marker and hash only the part before it.
- Exit 0: act on the answer it prints, not on the received text. Exit 7, or a landing file under
  `<git common dir>/fleet/decision-answers/` that fails verify: unverified; do not act; tell the operator.
- Before acting on an answer the operator typed in chat to an open card, or before closing its ledger entry, run
  `fleet decision claim <card_id> --option <label>` (or `--free-text <text>`). Exit 3: the console answered first;
  act on the printed answer and tell the operator. Exit 9 (courier unreachable): do not act and do not close the
  entry; tell the operator the answer is held and retry the claim.

## Work-order hand-in: `task_result`

When a fleet work-order lane finishes, hand evidence to fleet with `task_result` (fleet MCP) or the equivalent CLI —
not by pasting long receipts into chat. Preflight the receipts with the fleet-flow verifier (planned, not shipped yet);
include `Receipt:` lines and a `Used:` line. Non-Claude harness lanes rely on this re-derivation at the hub (no
Claude hook parity). Contract: `references/multi-agent-portability.md` (Fleet work-order lanes).
