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


const campaignDispositionAuthority = require('./campaign-disposition-authority');
const productReviewNormalizer = require('./product-review-normalizer');
const campaignStatus = require('../campaign/status');










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
const executionProfile = require('./execution-profile');
const profilePayload = require('./profile-payload');
const profileRuntime = require('./profile-runtime');
const profileCutover = require('./profile-cutover');
const capabilityEvidence = require('./capability-evidence');
const campaignAdjudication = require('./campaign-adjudication');
const campaignIntake = require('./campaign-intake');
const campaignComposition = require('./campaign-composition');
const controllerExecution = require('./controller-execution');
const campaignVerification = require('./campaign-verification');
const implementationCampaign = require('./implementation-campaign');
const localDeployment = require('./local-deployment');
const roles = require('./roles');
const authenticatedControl = require('./authenticated-control');
const missionConvergence = require('./mission-convergence');
const missionCampaignIdentity = require('./mission-campaign-identity');
const missionInterface = require('../mission/interface');

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
  CAPABILITY_EVIDENCE_SCHEMA_VERSION: capabilityEvidence.CAPABILITY_EVIDENCE_SCHEMA_VERSION,
  CAPABILITY_EVIDENCE_ROLES: capabilityEvidence.ROLES,
  CAPABILITY_EVIDENCE_SOURCES: capabilityEvidence.SOURCES,
  CAPABILITY_EVIDENCE_STATES: capabilityEvidence.STATES,
  CAPABILITY_EVIDENCE_REVOCATION_REASONS: capabilityEvidence.REVOCATION_REASONS,
  // Repointed, not extended (plan 2026-08-28-consult-discuss-qualification.md
  // §2.6 finding [5]): these two barrel names already promised the
  // CAPABILITY role variant; no new export names are added here.
  CAPABILITY_ROLE_IDS: roles.CAPABILITY_ROLE_IDS,
  CAPABILITY_ROLE_ALIASES: roles.LEGACY_ROLE_ALIASES,
  CapabilityEvidenceError: capabilityEvidence.CapabilityEvidenceError,
  MAX_QUALIFIED_TTL_DAYS: capabilityEvidence.MAX_QUALIFIED_TTL_DAYS,
  buildCapabilityEvidenceReceipt: capabilityEvidence.buildCapabilityEvidenceReceipt,
  compileCapabilityEvidence: capabilityEvidence.compileCapabilityEvidence,
  evaluateCapabilityEvidence: capabilityEvidence.evaluateCapabilityEvidence,
  normalizeCapabilityEvidenceIdentity: capabilityEvidence.normalizeIdentity,
  normalizeCapabilityEvidenceReceipt: capabilityEvidence.normalizeCapabilityEvidenceReceipt,
  normalizeCapabilityEvidenceScope: capabilityEvidence.normalizeScope,
  normalizeCapabilityRole: roles.normalizeCapabilityRole,
  verifyEvaluationCorpus: capabilityEvidence.verifyEvaluationCorpus,
  ...localDeployment,
  ...profileCutover,
  ...profileRuntime,
  ...profilePayload,
  ...executionProfile,
  ...campaignAdjudication,
  ...campaignVerification,
  ...campaignComposition,
  ...controllerExecution,
  ...implementationCampaign,
  ...campaignIntake,
  ...campaignDispositionAuthority,
  ...productReviewNormalizer,
  ...campaignStatus,
  ...ownerKernel,
  AUTHENTICATED_CONTROL_ACTIONS: authenticatedControl.CONTROL_ACTIONS,
  AUTHENTICATED_CONTROL_AUTHORITIES: authenticatedControl.CONTROL_AUTHORITIES,
  AUTHENTICATED_CONTROL_REJECTION_REASONS: authenticatedControl.REJECTION_REASONS,
  AUTHENTICATED_CONTROL_SCHEMA_VERSION: authenticatedControl.CONTROL_SCHEMA_VERSION,
  AuthenticatedControlAdapter: authenticatedControl.AuthenticatedControlAdapter,
  AuthenticatedControlError: authenticatedControl.AuthenticatedControlError,
  CEILING_LOOSEN_AUTHORITIES: authenticatedControl.CEILING_LOOSEN_AUTHORITIES,
  MISSION_CONVERGENCE_AXES: missionConvergence.SUPPORTED_AXES,
  MISSION_CONVERGENCE_CLOSURE_ALLOWLIST: missionConvergence.CLOSURE_ALLOWLIST,
  MISSION_CONVERGENCE_ENFORCEMENT_MODES: missionConvergence.ENFORCEMENT_MODES,
  MISSION_CONVERGENCE_EVENT_TYPES: missionConvergence.EVENT_TYPES,
  MISSION_CONVERGENCE_GRANT_BINDING_FIELDS: missionConvergence.GRANT_BINDING_FIELDS,
  MISSION_CONVERGENCE_SCHEMA_VERSION: missionConvergence.MISSION_SCHEMA_VERSION,
  MISSION_CONVERGENCE_STATES: missionConvergence.MISSION_STATES,
  MISSION_INTERFACE_VERSION: missionInterface.MISSION_INTERFACE_VERSION,
  MISSION_RECEIPT_SCHEMA_VERSION: missionConvergence.MISSION_RECEIPT_SCHEMA_VERSION,
  MissionReducerError: missionConvergence.MissionReducerError,
  missionInterface,
  TERMINAL_TRIGGER_ACTIONS: authenticatedControl.TERMINAL_TRIGGER_ACTIONS,
  authorizeCeilingAdjust: authenticatedControl.authorizeCeilingAdjust,
  buildProjection: missionConvergence.buildProjection,
  applyMissionCampaignReceipt: missionConvergence.applyMissionCampaignReceipt,
  createFileBackedMissionStateStore: missionConvergence.createFileBackedMissionStateStore,
  createMissionCampaignAdapters: missionConvergence.createMissionCampaignAdapters,
  evaluateCodexEnforcementDisposition: missionConvergence.evaluateCodexEnforcementDisposition,
  createCodexMissionEnforcementAdapter: missionConvergence.createCodexMissionEnforcementAdapter,
  fenceMissionEffect: missionConvergence.fenceMissionEffect,
  recordMissionClosureEffect: missionConvergence.recordMissionClosureEffect,
  buildMissionTerminalReceipt: missionConvergence.buildMissionTerminalReceipt,
  claimIdFor: missionConvergence.claimIdFor,
  classifyControlEffect: authenticatedControl.classifyControlEffect,
  computeAxisBudget: missionConvergence.computeAxisBudget,
  createMissionState: missionConvergence.createMissionState,
  evaluateConfig: missionConvergence.evaluateConfig,
  evaluateIdentityReset: missionConvergence.evaluateIdentityReset,
  evaluateMissionIntegrationFixture: missionConvergence.evaluateMissionIntegrationFixture,
  evaluateMissionReducerFixture: missionConvergence.evaluateMissionReducerFixture,
  isNonSerializableVerifier: authenticatedControl.isNonSerializableVerifier,
  missionCampaignIdFor: missionCampaignIdentity.missionCampaignIdFor,
  missionSubjectDigest: missionCampaignIdentity.missionSubjectDigest,
  normalizeControlEvent: authenticatedControl.normalizeControlEvent,
  reduceMissionState: missionConvergence.reduceMissionState,
  remainingForAxis: missionConvergence.remainingForAxis,
  replayEvents: missionConvergence.replayEvents,
  restoreProjection: missionConvergence.restoreProjection,
  sha256: missionConvergence.sha256,
  stateHash: missionConvergence.stateHash,
  validateMissionContract: missionConvergence.validateMissionContract,
  validateVerifier: authenticatedControl.validateVerifier,
  verifySequence: authenticatedControl.verifySequence,};
