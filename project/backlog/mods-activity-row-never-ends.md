# mods Now tab: a background row may never end when no status notification follows

Source: feat/mods-activity review, 2026-10-12. Live behavior UNVERIFIED.

- `scanBackground` (mods/live/model.ts) ends a 背景指令 or 監看 row only on a `<task-notification>` whose
  status is not running/pending, or on a TaskStop naming the task. Anything else keeps the row until its
  start message falls out of the transcript window.
- Two cases may never get that notification:
  - a session resumed after the process that owned a background shell or persistent Monitor exited;
  - a Bash result carrying `backgroundEndsWithFinalResponse: true` (Claude Code's tool types say no completion
    notification can follow it). Done (nowbg lane, 2026-10-15): such a row ends at the next real prompt.
- Related, narrow: when `$.session.messages()` keeps throwing, `readActivity` (mods/live/register.ts) keeps the
  previous shell and watch rows with no session id attached, so after a session switch the old session's rows
  stay until a transcript read succeeds. Fix direction: store the sid with `activity`, drop kept rows on a change.
- Probe first: quit a session while `sleep 600` runs in the background, resume it, look at the Now tab and the
  transcript. If no status note arrives, end such rows on the evidence that does exist (for example a later
  turn after a final response for the flagged case) rather than on a timer.
