'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const DEFAULT_PACKET_DENY_LIST = Object.freeze([
  '.autopilot/**',
  '.qc/**',
  'docs/plans/evidence/**',
  'docs/plans/**/*.review.md',
  'docs/plans/**/*.review.json',
  'docs/plans/**/*disposition*.json',
  '**/*.receipt.json',
  '**/*.raw.log',
]);

const GIT_MAX_BUFFER = 64 * 1024 * 1024;
// Every ambient GIT_* variable is scrubbed before any git subprocess: GIT_DIR /
// GIT_COMMON_DIR / GIT_INDEX_FILE / GIT_OBJECT_DIRECTORY / GIT_ALTERNATE_OBJECT_DIRECTORIES
// would point the isolated temp git dir at another repository's config and
// info/attributes; GIT_CONFIG_PARAMETERS / GIT_CONFIG_COUNT|KEY_n|VALUE_n inject config
// (a filter driver) without a file. Only the keys this module sets survive.
function gitEnv(extra) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith('GIT_')) env[key] = value;
  }
  return { ...env, ...(extra || {}) };
}

function runGit(step, args, options = {}) {
  const result = spawnSync('git', args, {
    cwd: options.cwd,
    env: options.env || gitEnv(),
    input: options.input,
    maxBuffer: GIT_MAX_BUFFER,
    shell: false,
    encoding: options.encoding,
  });
  if (result.error) {
    throw new Error(`${step}: ${result.error.message}`);
  }
  if (result.signal) {
    throw new Error(`${step}: signal ${result.signal}`);
  }
  if (result.status !== 0) {
    const err = result.stderr
      ? Buffer.isBuffer(result.stderr)
        ? result.stderr.toString('utf8')
        : String(result.stderr)
      : '';
    throw new Error(`${step}: ${err.trim() || `exit ${result.status}`}`);
  }
  return result.stdout;
}

function isValidUtf8(buf) {
  return Buffer.from(buf.toString('utf8'), 'utf8').equals(buf);
}

function splitNul(buf) {
  const parts = [];
  let start = 0;
  for (let i = 0; i < buf.length; i += 1) {
    if (buf[i] === 0) {
      parts.push(buf.subarray(start, i));
      start = i + 1;
    }
  }
  if (start < buf.length) parts.push(buf.subarray(start));
  return parts;
}

function parseLsTree(buf) {
  const entries = [];
  for (const rec of splitNul(buf)) {
    if (rec.length === 0) continue;
    const sp1 = rec.indexOf(0x20);
    const sp2 = rec.indexOf(0x20, sp1 + 1);
    const tab = rec.indexOf(0x09, sp2 + 1);
    if (sp1 < 0 || sp2 < 0 || tab < 0) {
      throw new Error(`git ls-tree: malformed record`);
    }
    const mode = rec.subarray(0, sp1).toString('utf8');
    const type = rec.subarray(sp1 + 1, sp2).toString('utf8');
    const oid = rec.subarray(sp2 + 1, tab).toString('utf8');
    const pathBytes = rec.subarray(tab + 1);
    entries.push({ mode, type, oid, pathBytes });
  }
  return entries;
}

function otherGlobSyntax(pattern) {
  if (pattern.startsWith('/') || path.isAbsolute(pattern)) return true;
  if (pattern.length === 0) return true;
  const segs = pattern.split('/');
  for (const seg of segs) {
    if (seg === '..' || seg === '.') return true;
    if (seg !== '**' && (seg.includes('**') || /[?[{}\]]/.test(seg))) return true;
  }
  return segs.some((s) => s === '');
}

function normalizeDenyList(denyList) {
  const raw = denyList == null ? [...DEFAULT_PACKET_DENY_LIST] : [...denyList];
  for (const pattern of raw) {
    if (typeof pattern !== 'string' || otherGlobSyntax(pattern)) {
      throw new Error(`invalid deny-list pattern: ${pattern}`);
    }
  }
  return [...new Set(raw)].sort();
}

function matchOneSegment(seg, pat) {
  if (pat === '**') return false;
  if (!pat.includes('*')) return seg === pat;
  let re = '^';
  for (const ch of pat) {
    if (ch === '*') re += '[^/]*';
    else re += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  re += '$';
  return new RegExp(re).test(seg);
}

function matchGlob(pathSegs, patSegs, pi, gi) {
  if (gi === patSegs.length) return pi === pathSegs.length;
  if (patSegs[gi] === '**') {
    if (gi === patSegs.length - 1) return true;
    for (let n = pi; n <= pathSegs.length; n += 1) {
      if (matchGlob(pathSegs, patSegs, n, gi + 1)) return true;
    }
    return false;
  }
  if (pi === pathSegs.length) return false;
  if (!matchOneSegment(pathSegs[pi], patSegs[gi])) return false;
  return matchGlob(pathSegs, patSegs, pi + 1, gi + 1);
}

function packetPathDenied(repoPath, denyList) {
  const list = denyList == null ? DEFAULT_PACKET_DENY_LIST : denyList;
  const posix = String(repoPath).replace(/^\.\//, '');
  if (posix === '' || posix === '.') return false;
  const pathSegs = posix.split('/');
  // A path is denied when it, or ANY ancestor directory of it, matches a pattern:
  // `logs/x.raw.log/verdict.txt` is under a directory named like a denied file.
  for (const pattern of list) {
    const patSegs = pattern.split('/');
    for (let n = 1; n <= pathSegs.length; n += 1) {
      if (matchGlob(pathSegs.slice(0, n), patSegs, 0, 0)) return true;
    }
  }
  return false;
}

function posixRel(from, to) {
  return path.relative(from, to).split(path.sep).join('/');
}

function walkLstat(root) {
  const acc = [];
  function rec(dir, rel) {
    let names;
    try {
      names = fs.readdirSync(dir);
    } catch (error) {
      if (error && error.code === 'ENOENT') return;
      throw error;
    }
    names.sort();
    for (const name of names) {
      const full = path.join(dir, name);
      const childRel = rel ? `${rel}/${name}` : name;
      const st = fs.lstatSync(full);
      if (st.isDirectory()) rec(full, childRel);
      else acc.push({ rel: childRel, full, st });
    }
  }
  rec(root, '');
  return acc;
}

function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function splitDiffSections(buf) {
  const needle = Buffer.from('diff --git ');
  const nlNeedle = Buffer.from('\ndiff --git ');
  const starts = [];
  if (buf.length >= needle.length && buf.subarray(0, needle.length).equals(needle)) {
    starts.push(0);
  }
  let idx = 0;
  while (idx < buf.length) {
    const found = buf.indexOf(nlNeedle, idx);
    if (found < 0) break;
    starts.push(found + 1);
    idx = found + 1;
  }
  const sections = [];
  for (let i = 0; i < starts.length; i += 1) {
    const end = i + 1 < starts.length ? starts[i + 1] : buf.length;
    sections.push(buf.subarray(starts[i], end));
  }
  return sections;
}

function pathBytesToString(pathBytes) {
  if (!isValidUtf8(pathBytes)) {
    throw new Error(`unsupported path encoding: ${pathBytes.toString('hex')}`);
  }
  return pathBytes.toString('utf8');
}

function parseNameStatus(buf) {
  const tokens = splitNul(buf).filter((t) => t.length > 0);
  const records = [];
  let i = 0;
  while (i < tokens.length) {
    const status = tokens[i].toString('utf8');
    const code = status[0];
    if (code === 'R' || code === 'C') {
      if (i + 2 >= tokens.length) throw new Error('git diff --name-status: truncated rename/copy record');
      records.push({
        status,
        oldPath: pathBytesToString(tokens[i + 1]),
        newPath: pathBytesToString(tokens[i + 2]),
      });
      i += 3;
    } else {
      if (i + 1 >= tokens.length) throw new Error('git diff --name-status: truncated record');
      const p = pathBytesToString(tokens[i + 1]);
      records.push({ status, oldPath: p, newPath: p });
      i += 2;
    }
  }
  return records;
}

function typeForMode(mode, st) {
  if (mode === '120000') return st.isSymbolicLink();
  if (mode === '100644' || mode === '100755') return st.isFile();
  return false;
}

function hashObject(repo, format, input) {
  const args = [];
  if (format && format !== 'sha1') {
    args.push('-c', `extensions.objectFormat=${format}`);
  }
  args.push('hash-object', '--stdin', '--no-filters');
  const out = runGit('git hash-object', args, {
    cwd: repo,
    env: gitEnv(),
    input,
    encoding: 'utf8',
  });
  return String(out).trim();
}

function verifyTreeIntegrity(treeDir, listing) {
  const listed = new Set();
  for (const entry of listing) {
    const rel = entry.path;
    listed.add(rel);
    const full = path.join(treeDir, rel);
    let st;
    try {
      st = fs.lstatSync(full);
    } catch {
      throw new Error(`tree integrity: ${rel}`);
    }
    if (!typeForMode(entry.mode, st)) {
      throw new Error(`tree integrity: ${rel}`);
    }
    const bytes = st.isSymbolicLink()
      ? fs.readlinkSync(full, { encoding: 'buffer' })
      : fs.readFileSync(full);
    const hashed = hashObject(entry.repo || path.resolve('.'), entry.format || '', bytes);
    if (hashed !== entry.oid) {
      throw new Error(`tree integrity: ${rel}`);
    }
  }
  for (const item of walkLstat(treeDir)) {
    if (!listed.has(item.rel)) {
      throw new Error(`tree integrity: ${item.rel}`);
    }
  }
}

function resolveSymlinkTarget(treeDir, linkRel, target) {
  const targetStr = Buffer.isBuffer(target) ? target.toString('utf8') : String(target);
  if (targetStr.startsWith('/') || /^[A-Za-z]:[\\/]/.test(targetStr)) {
    return { absolute: true, resolved: null };
  }
  const linkDir = path.posix.dirname(linkRel);
  const joined = path.posix.normalize(linkDir === '.' ? targetStr : `${linkDir}/${targetStr}`);
  if (joined === '..' || joined.startsWith('../')) {
    return { absolute: false, escaped: true, resolved: joined };
  }
  return { absolute: false, escaped: false, resolved: joined === '.' ? '' : joined };
}

function rmIfExists(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

function buildReviewPacket({
  repo,
  baseSha,
  candidateSha,
  diffFile,
  specFile,
  outDir,
  denyList,
} = {}) {
  const deny = normalizeDenyList(denyList);
  const repoAbs = path.resolve(repo);
  const outAbs = path.resolve(outDir);
  const baseOid = String(runGit('git rev-parse --verify', ['rev-parse', '--verify', `${baseSha}^{commit}`], {
    cwd: repoAbs,
    env: gitEnv(),
    encoding: 'utf8',
  })).trim();
  const candidateOid = String(runGit('git rev-parse --verify', ['rev-parse', '--verify', `${candidateSha}^{commit}`], {
    cwd: repoAbs,
    env: gitEnv(),
    encoding: 'utf8',
  })).trim();
  let format = '';
  try {
    format = String(runGit('git rev-parse --show-object-format', ['rev-parse', '--show-object-format'], {
      cwd: repoAbs,
      env: gitEnv(),
      encoding: 'utf8',
    })).trim();
  } catch {
    format = '';
  }

  const lsRaw = runGit('git ls-tree', ['ls-tree', '-r', '-z', candidateOid], {
    cwd: repoAbs,
    env: gitEnv(),
  });
  const rawEntries = parseLsTree(lsRaw);
  for (const entry of rawEntries) {
    if (entry.mode === '160000' || entry.type === 'commit') {
      const p = isValidUtf8(entry.pathBytes)
        ? entry.pathBytes.toString('utf8')
        : entry.pathBytes.toString('hex');
      throw new Error(`unsupported submodule: ${p}`);
    }
    if (!isValidUtf8(entry.pathBytes)) {
      throw new Error(`unsupported path encoding: ${entry.pathBytes.toString('hex')}`);
    }
  }
  const listing = rawEntries.map((entry) => ({
    mode: entry.mode,
    type: entry.type,
    oid: entry.oid,
    path: entry.pathBytes.toString('utf8'),
    repo: repoAbs,
    format,
  }));

  fs.mkdirSync(outAbs, { recursive: true });
  const gitDir = path.join(outAbs, '.gitdir');
  const emptyDir = path.join(outAbs, '.empty');
  const treeDir = path.join(outAbs, 'tree');
  const deniedSet = new Set();

  try {
    const objectsPath = String(runGit('git rev-parse --git-path objects', ['rev-parse', '--git-path', 'objects'], {
      cwd: repoAbs,
      env: gitEnv(),
      encoding: 'utf8',
    })).trim();
    const objectsAbs = path.isAbsolute(objectsPath) ? objectsPath : path.resolve(repoAbs, objectsPath);

    fs.mkdirSync(path.join(gitDir, 'refs'), { recursive: true });
    fs.mkdirSync(path.join(gitDir, 'objects', 'info'), { recursive: true });
    fs.writeFileSync(path.join(gitDir, 'HEAD'), 'ref: refs/heads/none\n');
    fs.writeFileSync(path.join(gitDir, 'objects', 'info', 'alternates'), `${objectsAbs}\n`);
    if (format && format !== 'sha1') {
      fs.writeFileSync(path.join(gitDir, 'config'), `[core]\n\trepositoryFormatVersion = 1\n[extensions]\n\tobjectFormat = ${format}\n`);
    }
    fs.mkdirSync(emptyDir, { recursive: true });
    fs.mkdirSync(treeDir, { recursive: true });

    const isolated = gitEnv({
      GIT_DIR: gitDir,
      GIT_INDEX_FILE: path.join(gitDir, 'index'),
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_SYSTEM: '/dev/null',
      GIT_ATTR_NOSYSTEM: '1',
    });

    const formatFlags = (format && format !== 'sha1')
      ? ['-c', `extensions.objectFormat=${format}`]
      : [];

    runGit('git read-tree', [...formatFlags, 'read-tree', candidateOid], { cwd: repoAbs, env: isolated });

    const attrPaths = listing.filter((e) => path.posix.basename(e.path) === '.gitattributes');
    for (const attr of attrPaths) {
      runGit('git update-index', [...formatFlags, 'update-index', '--force-remove', '--', attr.path], {
        cwd: repoAbs,
        env: isolated,
      });
    }

    const prefix = treeDir.endsWith(path.sep) ? treeDir : `${treeDir}${path.sep}`;
    runGit('checkout-index', [
      ...formatFlags,
      '-c', 'core.attributesFile=/dev/null',
      '-c', 'core.symlinks=true',
      '-c', 'core.autocrlf=false',
      '-c', 'core.eol=lf',
      `--work-tree=${emptyDir}`,
      'checkout-index', '-a', `--prefix=${prefix}`,
    ], { cwd: repoAbs, env: isolated });

    for (const attr of attrPaths) {
      const dest = path.join(treeDir, attr.path);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const blob = runGit('git cat-file blob', [...formatFlags, 'cat-file', 'blob', attr.oid], {
        cwd: repoAbs,
        env: isolated,
      });
      if (attr.mode === '120000') {
        fs.symlinkSync(blob.toString('utf8'), dest);
      } else {
        fs.writeFileSync(dest, blob, { mode: attr.mode === '100755' ? 0o755 : 0o644 });
      }
    }

    rmIfExists(gitDir);
    rmIfExists(emptyDir);

    verifyTreeIntegrity(treeDir, listing);

    for (const entry of listing) {
      if (packetPathDenied(entry.path, deny)) {
        deniedSet.add(entry.path);
        rmIfExists(path.join(treeDir, entry.path));
      }
    }
    for (const pattern of deny) {
      if (pattern.endsWith('/**')) {
        const dirRel = pattern.slice(0, -3);
        if (dirRel) {
          const dirFull = path.join(treeDir, dirRel);
          if (fs.existsSync(dirFull)) {
            deniedSet.add(dirRel);
            rmIfExists(dirFull);
          }
        }
      }
    }

    for (const item of walkLstat(treeDir)) {
      if (!item.st.isSymbolicLink()) continue;
      const target = fs.readlinkSync(item.full, { encoding: 'buffer' });
      const info = resolveSymlinkTarget(treeDir, item.rel, target);
      let hazardous = Boolean(info.absolute || info.escaped);
      if (!hazardous && info.resolved) {
        if (packetPathDenied(info.resolved, deny) || packetPathDenied(item.rel, deny)) {
          hazardous = true;
        } else {
          const resolvedFull = path.join(treeDir, info.resolved);
          try {
            const rst = fs.lstatSync(resolvedFull);
            if (rst.isDirectory() || rst.isFile() || rst.isSymbolicLink()) {
              if (packetPathDenied(info.resolved, deny)) hazardous = true;
            }
          } catch {
            // dangling inside tree: keep unless denied
          }
        }
      }
      if (hazardous) {
        deniedSet.add(item.rel);
        rmIfExists(item.full);
      }
    }

    const inputDiff = fs.readFileSync(diffFile);
    const canonicalRaw = runGit('git diff', [
      'diff', '--no-ext-diff', '--no-textconv', `${baseOid}..${candidateOid}`,
    ], { cwd: repoAbs, env: gitEnv() });
    const canonical = Buffer.isBuffer(canonicalRaw) ? canonicalRaw : Buffer.from(canonicalRaw);
    if (!canonical.equals(inputDiff)) {
      throw new Error('diff not canonical');
    }

    const nameStatusRaw = runGit('git diff --name-status', [
      'diff', '--no-ext-diff', '--no-textconv', '--name-status', '-z', baseOid, candidateOid,
    ], { cwd: repoAbs, env: gitEnv() });
    const records = parseNameStatus(Buffer.isBuffer(nameStatusRaw) ? nameStatusRaw : Buffer.from(nameStatusRaw));
    const sections = splitDiffSections(inputDiff);
    if (sections.length !== records.length) {
      throw new Error(`alignment: section count ${sections.length} != name-status ${records.length}`);
    }

    const kept = [];
    for (let i = 0; i < records.length; i += 1) {
      const rec = records[i];
      const oldDenied = packetPathDenied(rec.oldPath, deny);
      const newDenied = packetPathDenied(rec.newPath, deny);
      if (oldDenied || newDenied) {
        if (oldDenied) deniedSet.add(rec.oldPath);
        if (newDenied) deniedSet.add(rec.newPath);
        if (oldDenied && !newDenied) {
          deniedSet.add(rec.newPath);
          rmIfExists(path.join(treeDir, rec.newPath));
        }
        continue;
      }
      kept.push(sections[i]);
    }
    fs.writeFileSync(path.join(outAbs, 'diff.patch'), Buffer.concat(kept));

    const specDest = path.join(outAbs, 'spec.md');
    if (specFile == null) {
      fs.writeFileSync(specDest, Buffer.alloc(0));
    } else {
      fs.copyFileSync(specFile, specDest);
    }

    const entries = [];
    for (const item of walkLstat(outAbs)) {
      if (item.rel === 'MANIFEST.json') continue;
      const isLink = item.st.isSymbolicLink();
      const bytesBuf = isLink
        ? fs.readlinkSync(item.full, { encoding: 'buffer' })
        : fs.readFileSync(item.full);
      entries.push({
        path: item.rel,
        type: isLink ? 'symlink' : 'file',
        sha256: sha256Hex(bytesBuf),
        bytes: bytesBuf.length,
      });
    }
    entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

    const preimageObj = {
      schema_version: 1,
      base_sha: baseOid,
      candidate_sha: candidateOid,
      deny_list: deny,
      entries,
    };
    const packetHash = sha256Hex(Buffer.from(JSON.stringify(preimageObj), 'utf8'));
    const manifest = {
      schema_version: 1,
      artifact_type: 'review_packet_manifest',
      base_sha: baseOid,
      candidate_sha: candidateOid,
      deny_list: deny,
      entries,
      packet_hash: packetHash,
    };
    const manifestPath = path.join(outAbs, 'MANIFEST.json');
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    const denied_paths = [...deniedSet].sort();
    return {
      dir: outAbs,
      packet_hash: packetHash,
      manifest_path: manifestPath,
      entries_count: entries.length,
      denied_paths,
    };
  } finally {
    rmIfExists(gitDir);
    rmIfExists(emptyDir);
  }
}

module.exports = {
  buildReviewPacket,
  packetPathDenied,
  normalizeDenyList,
  DEFAULT_PACKET_DENY_LIST,
  verifyTreeIntegrity,
};
