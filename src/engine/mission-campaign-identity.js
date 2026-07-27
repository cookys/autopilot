'use strict';

// Mission campaign identity helpers (mission-subject-v2).
//
// Separates:
//   * raw contract_sha256 — final-byte provenance / drift seal
//   * mission_subject_digest — domain-separated digest over the full campaign
//     contract projection EXCLUDING only mission_grant_ref (stable under
//     grant-ref insertion)
//   * campaign-v2 id — derived from repo + ticket + subject (not raw bytes)
//
// Reuses the engine's existing canonical JSON primitive; does not invent a
// second serialization.

const crypto = require('crypto');
const { canonicalJson } = require('./authenticated-control');

const SUBJECT_DOMAIN = 'autopilot/mission-campaign-subject/v2';
const CAMPAIGN_ID_DOMAIN = 'autopilot/mission-campaign-id/v2';
const IDENTITY_SCHEME_V2 = 'mission-subject-v2';

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value);
}

function isSha256(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function domainSha256(domain, payload) {
  return crypto.createHash('sha256')
    .update(domain, 'utf8')
    .update('\0', 'utf8')
    .update(payload, 'utf8')
    .digest('hex');
}

/**
 * Full campaign-contract projection used for mission-subject-v2 identity.
 * Excludes only mission_grant_ref so inserting a grant ref does not change
 * the subject. All other fields participate.
 */
function projectMissionCampaignSubject(contract) {
  if (!isPlainObject(contract)) {
    throw new TypeError('missionSubjectDigest requires a plain campaign contract object');
  }
  const projection = {};
  for (const key of Object.keys(contract)) {
    if (key === 'mission_grant_ref') continue;
    projection[key] = contract[key];
  }
  return projection;
}

/**
 * Domain-separated mission subject digest.
 * SHA256("autopilot/mission-campaign-subject/v2\\0" + canonicalJSON(projection))
 */
function missionSubjectDigest(contract) {
  const projection = projectMissionCampaignSubject(contract);
  return domainSha256(SUBJECT_DOMAIN, canonicalJson(projection));
}

/**
 * campaign-v2 id from repo identity, ticket, and subject digest.
 * Never accepts a caller-supplied campaign id or subject as authoritative —
 * callers must recompute.
 */
function missionCampaignIdFor(repoIdentity, ticket, subjectDigest) {
  if (typeof repoIdentity !== 'string' || repoIdentity.length === 0) {
    throw new TypeError('missionCampaignIdFor requires a non-empty repoIdentity');
  }
  if (typeof ticket !== 'string' || !/^[A-Za-z0-9._-]{1,128}$/.test(ticket)) {
    throw new TypeError('missionCampaignIdFor requires a ticket matching [A-Za-z0-9._-]{1,128}');
  }
  if (!isSha256(subjectDigest)) {
    throw new TypeError('missionCampaignIdFor requires a lowercase SHA-256 subject digest');
  }
  const encoded = canonicalJson({
    repo_identity: repoIdentity,
    ticket,
    mission_subject_digest: subjectDigest,
  });
  return `campaign-v2-${domainSha256(CAMPAIGN_ID_DOMAIN, encoded)}`;
}

function isMissionSubjectV2Claim(claimOrPayload) {
  if (!isPlainObject(claimOrPayload)) return false;
  if (claimOrPayload.identity_scheme === IDENTITY_SCHEME_V2) return true;
  return typeof claimOrPayload.campaign_id === 'string'
    && /^campaign-v2-[0-9a-f]{64}$/.test(claimOrPayload.campaign_id)
    && (typeof claimOrPayload.mission_subject_digest === 'string'
      || typeof claimOrPayload.campaign_contract_digest === 'string');
}

function claimMissionSubjectDigest(claimOrPayload) {
  if (!isPlainObject(claimOrPayload)) return null;
  if (typeof claimOrPayload.mission_subject_digest === 'string'
      && isSha256(claimOrPayload.mission_subject_digest)) {
    return claimOrPayload.mission_subject_digest;
  }
  // v2 may store subject under the campaign_contract_digest compatibility alias
  if (typeof claimOrPayload.campaign_contract_digest === 'string'
      && isSha256(claimOrPayload.campaign_contract_digest)) {
    return claimOrPayload.campaign_contract_digest;
  }
  return null;
}

module.exports = {
  IDENTITY_SCHEME_V2,
  claimMissionSubjectDigest,
  isMissionSubjectV2Claim,
  missionCampaignIdFor,
  missionSubjectDigest,
  projectMissionCampaignSubject,
};
