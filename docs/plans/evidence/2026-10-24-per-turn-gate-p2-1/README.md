# P2-1 Mechanism - status and the NC6 recipe (BL-0055 phase 2)

Commits on branch `hands/ptg-p21/1`: W1-W3 `5a3c7690f` (hook, opt-in, tests NC1-NC4 and the
`violations` half of NC9), W4 `ec81c1cb5` (mode `violations+features`, guidance, own commit; the
evaluation pins this one). No version bump, no CHANGELOG entry (owner hold at 3.0.0).

Turn boundary: `stop_hook_active` false starts a new turn, confirmed by P2-0
(`docs/plans/evidence/2026-10-24-per-turn-gate-p2-0/README.md` on branch `hands/ptg-p20/1`); stdin
`prompt_id` is logged as a cross-check.

## Not done here: NC6 live

NC6 needs a real `claude` call, which this lane does not make. To be arranged by depth-0 after the
P2-0 lane result (now in). Wanted result: knob off -> red (zero blocks, one `allow/off` record);
knob on -> green (one block in the transcript, one `decision: block` record). Fix the CLI at 2.1.309
and the alias at `claude-haiku-4-5`; use a credentials-only config dir with a fresh credentials copy.

Recipe (fill `WT` with the checkout holding the hook, `V` with the verifier, e.g. the t14
`gate/verify-turn.js`, `R` with a repo that has a planted violation, e.g. the t14 `gate/fixtures/bad-localtime`
copied to a scratch dir):

```sh
S=$(mktemp -d); mkdir -p "$S/live" "$S/repo/.claude"; chmod 700 "$S/live"; cp -a "$R/." "$S/repo/"
cat > "$S/repo/.claude/settings.json" <<JSON
{"hooks":{"Stop":[{"matcher":"","hooks":[{"type":"command","command":"node $WT/hooks/per-turn-gate.js","timeout":60}]}]}}
JSON
# KNOB ON (green): hook enabled + verifier configured
echo "{\"hooks\":{\"per-turn-gate\":true},\"per_turn_gate\":{\"verifier\":\"node $V\"}}" > "$S/config.on.json"
# KNOB OFF (red): verifier configured, hook not enabled
echo "{\"per_turn_gate\":{\"verifier\":\"node $V\"}}" > "$S/config.off.json"
for k in on off; do
  rm -rf "$S/live/per-turn-gate"
  ( cd "$S/repo" && env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID \
      AUTOPILOT_LIVE_DIR="$S/live" AUTOPILOT_CONFIG_FILE="$S/config.$k.json" \
      timeout 600 claude -p --model claude-haiku-4-5 --setting-sources project \
      --dangerously-skip-permissions --output-format json "Reply with the word done." < /dev/null > "$S/out.$k.json" )
  echo "== $k"; cat "$S"/live/per-turn-gate/*.jsonl
done
```

Pass: `on` shows exactly one record with `"decision":"block","reason":"block"` (and the model's reply
follows the retry text); `off` shows exactly one `"decision":"allow","reason":"off"` record and the
output has no retry. If the prompt does not leave a violation for the verifier to see, plant it in
`$S/repo` before the call (the verifier judges the repo, not the reply).
