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
  AUTOPILOT_ENGINE_CONTROL_SINKS,
  AUTOPILOT_ENGINE_RUNTIME_CONTEXT_OPTION_KEYS,
  ENGINE_BRIDGE_CONTRACT_SCHEMA_VERSION,
  TRUSTED_INTAKE_VERIFICATION_PATH,
  compileSupervisedEngineBridgeContract,
  getAutopilotEngineControlSinkInventory,
  getRequiredActionCatalogBindingIds,
  getSupervisedEngineBridgeAbi,
  getSupervisedEngineBridgeAbiHash,
  validateAutopilotEngineControlSinkInventory,
  verifySupervisedEngineBridgeContract,
} = require('./supervised-engine-bridge-contract');

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
  AUTOPILOT_ENGINE_CONTROL_SINKS,
  AUTOPILOT_ENGINE_RUNTIME_CONTEXT_OPTION_KEYS,
  BoundedUnixLifecycleObserver,
  ENGINE_BRIDGE_CONTRACT_SCHEMA_VERSION,
  TRUSTED_INTAKE_VERIFICATION_PATH,
  ENGINE_LIFECYCLE_OBSERVATION_SCHEMA_VERSION,
  EXTERNAL_LIFECYCLE_WITNESS_PROTOCOL_VERSION,
  OBSERVATION_DISCLOSURE,
  EngineLifecycleObservationSession,
  ExternalLifecycleWitnessDaemon,
  buildImplementationArgs,
  buildReviewArgs,
  createBoundedUnixLifecycleObserver,
  createEngineLifecycleObservationSession,
  compileSupervisedEngineBridgeContract,
  getAutopilotEngineControlSinkInventory,
  getRequiredActionCatalogBindingIds,
  getSupervisedEngineBridgeAbi,
  getSupervisedEngineBridgeAbiHash,
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
  validateAutopilotEngineControlSinkInventory,
  validateReviewLoopConfig,
  verifySupervisedEngineBridgeContract,
  findJsonObjectCandidates,
  looksLikeReviewLoopConfig,
  RESOLVE_REVIEW_LOOP,
  invokeSocketRequest,
  ...ownerKernel,
};
