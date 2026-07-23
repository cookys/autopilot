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
  BoundedUnixLifecycleObserver,
  EXTERNAL_LIFECYCLE_WITNESS_PROTOCOL_VERSION,
  ExternalLifecycleWitnessDaemon,
  createBoundedUnixLifecycleObserver,
  invokeSocketRequest,
  normalizeClientConfig: normalizeExternalLifecycleWitnessClientConfig,
  normalizeDaemonConfig: normalizeExternalLifecycleWitnessDaemonConfig,
} = require('./external-lifecycle-witness');

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
  BoundedUnixLifecycleObserver,
  ENGINE_LIFECYCLE_OBSERVATION_SCHEMA_VERSION,
  EXTERNAL_LIFECYCLE_WITNESS_PROTOCOL_VERSION,
  OBSERVATION_DISCLOSURE,
  EngineLifecycleObservationSession,
  ExternalLifecycleWitnessDaemon,
  buildImplementationArgs,
  buildReviewArgs,
  createBoundedUnixLifecycleObserver,
  createEngineLifecycleObservationSession,
  reviewLoopResultBlocked,
  reviewResultBlocked,
  validateExtraArgs,
  validateImplementerRoster,
  validateExtraReviewArgs,
  validateReviewRoster,
  normalizeEngineLifecycleObservationConfig,
  normalizeExternalLifecycleWitnessClientConfig,
  normalizeExternalLifecycleWitnessDaemonConfig,
  resolveReviewLoop,
  resolveReviewLoopJson,
  parseReviewLoopOutput,
  validateReviewLoopConfig,
  findJsonObjectCandidates,
  looksLikeReviewLoopConfig,
  RESOLVE_REVIEW_LOOP,
  invokeSocketRequest,
  ...ownerKernel,
};
