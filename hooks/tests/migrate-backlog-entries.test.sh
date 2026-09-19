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
# The header block used to read as one unparseable_entry; since the FIRED-queue header was
# reshaped (2026-09-14) it no longer does. Either shape is fine — the assertion is that nothing
# but Title caps (and possibly that header block) survives the migration.
gate_codes_no_header="$(printf '%s' "$gate_codes" | sed 's/,unparseable_entry//; s/unparseable_entry,//')"
assert_eq "$gate_codes_no_header" "cap_exceeded:Title" "(j) only Title caps (plus at most the header block) remain (got: $gate_codes)"

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

# ── (n) table style (revival.3d shape, cuda 2026-09-16): foreign headers map through the
#     config, lossy rows move their ORIGINAL row line verbatim into a sidecar, lossless rows
#     stay with `none`, the rewritten file passes the gate, a second apply moves nothing.
#     RED at base f1f32640: `not supported yet`, exit 2.
N="$(repo table)"
mkdir -p "$N/docs/tickets/048/runs"; printf 'run\n' > "$N/docs/tickets/048/runs/a.md"
cat > "$N/docs/projects/BACKLOG.md" <<'EOB'
# revival BACKLOG

## 換裝線

| id | 標題 | 狀態 | 體量 | 來源 | spec | 備註 |
|----|------|------|------|------|------|------|
| **GC-a** | **地被 Rough Meadow Grass 收件登記** | **acceptance（最終 A/B 已拍，待 owner 看頁）** | **M** | **058 換裝線** | 票 048 | 產線同 TREE-a。  **結果（sonnet）**：inventory 已有登記；Blender cook 5 mesh；staging 已接上；逃生口驗過；A/B 頁面兩臂截圖各 3 張；覆蓋率統計跑三次取中位；owner 尚未看頁；下一步等 owner 裁定。這一列故意很長以超過上限並觸發遷移到 sidecar 檔案的行為，用來驗證 verbatim 保留與 pointer 指向。這一列故意很長以超過上限並觸發遷移到 sidecar 檔案的行為。這一列故意很長以超過上限並觸發遷移到 sidecar 檔案的行為。這一列故意很長以超過上限並觸發遷移到 sidecar 檔案的行為。 |

## 其他

| id | 標題 | 狀態 | 體量 | 來源 | spec | 備註 |
|----|------|------|------|------|------|------|
| **DONE-x** | 已完成的例子 | **done**（v1.2.3 2026-09-10） | Fix | user | — | — |
| **PIPE-y** | 標題含 a \| b 管線 | **fired**（2026-09-01） | S | user | — | docs/tickets/048/runs/a.md |
EOB
cat > "$N/.claude/backlog-config.md" <<'EOC'
- style: table
- mode: warn

## Pointer roots
- docs/backlog
- docs/tickets

## Columns
- id: Id
- 標題: Title
- 狀態: Status
- 體量: Effort
- 來源: Source
- spec: Context
- 備註: Pointer

## Status map
- acceptance: open
EOC
git -C "$N" add -A >/dev/null; git -C "$N" -c user.email=t@t -c user.name=t commit -qm base
ORIG_ROW="$(grep '^| \*\*GC-a\*\*' "$N/docs/projects/BACKLOG.md")"
out="$(node "$MIG" --backlog "$N/docs/projects/BACKLOG.md" --config "$N/.claude/backlog-config.md" --json)"
assert_eq "$?" "0" "(n) table dry-run exits 0"
assert_eq "$(json_field "$(first_json "$out")" totals.migrate)" "1" "(n) exactly the lossy row migrates"
out="$(node "$MIG" --backlog "$N/docs/projects/BACKLOG.md" --config "$N/.claude/backlog-config.md" --apply)"
assert_eq "$?" "0" "(n) table apply exits 0"
assert_eq "$(json_field "$(first_json "$out")" preserved)" "true" "(n) apply preserved"
assert_file_exists "$N/docs/backlog/gc-a.md" "(n) sidecar named from the Id"
side="$(cat "$N/docs/backlog/gc-a.md")"
printf '%s' "$side" | grep -qF -- "$ORIG_ROW" && ok=0 || ok=1
assert_eq "$ok" "0" "(n) sidecar holds the original row line verbatim"
assert_contains "$side" "Section: 換裝線" "(n) sidecar names the ## section"
rew="$(cat "$N/docs/projects/BACKLOG.md")"
assert_contains "$rew" "| Id | Title | Status | Trigger | Effort | Source | Pointer | Context |" "(n) tables re-headed to schema columns"
assert_contains "$rew" "| GC-a | 地被 Rough Meadow Grass 收件登記 | open | see pointer | M | 058 換裝線 | docs/backlog/gc-a.md |" "(n) lossy row points at its sidecar"
assert_contains "$rew" "| DONE-x | 已完成的例子 | shipped v1.2.3 2026-09-10 | see pointer | Fix | user | none |" "(n) lossless row stays with none and a synthesised shipped status"
assert_contains "$rew" '| PIPE-y | 標題含 a \| b 管線 | fired 2026-09-01 | see pointer | S | user | docs/tickets/048/runs/a.md |' "(n) escaped pipe survives and a resolvable evidence cell becomes the Pointer"
assert_contains "$rew" "## 其他" "(n) non-table lines preserved"
gout="$(node "$GATE" --backlog "$N/docs/projects/BACKLOG.md" --json --config "$N/.claude/backlog-config.md")"
assert_eq "$(json_field "$gout" exit)" "0" "(n) rewritten table passes the gate"
assert_eq "$(json_field "$gout" entries)" "3" "(n) gate sees three entries across two tables"
out2="$(node "$MIG" --backlog "$N/docs/projects/BACKLOG.md" --config "$N/.claude/backlog-config.md" --apply)"
assert_eq "$(json_field "$(first_json "$out2")" totals.moved_bytes)" "0" "(n) second apply moves nothing"


# ── (o) table style, reviewer-found loss paths (2026-09-16): free text in Effort/Id, a row
#     with fewer cells than the header, a `|` line inside a code fence, a stray row after a
#     blank line, and FIRED mentioned in a log cell. None may lose a byte or flip a status.
O="$(repo table-loss)"
cat > "$O/docs/projects/BACKLOG.md" <<'EOB'
## T

| id | 標題 | 狀態 | 體量 | 來源 | spec | 備註 |
|----|------|------|------|------|------|------|
| **E-1** | Effort 欄有長文 | **planned** | 巨大且複雜需要三週 | user | — | — |
| **SHORT-1** | 少一格的列 | open | 重要來源說明 | docs/plans/ok.md | 這是重要備註內容不該不見 |
| **D-2** | 已完成但備註提到告警 | **done**（v2.0.0 2026-09-10） | S | user | — | 上週告警 FIRED 一次，現已 v2 修復 |

```
| not | a | real | table | just | ascii | art |
```

| **STRAY-9** | 空行後資料列 | open | S | src | docs/plans/ok.md |  |
EOB
cat > "$O/.claude/backlog-config.md" <<'EOC'
- style: table

## Pointer roots
- docs/backlog
- docs/plans

## Columns
- id: Id
- 標題: Title
- 狀態: Status
- 體量: Effort
- 來源: Source
- spec: Context
- 備註: Pointer
EOC
git -C "$O" add -A >/dev/null; git -C "$O" -c user.email=t@t -c user.name=t commit -qm base
before="$(cat "$O/docs/projects/BACKLOG.md")"
out="$(node "$MIG" --backlog "$O/docs/projects/BACKLOG.md" --config "$O/.claude/backlog-config.md" --apply)"
assert_eq "$?" "0" "(o) apply exits 0"
after="$(cat "$O/docs/projects/BACKLOG.md")"
allside="$(cat "$O"/docs/backlog/*.md 2>/dev/null)"
for needle in "巨大且複雜需要三週" "重要來源說明" "這是重要備註內容不該不見"; do
  printf '%s\n%s' "$after" "$allside" | grep -qF -- "$needle" && ok=0 || ok=1
  assert_eq "$ok" "0" "(o) '$needle' survives in the backlog or a sidecar"
done
assert_contains "$after" '| not | a | real | table | just | ascii | art |' "(o) a fenced | line is preserved verbatim"
assert_contains "$after" '| **STRAY-9** | 空行後資料列 | open | S | src | docs/plans/ok.md |  |' "(o) a stray row after a blank line is preserved verbatim"
assert_contains "$after" '| D-2 | 已完成但備註提到告警 | shipped v2.0.0 2026-09-10 |' "(o) FIRED in a log cell does not flip a done row"
assert_file_exists "$O/docs/backlog/e-1.md" "(o) free-text Effort routes the row to a sidecar"
assert_file_exists "$O/docs/backlog/short-1.md" "(o) a short row routes to a sidecar instead of positional reinterpretation"
gout="$(node "$GATE" --backlog "$O/docs/projects/BACKLOG.md" --json --config "$O/.claude/backlog-config.md")"
assert_eq "$(json_field "$gout" exit)" "0" "(o) rewritten table passes the gate"


# ── (p) unmapped status + foreign column (revival.3d shape). RED at 488dc6dc:
#     Status: open for the unmapped word; owner cells absent from output and every
#     sidecar; preserved:true; bytes_before − bytes_after ≠ moved_bytes.
P="$(repo table-unmapped)"
mkdir -p "$P/docs/tickets/048/runs"; printf 'run\n' > "$P/docs/tickets/048/runs/a.md"
cat > "$P/docs/projects/BACKLOG.md" <<'EOB'
# revival BACKLOG

## 換裝線

| id | 標題 | 狀態 | 體量 | 來源 | spec | 備註 | owner |
|----|------|------|------|------|------|------|-------|
| **GC-p** | **mystery row** | **mystery**（待裁定） | **M** | **058 換裝線** | 票 048 | short note |  |
| **OK-p** | mapped extra-col row | **planned** | S | user | — | — | Alice |
EOB
cat > "$P/.claude/backlog-config.md" <<'EOC'
- style: table
- mode: warn

## Pointer roots
- docs/backlog
- docs/tickets

## Columns
- id: Id
- 標題: Title
- 狀態: Status
- 體量: Effort
- 來源: Source
- spec: Context
- 備註: Pointer

## Status map
- planned: open
EOC
git -C "$P" add -A >/dev/null; git -C "$P" -c user.email=t@t -c user.name=t commit -qm base
cp "$P/docs/projects/BACKLOG.md" "$P/before.md"
ORIG_MYSTERY="$(grep 'GC-p' "$P/docs/projects/BACKLOG.md")"
dry="$(node "$MIG" --backlog "$P/docs/projects/BACKLOG.md" --config "$P/.claude/backlog-config.md" --json)"
assert_eq "$?" "0" "(p) dry-run exits 0" # RED at 488dc6dc: dry-run invented open and dropped owner
assert_contains "$(first_json "$dry")" '"unmapped_status"' "(p) dry-run lists unmapped_status" # RED at 488dc6dc: no errors array
assert_contains "$(first_json "$dry")" '"unmapped_column"' "(p) dry-run lists unmapped_column" # RED at 488dc6dc: no errors array
assert_contains "$(first_json "$dry")" '## Columns' "(p) unmapped_column names the ## Columns line" # RED at 488dc6dc: silent drop
node "$MIG" --backlog "$P/docs/projects/BACKLOG.md" --config "$P/.claude/backlog-config.md" --apply --json >/tmp/mig-p-apply.json 2>/tmp/mig-p-apply.err || p_apply=$?
assert_eq "${p_apply:-0}" "1" "(p) --apply refuses without --allow-unmapped-to-sidecar" # RED at 488dc6dc: apply exited 0
cmp -s "$P/docs/projects/BACKLOG.md" "$P/before.md"; assert_eq "$?" "0" "(p) refuse leaves the backlog byte-identical"
assert_file_absent "$P/docs/backlog/gc-p.md" "(p) refuse writes no sidecar"
node "$MIG" --backlog "$P/docs/projects/BACKLOG.md" --config "$P/.claude/backlog-config.md" --apply --allow-unmapped-to-sidecar --json >/tmp/mig-p-flag.json 2>/tmp/mig-p-flag.err || p_flag=$?
assert_eq "${p_flag:-0}" "1" "(p) --allow-unmapped-to-sidecar still refuses while a column is unmapped" # RED at 488dc6dc: apply wrote
cmp -s "$P/docs/projects/BACKLOG.md" "$P/before.md"; assert_eq "$?" "0" "(p) column error writes nothing"

# status-only table: foreign column gone so apply can proceed with the flag
P2="$(repo table-unmapped-status)"
mkdir -p "$P2/docs/tickets/048/runs"; printf 'run\n' > "$P2/docs/tickets/048/runs/a.md"
cat > "$P2/docs/projects/BACKLOG.md" <<'EOB'
# revival BACKLOG

## 換裝線

| id | 標題 | 狀態 | 體量 | 來源 | spec | 備註 |
|----|------|------|------|------|------|------|
| **GC-p** | **mystery row** | **mystery**（待裁定） | **M** | **058 換裝線** | 票 048 | short note |
| **OK-p** | mapped extra-col row | **planned** | S | user | — | — |
EOB
cat > "$P2/.claude/backlog-config.md" <<'EOC'
- style: table
- mode: warn

## Pointer roots
- docs/backlog
- docs/tickets

## Columns
- id: Id
- 標題: Title
- 狀態: Status
- 體量: Effort
- 來源: Source
- spec: Context
- 備註: Pointer

## Status map
- planned: open
EOC
git -C "$P2" add -A >/dev/null; git -C "$P2" -c user.email=t@t -c user.name=t commit -qm base
cp "$P2/docs/projects/BACKLOG.md" "$P2/before.md"
ORIG_MYSTERY2="$(grep 'GC-p' "$P2/docs/projects/BACKLOG.md")"
node "$MIG" --backlog "$P2/docs/projects/BACKLOG.md" --config "$P2/.claude/backlog-config.md" --apply --json >/tmp/mig-p2.json 2>/tmp/mig-p2.err || p2=$?
assert_eq "${p2:-0}" "1" "(p) status-only --apply refuses without the flag" # RED at 488dc6dc: invented open
cmp -s "$P2/docs/projects/BACKLOG.md" "$P2/before.md"; assert_eq "$?" "0" "(p) status-only refuse is a no-write"
out="$(node "$MIG" --backlog "$P2/docs/projects/BACKLOG.md" --config "$P2/.claude/backlog-config.md" --apply --allow-unmapped-to-sidecar --json)"
assert_eq "$?" "0" "(p) --allow-unmapped-to-sidecar apply exits 0" # RED at 488dc6dc: flag unknown (usage 2)
assert_file_exists "$P2/docs/backlog/gc-p.md" "(p) sidecar named from the Id"
side="$(cat "$P2/docs/backlog/gc-p.md")"
printf '%s' "$side" | grep -qF -- "$ORIG_MYSTERY2" && ok=0 || ok=1
assert_eq "$ok" "0" "(p) sidecar holds the unmapped-status row verbatim" # RED at 488dc6dc: Status: open in the table
rew="$(cat "$P2/docs/projects/BACKLOG.md")"
printf '%s' "$rew" | grep -q 'Status: open' && ok=1 || ok=0
assert_eq "$ok" "0" "(p) open is never synthesised for the unmapped word" # RED at 488dc6dc: | GC-p | … | open |
printf '%s' "$rew" | grep -q '| GC-p |' && ok=1 || ok=0
assert_eq "$ok" "0" "(p) unmapped-status row is not rewritten into the table"
assert_contains "$rew" "| OK-p | mapped extra-col row | open |" "(p) mapped row still migrates" # negative control inside (p)
assert_contains "$(first_json "$out")" '"unmapped_status"' "(p) apply manifest records unmapped_status" # RED at 488dc6dc: preserved:true with no errors
assert_eq "$(json_field "$(first_json "$out")" preserved)" "true" "(p) preserved reflects accounted bytes"
bb="$(json_field "$(first_json "$out")" totals.bytes_before)"
ba="$(json_field "$(first_json "$out")" totals.bytes_after)"
mb="$(json_field "$(first_json "$out")" totals.moved_bytes)"
nb="$(json_field "$(first_json "$out")" totals.normalized_bytes)"
set +e
node -e 'const [bb,ba,mb,nb]=process.argv.slice(1).map(Number); process.exit(bb===ba+mb+nb?0:1)' "$bb" "$ba" "$mb" "$nb"
rec_bytes=$?
set -e
assert_eq "$rec_bytes" "0" "(p) bytes_before === bytes_after + moved_bytes + normalized_bytes" # RED at 488dc6dc: 277-258 != 122
assert_contains "$(first_json "$out")" '"gate"' "(p) gate report embedded in the manifest"
assert_eq "$(json_field "$(first_json "$out")" gate.exit)" "0" "(p) embedded gate is green"

# negative control: case (n) fixture shape still migrates with zero errors
n_err="$(node "$MIG" --backlog "$N/docs/projects/BACKLOG.md" --config "$N/.claude/backlog-config.md" --json | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d.split("\n")[0]);process.stdout.write(String((j.errors||[]).length))})')"
assert_eq "$n_err" "0" "(p) fully mapped table (n) still has zero errors"


finalize_test
