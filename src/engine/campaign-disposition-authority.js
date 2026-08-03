'use strict';

const fs = require('fs');
const { normalizeDispositionAuthority } = require('./campaign-adjudication');

const AUTHORITY_KEYS = new Set([
  'schema_version',
  'artifact_type',
  'authority',
  'actor_id',
  'campaign_id',
  'contract_digest',
  'reviews',
]);
const REVIEW_KEYS = new Set(['review_digest', 'decisions']);
const DECISION_KEYS = new Set(['finding_id', 'evidence', 'disposition']);

function exactKeys(value, keys) {
  return Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.keys(value).length === keys.size
    && Object.keys(value).every((key) => keys.has(key));
}

function validateCampaignDispositionAuthority(value) {
  if (!exactKeys(value, AUTHORITY_KEYS)
      || value.schema_version !== 1
      || value.artifact_type !== 'campaign_disposition_authority'
      || typeof value.actor_id !== 'string'
      || value.actor_id.length === 0
      || typeof value.campaign_id !== 'string'
      || !/^campaign-v1-[0-9a-f]{64}$/.test(value.campaign_id)
      || typeof value.contract_digest !== 'string'
      || !/^[0-9a-f]{64}$/.test(value.contract_digest)
      || !Array.isArray(value.reviews)
      || value.reviews.length === 0) {
    throw new Error('campaign disposition authority has an invalid identity or shape');
  }
  if (value.authority !== 'depth-0') {
    throw new Error(
      'campaign disposition authority files must be authored by depth-0; deterministic policy must use the explicit policy rail',
    );
  }
  const seenReviews = new Set();
  for (const review of value.reviews) {
    if (!exactKeys(review, REVIEW_KEYS)
        || typeof review.review_digest !== 'string'
        || !/^[0-9a-f]{64}$/.test(review.review_digest)
        || !Array.isArray(review.decisions)) {
      throw new Error('campaign disposition authority contains an invalid review binding');
    }
    if (seenReviews.has(review.review_digest)) {
      throw new Error(`campaign disposition authority duplicates review ${review.review_digest}`);
    }
    seenReviews.add(review.review_digest);
    const seenFindings = new Set();
    for (const decision of review.decisions) {
      if (!exactKeys(decision, DECISION_KEYS)
          || typeof decision.finding_id !== 'string'
          || !/^[A-Za-z0-9._:-]{1,128}$/.test(decision.finding_id)
          || !decision.evidence
          || typeof decision.evidence !== 'object'
          || Array.isArray(decision.evidence)
          || (decision.disposition !== null
            && (typeof decision.disposition !== 'object'
              || Array.isArray(decision.disposition)))) {
        throw new Error('campaign disposition authority contains an invalid decision');
      }
      if (seenFindings.has(decision.finding_id)) {
        throw new Error(
          `campaign disposition authority duplicates ${decision.finding_id} in one review`,
        );
      }
      seenFindings.add(decision.finding_id);
    }
    normalizeDispositionAuthority({
      authority: value.authority,
      actor_id: value.actor_id,
      review_digest: review.review_digest,
      decisions: review.decisions,
    }, review.review_digest, review.decisions.map((decision) => ({
      finding_id: decision.finding_id,
    })));
  }
  return JSON.parse(JSON.stringify(value));
}

function loadCampaignDispositionAuthority(file) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`campaign disposition authority is unreadable: ${error.message}`);
  }
  return validateCampaignDispositionAuthority(parsed);
}

function reviewFindingIds(review) {
  if (!review || typeof review.findings !== 'string') {
    throw new Error('campaign review findings are unavailable for disposition binding');
  }
  if (review.findings.trim().length === 0) return [];
  let findings;
  try {
    findings = JSON.parse(review.findings);
  } catch (_error) {
    throw new Error('campaign review findings must be normalized before disposition binding');
  }
  if (!Array.isArray(findings)) {
    throw new Error('campaign review findings must be a normalized array');
  }
  return findings.map((finding) => {
    if (!finding || typeof finding.finding_id !== 'string') {
      throw new Error('campaign review finding identity is invalid');
    }
    return finding.finding_id;
  });
}

function reviewFindings(review) {
  const ids = reviewFindingIds(review);
  if (ids.length === 0) return [];
  const findings = JSON.parse(review.findings);
  return findings.map((finding, index) => {
    if (typeof finding.claim !== 'string' || finding.claim.trim().length === 0) {
      throw new Error(`campaign review finding ${ids[index]} has no claim`);
    }
    return finding;
  });
}

function normalizeAcceptanceText(value) {
  return String(value).trim().replace(/\s+/gu, ' ').toLowerCase();
}

function compileCampaignDispositionProvider(rawAuthority) {
  const authority = validateCampaignDispositionAuthority(rawAuthority);
  const reviews = new Map(authority.reviews.map((review) => [
    review.review_digest,
    new Map(review.decisions.map((item) => [item.finding_id, item])),
  ]));
  return ({ review, campaignId, contractDigest }) => {
    if (campaignId !== authority.campaign_id) {
      throw new Error('campaign disposition authority campaign identity is stale');
    }
    if (contractDigest !== authority.contract_digest) {
      throw new Error('campaign disposition authority contract digest is stale');
    }
    const findingIds = reviewFindingIds(review);
    if (findingIds.length === 0) return null;
    if (!review || !/^[0-9a-f]{64}$/.test(review.review_digest || '')) {
      throw new Error('campaign disposition authority requires a bound review digest');
    }
    const decisions = reviews.get(review.review_digest);
    if (!decisions) {
      throw new Error('campaign disposition authority review digest is stale');
    }
    if (decisions.size !== findingIds.length) {
      throw new Error('campaign disposition authority review decision set is stale');
    }
    const selected = findingIds.map((findingId) => {
      const decision = decisions.get(findingId);
      if (!decision) {
        throw new Error(`campaign disposition authority is missing ${findingId}`);
      }
      return JSON.parse(JSON.stringify(decision));
    });
    return {
      authority: authority.authority,
      actor_id: authority.actor_id,
      review_digest: review.review_digest,
      decisions: selected,
    };
  };
}

function compileCampaignDispositionPolicy(name) {
  if (!new Set(['deny-nonempty', 'acceptance-bound']).has(name)) {
    throw new Error(`unknown campaign disposition policy: ${name}`);
  }
  if (name === 'deny-nonempty') return ({ review }) => {
    if (reviewFindingIds(review).length > 0) {
      throw new Error('deny-nonempty policy refuses reviewer-authored disposition authority');
    }
    return null;
  };
  return ({ review, contract }) => {
    const findings = reviewFindings(review);
    if (findings.length === 0) return null;
    if (!review || !/^[0-9a-f]{64}$/.test(review.review_digest || '')
        || !contract || !Array.isArray(contract.vertical_acceptance)) {
      throw new Error('acceptance-bound policy requires a bound review and sealed acceptance');
    }
    const acceptance = contract.vertical_acceptance.map(normalizeAcceptanceText);
    const matched = findings.map((finding) => {
      const claim = normalizeAcceptanceText(finding.claim);
      return acceptance.findIndex((criterion) => criterion === claim);
    });
    if (matched.some((acceptanceIndex) => acceptanceIndex < 0)) {
      throw new Error(
        'acceptance-bound policy requires explicit depth-0 authority for every non-exact finding',
      );
    }
    return {
      authority: 'deterministic-policy',
      actor_id: 'policy:acceptance-bound',
      review_digest: review.review_digest,
      decisions: findings.map((finding, findingIndex) => {
        const acceptanceIndex = matched[findingIndex];
        return {
          finding_id: finding.finding_id,
          evidence: {
            kind: 'trace',
            trace_chain: [`contract.vertical_acceptance[${acceptanceIndex}]`],
            confirmed_by: 'policy:acceptance-bound',
          },
          disposition: {
            disposition: 'must-fix-now',
            acceptance_id: `vertical_acceptance[${acceptanceIndex}]`,
            deferral_harm: 'deferral would leave an explicit frozen acceptance criterion unsatisfied',
          },
        };
      }),
    };
  };
}

module.exports = {
  compileCampaignDispositionPolicy,
  compileCampaignDispositionProvider,
  loadCampaignDispositionAuthority,
  validateCampaignDispositionAuthority,
};
