#!/usr/bin/env bash
# migrate-backlog-entries.test.sh — red-first suite for Phase 4a migrator.

. "$(dirname "$0")/lib.sh"

MIG="$REPO_ROOT/scripts/migrate-backlog-entries.js"
GATE="$REPO_ROOT/scripts/check-backlog-entries.js"

repo() {
  local d="$TEST_TMP/$1"
  mkdir -p "$d/docs/plans" "$d/docs/projects" "$d/.claude"
  git -C "$d" init -q >/dev/null
  git -C "$d" config user.email t@t
  git -C "$d" config user.name t
  printf '# ok\n' > "$d/docs/plans/ok.md"
  echo "$d"
}

first_json() {
  printf '%s' "$1" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const line=d.split("\n")[0];process.stdout.write(line)})'
}

json_field() {
  printf '%s' "$1" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d);const p='$2'.split('.');let x=j;for(const k of p)x=x[k];process.stdout.write(String(x))}catch(e){process.stdout.write('x')}})"
}

# ── (a) within-schema entry is byte-identical after apply ──
A="$(repo a-clean)"
CLEAN=$'### Clean schema row\n- **Status**: open\n- **Trigger**: when tests run\n- **Effort**: S\n- **Source**: suite\n- **Pointer**: docs/plans/ok.md\n'
printf '%s' "# header kept\n\n$CLEAN" > "$A/docs/BACKLOG.md"
cp "$A/docs/BACKLOG.md" "$A/docs/BACKLOG.md.before"
out="$(node "$MIG" --backlog "$A/docs/BACKLOG.md" --out-dir "$A/docs/backlog" --apply --json)" || true
assert_eq "$(json_field "$(first_json "$out")" preserved)" "true" "(a) apply preserved true"
cmp -s "$A/docs/BACKLOG.md" "$A/docs/BACKLOG.md.before"
assert_eq "$?" "0" "(a) within-schema backlog byte-identical"

# ── (b) fat entry with fences + sub-bullets ──
B="$(repo b-fat)"
{
  printf '%s\n' \
    '### Fat extra row' \
    '- **Status**: open' \
    '- **Trigger**: when the fence fires' \
    '- **Effort**: L' \
    '- **Source**: suite' \
    '- **Pointer**: none' \
    '- **Context**: a short problem.' \
    '- extra bullet that must move' \
    '  - nested sub-bullet' \
    '```' \
    'code fence body' \
    '```'
} > "$B/docs/BACKLOG.md"
cp "$B/docs/BACKLOG.md" "$B/docs/BACKLOG.md.before"
out="$(node "$MIG" --backlog "$B/docs/BACKLOG.md" --out-dir "$B/docs/backlog" --apply --json)" || true
assert_eq "$(json_field "$(first_json "$out")" preserved)" "true" "(b) apply preserved"
moved_sha="$(json_field "$(first_json "$out")" entries.0.moved_sha256)"
slug="$(json_field "$(first_json "$out")" entries.0.slug)"
assert_file_exists "$B/docs/backlog/${slug}.md"
side="$(cat "$B/docs/backlog/${slug}.md")"
assert_contains "$side" "code fence body" "(b) sidecar has fence text"
assert_contains "$side" "nested sub-bullet" "(b) sidecar has sub-bullet"
sha_rc=0
node -e '
const fs=require("fs"); const c=require("crypto");
const side=fs.readFileSync(process.argv[1],"utf8");
const sha=process.argv[2];
const orig=fs.readFileSync(process.argv[3],"utf8");
const start=orig.indexOf("### ");
const slice=orig.slice(start);
const nl=slice.indexOf("\n");
const moved=slice.slice(nl+1);
const h=c.createHash("sha256").update(moved,"utf8").digest("hex");
if(h!==sha) process.exit(3);
if(!side.includes(moved)) process.exit(4);
' "$B/docs/backlog/${slug}.md" "$moved_sha" "$B/docs/BACKLOG.md.before" || sha_rc=$?
assert_eq "$sha_rc" "0" "(b) sidecar contains moved text and sha256 matches"
assert_contains "$side" "extra bullet that must move" "(b) moved extra in sidecar"
entry_bytes="$(node -e '
const fs=require("fs");
const t=fs.readFileSync(process.argv[1],"utf8");
const i=t.indexOf("### ");
process.stdout.write(String(Buffer.byteLength(t.slice(i),"utf8")));
' "$B/docs/BACKLOG.md")"
# entry_bytes may include trailing newline only — must be <= 900
node -e 'process.exit(Number(process.argv[1])<=900?0:1)' "$entry_bytes"
assert_eq "$?" "0" "(b) rewritten row <= 900 B ($entry_bytes)"
gout="$(node "$GATE" --backlog "$B/docs/BACKLOG.md" --json --mode block)" || true
assert_eq "$(printf '%s' "$gout" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);const n=j.violations.filter(v=>v.title&&v.title.includes("Fat extra")).length;process.stdout.write(String(n))})')" "0" "(b) gate zero violations on rewritten row"

# ── (c) FIRED / SHIPPED status synthesis (both forms) ──
C="$(repo c-status)"
{
  printf '%s\n' \
    '### Fired plain row' \
    '- **Trigger**: FIRED — evidence 2026-01-15' \
    '- **Effort**: S' \
    '- **Source**: suite' \
    '- **Pointer**: none' \
    '- extra so we migrate' \
    '' \
    '### Fired bold row' \
    '- **Trigger**: **FIRED — reported 2026-02-01 with evidence.**' \
    '- **Effort**: S' \
    '- **Source**: suite' \
    '- **Pointer**: none' \
    '- extra so we migrate' \
    '' \
    '### Shipped token row' \
    '- **Trigger**: SHIPPED v2.36.32 on 2026-09-01' \
    '- **Effort**: S' \
    '- **Source**: suite' \
    '- **Pointer**: none' \
    '- extra so we migrate' \
    '' \
    '### ~~old title~~ — **SHIPPED leftover' \
    '- **Trigger**: leftover trigger line' \
    '- **Effort**: S' \
    '- **Source**: suite' \
    '- **Pointer**: none' \
    '- extra so we migrate'
} > "$C/docs/BACKLOG.md"
out="$(node "$MIG" --backlog "$C/docs/BACKLOG.md" --out-dir "$C/docs/backlog" --apply --json)" || true
rew="$(cat "$C/docs/BACKLOG.md")"
assert_contains "$rew" "- **Status**: fired 2026-01-15" "(c) FIRED plain"
assert_contains "$rew" "- **Status**: fired 2026-02-01" "(c) FIRED bold"
assert_contains "$rew" "- **Status**: shipped v2.36.32 2026-09-01" "(c) SHIPPED v"
assert_contains "$rew" "- **Status**: shipped " "(c) SHIPPED strike form present"

# ── (d) duplicate titles → -2 slug ──
D="$(repo d-dup)"
{
  printf '%s\n' \
    '### Same Title' \
    '- **Trigger**: one' \
    '- **Effort**: S' \
    '- **Source**: suite' \
    '- **Pointer**: none' \
    '- extra migrate' \
    '' \
    '### Same Title' \
    '- **Trigger**: two' \
    '- **Effort**: S' \
    '- **Source**: suite' \
    '- **Pointer**: none' \
    '- extra migrate two'
} > "$D/docs/BACKLOG.md"
out="$(node "$MIG" --backlog "$D/docs/BACKLOG.md" --out-dir "$D/docs/backlog" --apply --json)" || true
j="$(first_json "$out")"
s0="$(printf '%s' "$j" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);process.stdout.write(j.entries[0].slug+" "+j.entries[1].slug)})')"
assert_eq "$s0" "same-title same-title-2" "(d) duplicate slug -2"

# ── (e) CJK title → valid slug ──
E="$(repo e-cjk)"
{
  printf '%s\n' \
    '### 中文標題列' \
    '- **Trigger**: when cjk' \
    '- **Effort**: S' \
    '- **Source**: suite' \
    '- **Pointer**: none' \
    '- extra migrate cjk'
} > "$E/docs/BACKLOG.md"
out="$(node "$MIG" --backlog "$E/docs/BACKLOG.md" --out-dir "$E/docs/backlog" --apply --json)" || true
slug_cjk="$(json_field "$(first_json "$out")" entries.0.slug)"
[ -n "$slug_cjk" ] && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1)) || fail "(e) slug non-empty"
node -e 'const s=process.argv[1]; process.exit(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s)?0:1)' "$slug_cjk"
assert_eq "$?" "0" "(e) CJK slug is filename-valid ($slug_cjk)"
assert_file_exists "$E/docs/backlog/${slug_cjk}.md"

# ── (f) dry-run writes nothing (out-dir stays absent) ──
F="$(repo f-dry)"
printf '%s\n' '### Dry row' '- **Trigger**: FIRED 2026-03-03' '- **Effort**: S' '- **Source**: suite' '- **Pointer**: none' '- extra migrate dry' > "$F/docs/BACKLOG.md"
out="$(node "$MIG" --backlog "$F/docs/BACKLOG.md" --out-dir "$F/docs/backlog" --json)" || true
assert_eq "$(json_field "$(first_json "$out")" preserved)" "null" "(f) dry-run preserved null"
assert_file_absent "$F/docs/backlog" "(f) out-dir absent after dry-run"

# ── (g) idempotence: second apply moved_bytes 0 ──
G="$(repo g-idemp)"
{
  printf '%s\n' \
    '### Idempotent fat' \
    '- **Trigger**: when twice' \
    '- **Effort**: S' \
    '- **Source**: suite' \
    '- **Pointer**: none' \
    '- extra migrate once'
} > "$G/docs/BACKLOG.md"
node "$MIG" --backlog "$G/docs/BACKLOG.md" --out-dir "$G/docs/backlog" --apply --json >/dev/null
out2="$(node "$MIG" --backlog "$G/docs/BACKLOG.md" --out-dir "$G/docs/backlog" --apply --json)" || true
assert_eq "$(json_field "$(first_json "$out2")" totals.moved_bytes)" "0" "(g) second apply moved_bytes 0"

# ── (h) unwritable out-dir → exit 1, backlog byte-identical ──
H="$(repo h-fail)"
printf '%s\n' '### Fail write row' '- **Trigger**: when fail' '- **Effort**: S' '- **Source**: suite' '- **Pointer**: none' '- extra migrate fail' > "$H/docs/BACKLOG.md"
cp "$H/docs/BACKLOG.md" "$H/docs/BACKLOG.md.before"
printf 'not-a-dir\n' > "$H/blocker"
set +e
node "$MIG" --backlog "$H/docs/BACKLOG.md" --out-dir "$H/blocker/backlog" --apply --json >/dev/null 2>"$H/err"
rc=$?
set -e
assert_eq "$rc" "1" "(h) unwritable out-dir exit 1"
cmp -s "$H/docs/BACKLOG.md" "$H/docs/BACKLOG.md.before"
assert_eq "$?" "0" "(h) backlog byte-identical after failed apply"

# ── (i) real docs/BACKLOG.md dry-run ≥ 100 entries to migrate ──
I="$(repo i-real)"
cp "$REPO_ROOT/docs/BACKLOG.md" "$I/docs/BACKLOG.md"
out="$(node "$MIG" --backlog "$I/docs/BACKLOG.md" --out-dir "$I/docs/backlog" --json)" || true
rc_i=$?
assert_eq "$rc_i" "0" "(i) real backlog dry-run exit 0"
mig="$(json_field "$(first_json "$out")" totals.migrate)"
node -e 'process.exit(Number(process.argv[1])>=100?0:1)' "$mig"
assert_eq "$?" "0" "(i) migrate count >= 100 (got $mig)"
assert_eq "$(json_field "$(first_json "$out")" preserved)" "null" "(i) preserved null"
assert_file_absent "$I/docs/backlog" "(i) dry-run did not create out-dir"

# ── (j) the real backlog, applied twice: idempotent, every title kept, and the gate is left with
#        nothing but Title caps and the header block (depth-0 probe 2026-09-14) ──
J="$(repo j-real-apply)"
cp "$REPO_ROOT/docs/BACKLOG.md" "$J/docs/BACKLOG.md"
mkdir -p "$J/docs/plans" "$J/docs/projects"
titles_before="$(grep -c '^### ' "$J/docs/BACKLOG.md")"
out="$(node "$MIG" --backlog "$J/docs/BACKLOG.md" --out-dir "$J/docs/backlog" --apply --json 2>/dev/null)"
assert_eq "$(json_field "$(first_json "$out")" preserved)" "true" "(j) real backlog apply preserved"
assert_eq "$(grep -c '^### ' "$J/docs/BACKLOG.md")" "$titles_before" "(j) every title survives"
sidecars_first="$(ls "$J/docs/backlog" | grep -c '\.md$')"
out2="$(node "$MIG" --backlog "$J/docs/BACKLOG.md" --out-dir "$J/docs/backlog" --apply --json 2>/dev/null)"
assert_eq "$(json_field "$(first_json "$out2")" totals.moved_bytes)" "0" "(j) second apply on the real backlog moves nothing"
assert_eq "$(ls "$J/docs/backlog" | grep -c '\.md$')" "$sidecars_first" "(j) second apply creates no new sidecar"
gate_codes="$(node "$REPO_ROOT/scripts/check-backlog-entries.js" --backlog "$J/docs/BACKLOG.md" 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);const set=new Set(j.violations.map(v=>v.code+(v.field?":"+v.field:"")));process.stdout.write([...set].sort().join(","))})')"
assert_eq "$gate_codes" "cap_exceeded:Title,unparseable_entry" "(j) only Title caps and the header block remain (got: $gate_codes)"

# ── (k) a small entry that only lacks Status/Pointer IS migrated; a lone over-cap Title is NOT ──
K="$(repo k-small)"
mkdir -p "$K/docs/plans"; touch "$K/docs/plans/x.md"
long_title="$(printf 'T%.0s' $(seq 1 121))"
printf '# BACKLOG\n\n### Small row lacking status\n- **Trigger**: when x\n- **Effort**: S\n- **Source**: s\n\n### %s\n- **Status**: open\n- **Trigger**: t\n- **Effort**: S\n- **Source**: s\n- **Pointer**: docs/plans/x.md\n' "$long_title" > "$K/docs/BACKLOG.md"
out="$(node "$MIG" --backlog "$K/docs/BACKLOG.md" --out-dir "$K/docs/backlog" --apply --json 2>/dev/null)"
assert_eq "$(json_field "$(first_json "$out")" totals.migrate)" "1" "(k) exactly the small row migrates"
assert_contains "$(cat "$K/docs/BACKLOG.md")" "- **Status**: open" "(k) Status synthesised"
assert_contains "$(cat "$K/docs/BACKLOG.md")" "- **Pointer**: docs/backlog/small-row-lacking-status.md" "(k) pointer to the sidecar"
assert_contains "$(cat "$K/docs/BACKLOG.md")" "### $long_title" "(k) long title untouched"

# ── (l) an existing sidecar on disk is never overwritten: the colliding title takes -2 ──
L="$(repo l-collide)"
mkdir -p "$L/docs/backlog"; printf '# hand-curated note\nkeep me\n' > "$L/docs/backlog/fat-row.md"
printf '# BACKLOG\n\n### Fat row\n- **Status**: open\n- **Trigger**: t\n- **Effort**: S\n- **Source**: s\n- **Pointer**: docs/plans/ok.md\n- extra bullet that forces migration\n' > "$L/docs/BACKLOG.md"
node "$MIG" --backlog "$L/docs/BACKLOG.md" --out-dir "$L/docs/backlog" --apply --json >/dev/null 2>&1
assert_eq "$?" "0" "(l) apply with a disk collision exits 0"
assert_eq "$(cat "$L/docs/backlog/fat-row.md")" "$(printf '# hand-curated note\nkeep me')" "(l) existing sidecar untouched"
assert_file_exists "$L/docs/backlog/fat-row-2.md" "(l) colliding entry took the -2 slug"
assert_contains "$(cat "$L/docs/BACKLOG.md")" "docs/backlog/fat-row-2.md" "(l) pointer names the -2 sidecar"

# ── (m) a failure during the rename phase leaves no sidecar or manifest behind ──
M="$(repo m-rollback)"
printf '# BACKLOG\n\n### Row a\n- **Status**: open\n- **Trigger**: t\n- **Effort**: S\n- **Source**: s\n- **Pointer**: docs/plans/ok.md\n- extra a\n\n### Row b\n- **Status**: open\n- **Trigger**: t\n- **Effort**: S\n- **Source**: s\n- **Pointer**: docs/plans/ok.md\n- extra b\n' > "$M/docs/BACKLOG.md"
cp "$M/docs/BACKLOG.md" "$M/before.md"
# a DIRECTORY where the manifest must land: its rename fails AFTER both sidecars have landed
mkdir -p "$M/docs/backlog/MIGRATION-$(date +%F).json" "$M/docs/backlog/MIGRATION-$(date -u +%F).json"
set +e
node "$MIG" --backlog "$M/docs/BACKLOG.md" --out-dir "$M/docs/backlog" --apply --json >/dev/null 2>"$M/err"
rc_m=$?
set -e
assert_eq "$rc_m" "1" "(m) rename-phase failure exits 1"
cmp -s "$M/docs/BACKLOG.md" "$M/before.md"; assert_eq "$?" "0" "(m) backlog untouched"
assert_file_absent "$M/docs/backlog/row-a.md" "(m) the first sidecar that had landed was rolled back"
assert_file_absent "$M/docs/backlog/row-b.md" "(m) the second sidecar that had landed was rolled back"
assert_eq "$(ls "$M/docs/backlog" | grep -c '\.md$')" "0" "(m) no sidecar left behind"

finalize_test
