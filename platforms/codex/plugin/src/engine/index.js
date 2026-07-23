'use strict';

const {
  AutopilotEngine,
  buildImplementationArgs,
  buildReviewArgs,
  reviewLoopResultBlocked,
  reviewResultBlocked,
  validateImplementerRoster,
  validateExtraReviewArgs,
  validateExtraArgs,
  validateReviewRoster,
} = require('./autopilot-engine');

const {
  ENGINE_LIFECYCLE_OBSERVATION_SCHEMA_VERSION,
  OBSERVATION_DISCLOSURE,
  EngineLifecycleObservationSession,
  createEngineLifecycleObservationSession,
  normalizeEngineLifecycleObservationConfig,
} = require('./engine-lifecycle-observation');

const {
  resolveReviewLoop,
  resolveReviewLoopJson,
  parseReviewLoopOutput,
  validateReviewLoopConfig,
  findJsonObjectCandidates,
  looksLikeReviewLoopConfig,
  RESOLVE_REVIEW_LOOP,
} = require('./resolve-review-loop');

const ownerKernel = require('./owner-kernel');

module.exports = {
  AutopilotEngine,
  ENGINE_LIFECYCLE_OBSERVATION_SCHEMA_VERSION,
  OBSERVATION_DISCLOSURE,
  EngineLifecycleObservationSession,
  buildImplementationArgs,
  buildReviewArgs,
  createEngineLifecycleObservationSession,
  reviewLoopResultBlocked,
  reviewResultBlocked,
  validateExtraArgs,
  validateImplementerRoster,
  validateExtraReviewArgs,
  validateReviewRoster,
  normalizeEngineLifecycleObservationConfig,
  resolveReviewLoop,
  resolveReviewLoopJson,
  parseReviewLoopOutput,
  validateReviewLoopConfig,
  findJsonObjectCandidates,
  looksLikeReviewLoopConfig,
  RESOLVE_REVIEW_LOOP,
  ...ownerKernel,
};
