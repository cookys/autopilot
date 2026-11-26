#!/usr/bin/env bash
set -eu
repo=$(cd "$(dirname "$0")/../.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
export HOME="$tmp/home" XDG_RUNTIME_DIR="$tmp/runtime" AUTOPILOT_CLAUDE_HOME_ROOTS="$tmp/home" AUTOPILOT_FLEET_BIN="$tmp/fleet" FLEET_RC=0
mkdir -p "$HOME/.claude/projects/x" "$XDG_RUNTIME_DIR"
cat > "$AUTOPILOT_FLEET_BIN" <<'SH'
#!/usr/bin/env bash
exit "${FLEET_RC:-0}"
SH
chmod +x "$AUTOPILOT_FLEET_BIN"
card=d-12345678
sha=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
file="$HOME/.claude/projects/x/s.jsonl"
grant="$XDG_RUNTIME_DIR/autopilot/card-exceptions/$card.json"
check() {
  local expected=$1 tool=$2 target=$3 output
  output=$(node -e 'process.stdout.write(JSON.stringify({hook_event_name:"PreToolUse",tool_name:process.argv[1],tool_input:{file_path:process.argv[2]},cwd:"/tmp/test-project"}))' "$tool" "$target" | node "$repo/hooks/claude-home-read-guard.js")
  if [ "$expected" = deny ]; then [[ "$output" == *'"deny"'* ]] || { echo "FAIL: expected deny: $target"; exit 1; }
  else [ -z "$output" ] || { echo "FAIL: expected allow: $target"; exit 1; }; fi
}
check deny Read "$file"
node "$repo/scripts/card-exception-grant.js" grant --card "$card" --answer answer-1 --content-sha256 "$sha" --mode usage
check allow Read "$file"
[ "$(stat -c %a "$(dirname "$grant")")" = 700 ] && [ "$(stat -c %a "$grant")" = 600 ] || { echo 'FAIL: grant permissions'; exit 1; }
node -e 'const fs=require("fs"); const p=process.argv[1]; const g=JSON.parse(fs.readFileSync(p)); g.verified_at="2000-01-01T00:00:00.000Z"; fs.writeFileSync(p,JSON.stringify(g));' "$grant"
check allow Read "$file"
node -e 'const g=require(process.argv[1]); if (Date.now()-Date.parse(g.verified_at)>10000) process.exit(1)' "$grant"
check deny Write "$file"
check deny Read "$HOME/.claude/settings.json"
check deny Read "$HOME/.claude/projects/x/other.txt"
node "$repo/scripts/card-exception-grant.js" revoke --card "$card"
export FLEET_RC=7
# forged grant with a fresh timestamp must not pass either
mkdir -p "$(dirname "$grant")"
node -e 'const [c,s,p]=process.argv.slice(1);require("fs").writeFileSync(p,JSON.stringify({card:c,answer:"a",content_sha256:s,mode:"usage",verified_at:new Date().toISOString()}))' "$card" "$sha" "$grant"
check deny Read "$file"
mkdir -p "$(dirname "$grant")"
printf '{"card":"%s","answer":"answer-1","content_sha256":"%s","mode":"usage","verified_at":"2000-01-01T00:00:00.000Z"}' "$card" "$sha" > "$grant"
check deny Read "$file"
rm "$grant"
set +e
node "$repo/scripts/card-exception-grant.js" grant --card "$card" --answer answer-1 --content-sha256 "$sha" --mode usage
rc=$?
set -e
[ "$rc" = 1 ] && [ ! -e "$grant" ] || { echo 'FAIL: rejected verification'; exit 1; }
set +e
node "$repo/scripts/card-exception-grant.js" grant --card "$card" --answer answer-1 --content-sha256 "$sha" --mode updater
rc=$?
set -e
[ "$rc" = 2 ] || { echo 'FAIL: invalid mode'; exit 1; }
echo 'PASS: card exceptions'
