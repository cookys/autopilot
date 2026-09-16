#!/usr/bin/env bash
# RED at base 004cb2da: bash: hooks/tests/review-packet.test.sh: No such file or directory
# RED at base 004cb2da: Cannot find module './src/runners/review-packet'
# RED at e566ea0c (hand commit, second-family codex review r1): (g2) `logs/x.raw.log/verdict.txt` allowed
#   (leaf-only deny); `.qc\product.js` denied (backslash rewrite); (h2d) sentinel ran under ambient
#   GIT_COMMON_DIR (marker present); (h4b) deleted invalid-UTF-8 path NO-THROW; (k) tracked
#   .gitattributes symlink → `tree integrity: .gitattributes`.
. "$(dirname "$0")/lib.sh"

MODULE="$REPO_ROOT/src/runners/review-packet.js"
assert_file_exists "$MODULE" "review-packet module exists"

FIX="$TEST_TMP/fixrepo"
git init --object-format=sha1 -q "$FIX"
git -C "$FIX" config user.email t@t.example
git -C "$FIX" config user.name t
git -C "$FIX" config core.symlinks false
SMUDGE_MARK="$TEST_TMP/smudge.marker"
git -C "$FIX" config filter.sentinel.smudge "sh -c 'echo SENTINEL >> \"$SMUDGE_MARK\"; cat'"
git -C "$FIX" config filter.sentinel.clean cat

mkdir -p "$FIX/src" "$FIX/docs/plans/evidence"
printf 'base-app\n' > "$FIX/src/app.js"
printf 'T-RENAME\n' > "$FIX/docs/plans/evidence/old.md"
printf 'keep-bytes-c-will-replace\n' > "$FIX/keep.txt"
git -C "$FIX" add src/app.js docs/plans/evidence/old.md keep.txt
git -C "$FIX" commit -q -m 'B-base'

printf 'product-line\ndiff --git a/x b/x\nmore\n' > "$FIX/src/app.js"
mkdir -p "$FIX/.autopilot" "$FIX/.qc" "$FIX/docs/plans/evidence/x" "$FIX/lib" "$FIX/logs" "$FIX/docs/notes"
printf 'T-AUTOPILOT\n' > "$FIX/.autopilot/prior-verdict.json"
printf 'T-QC\n' > "$FIX/.qc/deadbeef.verdict.json"
printf 'T-EVIDENCE\n' > "$FIX/docs/plans/evidence/x/review.json"
printf 'T-REVIEWMD\n' > "$FIX/docs/plans/p.review.md"
printf 'T-DISP\n' > "$FIX/docs/plans/g1-disposition.json"
printf 'T-RECEIPT\n' > "$FIX/lib/run.receipt.json"
printf 'T-RAWLOG\n' > "$FIX/logs/x.raw.log"
printf 'T-RAWLOG\n' > "$FIX/y.raw.log"
git -C "$FIX" mv docs/plans/evidence/old.md docs/notes/moved.md
printf 'keep-c-bytes\n' > "$FIX/keep.txt"
printf '$Format:%%B$\n' > "$FIX/msg.txt"
# literal $Format:%B$ without extra percent: write via node
node -e 'require("fs").writeFileSync(process.argv[1], "$Format:%B$\n")' "$FIX/msg.txt"
printf 'msg.txt export-subst\nkeep.txt export-ignore\nsecret.txt filter=sentinel\n' > "$FIX/.gitattributes"
printf 'secret-ok\n' > "$FIX/secret.txt"
printf 'crlf-body\r\n' > "$FIX/win.txt"
printf 'bin\x00\xff' > "$FIX/img.bin"
ln -s src "$FIX/link"
ln -s ../../etc "$FIX/esc"
ln -s .qc "$FIX/qc"
git -C "$FIX" add src/app.js .autopilot .qc docs/plans lib logs y.raw.log docs/notes keep.txt msg.txt .gitattributes secret.txt win.txt img.bin link esc qc
git -C "$FIX" commit -q -m 'C-candidate T-MSG'
mkdir -p "$FIX/notes"
printf 'T-UNTRACKED\n' > "$FIX/notes/verdict.txt"

B="$(git -C "$FIX" rev-parse HEAD^)"
C="$(git -C "$FIX" rev-parse HEAD)"
DIFF="$TEST_TMP/input.diff"
git -C "$FIX" diff --no-ext-diff --no-textconv "$B..$C" > "$DIFF"
SPEC="$TEST_TMP/spec.md"
printf 'spec-no-token\n' > "$SPEC"

OUT1="$TEST_TMP/packet1"
BUILD_JSON="$(node - "$MODULE" "$FIX" "$B" "$C" "$DIFF" "$SPEC" "$OUT1" <<'NODE'
const { buildReviewPacket } = require(process.argv[2]);
const r = buildReviewPacket({
  repo: process.argv[3],
  baseSha: process.argv[4],
  candidateSha: process.argv[5],
  diffFile: process.argv[6],
  specFile: process.argv[7],
  outDir: process.argv[8],
});
process.stdout.write(JSON.stringify(r));
NODE
)"

# (a) tokens
for tok in T-MSG T-AUTOPILOT T-QC T-EVIDENCE T-REVIEWMD T-DISP T-RECEIPT T-RAWLOG T-RENAME T-UNTRACKED; do
  HITS="$(grep -r "$tok" "$OUT1" 2>/dev/null || true)"
  assert_eq "$HITS" "" "(a) token $tok absent from packet"
done
assert_contains "$(cat "$OUT1/tree/msg.txt")" '$Format:%B$' "(a) msg.txt keeps literal export-subst"
assert_eq "$(cat "$OUT1/tree/keep.txt")" "$(printf 'keep-c-bytes\n')" "(a) keep.txt present with C bytes"
assert_file_absent "$SMUDGE_MARK" "(a) tracked .gitattributes sentinel smudge never ran during the build (preservation, green at e566ea0c)"

# git archive control
ARCH="$TEST_TMP/archive"
mkdir -p "$ARCH"
git -C "$FIX" archive "$C" | tar -C "$ARCH" -xf -
assert_contains "$(cat "$ARCH/msg.txt" 2>/dev/null || true)" "T-MSG" "git archive control expands T-MSG"
assert_file_absent "$ARCH/keep.txt" "git archive control omits export-ignore keep.txt"

# (b) allowed bytes and absences
git -C "$FIX" show "$C:src/app.js" > "$TEST_TMP/blob-app.js"
git -C "$FIX" show "$C:img.bin" > "$TEST_TMP/blob-img.bin"
git -C "$FIX" show "$C:win.txt" > "$TEST_TMP/blob-win.txt"
cmp -s "$OUT1/tree/src/app.js" "$TEST_TMP/blob-app.js"
assert_eq "0" "$?" "(b) src/app.js bytes"
cmp -s "$OUT1/tree/img.bin" "$TEST_TMP/blob-img.bin"
assert_eq "0" "$?" "(b) img.bin bytes"
cmp -s "$OUT1/tree/win.txt" "$TEST_TMP/blob-win.txt"
assert_eq "0" "$?" "(b) win.txt bytes"
assert_eq "src" "$(readlink "$OUT1/tree/link")" "(b) link -> src"
assert_file_absent "$OUT1/tree/esc" "(b) esc pruned"
assert_file_absent "$OUT1/tree/qc" "(b) qc pruned"
assert_file_absent "$OUT1/tree/.autopilot" "(b) .autopilot pruned"
assert_file_absent "$OUT1/tree/.qc" "(b) .qc pruned"
assert_file_absent "$OUT1/tree/docs/plans/evidence" "(b) evidence pruned"
assert_file_absent "$OUT1/tree/docs/notes/moved.md" "(b) renamed-out path pruned"
node - "$BUILD_JSON" <<'NODE'
const r = JSON.parse(process.argv[2]);
const d = r.denied_paths;
const need = ['.autopilot/prior-verdict.json', '.qc/deadbeef.verdict.json', 'docs/plans/evidence/x/review.json', 'docs/plans/p.review.md', 'docs/plans/g1-disposition.json', 'lib/run.receipt.json', 'logs/x.raw.log', 'y.raw.log', 'esc', 'qc', 'docs/notes/moved.md'];
const miss = need.filter((p) => !d.includes(p));
const sorted = [...d].sort();
if (miss.length) { console.error('missing denied', miss, d); process.exit(2); }
if (JSON.stringify(d) !== JSON.stringify(sorted)) { console.error('not sorted', d); process.exit(3); }
const dup = d.filter((p, i) => d.indexOf(p) !== i);
if (dup.length) { console.error('dup', dup); process.exit(4); }
NODE
assert_eq "0" "$?" "(b) denied_paths lists pruned paths once sorted"

# (c) kept diff sections
node - "$DIFF" "$OUT1/diff.patch" <<'NODE'
const fs = require('fs');
const input = fs.readFileSync(process.argv[2]);
const out = fs.readFileSync(process.argv[3]);
const split = (buf) => {
  const n = Buffer.from('\ndiff --git ');
  const first = Buffer.from('diff --git ');
  const starts = [];
  if (buf.subarray(0, first.length).equals(first)) starts.push(0);
  let idx = 0;
  while (true) {
    const f = buf.indexOf(n, idx);
    if (f < 0) break;
    starts.push(f + 1);
    idx = f + 1;
  }
  return starts.map((s, i) => buf.subarray(s, i + 1 < starts.length ? starts[i + 1] : buf.length));
};
const inSecs = split(input);
const outSecs = split(out);
const names = (sec) => {
  const line = sec.toString('utf8').split('\n')[0];
  return line;
};
const keepHints = ['src/app.js', 'img.bin', 'win.txt', 'link'];
for (const h of keepHints) {
  const a = inSecs.find((s) => s.includes(Buffer.from(h)));
  const b = outSecs.find((s) => s.includes(Buffer.from(h)));
  if (!a || !b || !a.equals(b)) {
    console.error('section mismatch', h);
    process.exit(2);
  }
}
const deniedHints = ['.autopilot', '.qc/', 'docs/plans/evidence', 'p.review.md', 'disposition', 'run.receipt.json', 'raw.log', 'moved.md', 'old.md'];
for (const h of deniedHints) {
  if (out.includes(Buffer.from(h))) {
    console.error('denied path in diff', h);
    process.exit(3);
  }
}
NODE
assert_eq "0" "$?" "(c) kept sections byte-equal; denied sections absent"

# (d) manifest
node - "$OUT1" "$FIX" "$B" "$C" <<'NODE'
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const dir = process.argv[2];
const repo = process.argv[3];
const b = process.argv[4];
const c = process.argv[5];
const m = JSON.parse(fs.readFileSync(path.join(dir, 'MANIFEST.json'), 'utf8'));
const git = (args) => spawnSync('git', args, { cwd: repo, encoding: 'utf8' }).stdout.trim();
if (m.base_sha !== git(['rev-parse', '--verify', `${b}^{commit}`])) process.exit(2);
if (m.candidate_sha !== git(['rev-parse', '--verify', `${c}^{commit}`])) process.exit(3);
function walk(root, rel, acc) {
  for (const name of fs.readdirSync(root).sort()) {
    const full = path.join(root, name);
    const r = rel ? `${rel}/${name}` : name;
    const st = fs.lstatSync(full);
    if (st.isDirectory()) walk(full, r, acc);
    else acc.push({ r, full, st });
  }
}
const acc = [];
walk(dir, '', acc);
const walked = acc.filter((x) => x.r !== 'MANIFEST.json').sort((a, b) => a.r.localeCompare(b.r));
if (walked.length !== m.entries.length) process.exit(4);
for (let i = 0; i < walked.length; i++) {
  const e = m.entries[i];
  const w = walked[i];
  if (e.path !== w.r) process.exit(5);
  const buf = w.st.isSymbolicLink() ? fs.readlinkSync(w.full, { encoding: 'buffer' }) : fs.readFileSync(w.full);
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  if (e.sha256 !== sha || e.bytes !== buf.length) process.exit(6);
  if (e.type !== (w.st.isSymbolicLink() ? 'symlink' : 'file')) process.exit(7);
}
const pre = JSON.stringify({
  schema_version: m.schema_version,
  base_sha: m.base_sha,
  candidate_sha: m.candidate_sha,
  deny_list: m.deny_list,
  entries: m.entries,
});
const h = crypto.createHash('sha256').update(pre).digest('hex');
if (h !== m.packet_hash) process.exit(8);
const denySorted = [...m.deny_list].sort();
if (JSON.stringify(m.deny_list) !== JSON.stringify(denySorted)) process.exit(9);
if ([...new Set(m.deny_list)].length !== m.deny_list.length) process.exit(10);
NODE
assert_eq "0" "$?" "(d) manifest identity fields"

# (e) two builds, spec change, deny reorder
OUT2="$TEST_TMP/packet2"
HASH1="$(node -e 'console.log(JSON.parse(process.argv[1]).packet_hash)' "$BUILD_JSON")"
HASH2="$(node - "$MODULE" "$FIX" "$B" "$C" "$DIFF" "$SPEC" "$OUT2" <<'NODE'
const { buildReviewPacket } = require(process.argv[2]);
process.stdout.write(buildReviewPacket({
  repo: process.argv[3], baseSha: process.argv[4], candidateSha: process.argv[5],
  diffFile: process.argv[6], specFile: process.argv[7], outDir: process.argv[8],
}).packet_hash);
NODE
)"
assert_eq "$HASH1" "$HASH2" "(e) two builds equal packet_hash"

SPEC2="$TEST_TMP/spec2.md"
printf 'spec-no-tokenX\n' > "$SPEC2"
OUT3="$TEST_TMP/packet3"
HASH3="$(node - "$MODULE" "$FIX" "$B" "$C" "$DIFF" "$SPEC2" "$OUT3" <<'NODE'
const { buildReviewPacket } = require(process.argv[2]);
process.stdout.write(buildReviewPacket({
  repo: process.argv[3], baseSha: process.argv[4], candidateSha: process.argv[5],
  diffFile: process.argv[6], specFile: process.argv[7], outDir: process.argv[8],
}).packet_hash);
NODE
)"
assert_neq "$HASH1" "$HASH3" "(e) spec byte change alters hash"

OUT4="$TEST_TMP/packet4"
HASH4="$(node - "$MODULE" "$FIX" "$B" "$C" "$DIFF" "$SPEC" "$OUT4" <<'NODE'
const { buildReviewPacket, DEFAULT_PACKET_DENY_LIST } = require(process.argv[2]);
const d = [...DEFAULT_PACKET_DENY_LIST].reverse();
d.push(d[0]);
process.stdout.write(buildReviewPacket({
  repo: process.argv[3], baseSha: process.argv[4], candidateSha: process.argv[5],
  diffFile: process.argv[6], specFile: process.argv[7], outDir: process.argv[8],
  denyList: d,
}).packet_hash);
NODE
)"
assert_eq "$HASH1" "$HASH4" "(e) deny reorder/dup equal hash"

# (f) empty deny, no hazards
F2="$TEST_TMP/plain"
git init --object-format=sha1 -q "$F2"
git -C "$F2" config user.email t@t.example
git -C "$F2" config user.name t
printf 'one\n' > "$F2/a.txt"
git -C "$F2" add a.txt
git -C "$F2" commit -q -m b
printf 'two\n' > "$F2/a.txt"
git -C "$F2" add a.txt
git -C "$F2" commit -q -m c
FB="$(git -C "$F2" rev-parse HEAD^)"
FC="$(git -C "$F2" rev-parse HEAD)"
FDIFF="$TEST_TMP/plain.diff"
git -C "$F2" diff --no-ext-diff --no-textconv "$FB..$FC" > "$FDIFF"
FOUT="$TEST_TMP/plain-out"
node - "$MODULE" "$F2" "$FB" "$FC" "$FDIFF" "$FOUT" <<'NODE'
const { buildReviewPacket } = require(process.argv[2]);
buildReviewPacket({
  repo: process.argv[3], baseSha: process.argv[4], candidateSha: process.argv[5],
  diffFile: process.argv[6], specFile: null, outDir: process.argv[7], denyList: [],
});
NODE
cmp -s "$FDIFF" "$FOUT/diff.patch"
assert_eq "0" "$?" "(f) denyList [] diff.patch cmp identical"

# (g) tables
node - "$MODULE" <<'NODE'
const { packetPathDenied, normalizeDenyList, DEFAULT_PACKET_DENY_LIST } = require(process.argv[2]);
const denied = ['.autopilot/x', '.autopilot/a/b', '.qc/a.verdict.json', 'docs/plans/evidence/r.md', 'docs/plans/a/b.review.md', 'docs/plans/g2-disposition.json', 'a/b/c.receipt.json', 'x.raw.log', 'a/x.raw.log',
  // (g2) descendants of a directory named like a denied file are denied too
  'logs/x.raw.log/verdict.txt', 'docs/plans/p.review.md/body', 'lib/run.receipt.json/inner/x'];
// (g2) a backslash is an ordinary POSIX filename byte, never a separator
const allowed = ['docs/plans/evidence.md', 'src/receipt.json', 'autopilot/x', 'docs/review.md', '.qc\\product.js', 'docs\\plans\\evidence\\x'];
for (const p of denied) {
  if (!packetPathDenied(p, DEFAULT_PACKET_DENY_LIST)) { console.error('should deny', p); process.exit(2); }
}
for (const p of allowed) {
  if (packetPathDenied(p, DEFAULT_PACKET_DENY_LIST)) { console.error('should allow', p); process.exit(3); }
}
const bad = ['/abs/**', 'a/../b', '', '{a,b}'];
for (const p of bad) {
  let threw = false;
  try { normalizeDenyList([p]); } catch { threw = true; }
  if (!threw) { console.error('should reject', p); process.exit(4); }
}
NODE
assert_eq "0" "$?" "(g) packetPathDenied and normalizeDenyList tables"

# (h) >1 MiB
H="$TEST_TMP/big"
git init --object-format=sha1 -q "$H"
git -C "$H" config user.email t@t.example
git -C "$H" config user.name t
dd if=/dev/zero of="$H/big.bin" bs=1024 count=1100 status=none
git -C "$H" add big.bin
git -C "$H" commit -q -m b
printf 'x\n' > "$H/z.txt"
git -C "$H" add z.txt
git -C "$H" commit -q -m c
HB="$(git -C "$H" rev-parse HEAD^)"
HC="$(git -C "$H" rev-parse HEAD)"
HDIFF="$TEST_TMP/big.diff"
git -C "$H" diff --no-ext-diff --no-textconv "$HB..$HC" > "$HDIFF"
node - "$MODULE" "$H" "$HB" "$HC" "$HDIFF" "$TEST_TMP/big-out" <<'NODE'
const { buildReviewPacket } = require(process.argv[2]);
buildReviewPacket({
  repo: process.argv[3], baseSha: process.argv[4], candidateSha: process.argv[5],
  diffFile: process.argv[6], specFile: null, outDir: process.argv[7], denyList: [],
});
NODE
assert_eq "0" "$?" "(h) >1 MiB tree builds"

# (h2) ident literal + integrity helper
ID="$TEST_TMP/ident"
git init --object-format=sha1 -q "$ID"
git -C "$ID" config user.email t@t.example
git -C "$ID" config user.name t
printf 'id.txt ident\n' > "$ID/.gitattributes"
printf '$Id$\n' > "$ID/id.txt"
git -C "$ID" add .gitattributes id.txt
git -C "$ID" commit -q -m b
printf '$Id$\nchanged\n' > "$ID/id.txt"
git -C "$ID" add id.txt
git -C "$ID" commit -q -m c
IB="$(git -C "$ID" rev-parse HEAD^)"
IC="$(git -C "$ID" rev-parse HEAD)"
IDIFF="$TEST_TMP/id.diff"
git -C "$ID" diff --no-ext-diff --no-textconv "$IB..$IC" > "$IDIFF"
IOUT="$TEST_TMP/id-out"
node - "$MODULE" "$ID" "$IB" "$IC" "$IDIFF" "$IOUT" <<'NODE'
const { buildReviewPacket } = require(process.argv[2]);
buildReviewPacket({
  repo: process.argv[3], baseSha: process.argv[4], candidateSha: process.argv[5],
  diffFile: process.argv[6], specFile: null, outDir: process.argv[7],
});
NODE
assert_contains "$(cat "$IOUT/tree/id.txt")" '$Id$' "(h2) ident stays literal"
assert_file_exists "$IOUT/MANIFEST.json" "(h2) successful build writes manifest"

H2MSG="$(node - "$MODULE" "$ID" "$IOUT" <<'NODE'
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { verifyTreeIntegrity } = require(process.argv[2]);
const repo = process.argv[3];
const out = process.argv[4];
const copy = out + '-copy';
fs.cpSync(path.join(out, 'tree'), copy, { recursive: true });
const ls = spawnSync('git', ['ls-tree', '-r', 'HEAD'], { cwd: repo, encoding: 'utf8' }).stdout;
const listing = [];
for (const line of ls.trim().split('\n')) {
  const [meta, p] = line.split('\t');
  const [mode, , oid] = meta.split(' ');
  listing.push({ mode, oid, path: p, repo });
}
const blob = spawnSync('git', ['rev-parse', 'HEAD:id.txt'], { cwd: repo, encoding: 'utf8' }).stdout.trim();
fs.writeFileSync(path.join(copy, 'id.txt'), `$Id: ${blob} $\n`);
try {
  verifyTreeIntegrity(copy, listing);
  process.stdout.write('NO-THROW');
} catch (e) {
  process.stdout.write(String(e.message));
}
NODE
)"
assert_contains "$H2MSG" "tree integrity: id.txt" "(h2) expanded ident fails integrity helper"
assert_file_absent "$IOUT-copy/MANIFEST.json" "(h2) helper does not write MANIFEST.json"

# (h2b) info/attributes sentinel
INFO="$TEST_TMP/infoattr"
git init --object-format=sha1 -q "$INFO"
git -C "$INFO" config user.email t@t.example
git -C "$INFO" config user.name t
INFO_MARK="$TEST_TMP/info-smudge"
git -C "$INFO" config filter.sentinel.smudge "sh -c 'echo RAN >> \"$INFO_MARK\"; cat'"
mkdir -p "$INFO/.git/info"
printf 'watched.txt filter=sentinel\n' > "$INFO/.git/info/attributes"
printf 'watch-bytes\n' > "$INFO/watched.txt"
git -C "$INFO" add watched.txt
git -C "$INFO" commit -q -m b
printf 'watch-bytes2\n' > "$INFO/watched.txt"
git -C "$INFO" add watched.txt
git -C "$INFO" commit -q -m c
INB="$(git -C "$INFO" rev-parse HEAD^)"
INC="$(git -C "$INFO" rev-parse HEAD)"
INDIFF="$TEST_TMP/info.diff"
git -C "$INFO" diff --no-ext-diff --no-textconv "$INB..$INC" > "$INDIFF"
rm -f "$INFO_MARK"
node - "$MODULE" "$INFO" "$INB" "$INC" "$INDIFF" "$TEST_TMP/info-out" <<'NODE'
const { buildReviewPacket } = require(process.argv[2]);
buildReviewPacket({
  repo: process.argv[3], baseSha: process.argv[4], candidateSha: process.argv[5],
  diffFile: process.argv[6], specFile: null, outDir: process.argv[7], denyList: [],
});
NODE
assert_file_absent "$INFO_MARK" "(h2b) isolated build never runs info/attributes sentinel"
# control: checkout-index against real git dir
CTRL="$TEST_TMP/info-ctrl"
mkdir -p "$CTRL"
git -C "$INFO" checkout-index -a --prefix="$CTRL/"
assert_file_exists "$INFO_MARK" "(h2b) real-git-dir checkout-index control runs sentinel"

# (h2c) swapped sections
SWAP="$TEST_TMP/swap.diff"
node - "$DIFF" "$SWAP" <<'NODE'
const fs = require('fs');
const buf = fs.readFileSync(process.argv[2]);
const n = Buffer.from('\ndiff --git ');
const first = Buffer.from('diff --git ');
const starts = [];
if (buf.subarray(0, first.length).equals(first)) starts.push(0);
let idx = 0;
while (true) {
  const f = buf.indexOf(n, idx);
  if (f < 0) break;
  starts.push(f + 1);
  idx = f + 1;
}
const secs = starts.map((s, i) => buf.subarray(s, i + 1 < starts.length ? starts[i + 1] : buf.length));
if (secs.length < 2) process.exit(2);
const swapped = Buffer.concat([secs[1], secs[0], ...secs.slice(2)]);
fs.writeFileSync(process.argv[3], swapped);
NODE
H2C="$(node - "$MODULE" "$FIX" "$B" "$C" "$SWAP" "$TEST_TMP/swap-out" <<'NODE'
const { buildReviewPacket } = require(process.argv[2]);
try {
  buildReviewPacket({
    repo: process.argv[3], baseSha: process.argv[4], candidateSha: process.argv[5],
    diffFile: process.argv[6], specFile: null, outDir: process.argv[7],
  });
  process.stdout.write('NO-THROW');
} catch (e) {
  process.stdout.write(String(e.message));
}
NODE
)"
assert_contains "$H2C" "diff not canonical" "(h2c) swapped sections fail closed"

# (h3) sha256
S256="$TEST_TMP/sha256"
if git init --object-format=sha256 -q "$S256" 2>/dev/null; then
  git -C "$S256" config user.email t@t.example
  git -C "$S256" config user.name t
  printf 'a\n' > "$S256/a.txt"
  git -C "$S256" add a.txt
  git -C "$S256" commit -q -m b
  printf 'b\n' > "$S256/a.txt"
  git -C "$S256" add a.txt
  git -C "$S256" commit -q -m c
  SB="$(git -C "$S256" rev-parse --verify HEAD^^{commit})"
  SC="$(git -C "$S256" rev-parse --verify HEAD^{commit})"
  SDIFF="$TEST_TMP/s256.diff"
  git -C "$S256" diff --no-ext-diff --no-textconv "$SB..$SC" > "$SDIFF"
  node - "$MODULE" "$S256" "$SB" "$SC" "$SDIFF" "$TEST_TMP/s256-out" <<'NODE'
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { buildReviewPacket } = require(process.argv[2]);
const repo = process.argv[3];
const r = buildReviewPacket({
  repo, baseSha: process.argv[4], candidateSha: process.argv[5],
  diffFile: process.argv[6], specFile: null, outDir: process.argv[7], denyList: [],
});
const m = JSON.parse(fs.readFileSync(path.join(r.dir, 'MANIFEST.json'), 'utf8'));
const b = spawnSync('git', ['rev-parse', '--verify', `${process.argv[4]}^{commit}`], { cwd: repo, encoding: 'utf8' }).stdout.trim();
const c = spawnSync('git', ['rev-parse', '--verify', `${process.argv[5]}^{commit}`], { cwd: repo, encoding: 'utf8' }).stdout.trim();
if (m.base_sha !== b || m.candidate_sha !== c) process.exit(2);
if (!/^[0-9a-f]{64}$/.test(m.base_sha) || !/^[0-9a-f]{64}$/.test(m.candidate_sha)) process.exit(3);
const pre = JSON.stringify({
  schema_version: m.schema_version, base_sha: m.base_sha, candidate_sha: m.candidate_sha,
  deny_list: m.deny_list, entries: m.entries,
});
if (crypto.createHash('sha256').update(pre).digest('hex') !== m.packet_hash) process.exit(4);
NODE
  assert_eq "0" "$?" "(h3) sha256 fixture OIDs and preimage"
else
  fail "(h3) git init --object-format=sha256 unavailable"
fi

# (h4) invalid UTF-8 filename
U8="$TEST_TMP/utf8"
git init --object-format=sha1 -q "$U8"
git -C "$U8" config user.email t@t.example
git -C "$U8" config user.name t
printf 'ok\n' > "$U8/ok.txt"
git -C "$U8" add ok.txt
git -C "$U8" commit -q -m b
node - "$U8" <<'NODE'
const fs = require('fs');
const path = require('path');
const dir = process.argv[2];
fs.writeFileSync(Buffer.from(`${dir}/bad\xff`, 'latin1'), 'x\n');
NODE
git -C "$U8" add -A
git -C "$U8" commit -q -m c
UB="$(git -C "$U8" rev-parse HEAD^)"
UC="$(git -C "$U8" rev-parse HEAD)"
UDIFF="$TEST_TMP/u8.diff"
git -C "$U8" diff --no-ext-diff --no-textconv "$UB..$UC" > "$UDIFF"
UOUT="$TEST_TMP/u8-out"
H4MSG="$(node - "$MODULE" "$U8" "$UB" "$UC" "$UDIFF" "$UOUT" <<'NODE'
const fs = require('fs');
const { buildReviewPacket } = require(process.argv[2]);
try {
  buildReviewPacket({
    repo: process.argv[3], baseSha: process.argv[4], candidateSha: process.argv[5],
    diffFile: process.argv[6], specFile: null, outDir: process.argv[7], denyList: [],
  });
  process.stdout.write('NO-THROW');
} catch (e) {
  process.stdout.write(String(e.message));
}
NODE
)"
assert_contains "$H4MSG" "unsupported path encoding:" "(h4) invalid UTF-8 fails closed"
if [ -d "$UOUT" ]; then
  LEFT="$(find "$UOUT" -mindepth 1 | wc -l)"
  assert_eq "0" "$(echo "$LEFT" | tr -d ' ')" "(h4) nothing written under outDir"
fi

# (i) gitlink
GL="$TEST_TMP/gitlink"
git init --object-format=sha1 -q "$GL"
git -C "$GL" config user.email t@t.example
git -C "$GL" config user.name t
printf 'f\n' > "$GL/f.txt"
git -C "$GL" add f.txt
git -C "$GL" commit -q -m b
SHA="$(git -C "$GL" rev-parse HEAD)"
git -C "$GL" update-index --add --cacheinfo "160000,$SHA,sub"
git -C "$GL" commit -q -m c
GB="$(git -C "$GL" rev-parse HEAD^)"
GC="$(git -C "$GL" rev-parse HEAD)"
GDIFF="$TEST_TMP/gl.diff"
git -C "$GL" diff --no-ext-diff --no-textconv "$GB..$GC" > "$GDIFF" || true
GOUT="$TEST_TMP/gl-out"
IMSG="$(node - "$MODULE" "$GL" "$GB" "$GC" "$GDIFF" "$GOUT" <<'NODE'
const { buildReviewPacket } = require(process.argv[2]);
try {
  buildReviewPacket({
    repo: process.argv[3], baseSha: process.argv[4], candidateSha: process.argv[5],
    diffFile: process.argv[6], specFile: null, outDir: process.argv[7], denyList: [],
  });
  process.stdout.write('NO-THROW');
} catch (e) {
  process.stdout.write(String(e.message));
}
NODE
)"
assert_contains "$IMSG" "unsupported submodule: sub" "(i) gitlink fails closed"
if [ -d "$GOUT" ]; then
  LEFT="$(find "$GOUT" -mindepth 1 | wc -l)"
  assert_eq "0" "$(echo "$LEFT" | tr -d ' ')" "(i) writes nothing under outDir"
fi

# (j) absent specFile
JOUT="$TEST_TMP/nospec"
node - "$MODULE" "$F2" "$FB" "$FC" "$FDIFF" "$JOUT" <<'NODE'
const { buildReviewPacket } = require(process.argv[2]);
buildReviewPacket({
  repo: process.argv[3], baseSha: process.argv[4], candidateSha: process.argv[5],
  diffFile: process.argv[6], specFile: null, outDir: process.argv[7], denyList: [],
});
NODE
assert_eq "0" "$(wc -c < "$JOUT/spec.md" | tr -d ' ')" "(j) zero-byte spec.md"
node -e 'const m=require(process.argv[1]+"/MANIFEST.json"); const e=m.entries.find(x=>x.path==="spec.md"); if(!e || e.bytes!==0) process.exit(2)' "$JOUT"
assert_eq "0" "$?" "(j) manifest lists spec.md bytes 0"

# (h2d) ambient GIT_COMMON_DIR / GIT_CONFIG_* poison must not reach the isolated git dir
POISON="$TEST_TMP/poison"
git init --object-format=sha1 -q "$POISON"
POISON_MARK="$TEST_TMP/poison-smudge"
git -C "$POISON" config filter.poison.smudge "sh -c 'echo RAN >> \"$POISON_MARK\"; cat'"
mkdir -p "$POISON/.git/info"
printf '* filter=poison\n' > "$POISON/.git/info/attributes"
rm -f "$POISON_MARK"
GIT_COMMON_DIR="$POISON/.git" GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=filter.poison.smudge GIT_CONFIG_VALUE_0="sh -c 'echo RAN >> \"$POISON_MARK\"; cat'" \
  node - "$MODULE" "$INFO" "$INB" "$INC" "$INDIFF" "$TEST_TMP/poison-out" <<'NODE'
const { buildReviewPacket } = require(process.argv[2]);
buildReviewPacket({
  repo: process.argv[3], baseSha: process.argv[4], candidateSha: process.argv[5],
  diffFile: process.argv[6], specFile: null, outDir: process.argv[7], denyList: [],
});
NODE
assert_eq "0" "$?" "(h2d) build succeeds under a poisoned GIT_* environment"
assert_file_absent "$POISON_MARK" "(h2d) ambient GIT_COMMON_DIR / GIT_CONFIG_* never reach the isolated checkout"
assert_file_exists "$TEST_TMP/poison-out/tree/watched.txt" "(h2d) tree came from the requested repository, not the poisoned one"

# (h4b) an invalid-UTF-8 path that exists only at BASE (deleted in the candidate) also fails closed
U8D="$TEST_TMP/utf8-del"
git init --object-format=sha1 -q "$U8D"
git -C "$U8D" config user.email t@t.example
git -C "$U8D" config user.name t
printf 'ok\n' > "$U8D/ok.txt"
node -e 'require("fs").writeFileSync(Buffer.from(`${process.argv[1]}/gone\xff`, "latin1"), "x\n")' "$U8D"
git -C "$U8D" add -A
git -C "$U8D" commit -q -m b
git -C "$U8D" rm -q --cached -- "$(printf 'gone\xff')" 2>/dev/null || git -C "$U8D" rm -q --cached "gone"*
printf 'ok2\n' > "$U8D/ok.txt"
git -C "$U8D" add ok.txt
git -C "$U8D" commit -q -m c
U8DB="$(git -C "$U8D" rev-parse HEAD^)"
U8DC="$(git -C "$U8D" rev-parse HEAD)"
U8DDIFF="$TEST_TMP/u8d.diff"
git -C "$U8D" diff --no-ext-diff --no-textconv "$U8DB..$U8DC" > "$U8DDIFF"
H4BMSG="$(node - "$MODULE" "$U8D" "$U8DB" "$U8DC" "$U8DDIFF" "$TEST_TMP/u8d-out" <<'NODE'
const { buildReviewPacket } = require(process.argv[2]);
try {
  buildReviewPacket({
    repo: process.argv[3], baseSha: process.argv[4], candidateSha: process.argv[5],
    diffFile: process.argv[6], specFile: null, outDir: process.argv[7], denyList: [],
  });
  process.stdout.write('NO-THROW');
} catch (e) {
  process.stdout.write(String(e.message));
}
NODE
)"
assert_contains "$H4BMSG" "unsupported path encoding:" "(h4b) invalid UTF-8 base-only path in name-status fails closed"

# (k) a tracked .gitattributes that is a SYMLINK is restored as a symlink and survives integrity
KS="$TEST_TMP/attrlink"
git init --object-format=sha1 -q "$KS"
git -C "$KS" config user.email t@t.example
git -C "$KS" config user.name t
printf 'a.txt -text\n' > "$KS/attrs.real"
ln -s attrs.real "$KS/.gitattributes"
printf 'a\n' > "$KS/a.txt"
git -C "$KS" add -A
git -C "$KS" commit -q -m b
printf 'a2\n' > "$KS/a.txt"
git -C "$KS" add a.txt
git -C "$KS" commit -q -m c
KSB="$(git -C "$KS" rev-parse HEAD^)"
KSC="$(git -C "$KS" rev-parse HEAD)"
KSDIFF="$TEST_TMP/ks.diff"
git -C "$KS" diff --no-ext-diff --no-textconv "$KSB..$KSC" > "$KSDIFF"
node - "$MODULE" "$KS" "$KSB" "$KSC" "$KSDIFF" "$TEST_TMP/ks-out" <<'NODE'
const { buildReviewPacket } = require(process.argv[2]);
buildReviewPacket({
  repo: process.argv[3], baseSha: process.argv[4], candidateSha: process.argv[5],
  diffFile: process.argv[6], specFile: null, outDir: process.argv[7], denyList: [],
});
NODE
assert_eq "0" "$?" "(k) build with a symlink .gitattributes succeeds"
assert_eq "attrs.real" "$(readlink "$TEST_TMP/ks-out/tree/.gitattributes" 2>/dev/null)" "(k) .gitattributes restored as a symlink"

# DEFAULT_PACKET_DENY_LIST length
node -e 'const {DEFAULT_PACKET_DENY_LIST}=require(process.argv[1]); if(DEFAULT_PACKET_DENY_LIST.length!==8) process.exit(2)' "$MODULE"
assert_eq "0" "$?" "DEFAULT_PACKET_DENY_LIST has eight patterns"

finalize_test
