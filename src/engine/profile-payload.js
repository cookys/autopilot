'use strict';

const fs = require('fs');
const path = require('path');
const { TextDecoder } = require('util');
const {
  canonicalJson,
  cloneCanonical,
  isSha256,
  sha256,
} = require('./owner-kernel/canonical');
const {
  assertJsonValue,
  preflightJsonSource,
} = require('../../scripts/validate-json-schema');
const { OwnerKernelError } = require('./owner-kernel/errors');
const { normalizeTaskAuthorityEnvelope } = require('./owner-kernel/task-authority');
const { normalizeRoleExecutionGrant } = require('./execution-profile');

const PROFILE_PAYLOAD_SCHEMA_VERSION = 1;
const PROFILE_NAMES = Object.freeze(['guided', 'autonomous']);
const REQUIRED_TRACE_STAGES = Object.freeze(['intake', 'late_skill', 'compact', 'reload']);
const DEFAULT_REPO_ROOT = path.resolve(__dirname, '..', '..');
const CATALOG_PATH = 'profiles/profile-catalog.json';
const EXACT_TOKEN_SOURCE = /^(?:harness_reported_input_delta|exact_tokenizer:[A-Za-z0-9._:-]{1,128})$/u;

function payloadError(message, code = 'INVALID_PROFILE_PAYLOAD') {
  throw new OwnerKernelError(message, code);
}

function plainObject(value, label) {
  try {
    assertJsonValue(value, label);
  } catch (error) {
    payloadError(error.message, error.code || 'INVALID_PROFILE_PAYLOAD');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype
      && Object.getPrototypeOf(value) !== null)) {
    payloadError(`${label} must be a plain object`);
  }
  return value;
}

function onlyKeys(value, allowed, label) {
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowed.has(key)) {
      payloadError(`${label} has unsupported key "${String(key)}"`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true
      || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      payloadError(`${label}.${key} must be an enumerable data property`);
    }
  }
}

function boundedString(value, label, maxLength = 4096) {
  if (typeof value !== 'string' || value.trim() === '' || value.length > maxLength) {
    payloadError(`${label} must be a non-empty string no longer than ${maxLength} characters`);
  }
  return value;
}

function token(value, label) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/u.test(value)) {
    payloadError(`${label} must be a bounded protocol token`);
  }
  return value;
}

function safeInteger(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    payloadError(`${label} must be a safe integer >= ${minimum}`);
  }
  return value;
}

function profileName(value, label = 'profile') {
  if (!PROFILE_NAMES.includes(value)) {
    payloadError(`${label} must be guided or autonomous`);
  }
  return value;
}

function relativeArtifact(value, label) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512
    || path.isAbsolute(value) || value.includes('\\') || /[*?\0]/u.test(value)) {
    payloadError(`${label} must be a bounded POSIX relative path`);
  }
  const normalized = path.posix.normalize(value);
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
    payloadError(`${label} escapes the artifact boundary`);
  }
  return normalized.replace(/\/+$/u, '');
}

function assertSha(value, label) {
  if (!isSha256(value)) payloadError(`${label} must be a SHA-256 digest`);
  return value.toLowerCase();
}

function readRegularFileInside(root, relative, label) {
  const absoluteRoot = fs.realpathSync(root);
  const candidate = path.resolve(absoluteRoot, relative);
  let resolved;
  let stat;
  try {
    resolved = fs.realpathSync(candidate);
    stat = fs.statSync(resolved);
  } catch (error) {
    payloadError(`${label} is unreadable: ${error.message}`, 'PROFILE_SOURCE_UNREADABLE');
  }
  const rel = path.relative(absoluteRoot, resolved);
  if (!stat.isFile() || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    payloadError(`${label} must be a regular file inside the profile root`, 'PROFILE_PATH_ESCAPE');
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(fs.readFileSync(resolved));
  } catch (error) {
    payloadError(`${label} is not valid UTF-8: ${error.message}`, 'PROFILE_SOURCE_INVALID');
  }
}

function readJsonInside(root, relative, label) {
  const source = readRegularFileInside(root, relative, label);
  try {
    preflightJsonSource(source, label);
    return JSON.parse(source);
  } catch (error) {
    payloadError(`${label} is invalid JSON: ${error.message}`, error.code || 'PROFILE_SOURCE_INVALID');
  }
}

function validateCatalog(raw, repoRoot = DEFAULT_REPO_ROOT) {
  const catalog = plainObject(raw, 'profile catalog');
  onlyKeys(catalog, new Set([
    'schema_version',
    'inventory_sha256',
    'source_manifest_sha256',
    'source_map_sha256',
    'hook_classes_sha256',
    'rule_migration_sha256',
    'guided_compatibility_sha256',
    'category_totals',
    'core',
    'profiles',
  ]), 'profile catalog');
  if (catalog.schema_version !== PROFILE_PAYLOAD_SCHEMA_VERSION) {
    payloadError('profile catalog schema_version must be 1');
  }
  for (const field of [
    'inventory_sha256',
    'source_manifest_sha256',
    'source_map_sha256',
    'hook_classes_sha256',
    'rule_migration_sha256',
    'guided_compatibility_sha256',
  ]) {
    assertSha(catalog[field], `profile catalog.${field}`);
  }
  const totals = plainObject(catalog.category_totals, 'profile catalog.category_totals');
  onlyKeys(
    totals,
    new Set(['core', 'guided', 'autonomous', 'assurance', 'topology', 'obsolete']),
    'profile catalog.category_totals',
  );
  for (const [category, count] of Object.entries(totals)) {
    safeInteger(count, `profile catalog.category_totals.${category}`);
  }
  if (totals.obsolete !== 0) {
    payloadError('obsolete rules must be removed before profile payload generation');
  }

  const validateComponent = (rawComponent, label) => {
    const component = plainObject(rawComponent, label);
    onlyKeys(component, new Set(['path', 'sha256', 'bytes']), label);
    const componentPath = boundedString(component.path, `${label}.path`, 256);
    const expectedHash = assertSha(component.sha256, `${label}.sha256`);
    const expectedBytes = safeInteger(component.bytes, `${label}.bytes`, 1);
    const body = readRegularFileInside(repoRoot, componentPath, label);
    if (Buffer.byteLength(body) !== expectedBytes || sha256(body) !== expectedHash) {
      payloadError(`${label} content does not match the canonical catalog`, 'PROFILE_SOURCE_DRIFT');
    }
    return { body, path: componentPath, sha256: expectedHash, bytes: expectedBytes };
  };

  const core = validateComponent(catalog.core, 'profile catalog.core');
  const profiles = plainObject(catalog.profiles, 'profile catalog.profiles');
  onlyKeys(profiles, new Set(PROFILE_NAMES), 'profile catalog.profiles');
  const components = {};
  for (const name of PROFILE_NAMES) {
    components[name] = validateComponent(
      profiles[name],
      `profile catalog.profiles.${name}`,
    );
  }

  const bindingFiles = [
    ['profiles/rule-inventory.json', catalog.inventory_sha256, 'rule inventory'],
    ['profiles/rule-source-manifest.json', catalog.source_manifest_sha256, 'rule source manifest'],
    ['profiles/profile-source-map.json', catalog.source_map_sha256, 'profile source map'],
    ['profiles/hook-classes.json', catalog.hook_classes_sha256, 'hook classes'],
    ['profiles/rule-migration.json', catalog.rule_migration_sha256, 'rule migration'],
    [
      'profiles/guided-compatibility.json',
      catalog.guided_compatibility_sha256,
      'guided compatibility record',
    ],
  ];
  for (const [relative, expectedHash, label] of bindingFiles) {
    const source = readRegularFileInside(repoRoot, relative, label);
    if (sha256(source) !== expectedHash) {
      payloadError(`${label} does not match the profile catalog`, 'PROFILE_SOURCE_DRIFT');
    }
  }

  return {
    catalog: cloneCanonical(catalog),
    components: cloneCanonical({
      core: { path: core.path, sha256: core.sha256, bytes: core.bytes },
      profiles: Object.fromEntries(PROFILE_NAMES.map((name) => [
        name,
        {
          path: components[name].path,
          sha256: components[name].sha256,
          bytes: components[name].bytes,
        },
      ])),
    }),
    bodies: {
      core: core.body,
      guided: components.guided.body,
      autonomous: components.autonomous.body,
    },
  };
}

function loadProfileCatalog(repoRoot = DEFAULT_REPO_ROOT) {
  return validateCatalog(
    readJsonInside(repoRoot, CATALOG_PATH, 'profile catalog'),
    repoRoot,
  );
}

function loadHookClasses(repoRoot = DEFAULT_REPO_ROOT) {
  const loaded = loadProfileCatalog(repoRoot);
  const raw = readJsonInside(repoRoot, 'profiles/hook-classes.json', 'hook classes');
  const document = plainObject(raw, 'hook classes');
  onlyKeys(document, new Set(['schema_version', 'hooks']), 'hook classes');
  if (document.schema_version !== PROFILE_PAYLOAD_SCHEMA_VERSION || !Array.isArray(document.hooks)) {
    payloadError('hook classes require schema_version 1 and hooks[]', 'PROFILE_HOOK_DRIFT');
  }
  const classes = document.hooks.map((rawEntry, index) => {
    const label = `hook classes.hooks[${index}]`;
    const entry = plainObject(rawEntry, label);
    const isGuidance = entry.class === 'guidance';
    onlyKeys(
      entry,
      new Set(isGuidance ? ['stem', 'class', 'profiles'] : ['stem', 'class']),
      label,
    );
    const stem = token(entry.stem, `${label}.stem`);
    if (!['invariant_effect', 'guidance', 'host_only'].includes(entry.class)) {
      payloadError(`${label}.class is invalid`, 'PROFILE_HOOK_DRIFT');
    }
    if (!isGuidance) return { stem, class: entry.class };
    if (!Array.isArray(entry.profiles) || entry.profiles.length === 0) {
      payloadError(`${label}.profiles must be non-empty`, 'PROFILE_HOOK_DRIFT');
    }
    const profiles = entry.profiles.map((name, profileIndex) => profileName(
      name,
      `${label}.profiles[${profileIndex}]`,
    ));
    if (new Set(profiles).size !== profiles.length) {
      payloadError(`${label}.profiles must be unique`, 'PROFILE_HOOK_DRIFT');
    }
    return { stem, class: entry.class, profiles: profiles.sort() };
  });
  const stems = classes.map((entry) => entry.stem);
  if (new Set(stems).size !== stems.length) {
    payloadError('hook class stems must be unique', 'PROFILE_HOOK_DRIFT');
  }

  const liveHookManifest = path.join(repoRoot, 'hooks', 'hooks.json');
  const hookManifestPath = fs.existsSync(liveHookManifest)
    ? 'hooks/hooks.json'
    : 'profiles/baselines/claude-hooks.json';
  const hookManifest = readJsonInside(repoRoot, hookManifestPath, 'hook manifest');
  const wired = [];
  for (const groups of Object.values(hookManifest.hooks || {})) {
    for (const group of groups) {
      for (const hook of group.hooks || []) {
        const match = /\/hooks\/([A-Za-z0-9._-]+)\.js(?:\s|$)/u.exec(hook.command || '');
        if (match) wired.push(match[1]);
      }
    }
  }
  const wiredUnique = [...new Set(wired)].sort();
  const classified = [...stems].sort();
  if (canonicalJson(wiredUnique) !== canonicalJson(classified)) {
    payloadError(
      'hook classes must classify every wired hook exactly once',
      'PROFILE_HOOK_DRIFT',
    );
  }
  return {
    catalog: loaded.catalog,
    hooks: cloneCanonical(classes.sort((left, right) => left.stem.localeCompare(right.stem))),
  };
}

function buildHookPolicy(effectiveProfile, repoRoot = DEFAULT_REPO_ROOT) {
  const name = profileName(effectiveProfile);
  const classes = loadHookClasses(repoRoot).hooks;
  const invariantHooks = classes
    .filter((entry) => entry.class === 'invariant_effect')
    .map((entry) => entry.stem);
  const guidanceHooks = classes
    .filter((entry) => entry.class === 'guidance' && entry.profiles.includes(name))
    .map((entry) => entry.stem);
  const invariantHookSetHash = sha256(canonicalJson(invariantHooks));
  const body = {
    schema_version: PROFILE_PAYLOAD_SCHEMA_VERSION,
    effective_profile: name,
    invariant_effect_hooks: invariantHooks,
    guidance_hooks: guidanceHooks,
    invariant_hook_set_hash: invariantHookSetHash,
  };
  return cloneCanonical({
    ...body,
    hook_policy_id: sha256(canonicalJson(body)),
  });
}

function profileBodyHashes(repoRoot = DEFAULT_REPO_ROOT) {
  const loaded = loadProfileCatalog(repoRoot);
  return Object.freeze(Object.fromEntries(PROFILE_NAMES.map((name) => [
    name,
    loaded.components.profiles[name].sha256,
  ])));
}

function buildProfileBundle(effectiveProfile, repoRoot = DEFAULT_REPO_ROOT) {
  const name = profileName(effectiveProfile);
  const loaded = loadProfileCatalog(repoRoot);
  const hookPolicy = buildHookPolicy(name, repoRoot);
  const core = loaded.bodies.core;
  const guidance = loaded.bodies[name];
  const payload = [
    '<!-- autopilot-profile-payload:v1 -->',
    `<!-- component:core sha256:${loaded.components.core.sha256} -->`,
    core.trimEnd(),
    `<!-- component:${name} sha256:${loaded.components.profiles[name].sha256} -->`,
    guidance.trimEnd(),
    '',
  ].join('\n');
  const manifestBody = {
    schema_version: PROFILE_PAYLOAD_SCHEMA_VERSION,
    artifact_kind: 'autopilot_execution_profile',
    effective_profile: name,
    core_sha256: loaded.components.core.sha256,
    profile_sha256: loaded.components.profiles[name].sha256,
    payload_sha256: sha256(payload),
    source_map_sha256: loaded.catalog.source_map_sha256,
    inventory_sha256: loaded.catalog.inventory_sha256,
    hook_policy_sha256: hookPolicy.hook_policy_id,
    invariant_hook_set_sha256: hookPolicy.invariant_hook_set_hash,
  };
  return cloneCanonical({
    manifest: {
      ...manifestBody,
      bundle_id: sha256(canonicalJson(manifestBody)),
    },
    payload,
    hooks: hookPolicy,
  });
}

function normalizeBundle(raw, repoRoot = DEFAULT_REPO_ROOT) {
  const bundle = plainObject(raw, 'profile bundle');
  onlyKeys(bundle, new Set(['manifest', 'payload', 'hooks']), 'profile bundle');
  const manifest = plainObject(bundle.manifest, 'profile bundle.manifest');
  onlyKeys(manifest, new Set([
    'schema_version',
    'artifact_kind',
    'effective_profile',
    'core_sha256',
    'profile_sha256',
    'payload_sha256',
    'source_map_sha256',
    'inventory_sha256',
    'hook_policy_sha256',
    'invariant_hook_set_sha256',
    'bundle_id',
  ]), 'profile bundle.manifest');
  if (manifest.schema_version !== PROFILE_PAYLOAD_SCHEMA_VERSION
    || manifest.artifact_kind !== 'autopilot_execution_profile') {
    payloadError('profile bundle manifest has an unsupported format');
  }
  const name = profileName(manifest.effective_profile, 'profile bundle effective_profile');
  for (const field of [
    'core_sha256',
    'profile_sha256',
    'payload_sha256',
    'source_map_sha256',
    'inventory_sha256',
    'hook_policy_sha256',
    'invariant_hook_set_sha256',
    'bundle_id',
  ]) {
    assertSha(manifest[field], `profile bundle manifest.${field}`);
  }
  if (typeof bundle.payload !== 'string' || bundle.payload.length === 0) {
    payloadError('profile bundle payload must be a non-empty string');
  }
  const canonical = buildProfileBundle(name, repoRoot);
  if (canonicalJson(bundle) !== canonicalJson(canonical)) {
    payloadError(
      'profile bundle is not the canonical single-profile artifact',
      'PROFILE_BUNDLE_DRIFT',
    );
  }
  return canonical;
}

function readProfileBundle(bundleRoot, repoRoot = DEFAULT_REPO_ROOT) {
  const manifest = readJsonInside(bundleRoot, 'manifest.json', 'profile bundle manifest');
  const payload = readRegularFileInside(bundleRoot, 'profile.md', 'profile bundle payload');
  const hooks = readJsonInside(bundleRoot, 'hook-policy.json', 'profile hook policy');
  return normalizeBundle({ manifest, payload, hooks }, repoRoot);
}

function tokenList(raw, label) {
  if (!Array.isArray(raw)) payloadError(`${label} must be an array`);
  const values = raw.map((value, index) => token(value, `${label}[${index}]`));
  if (new Set(values).size !== values.length) payloadError(`${label} must be unique`);
  return values;
}

function normalizeSliceArtifact(raw, label, requireHash) {
  const value = plainObject(raw, label);
  onlyKeys(
    value,
    new Set(requireHash ? ['id', 'artifact', 'sha256'] : ['id', 'artifact']),
    label,
  );
  const normalized = {
    id: token(value.id, `${label}.id`),
    artifact: relativeArtifact(value.artifact, `${label}.artifact`),
  };
  if (requireHash) normalized.sha256 = assertSha(value.sha256, `${label}.sha256`);
  return normalized;
}

function normalizeActiveSlice(raw) {
  const value = plainObject(raw, 'active slice');
  onlyKeys(value, new Set([
    'slice_id',
    'objective',
    'dependencies',
    'inputs',
    'outputs',
    'acceptance',
  ]), 'active slice');
  if (!Array.isArray(value.inputs) || !Array.isArray(value.outputs)
    || !Array.isArray(value.acceptance) || value.acceptance.length === 0) {
    payloadError('active slice inputs/outputs must be arrays and acceptance must be non-empty');
  }
  const normalized = {
    slice_id: token(value.slice_id, 'active slice.slice_id'),
    objective: boundedString(value.objective, 'active slice.objective'),
    dependencies: tokenList(value.dependencies, 'active slice.dependencies'),
    inputs: value.inputs.map((entry, index) => normalizeSliceArtifact(
      entry,
      `active slice.inputs[${index}]`,
      true,
    )),
    outputs: value.outputs.map((entry, index) => normalizeSliceArtifact(
      entry,
      `active slice.outputs[${index}]`,
      false,
    )),
    acceptance: tokenList(value.acceptance, 'active slice.acceptance').sort(),
  };
  for (const field of ['inputs', 'outputs']) {
    const ids = normalized[field].map((entry) => entry.id);
    if (new Set(ids).size !== ids.length) {
      payloadError(`active slice.${field} ids must be unique`);
    }
  }
  return cloneCanonical(normalized);
}

function artifactWithinRoots(artifact, roots) {
  return roots.some((root) => artifact === root || artifact.startsWith(`${root}/`));
}

function narrowActiveSlice(rawSlice, grant, envelope) {
  const activeSlice = normalizeActiveSlice(rawSlice);
  if (activeSlice.objective !== envelope.intent.objective) {
    payloadError(
      'active slice objective must equal the frozen task intent objective',
      'PROFILE_SLICE_BROADENS_GRANT',
    );
  }
  for (const [field, entries] of [
    ['inputs', activeSlice.inputs],
    ['outputs', activeSlice.outputs],
  ]) {
    for (const [index, entry] of entries.entries()) {
      if (!artifactWithinRoots(entry.artifact, grant.allowed_artifacts)) {
        payloadError(
          `active slice.${field}[${index}] escapes the role grant artifact roots`,
          'PROFILE_SLICE_BROADENS_GRANT',
        );
      }
    }
  }
  if (grant.required_evidence.length === 0
    || canonicalJson(activeSlice.acceptance) !== canonicalJson(grant.required_evidence)) {
    payloadError(
      'active slice acceptance must exactly match the grant evidence requirements',
      'PROFILE_SLICE_BROADENS_GRANT',
    );
  }
  return activeSlice;
}

function promptJson(value) {
  return canonicalJson(value).replace(/[<>&\u2028\u2029]/gu, (character) => ({
    '<': '\\u003c',
    '>': '\\u003e',
    '&': '\\u0026',
    '\u2028': '\\u2028',
    '\u2029': '\\u2029',
  })[character]);
}

function coreControlData(rawEnvelope) {
  const envelope = normalizeTaskAuthorityEnvelope(rawEnvelope);
  return cloneCanonical({
    schema_version: PROFILE_PAYLOAD_SCHEMA_VERSION,
    authority_status: envelope.authority_status,
    intent: envelope.intent,
    acceptance: envelope.acceptance,
    red_lines: envelope.red_lines,
    effect_permissions: envelope.effect_permissions,
    resource_ceiling: envelope.resource_ceiling,
    data_egress_policy: envelope.data_egress_policy,
    escalation_policy: envelope.escalation_policy,
    finish_receipt_schema: envelope.finish_receipt_schema,
  });
}

function roleControlData(rawGrant, rawEnvelope) {
  const grant = normalizeRoleExecutionGrant(rawGrant, rawEnvelope);
  return cloneCanonical({
    schema_version: PROFILE_PAYLOAD_SCHEMA_VERSION,
    grant_id: grant.grant_id,
    parent_task_authority_id: grant.parent_task_authority_id,
    dispatch_id: grant.dispatch_id,
    role: grant.role,
    capability_scope: grant.capability_scope,
    role_admission: grant.role_admission,
    effective_profile: grant.effective_profile,
    profile_hash: grant.profile_hash,
    model_identity: grant.model_identity,
    risk: grant.risk,
    assurance: grant.assurance,
    topology: grant.topology,
    allowed_tools: grant.allowed_tools,
    allowed_artifacts: grant.allowed_artifacts,
    effect_subset: grant.effect_subset,
    egress_subset: grant.egress_subset,
    required_evidence: grant.required_evidence,
    resource_budget: grant.resource_budget,
    context_budget: grant.context_budget,
    expires_at: grant.expires_at,
  });
}

function normalizeTokenMeasurement(raw, ceiling) {
  const value = plainObject(raw, 'token measurement');
  onlyKeys(value, new Set(['tokens', 'source', 'exact']), 'token measurement');
  if (value.exact !== true || typeof value.source !== 'string'
    || !EXACT_TOKEN_SOURCE.test(value.source)) {
    payloadError(
      'control context requires a harness-reported delta or exact tokenizer',
      'PROFILE_TOKEN_MEASUREMENT_REQUIRED',
    );
  }
  const tokens = safeInteger(value.tokens, 'token measurement.tokens', 1);
  if (tokens > ceiling) {
    payloadError(
      `control context uses ${tokens} tokens, exceeding the ${ceiling}-token ceiling`,
      'PROFILE_CONTEXT_BUDGET_EXCEEDED',
    );
  }
  return { tokens, source: value.source, exact: true };
}

function renderExecutionCapsule({
  bundle: rawBundle,
  envelope: rawEnvelope,
  grant: rawGrant,
  activeSlice: rawActiveSlice,
  tokenCounter,
  usableContextTokens,
  repoRoot = DEFAULT_REPO_ROOT,
}) {
  const bundle = normalizeBundle(rawBundle, repoRoot);
  const envelope = normalizeTaskAuthorityEnvelope(rawEnvelope);
  const grant = normalizeRoleExecutionGrant(rawGrant, envelope);
  if (grant.effective_profile !== bundle.manifest.effective_profile
    || grant.profile_hash !== bundle.manifest.profile_sha256) {
    payloadError(
      'selected bundle does not match the current role grant',
      'PROFILE_GRANT_MISMATCH',
    );
  }
  let activeSlice = null;
  if (grant.effective_profile === 'guided') {
    activeSlice = narrowActiveSlice(rawActiveSlice, grant, envelope);
  } else if (rawActiveSlice !== undefined && rawActiveSlice !== null) {
    payloadError(
      'autonomous execution consumes the frozen bounded intent, not a guided active slice',
      'PROFILE_SHAPE_MISMATCH',
    );
  }
  const coreData = coreControlData(envelope);
  const roleData = roleControlData(grant, envelope);
  const coreBlock = `<task-authority-envelope>\n${promptJson(coreData)}\n</task-authority-envelope>`;
  const roleBlock = `<role-execution-grant>\n${promptJson(roleData)}\n</role-execution-grant>`;
  const sliceBlock = activeSlice === null
    ? ''
    : `<active-slice>\n${promptJson(activeSlice)}\n</active-slice>\n`;
  const capsule = `${bundle.payload}\n${coreBlock}\n${roleBlock}\n${sliceBlock}`;
  if (typeof tokenCounter !== 'function') {
    payloadError(
      'an exact token counter is required before profile rendering can pass',
      'PROFILE_TOKEN_MEASUREMENT_REQUIRED',
    );
  }
  const usable = safeInteger(
    usableContextTokens,
    'usable context tokens',
    1,
  );
  const ceiling = Math.min(
    2000,
    Math.floor(usable * 0.05),
    grant.context_budget.max_control_tokens,
  );
  if (ceiling < 1) {
    payloadError('usable context cannot fit the non-truncatable core capsule', 'PROFILE_PRECONDITION');
  }
  const measurement = normalizeTokenMeasurement(tokenCounter(capsule), ceiling);
  return cloneCanonical({
    schema_version: PROFILE_PAYLOAD_SCHEMA_VERSION,
    status: 'ready',
    authority_status: grant.authority_status,
    task_authority_id: envelope.task_authority_id,
    grant_id: grant.grant_id,
    effective_profile: grant.effective_profile,
    profile_hash: grant.profile_hash,
    bundle_id: bundle.manifest.bundle_id,
    core_control_hash: sha256(canonicalJson(coreData)),
    role_control_hash: sha256(canonicalJson(roleData)),
    active_slice_hash: activeSlice === null ? null : sha256(canonicalJson(activeSlice)),
    capsule_hash: sha256(capsule),
    context_budget: {
      ceiling_tokens: ceiling,
      measured_tokens: measurement.tokens,
      token_source: measurement.source,
      exact: true,
    },
    capsule,
  });
}

function profileSessionRequest(rawEnvelope, rawGrant, rawBundle, repoRoot = DEFAULT_REPO_ROOT) {
  const envelope = normalizeTaskAuthorityEnvelope(rawEnvelope);
  const grant = normalizeRoleExecutionGrant(rawGrant, envelope);
  const bundle = normalizeBundle(rawBundle, repoRoot);
  if (bundle.manifest.effective_profile !== grant.effective_profile
    || bundle.manifest.profile_sha256 !== grant.profile_hash) {
    payloadError('profile session request does not match the current role grant', 'PROFILE_GRANT_MISMATCH');
  }
  return cloneCanonical({
    schema_version: PROFILE_PAYLOAD_SCHEMA_VERSION,
    task_authority_id: envelope.task_authority_id,
    grant_id: grant.grant_id,
    effective_profile: grant.effective_profile,
    bundle_id: bundle.manifest.bundle_id,
  });
}

function normalizeSession(raw, label) {
  const session = plainObject(raw, label);
  onlyKeys(session, new Set([
    'schema_version',
    'task_authority_id',
    'grant_id',
    'effective_profile',
    'bundle_id',
  ]), label);
  if (session.schema_version !== PROFILE_PAYLOAD_SCHEMA_VERSION) {
    payloadError(`${label}.schema_version must be 1`);
  }
  return cloneCanonical({
    schema_version: PROFILE_PAYLOAD_SCHEMA_VERSION,
    task_authority_id: assertSha(session.task_authority_id, `${label}.task_authority_id`),
    grant_id: assertSha(session.grant_id, `${label}.grant_id`),
    effective_profile: profileName(session.effective_profile, `${label}.effective_profile`),
    bundle_id: assertSha(session.bundle_id, `${label}.bundle_id`),
  });
}

function resolveProfileSession(currentRaw, requestRaw) {
  const request = normalizeSession(requestRaw, 'profile session request');
  if (currentRaw === null || currentRaw === undefined) {
    return cloneCanonical({ decision: 'load', loaded: true, session: request });
  }
  const current = normalizeSession(currentRaw, 'current profile session');
  if (canonicalJson(current) === canonicalJson(request)) {
    return cloneCanonical({ decision: 'reuse', loaded: true, session: current });
  }
  return cloneCanonical({
    decision: 'fresh_session_required',
    loaded: false,
    current,
    requested: request,
    handoff: {
      task_authority_id: request.task_authority_id,
      from_grant_id: current.grant_id,
      to_grant_id: request.grant_id,
      reason: 'profile_or_grant_changed_after_context_load',
    },
  });
}

module.exports = {
  CATALOG_PATH,
  DEFAULT_REPO_ROOT,
  EXACT_TOKEN_SOURCE,
  PROFILE_NAMES,
  PROFILE_PAYLOAD_SCHEMA_VERSION,
  REQUIRED_TRACE_STAGES,
  buildProfileBundle,
  buildHookPolicy,
  coreControlData,
  loadProfileCatalog,
  loadHookClasses,
  normalizeActiveSlice,
  narrowActiveSlice,
  normalizeBundle,
  profileBodyHashes,
  profileSessionRequest,
  readProfileBundle,
  renderExecutionCapsule,
  resolveProfileSession,
  roleControlData,
  validateCatalog,
};
