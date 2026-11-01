#!/usr/bin/env bash
# check-config-docs.js test: the two-way settings sync gate, with negative controls.
#
# Every red case is a tiny fake repo (--root) that starts green and is broken in exactly one way, so a gate that
# stopped checking one direction would turn that case green and fail the test:
#   (a) the code reads an env var nobody registered          -> env_unregistered
#   (b) the registry lists a setting the code does not read   -> reader_missing
#   (c) a user setting is missing from the reference doc      -> user_undocumented
#   plus: unregistered config property, unregistered DI template, stale ignore item, bad registry, missing registry.
# The last case runs the real repo, which must be green.
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/check-config-docs.js"
N=0

# mk_fixture: a green fake repo in $FX
mk_fixture() {
  N=$((N + 1))
  FX="$TEST_TMP/fx$N"
  mkdir -p "$FX/hooks" "$FX/scripts/lib" "$FX/docs" "$FX/project-config-template"
  cat > "$FX/hooks/a.js" <<'EOF'
// reads ~/.autopilot/config.json through config-path; see x-config.md for the project file
const cfg = JSON.parse('{}');
const v = process.env.AUTOPILOT_FOO || cfg.my_key;
EOF
  echo "# x" > "$FX/project-config-template/x-config.md"
  cat > "$FX/scripts/lib/config-keys.json" <<'EOF'
{
  "ignore": { "env": {}, "config": {}, "templates": {} },
  "entries": [
    { "name": "AUTOPILOT_FOO", "kind": "env", "audience": "user", "group": "g", "default": null, "readers": ["hooks/a.js"], "doc": "docs/settings-reference.md", "relates": [], "summary": "foo" },
    { "name": "my_section.my_key", "kind": "config_key", "audience": "user", "group": "g", "default": 1, "readers": ["hooks/a.js"], "doc": "docs/settings-reference.md", "relates": [], "summary": "key" },
    { "name": ".claude/x-config.md", "kind": "project_di", "audience": "user", "group": "project", "default": null, "template": "project-config-template/x-config.md", "readers": ["hooks/a.js"], "doc": "docs/settings-reference.md", "relates": [], "summary": "x" },
    { "name": "AUTOPILOT_INTERNAL_THING", "kind": "env", "audience": "internal", "class": "plumbing", "default": null, "readers": ["hooks/a.js"], "doc": null, "relates": [] }
  ]
}
EOF
  # the internal entry needs a reader that contains its name
  echo "// AUTOPILOT_INTERNAL_THING is set for child processes" >> "$FX/hooks/a.js"
  printf '# ref\n`AUTOPILOT_FOO`\n`my_section.my_key`\n`.claude/x-config.md`\n' > "$FX/docs/settings-reference.md"
}

run() { OUT="$(node "$SCRIPT" --root "$FX" "$@" 2>&1)"; EXIT=$?; }
count_of() { printf '%s' "$OUT" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(j.findings.length+":"+j.findings.map(f=>f.rule).join(","))})'; }

# --- green baseline
mk_fixture; run
assert_eq "$EXIT" "0" "baseline fixture is green"
assert_contains "$OUT" "OK:" "baseline prints OK"

# --- (a) code reads an unregistered env var -> RED
mk_fixture
echo "const w = process.env.AUTOPILOT_BAR;" >> "$FX/hooks/a.js"
run --json
assert_eq "$EXIT" "1" "(a) unregistered env read is red"
assert_eq "$(count_of)" "1:env_unregistered" "(a) exactly one env_unregistered finding"
assert_contains "$OUT" "AUTOPILOT_BAR" "(a) names the unregistered variable"

# --- (a2) the same read covered by a registered prefix family -> green again
mk_fixture
echo "const w = process.env.AUTOPILOT_BAR;" >> "$FX/hooks/a.js"
node -e '
const fs=require("fs"),p=process.argv[1];const j=JSON.parse(fs.readFileSync(p,"utf8"));
j.entries.push({name:"AUTOPILOT_BA<X>",kind:"env",prefix:"AUTOPILOT_BA",audience:"internal",class:"plumbing",default:null,readers:["hooks/a.js"],doc:null,relates:[]});
fs.writeFileSync(p,JSON.stringify(j));' "$FX/scripts/lib/config-keys.json"
run
assert_eq "$EXIT" "0" "(a2) a prefix family covers the new variable"

# --- (b) registry lists a setting the code does not read -> RED
mk_fixture
node -e '
const fs=require("fs"),p=process.argv[1];const j=JSON.parse(fs.readFileSync(p,"utf8"));
j.entries.push({name:"AUTOPILOT_GHOST",kind:"env",audience:"internal",class:"plumbing",default:null,readers:["hooks/a.js"],doc:null,relates:[]});
fs.writeFileSync(p,JSON.stringify(j));' "$FX/scripts/lib/config-keys.json"
run --json
assert_eq "$EXIT" "1" "(b) a registered setting the code does not read is red"
assert_eq "$(count_of)" "1:reader_missing" "(b) exactly one reader_missing finding"
assert_contains "$OUT" "AUTOPILOT_GHOST" "(b) names the ghost entry"

# --- (b2) a reader file that disappeared -> RED
mk_fixture
rm "$FX/hooks/a.js"
run --json
assert_eq "$EXIT" "1" "(b2) a deleted reader file is red"
assert_contains "$OUT" "does not exist" "(b2) says the reader is gone"

# --- (c) a user setting is not on the reference page -> RED
mk_fixture
printf '# ref\n`my_section.my_key`\n`.claude/x-config.md`\n' > "$FX/docs/settings-reference.md"
run --json
assert_eq "$EXIT" "1" "(c) a user setting missing from the reference is red"
assert_eq "$(count_of)" "1:user_undocumented" "(c) exactly one user_undocumented finding"
assert_contains "$OUT" "AUTOPILOT_FOO" "(c) names the undocumented setting"

# --- (c2) a longer name does not count as a mention of a shorter one
mk_fixture
printf '# ref\n`AUTOPILOT_FOO_EXTRA`\n`my_section.my_key`\n`.claude/x-config.md`\n' > "$FX/docs/settings-reference.md"
run --json
assert_eq "$EXIT" "1" "(c2) AUTOPILOT_FOO_EXTRA is not a mention of AUTOPILOT_FOO"

# --- (c3) internal settings need no mention in the reference
mk_fixture
run
assert_eq "$EXIT" "0" "(c3) the internal entry is not required in the reference"

# --- (d) unregistered config property -> RED
mk_fixture
echo "const z = cfg.brand_new_key;" >> "$FX/hooks/a.js"
run --json
assert_eq "$EXIT" "1" "(d) unregistered config property is red"
assert_eq "$(count_of)" "1:config_unregistered" "(d) exactly one config_unregistered finding"

# --- (e) a project template with no entry -> RED
mk_fixture
echo "# y" > "$FX/project-config-template/y-config.md"
run --json
assert_eq "$EXIT" "1" "(e) unregistered DI template is red"
assert_eq "$(count_of)" "1:di_unregistered" "(e) exactly one di_unregistered finding"

# --- (f) stale ignore item -> RED
mk_fixture
node -e '
const fs=require("fs"),p=process.argv[1];const j=JSON.parse(fs.readFileSync(p,"utf8"));
j.ignore.env.AUTOPILOT_NOT_THERE="no such token";
fs.writeFileSync(p,JSON.stringify(j));' "$FX/scripts/lib/config-keys.json"
run --json
assert_eq "$EXIT" "1" "(f) stale ignore item is red"
assert_eq "$(count_of)" "1:ignore_stale" "(f) exactly one ignore_stale finding"

# --- (g) malformed registry entry -> RED; unreadable registry -> exit 2
mk_fixture
node -e '
const fs=require("fs"),p=process.argv[1];const j=JSON.parse(fs.readFileSync(p,"utf8"));
j.entries[0].audience="whatever";
fs.writeFileSync(p,JSON.stringify(j));' "$FX/scripts/lib/config-keys.json"
run --json
assert_eq "$EXIT" "1" "(g) unknown audience is red"
assert_contains "$OUT" "registry_invalid" "(g) reported as registry_invalid"
mk_fixture
rm "$FX/scripts/lib/config-keys.json"
run
assert_eq "$EXIT" "2" "(g2) missing registry is exit 2"
node "$SCRIPT" --bogus >/dev/null 2>&1
assert_eq "$?" "2" "unknown flag is exit 2"

# --- relay2 g1: the scan root for scripts is the registry's scripts_dir, not a literal "scripts"
mk_fixture
mkdir -p "$FX/tooling"
echo "const v = process.env.AUTOPILOT_MOVED_ONLY;" > "$FX/tooling/m.js"
LREG="$TEST_TMP/cfgdocs-moved-registry.json"
node -e '
  const r = JSON.parse(JSON.stringify(require(process.argv[1]).DEFAULT_REGISTRY));
  r.paths.scripts_dir = "tooling"; require("fs").writeFileSync(process.argv[2], JSON.stringify(r));
' "$REPO_ROOT/scripts/lib/repo-layout.js" "$LREG"
run
assert_eq "$EXIT" "0" "layout negative control: with scripts_dir=scripts the file under tooling/ is not scanned (green)"
REPO_LAYOUT_REGISTRY="$LREG" run --json
assert_eq "$EXIT" "1" "layout: with scripts_dir=tooling the scan follows the registry and sees the unregistered env var"
assert_contains "$OUT" "AUTOPILOT_MOVED_ONLY" "layout: the finding names the var read under the moved scripts_dir"

# --- the real repo is green
OUT="$(node "$SCRIPT" --json 2>&1)"; EXIT=$?
assert_eq "$EXIT" "0" "real repo is in sync"
assert_contains "$OUT" '"ok": true' "real repo reports ok"

finalize_test
