#!/usr/bin/env bash
# BL-0146 D4 follow-up: an incremental packet must hand a seat the hunk of every re-check file the range
# changed. The descriptor's diff_paths and tree_paths come from one list (review-increment.js
# recheck_diff_paths); if they ever disagree, buildReviewPacket refuses rather than ship content without its
# hunk. Negative control: a COPY of the packet module with the guard removed must accept the broken descriptor.
. "$(dirname "$0")/lib.sh"

OUT="$(node - "$REPO_ROOT" "$TEST_TMP" <<'NODE'
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const [root, tmp] = process.argv.slice(2);
const git = (repo, ...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const repo = path.join(tmp, 'repo');
fs.mkdirSync(repo);
execFileSync('git', ['-C', repo, 'init', '-q']);
git(repo, 'config', 'user.email', 'w@example.invalid'); git(repo, 'config', 'user.name', 'W');
fs.writeFileSync(path.join(repo, 'README'), 'base\n');
git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'base');
const base = git(repo, 'rev-parse', 'HEAD');
for (const n of ['a', 'b']) fs.writeFileSync(path.join(repo, `${n}.txt`), `${n} payload\n`);
git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'range');
const head = git(repo, 'rev-parse', 'HEAD');
const { pathDiff } = require(path.join(root, 'src/engine/review-increment'));
fs.writeFileSync(path.join(tmp, 'spec.md'), 'spec\n');

function load(mutate, name) {
  let src = fs.readFileSync(path.join(root, 'src/runners/review-packet.js'), 'utf8');
  if (mutate) { const m = mutate(src); if (m === src) throw new Error('mutation no-op'); src = m; }
  src = src.replace(/require\('\.\.\/engine\/review-increment'\)/g, `require(${JSON.stringify(path.join(root, 'src/engine/review-increment'))})`)
    .replace(/require\('\.\/([a-z-]+)'\)/g, (_m, n) => `require(${JSON.stringify(path.join(root, 'src/runners', n))})`);
  const f = path.join(tmp, `${name}-review-packet.js`);
  fs.writeFileSync(f, src);
  return require(f);
}
function attempt(mod, tag, diffPaths, treePaths) {
  const diffFile = path.join(tmp, `${tag}.diff`);
  fs.writeFileSync(diffFile, pathDiff(repo, base, head, diffPaths));
  try {
    mod.buildReviewPacket({
      repo, baseSha: base, candidateSha: head, diffFile, specFile: path.join(tmp, 'spec.md'),
      outDir: path.join(tmp, `out-${tag}`),
      incremental: { diff_paths: diffPaths, tree_paths: treePaths, delta_diff: Buffer.from('') },
    });
    return 'built';
  } catch (e) { return String(e.message); }
}
const out = {};
const real = load(null, 'real');
out.consistent_builds = attempt(real, 'ok', ['a.txt'], ['a.txt']) === 'built';
const bad = attempt(real, 'bad', ['a.txt'], ['a.txt', 'b.txt']);
out.hunkless_changed_file_refused = /no hunk/.test(bad);
const negMod = load((s) => s.replace(/if \(changedSet\.has\(p\) && !diffSet\.has\(p\)\) \{ \/\/ guard:recheck_hunk/, 'if (false) {'), 'neg');
out.neg_guard_removed_accepts_broken = attempt(negMod, 'negbad', ['a.txt'], ['a.txt', 'b.txt']) === 'built';

// A renamed re-check file (e060df59 follow-up, plan A14): the range shows the rename as a delete of the old
// path plus an add of the new one (the packet diff runs --no-renames). The seat must get both hunks, and
// only the new path's content; a descriptor that lists the new path without its hunk is refused.
git(repo, 'mv', 'README', 'README-renamed');
git(repo, 'commit', '-qm', 'rename');
const headR = git(repo, 'rev-parse', 'HEAD');
function attemptRename(mod, tag, diffPaths, treePaths) {
  const diffFile = path.join(tmp, `${tag}.diff`);
  fs.writeFileSync(diffFile, pathDiff(repo, base, headR, diffPaths));
  try {
    const built = mod.buildReviewPacket({
      repo, baseSha: base, candidateSha: headR, diffFile, specFile: path.join(tmp, 'spec.md'),
      outDir: path.join(tmp, `out-${tag}`),
      incremental: { diff_paths: diffPaths, tree_paths: treePaths, delta_diff: Buffer.from('') },
    });
    const dir = built.dir;
    const patch = fs.readFileSync(path.join(dir, 'diff.patch'), 'utf8');
    const tree = fs.readdirSync(path.join(dir, 'tree')).sort().join();
    return { built: true, patch, tree };
  } catch (e) { return { built: false, message: String(e.message) }; }
}
const ren = attemptRename(real, 'ren', ['README-renamed', 'README'], ['README-renamed']);
out.rename_builds_with_both_sides = ren.built === true;
out.rename_patch_has_delete_and_add = ren.built === true && /deleted file mode[\s\S]*README/.test(ren.patch)
  && /new file mode/.test(ren.patch) && ren.patch.includes('README-renamed') && ren.patch.includes('a/README');
out.rename_tree_holds_new_path_only = ren.built === true && ren.tree === 'README-renamed';
const renBad = attemptRename(real, 'renbad', ['README'], ['README-renamed']);
out.rename_new_path_without_hunk_refused = renBad.built === false && /no hunk/.test(renBad.message);
out.neg_rename_guard_removed_accepts_broken = attemptRename(negMod, 'negrenbad', ['README'], ['README-renamed']).built === true;
console.log(JSON.stringify(out));
NODE
)"
[ -n "$OUT" ] || fail "node produced no output"
while IFS= read -r line; do
  assert_eq "${line#*=}" "true" "${line%%=*}"
done < <(printf '%s' "$OUT" | node -e 'const o=JSON.parse(require("fs").readFileSync(0,"utf8"));for(const k in o)console.log(k+"="+o[k])')
finalize_test
