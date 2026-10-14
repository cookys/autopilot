'use strict';

// BL-0090 P5: the `repair` disposition of a parked review-only campaign. The review-only campaign
// ends not-ready (the range did not pass) and this module builds the hand-off: a draft
// `implement-review` contract plus a task prompt that the CALLER seals and runs as a normal
// campaign. Nothing here touches git_candidate, the writer fence or repair lineage (D11, D12):
// the writer that later runs is an ordinary implement-review writer on top of the reviewed head.
const fs = require('fs');
const path = require('path');

const SCHEMA_PATH = path.resolve(__dirname, '..', '..', 'schemas', 'implementation-campaign-contract.schema.json');
// Fields the seed sets itself; everything else (paths, verify, caps, wall, profile ...) comes from
// the adoption contract unchanged.
const SEEDED_FIELDS = new Set(['adoption', 'ticket', 'branch', 'base_sha', 'max_repair_generations']);
// Fields that must survive the copy byte-for-byte: a drift here means the seed no longer carries the
// adoption contract's scope or verification.
const BOUND_FIELDS = ['allowed_path_prefixes', 'verify_cmd', 'vertical_acceptance', 'rubric_ids', 'repo_identity', 'profile'];

class RepairSeedError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'RepairSeedError';
    this.code = code;
  }
}

function repairCeiling(profile) {
  try {
    const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
    const ceiling = schema['x-profile-repair-ceilings'][profile];
    return Number.isSafeInteger(ceiling) ? ceiling : 1;
  } catch (_error) {
    return 1;
  }
}

function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// Throws RepairSeedError with a named code when the seed is not a faithful repair of the reviewed range.
function validateRepairSeed({ seed, adoptionContract, reviewedHead }) {
  if (!seed || typeof seed !== 'object' || Array.isArray(seed)) {
    throw new RepairSeedError('review_candidate_repair_seed_invalid', 'seeded contract must be an object');
  }
  if (seed.base_sha !== reviewedHead) {
    throw new RepairSeedError(
      'review_candidate_repair_seed_base_mismatch',
      `seeded contract base ${seed.base_sha} is not the reviewed head ${reviewedHead}`,
    );
  }
  if (Object.prototype.hasOwnProperty.call(seed, 'adoption')) {
    throw new RepairSeedError(
      'review_candidate_repair_seed_has_adoption',
      'a seeded implement-review contract must not carry an adoption section',
    );
  }
  for (const field of BOUND_FIELDS) {
    if (!sameJson(seed[field], adoptionContract[field])) {
      throw new RepairSeedError(
        'review_candidate_repair_seed_binding_mismatch',
        `seeded contract ${field} differs from the adoption contract`,
      );
    }
  }
  if (!(Number.isSafeInteger(seed.max_repair_generations) && seed.max_repair_generations >= 1)) {
    throw new RepairSeedError(
      'review_candidate_repair_seed_invalid',
      'a seeded implement-review contract needs max_repair_generations >= 1',
    );
  }
  return true;
}

function renderTask({ findings, reviewedHead, base, branch, campaignId }) {
  const lines = [
    "# Repair task: a review-only campaign's findings (reviewer claims, not yet adjudicated by depth-0)",
    '',
    `The range ${base}..${reviewedHead} (external branch \`${branch}\`) was reviewed by campaign ${campaignId}`,
    'and did not pass. Choosing repair authorizes one repair round; it does not accept each finding.',
    'Every finding below is a reviewer claim. Verify each one against the code first, and fix only the',
    'ones that hold, on top of the reviewed head. List every finding you judge not to hold, with the',
    'reason, in your delivery. Do not widen scope beyond the sealed allowed path prefixes. The verify',
    'command of the contract must pass afterwards.',
    '',
    '## Findings',
    '',
  ];
  if (findings.length === 0) lines.push('(the review recorded no structured findings; read the campaign receipt)');
  findings.forEach((item, index) => {
    const id = item && item.finding_id ? `[${item.finding_id}] ` : '';
    const claim = item && item.claim ? item.claim : JSON.stringify(item);
    lines.push(`${index + 1}. ${id}${claim}`);
    if (item && typeof item === 'object') {
      for (const key of ['severity', 'path', 'file', 'line', 'evidence', 'fix']) {
        if (item[key] !== undefined && item[key] !== null && item[key] !== '') {
          lines.push(`   - ${key}: ${typeof item[key] === 'string' ? item[key] : JSON.stringify(item[key])}`);
        }
      }
    }
  });
  lines.push('');
  return lines.join('\n');
}

// Build the seeded contract and task prompt. Pure: no I/O besides reading the schema ceiling.
function buildRepairSeed({ adoptionContract, reviewedHead, findings, campaignId }) {
  if (!adoptionContract || !adoptionContract.adoption) {
    throw new RepairSeedError('review_candidate_repair_seed_invalid', 'an adoption contract is required');
  }
  const seed = {};
  for (const [key, value] of Object.entries(adoptionContract)) {
    if (!SEEDED_FIELDS.has(key)) seed[key] = value;
  }
  const suffix = '-repair';
  seed.ticket = `${adoptionContract.ticket.slice(0, 128 - suffix.length)}${suffix}`;
  seed.base_sha = reviewedHead;
  seed.branch = `repair/${seed.ticket}`;
  seed.max_repair_generations = Math.min(2, repairCeiling(adoptionContract.profile));
  validateRepairSeed({ seed, adoptionContract, reviewedHead });
  const list = Array.isArray(findings) ? findings : [];
  return {
    contract: seed,
    task_prompt: renderTask({
      findings: list,
      reviewedHead,
      base: adoptionContract.base_sha,
      branch: adoptionContract.branch,
      campaignId,
    }),
  };
}

// Write the seed next to the repository's other campaign state. Returns paths, or a named reason when
// the write failed (the inline copy in the result is then the only one).
function writeRepairSeed({ commonDir, campaignId, seed }) {
  if (!commonDir) return { contract_path: null, task_path: null, write_error: 'git_common_dir_unresolved' };
  try {
    const dir = path.join(commonDir, 'autopilot', 'review-candidate-repair', String(campaignId).replace(/[^A-Za-z0-9._-]/g, '_'));
    fs.mkdirSync(dir, { recursive: true });
    const contractPath = path.join(dir, 'contract.json');
    const taskPath = path.join(dir, 'task.md');
    fs.writeFileSync(contractPath, `${JSON.stringify(seed.contract, null, 2)}\n`);
    fs.writeFileSync(taskPath, seed.task_prompt);
    return { contract_path: contractPath, task_path: taskPath, write_error: null };
  } catch (error) {
    return { contract_path: null, task_path: null, write_error: error && error.message ? error.message : String(error) };
  }
}

module.exports = { RepairSeedError, buildRepairSeed, validateRepairSeed, writeRepairSeed };
