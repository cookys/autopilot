#!/usr/bin/env bash
# docs/dev/ar-gate-ops-tag.patch: applies to a temp copy of capacity's ar_gate.py (read-only source) and makes the gate read the ops tag
# `key:card:<id>` from --ops; red before (unpatched copy flags every record), green after (tag + closed card is handled).
. "$(dirname "$0")/lib.sh"
PLUGIN="${AP_PLUGIN_ROOT:-$REPO_ROOT}"
CAP="${CAPACITY_REPO:-/home/team/projects/capacity}"
[ -f "$CAP/scripts/ar_gate.py" ] || { echo "SKIP [ar-gate-ops-patch] capacity repo not on this host"; exit 0; }
W="$TEST_TMP/cap"; mkdir -p "$W/scripts" "$W/out"
cp "$CAP"/scripts/*.py "$W/scripts/"
cp "$W/scripts/ar_gate.py" "$W/ar_gate.orig"
REC="$TEST_TMP/records"; OPS="$TEST_TMP/ops"; CARDS="$TEST_TMP/cards"; mkdir -p "$REC" "$OPS" "$CARDS"
mkrec() { printf -- '---\nid: %s\nkind: decision\ncreated: 2026-11-20T00:00:00.000Z\n---\nan answer record\n' "$1" > "$REC/$1.md"; }
for r in RTAGGED RUNTAGGED ROPENCARD RREMOVED RUNKNOWN; do mkrec "$r"; done
tagop() { printf '{"op_id":"o1","actor":"t","at":"2026-11-20T00:00:00.000Z","kind":"set","field":"tags/key:card:%s","value":%s,"supersedes":[]}\n' "$2" "$3" >> "$OPS/$1.jsonl"; }
printf '{"op_id":"o0","kind":"create","field":"kind","value":"decision"}\n' > "$OPS/RUNTAGGED.jsonl"
tagop RTAGGED d-aaaaaaaa true
tagop ROPENCARD d-bbbbbbbb true
tagop RREMOVED d-aaaaaaaa true; tagop RREMOVED d-aaaaaaaa false
tagop RUNKNOWN d-ffffffff true
cat > "$CARDS/c.json" <<'EOF'
{"schema":"autopilot.decision/2","decisions":[{"id":"d-aaaaaaaa","status":"closed"},{"id":"d-bbbbbbbb","status":"open"}]}
EOF
echo '[]' > "$TEST_TMP/tasks.json"
flagged() { python3 -I -c 'import json,sys; print(" ".join(sorted(x["decision"] for x in json.load(open(sys.argv[1]))["decided_no_task"])))' "$1"; }
run_gate() { # $1 = out file; rest = extra args
  local out="$1"; shift
  python3 "$W/scripts/ar_gate.py" --now-ms 1795000000000 --tasks-file "$TEST_TMP/tasks.json" --records "$REC" --cards "$CARDS" --out "$out" "$@" >/dev/null 2>&1
  flagged "$out"
}
# RED: the unpatched gate has no --ops and flags every record, including the tagged one on a closed card
assert_eq "$(run_gate "$TEST_TMP/red.json")" 'ROPENCARD RREMOVED RTAGGED RUNKNOWN RUNTAGGED' 'before the patch every record is flagged'
python3 "$W/scripts/ar_gate.py" --tasks-file "$TEST_TMP/tasks.json" --records "$REC" --ops "$OPS" --out "$TEST_TMP/red2.json" >/dev/null 2>&1; assert_eq "$?" 2 'before the patch --ops is not accepted'
# apply
(cd "$W" && patch -p1 < "$PLUGIN/docs/dev/ar-gate-ops-tag.patch" >/dev/null); assert_eq "$?" 0 'patch applies to the capacity ar_gate.py'
# GREEN
assert_eq "$(run_gate "$TEST_TMP/green.json" --ops "$OPS")" 'ROPENCARD RREMOVED RUNKNOWN RUNTAGGED' 'tag + closed card is handled; untagged, removed tag, tag on an open card and on an unknown card stay flagged'
assert_eq "$(run_gate "$TEST_TMP/noops.json")" 'ROPENCARD RREMOVED RTAGGED RUNKNOWN RUNTAGGED' 'without --ops the behaviour is unchanged'
finalize_test
