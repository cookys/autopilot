'use strict';

// LSM P3 explicit merge executor. The only mutations in this module are the
// declared merges and the exact path snapshots needed to preserve approved
// overlaps. It deliberately has no push, ref deletion, worktree deletion, or
// stash operations.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { canonicalDigest } = require('../engine/implementation-campaign');
const { verifyMergeIntentSeal } = require('../status/merge-intent');

const SCHEMA_VERSION = 1;
const ARTIFACT_TYPE = 'merge_execution_receipt';
const GIT_OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function git(cwd, args, { allowFailure = false, input = null, encoding = 'utf8' } = {}) {
  const result = spawnSync('git', ['-C', cwd, ...args], {
    encoding,
    input,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (!allowFailure && (result.error || result.signal || result.status !== 0)) {
    const detail = String(result.stderr || result.error || result.signal || '').trim();
    throw new Error(`git ${args[0]} failed${detail ? `: ${detail}` : ''}`);
  }
  return result;
}

function resolveRef(worktree, ref) {
  const result = git(worktree, ['rev-parse', '--verify', `${ref}^{commit}`], {
    allowFailure: true,
  });
  const value = result.status === 0 ? result.stdout.trim() : '';
  return GIT_OID.test(value) ? value : null;
}

function resolveHead(worktree) {
  const value = git(worktree, ['rev-parse', '--verify', 'HEAD^{commit}']).stdout.trim();
  return GIT_OID.test(value) ? value : null;
}

function symbolicHead(worktree) {
  const result = git(worktree, ['symbolic-ref', '-q', 'HEAD'], { allowFailure: true });
  return result.status === 0 ? result.stdout.trim() : null;
}

function commonDir(worktree) {
  const result = git(worktree, ['rev-parse', '--git-common-dir'], { allowFailure: true });
  if (result.status !== 0) return null;
  const value = result.stdout.trim();
  try {
    return fs.realpathSync(path.isAbsolute(value) ? value : path.resolve(worktree, value));
  } catch (_error) {
    return null;
  }
}

function validateWorktreeBinding(repo, worktree) {
  let canonicalRepo;
  let canonicalWorktree;
  try {
    canonicalRepo = fs.realpathSync(repo);
    canonicalWorktree = fs.realpathSync(worktree);
  } catch (_error) {
    return false;
  }
  if (canonicalRepo !== repo || canonicalWorktree !== worktree) return false;
  const top = git(worktree, ['rev-parse', '--show-toplevel'], { allowFailure: true });
  if (top.status !== 0) return false;
  let canonicalTop;
  try {
    canonicalTop = fs.realpathSync(top.stdout.trim());
  } catch (_error) {
    return false;
  }
  return canonicalTop === canonicalWorktree
    && commonDir(canonicalRepo) !== null
    && commonDir(canonicalRepo) === commonDir(canonicalWorktree);
}

function parseNul(value) {
  return value.split('\0').filter(Boolean).sort();
}

function inventoryDirty(worktree) {
  return {
    staged: parseNul(git(worktree, [
      'diff', '--cached', '--name-only', '-z',
    ]).stdout),
    unstaged: parseNul(git(worktree, ['diff', '--name-only', '-z']).stdout),
    untracked: parseNul(git(worktree, [
      'ls-files', '--others', '--exclude-standard', '-z',
    ]).stdout),
    ambiguous: parseNul(git(worktree, [
      'diff', '--name-only', '--diff-filter=U', '-z',
    ]).stdout),
  };
}

function inventoryIgnored(worktree) {
  return parseNul(git(worktree, [
    'ls-files', '--others', '--ignored', '--exclude-standard', '-z',
  ]).stdout);
}

function operationInProgress(worktree) {
  for (const marker of [
    'MERGE_HEAD',
    'CHERRY_PICK_HEAD',
    'REVERT_HEAD',
    'BISECT_LOG',
    'rebase-merge',
    'rebase-apply',
  ]) {
    const markerPath = git(worktree, ['rev-parse', '--git-path', marker]).stdout.trim();
    if (fs.existsSync(path.resolve(worktree, markerPath))) return marker;
  }
  return null;
}

function normalizedPaths(value) {
  if (!Array.isArray(value)) return null;
  const paths = value.map((item) => {
    if (typeof item !== 'string'
        || item.length === 0
        || path.isAbsolute(item)
        || item.split('/').includes('..')
        || item.includes('\0')) {
      return null;
    }
    return item.replace(/\\/g, '/');
  });
  if (paths.includes(null) || new Set(paths).size !== paths.length) return null;
  return paths.sort();
}

function sameInventory(left, right) {
  return ['staged', 'unstaged', 'untracked', 'ambiguous'].every((key) =>
    Array.isArray(left && left[key])
    && Array.isArray(right && right[key])
    && JSON.stringify([...left[key]].sort()) === JSON.stringify([...right[key]].sort()));
}

function incomingPaths(repo, targetSha, sourceSha) {
  const base = git(repo, ['merge-base', targetSha, sourceSha], { allowFailure: true });
  if (base.status !== 0) return null;
  return parseNul(git(repo, [
    'diff', '--name-only', '-z', base.stdout.trim(), sourceSha,
  ]).stdout);
}

function isAncestor(repo, ancestor, descendant) {
  return git(repo, [
    'merge-base', '--is-ancestor', ancestor, descendant,
  ], { allowFailure: true }).status === 0;
}

function digestBuffer(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function snapshotPath(worktree, relativePath) {
  const absolute = path.resolve(worktree, relativePath);
  if (absolute !== worktree && !absolute.startsWith(`${worktree}${path.sep}`)) {
    throw new Error(`unsafe preservation path: ${relativePath}`);
  }
  const indexRaw = git(worktree, [
    'ls-files', '--stage', '-z', '--', relativePath,
  ]).stdout;
  const indexLine = indexRaw.split('\0').find(Boolean) || null;
  let index = null;
  if (indexLine) {
    const match = /^([0-7]{6}) ([0-9a-f]+) ([0-3])\t/.exec(indexLine);
    if (!match || match[3] !== '0') {
      throw new Error(`cannot preserve non-stage-0 index entry: ${relativePath}`);
    }
    const content = git(worktree, ['show', `:${relativePath}`], {
      encoding: null,
    }).stdout;
    index = {
      mode: match[1],
      content,
      digest: digestBuffer(content),
    };
  }
  let worktreeEntry = null;
  try {
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) {
      worktreeEntry = {
        type: 'symlink',
        content: Buffer.from(fs.readlinkSync(absolute)),
        mode: stat.mode,
      };
    } else if (stat.isFile()) {
      worktreeEntry = {
        type: 'file',
        content: fs.readFileSync(absolute),
        mode: stat.mode,
      };
    } else {
      throw new Error(`preservation path is not a file or symlink: ${relativePath}`);
    }
    worktreeEntry.digest = digestBuffer(worktreeEntry.content);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return { path: relativePath, absolute, index, worktree: worktreeEntry };
}

function removeExactPath(absolute) {
  try {
    const stat = fs.lstatSync(absolute);
    if (stat.isDirectory() && !stat.isSymbolicLink()) {
      throw new Error(`refusing to remove directory preservation target: ${absolute}`);
    }
    fs.unlinkSync(absolute);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function cleanSnapshot(worktree, snapshot) {
  git(worktree, ['reset', '-q', 'HEAD', '--', snapshot.path]);
  const trackedAtHead = git(worktree, [
    'cat-file', '-e', `HEAD:${snapshot.path}`,
  ], { allowFailure: true }).status === 0;
  if (trackedAtHead) {
    git(worktree, ['checkout', '-q', 'HEAD', '--', snapshot.path]);
  } else {
    removeExactPath(snapshot.absolute);
  }
}

function restoreSnapshot(worktree, snapshot) {
  if (snapshot.index) {
    const oid = git(worktree, ['hash-object', '-w', '--stdin'], {
      input: snapshot.index.content,
      encoding: null,
    }).stdout.toString().trim();
    git(worktree, [
      'update-index', '--add', '--cacheinfo',
      `${snapshot.index.mode},${oid},${snapshot.path}`,
    ]);
  } else {
    git(worktree, [
      'update-index', '--force-remove', '--', snapshot.path,
    ]);
  }

  removeExactPath(snapshot.absolute);
  if (snapshot.worktree) {
    fs.mkdirSync(path.dirname(snapshot.absolute), { recursive: true });
    if (snapshot.worktree.type === 'symlink') {
      fs.symlinkSync(snapshot.worktree.content.toString(), snapshot.absolute);
    } else {
      fs.writeFileSync(snapshot.absolute, snapshot.worktree.content);
      fs.chmodSync(snapshot.absolute, snapshot.worktree.mode);
    }
  }
}

function restoreSnapshots(worktree, snapshots) {
  let restored = true;
  for (const snapshot of [...snapshots].reverse()) {
    try {
      restoreSnapshot(worktree, snapshot);
    } catch (_error) {
      restored = false;
    }
  }
  return restored && snapshots.every((item) => verifySnapshot(worktree, item));
}

function verifySnapshot(worktree, snapshot) {
  const current = snapshotPath(worktree, snapshot.path);
  const indexMatches = (!snapshot.index && !current.index)
    || (snapshot.index && current.index
      && snapshot.index.mode === current.index.mode
      && snapshot.index.digest === current.index.digest);
  const worktreeMatches = (!snapshot.worktree && !current.worktree)
    || (snapshot.worktree && current.worktree
      && snapshot.worktree.type === current.worktree.type
      && snapshot.worktree.mode === current.worktree.mode
      && snapshot.worktree.digest === current.worktree.digest);
  return Boolean(indexMatches && worktreeMatches);
}

function dirtyProof(worktree, dirty) {
  const paths = [...new Set([
    ...dirty.staged,
    ...dirty.unstaged,
    ...dirty.untracked,
    ...dirty.ambiguous,
  ])].sort();
  return paths.map((relativePath) => {
    const snapshot = snapshotPath(worktree, relativePath);
    return {
      path: relativePath,
      index: snapshot.index
        ? { mode: snapshot.index.mode, digest: snapshot.index.digest }
        : null,
      worktree: snapshot.worktree
        ? {
          type: snapshot.worktree.type,
          mode: snapshot.worktree.mode,
          digest: snapshot.worktree.digest,
        }
        : null,
    };
  });
}

function sealReceipt(body) {
  return { ...body, receipt_digest: canonicalDigest(body) };
}

function verifyMergeExecutionReceipt(receipt) {
  if (!isPlainObject(receipt)
      || receipt.schema_version !== SCHEMA_VERSION
      || receipt.artifact_type !== ARTIFACT_TYPE
      || typeof receipt.receipt_digest !== 'string') {
    return false;
  }
  const { receipt_digest: digest, ...body } = receipt;
  return /^[0-9a-f]{64}$/.test(digest) && canonicalDigest(body) === digest;
}

function halted(manifestSeal, rootRunId, edges, reason, haltEdge = null) {
  return sealReceipt({
    schema_version: SCHEMA_VERSION,
    artifact_type: ARTIFACT_TYPE,
    manifest_seal: typeof manifestSeal === 'string' ? manifestSeal : null,
    root_run_id: typeof rootRunId === 'string' ? rootRunId : null,
    status: 'halted',
    halt_reason: reason,
    halt_edge: haltEdge,
    edges,
  });
}

function validatePreflight(preflight, manifestSeal, manifest) {
  if (!isPlainObject(preflight) || typeof preflight.receipt_digest !== 'string') {
    return 'preflight_missing';
  }
  const { receipt_digest: digest, ...body } = preflight;
  if (canonicalDigest(body) !== digest) return 'preflight_receipt_drift';
  if (preflight.manifest_seal !== manifestSeal) return 'preflight_manifest_mismatch';
  if (!['safe', 'overlapping'].includes(preflight.status)
      || !Array.isArray(preflight.blockers)
      || preflight.blockers.length > 0
      || !Array.isArray(preflight.edges)
      || preflight.edges.length !== manifest.edges.length) {
    return 'preflight_not_executable';
  }
  return null;
}

function normalizeApprovals(value, preflight) {
  if (!Array.isArray(value)) return null;
  const bySequence = new Map();
  for (const item of value) {
    if (!isPlainObject(item)
        || !Number.isInteger(item.edge_sequence)
        || bySequence.has(item.edge_sequence)) {
      return null;
    }
    const paths = normalizedPaths(item.paths);
    if (!paths) return null;
    bySequence.set(item.edge_sequence, paths);
  }
  for (const report of preflight.edges) {
    const proposed = normalizedPaths(report.preservation_proposal);
    if (!proposed) return null;
    const approved = bySequence.get(report.sequence) || [];
    if (JSON.stringify(proposed) !== JSON.stringify(approved)) return null;
    if (approved.length === 0) bySequence.delete(report.sequence);
  }
  if ([...bySequence.keys()].some((sequence) =>
    !preflight.edges.some((edge) => edge.sequence === sequence))) {
    return null;
  }
  return new Map(preflight.edges.map((edge) => [
    edge.sequence,
    normalizedPaths(edge.preservation_proposal),
  ]));
}

function endpointExpectation(edge, side, receipts) {
  const fromEdge = edge[`${side}_from_edge`];
  if (fromEdge === null) {
    return { expectedSha: edge[`${side}_sha`], fromEdge: null };
  }
  const predecessor = receipts.find((item) => item.sequence === fromEdge);
  if (!predecessor
      || predecessor.status !== 'executed'
      || predecessor.target_ref !== edge[`${side}_ref`]
      || !verifyEdgeReceipt(predecessor)) {
    return null;
  }
  return { expectedSha: predecessor.after_sha, fromEdge };
}

function edgeReceiptDigest(receipt) {
  const { edge_receipt_digest: _ignored, ...body } = receipt;
  return canonicalDigest(body);
}

function sealEdgeReceipt(receipt) {
  return { ...receipt, edge_receipt_digest: canonicalDigest(receipt) };
}

function verifyEdgeReceipt(receipt) {
  return isPlainObject(receipt)
    && typeof receipt.edge_receipt_digest === 'string'
    && edgeReceiptDigest(receipt) === receipt.edge_receipt_digest;
}

function validateEndpoint(edge, side, receipts) {
  const expectation = endpointExpectation(edge, side, receipts);
  if (!expectation) return { error: `${side}_predecessor_receipt_invalid` };
  const ref = edge[`${side}_ref`];
  const worktree = edge[`${side}_worktree`];
  const actualSha = resolveRef(worktree, ref);
  const headSha = resolveHead(worktree);
  if (actualSha !== expectation.expectedSha) {
    return { error: `${side}_sha_drift` };
  }
  if (headSha !== expectation.expectedSha) {
    return { error: `${side}_worktree_drift` };
  }
  return {
    ref,
    expected_sha: expectation.expectedSha,
    actual_sha: actualSha,
    from_edge: expectation.fromEdge,
  };
}

function validateInitialState(manifest, preflight) {
  for (const edge of manifest.edges) {
    const operation = operationInProgress(edge.target_worktree);
    if (operation) {
      return { reason: `target_operation_in_progress_${operation.toLowerCase()}`, edge: edge.sequence };
    }
    for (const side of ['source', 'target']) {
      if (!validateWorktreeBinding(manifest.repo, edge[`${side}_worktree`])) {
        return { reason: `initial_${side}_worktree_repo_binding_drift`, edge: edge.sequence };
      }
      const actual = resolveRef(edge[`${side}_worktree`], edge[`${side}_ref`]);
      if (actual !== edge[`${side}_sha`]) {
        return { reason: `initial_${side}_sha_drift`, edge: edge.sequence };
      }
      if (resolveHead(edge[`${side}_worktree`]) !== edge[`${side}_sha`]) {
        return { reason: `initial_${side}_worktree_drift`, edge: edge.sequence };
      }
    }
    if (symbolicHead(edge.target_worktree) !== edge.target_ref) {
      return { reason: 'target_worktree_not_on_declared_ref', edge: edge.sequence };
    }
    const report = preflight.edges.find((item) => item.sequence === edge.sequence);
    if (!report || !sameInventory(inventoryDirty(edge.target_worktree), report.dirty)) {
      return { reason: 'initial_dirty_inventory_drift', edge: edge.sequence };
    }
  }
  return null;
}

function collidingPaths(incoming, dirty, ignored) {
  const candidates = [...new Set([
    ...dirty.staged,
    ...dirty.unstaged,
    ...dirty.untracked,
    ...dirty.ambiguous,
    ...ignored,
  ])];
  return candidates.filter((localPath) => incoming.some((incomingPath) =>
    localPath !== incomingPath
    && (localPath.startsWith(`${incomingPath}/`)
      || incomingPath.startsWith(`${localPath}/`)))).sort();
}

function executeMergeIntent(request) {
  if (isPlainObject(request)
      && isPlainObject(request.sealed)
      && !Object.prototype.hasOwnProperty.call(request, 'sealed_manifest')) {
    request = {
      ...request,
      sealed_manifest: request.sealed,
      manifest_seal: request.sealed.seal,
      approved_preservation: Array.isArray(request.preflight && request.preflight.edges)
        ? request.preflight.edges
          .filter((edge) =>
            Array.isArray(edge.preservation_proposal) && edge.preservation_proposal.length > 0)
          .map((edge) => ({
            edge_sequence: edge.sequence,
            paths: edge.preservation_proposal,
          }))
        : [],
    };
  }
  if (!isPlainObject(request)
      || !isPlainObject(request.sealed_manifest)
      || !isPlainObject(request.sealed_manifest.manifest)) {
    return halted(null, null, [], 'execution_request_invalid');
  }
  const sealed = request.sealed_manifest;
  const manifest = sealed.manifest;
  if (!verifyMergeIntentSeal(sealed)) {
    return halted(sealed.seal, manifest.root_run_id, [], 'manifest_seal_invalid');
  }
  if (request.manifest_seal !== sealed.seal) {
    return halted(sealed.seal, manifest.root_run_id, [], 'manifest_seal_mismatch');
  }
  const preflightError = validatePreflight(request.preflight, sealed.seal, manifest);
  if (preflightError) {
    return halted(sealed.seal, manifest.root_run_id, [], preflightError);
  }
  const approvals = normalizeApprovals(request.approved_preservation, request.preflight);
  if (!approvals) {
    return halted(sealed.seal, manifest.root_run_id, [], 'preservation_approval_mismatch');
  }
  const initialError = validateInitialState(manifest, request.preflight);
  if (initialError) {
    return halted(
      sealed.seal,
      manifest.root_run_id,
      [],
      initialError.reason,
      initialError.edge,
    );
  }
  const initialDirtyProof = new Map();
  for (const edge of manifest.edges) {
    if (!initialDirtyProof.has(edge.target_worktree)) {
      const dirty = inventoryDirty(edge.target_worktree);
      initialDirtyProof.set(
        edge.target_worktree,
        canonicalDigest(dirtyProof(edge.target_worktree, dirty)),
      );
    }
  }

  const receipts = [];
  for (const edge of manifest.edges) {
    for (const side of ['source', 'target']) {
      if (!validateWorktreeBinding(manifest.repo, edge[`${side}_worktree`])) {
        return halted(
          sealed.seal,
          manifest.root_run_id,
          receipts,
          `${side}_worktree_repo_binding_drift`,
          edge.sequence,
        );
      }
    }
    const sourceValidation = validateEndpoint(edge, 'source', receipts);
    if (sourceValidation.error) {
      return halted(
        sealed.seal, manifest.root_run_id, receipts, sourceValidation.error, edge.sequence,
      );
    }
    const targetValidation = validateEndpoint(edge, 'target', receipts);
    if (targetValidation.error) {
      return halted(
        sealed.seal, manifest.root_run_id, receipts, targetValidation.error, edge.sequence,
      );
    }
    if (symbolicHead(edge.target_worktree) !== edge.target_ref) {
      return halted(
        sealed.seal, manifest.root_run_id, receipts,
        'target_worktree_not_on_declared_ref', edge.sequence,
      );
    }
    const report = request.preflight.edges.find((item) => item.sequence === edge.sequence);
    const dirtyBefore = inventoryDirty(edge.target_worktree);
    if (!sameInventory(dirtyBefore, report.dirty)) {
      return halted(
        sealed.seal, manifest.root_run_id, receipts, 'dirty_inventory_drift', edge.sequence,
      );
    }
    if (canonicalDigest(dirtyProof(edge.target_worktree, dirtyBefore))
        !== initialDirtyProof.get(edge.target_worktree)) {
      return halted(
        sealed.seal, manifest.root_run_id, receipts,
        'dirty_content_or_index_drift', edge.sequence,
      );
    }
    const incoming = incomingPaths(
      manifest.repo,
      targetValidation.expected_sha,
      sourceValidation.expected_sha,
    );
    if (!incoming) {
      return halted(
        sealed.seal, manifest.root_run_id, receipts, 'incoming_inventory_failed', edge.sequence,
      );
    }
    const dirtyPaths = new Set([
      ...dirtyBefore.staged,
      ...dirtyBefore.unstaged,
      ...dirtyBefore.untracked,
      ...dirtyBefore.ambiguous,
    ]);
    const overlap = [...dirtyPaths].filter((item) => incoming.includes(item)).sort();
    const approved = approvals.get(edge.sequence) || [];
    const ignored = inventoryIgnored(edge.target_worktree);
    const ignoredOverlap = ignored.filter((item) => incoming.includes(item));
    const prefixCollisions = collidingPaths(incoming, dirtyBefore, ignored);
    if (ignoredOverlap.length > 0 || prefixCollisions.length > 0) {
      return halted(
        sealed.seal, manifest.root_run_id, receipts,
        'ignored_or_path_prefix_collision', edge.sequence,
      );
    }
    if (JSON.stringify(overlap) !== JSON.stringify(approved)) {
      return halted(
        sealed.seal, manifest.root_run_id, receipts,
        'dynamic_preservation_overlap_mismatch', edge.sequence,
      );
    }
    if (approved.some((item) => dirtyBefore.untracked.includes(item))) {
      return halted(
        sealed.seal, manifest.root_run_id, receipts,
        'untracked_overlap_not_exactly_restorable', edge.sequence,
      );
    }
    if (edge.mode === 'ff-only'
        && !isAncestor(manifest.repo, targetValidation.expected_sha, sourceValidation.expected_sha)) {
      return halted(
        sealed.seal, manifest.root_run_id, receipts, 'ff_only_not_possible', edge.sequence,
      );
    }

    const protectedPaths = [...dirtyPaths].sort();
    let snapshots;
    const cleaned = [];
    try {
      snapshots = protectedPaths.map((item) => snapshotPath(edge.target_worktree, item));
      for (const snapshot of snapshots) {
        cleanSnapshot(edge.target_worktree, snapshot);
        cleaned.push(snapshot);
      }
    } catch (_error) {
      const restoredAfterFailure = restoreSnapshots(edge.target_worktree, cleaned);
      return halted(
        sealed.seal,
        manifest.root_run_id,
        receipts,
        restoredAfterFailure
          ? 'preservation_snapshot_failed'
          : 'preservation_snapshot_recovery_required',
        edge.sequence,
      );
    }

    const beforeSha = targetValidation.expected_sha;
    const mergeArgs = edge.mode === 'no-ff'
      ? ['merge', '--no-ff', '--no-edit', sourceValidation.expected_sha]
      : ['merge', '--ff-only', sourceValidation.expected_sha];
    const merge = git(edge.target_worktree, mergeArgs, { allowFailure: true });
    const conflicts = parseNul(git(edge.target_worktree, [
      'diff', '--name-only', '--diff-filter=U', '-z',
    ], { allowFailure: true }).stdout || '');
    if (merge.status !== 0) {
      git(edge.target_worktree, ['merge', '--abort'], { allowFailure: true });
      const conflictRestored = restoreSnapshots(edge.target_worktree, snapshots);
      const mergeRolledBack = resolveRef(edge.target_worktree, edge.target_ref) === beforeSha
        && resolveHead(edge.target_worktree) === beforeSha
        && operationInProgress(edge.target_worktree) === null;
      const recoveryComplete = conflictRestored && mergeRolledBack;
      const edgeReceipt = sealEdgeReceipt({
        sequence: edge.sequence,
        source_ref: edge.source_ref,
        target_ref: edge.target_ref,
        mode: edge.mode,
        status: 'halted',
        source_validation: sourceValidation,
        target_validation: targetValidation,
        before_sha: beforeSha,
        after_sha: resolveRef(edge.target_worktree, edge.target_ref),
        merge_commit: null,
        conflicts,
        error: String(merge.stderr || merge.error || merge.signal || '').trim() || null,
        preservation: {
          approved_paths: approved,
          protected_paths: protectedPaths,
          action: protectedPaths.length > 0 ? 'path_snapshot_restore' : 'none',
          restored: recoveryComplete,
          verification: recoveryComplete ? 'exact' : 'failed',
        },
      });
      receipts.push(edgeReceipt);
      return halted(
        sealed.seal,
        manifest.root_run_id,
        receipts,
        recoveryComplete ? 'merge_failed' : 'merge_failed_recovery_required',
        edge.sequence,
      );
    }

    if (!restoreSnapshots(edge.target_worktree, snapshots)) {
      receipts.push(sealEdgeReceipt({
        sequence: edge.sequence,
        source_ref: edge.source_ref,
        target_ref: edge.target_ref,
        mode: edge.mode,
        status: 'halted',
        source_validation: sourceValidation,
        target_validation: targetValidation,
        before_sha: beforeSha,
        after_sha: resolveRef(edge.target_worktree, edge.target_ref),
        merge_commit: null,
        conflicts,
        error: 'preservation restore failed',
        preservation: {
          approved_paths: approved,
          protected_paths: protectedPaths,
          action: protectedPaths.length > 0 ? 'path_snapshot_restore' : 'none',
          restored: false,
          verification: 'failed',
        },
      }));
      return halted(
        sealed.seal, manifest.root_run_id, receipts, 'preservation_restore_failed', edge.sequence,
      );
    }
    const afterSha = resolveRef(edge.target_worktree, edge.target_ref);
    const restored = snapshots.every((item) => verifySnapshot(edge.target_worktree, item))
      && sameInventory(inventoryDirty(edge.target_worktree), dirtyBefore);
    const mergeCommit = edge.mode === 'no-ff' ? afterSha : null;
    const graphValid = afterSha !== null
      && isAncestor(manifest.repo, sourceValidation.expected_sha, afterSha)
      && (edge.mode !== 'no-ff'
        || (git(manifest.repo, ['rev-parse', `${afterSha}^1`]).stdout.trim() === beforeSha
          && isAncestor(
            manifest.repo,
            sourceValidation.expected_sha,
            git(manifest.repo, ['rev-parse', `${afterSha}^2`]).stdout.trim(),
          )));
    const resultValid = graphValid && restored && conflicts.length === 0;
    const edgeReceipt = sealEdgeReceipt({
      sequence: edge.sequence,
      source_ref: edge.source_ref,
      target_ref: edge.target_ref,
      mode: edge.mode,
      status: resultValid ? 'executed' : 'halted',
      source_validation: sourceValidation,
      target_validation: targetValidation,
      before_sha: beforeSha,
      after_sha: afterSha,
      merge_commit: mergeCommit,
      conflicts,
      error: null,
      preservation: {
        approved_paths: approved,
        protected_paths: protectedPaths,
        action: protectedPaths.length > 0 ? 'path_snapshot_restore' : 'none',
        restored,
        verification: restored ? 'exact' : 'failed',
      },
    });
    receipts.push(edgeReceipt);
    if (!resultValid) {
      const reason = !restored
        ? 'preservation_verification_failed'
        : (edge.mode === 'no-ff'
          ? 'predecessor_source_drift_after_merge'
          : 'merge_result_verification_failed');
      return halted(sealed.seal, manifest.root_run_id, receipts, reason, edge.sequence);
    }
  }
  return sealReceipt({
    schema_version: SCHEMA_VERSION,
    artifact_type: ARTIFACT_TYPE,
    manifest_seal: request.manifest_seal,
    root_run_id: manifest.root_run_id,
    status: 'complete',
    halt_reason: null,
    halt_edge: null,
    edges: receipts,
  });
}

function runMergeCli(args, io = {}) {
  const stdout = io.stdout || process.stdout;
  const stderr = io.stderr || process.stderr;
  if (args[0] !== 'execute') {
    stderr.write('Usage: autopilot merge execute --request <file> [--json]\n');
    return 2;
  }
  let requestFile = null;
  for (let index = 1; index < args.length; index += 1) {
    if (args[index] === '--request' && args[index + 1]) {
      requestFile = args[index + 1];
      index += 1;
    } else if (args[index] !== '--json') {
      stderr.write(`ERROR: unknown merge execute option: ${args[index]}\n`);
      return 2;
    }
  }
  if (!requestFile) {
    stderr.write('ERROR: merge execute requires --request <file>\n');
    return 2;
  }
  let request;
  try {
    request = JSON.parse(fs.readFileSync(path.resolve(requestFile), 'utf8'));
  } catch (error) {
    stderr.write(`ERROR: cannot read merge execution request: ${error.message}\n`);
    return 2;
  }
  const receipt = executeMergeIntent(request);
  stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  return receipt.status === 'complete' ? 0 : 1;
}

module.exports = {
  ARTIFACT_TYPE,
  SCHEMA_VERSION,
  executeMergeIntent,
  runMergeCli,
  verifyMergeExecutionReceipt,
};
