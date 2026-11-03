# mods P5 — proxy-decision reminders (writer first)

Source: owner request 2026-10-04 ("if something awaits a human decision, or you decided on my behalf, remind me"); research `docs/plans/evidence/2026-10-04-mods-p1c/c4-proxy-decision-research.md`; state of play `docs/plans/evidence/2026-10-04-mods-p1c/README.md`; plan §P5 of `docs/plans/2026-10-03-mods-visible-dispatch.md`.

Order is fixed: writer, then publisher, then display. Each step ships on its own.

1. **Writer.** Make depth-0 actually append `decision` rows (today nothing does; `depth0-control-loop.md:406` has never produced a file on this machine). Fix one location, `<project>/ledger/decisions.jsonl`. `decision-ledger.js append` stamps `root_run_id` and `repo_identity` on every row. Acceptance: one `/l5` run leaves the file with rows carrying both fields.
2. **Publisher.** The project watcher publishes a `decisions` sidecar next to the scoped envelope (the `runs-live/1` schema is `additionalProperties:false`, so a sidecar avoids a contract change). No ledger means no file, not an empty one.
3. **Display.** The `live` mod reads the sidecar: count of decisions awaiting the owner plus count made on their behalf with irreversible ones first; the pane lists decision, rationale, reversibility, veto command. No sidecar shows `—`, never 0.
4. **Seen marker (later spike).** There is no ack mechanism anywhere; options are an `ack` row kind, a cursor file, or a review-page button. Choose after a spike.

Not in scope: changing `runs-live/1`, writing files from the mod.
