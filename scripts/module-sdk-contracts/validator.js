const fs = require('fs');
const path = require('path');

const SCHEMA_VERSION = 1;
const REQUIRED_COMPATIBILITY_LANES = ['effect-first', 'tanstack-first'];
const REQUIRED_MANIFEST_FIELDS = [
  'moduleId',
  'version',
  'runtime',
  'sourceDir',
  'lifecycleHooks',
  'policyHooks',
  'observability',
  'compliance',
];
const REQUIRED_COMPLIANCE_FLAGS = [
  'usesSdkContracts',
  'usesPolicyMiddleware',
  'usesObservabilityHooks',
];
const REQUIRED_LIFECYCLE_HOOKS = [
  'registerRoutes',
  'registerCapabilities',
  'registerMigrations',
];
const REQUIRED_POLICY_HOOKS = [
  'authorize',
  'enforceTenantScope',
  'validateOperationContext',
];
const REQUIRED_OBSERVABILITY_HOOKS = [
  'emitBusinessMetric',
  'emitAuditEvent',
  'emitTraceContext',
];
const REQUIRED_OBSERVABILITY_SIGNALS = ['metrics', 'audit', 'trace'];
const REQUIRED_FORBIDDEN_CODE_PATTERNS = [
  'createRequest\\(',
  'x-modernjs-bff-envelope',
  'x-operation-id',
];

const readJsonFile = filePath => {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
};

const ensureStringArray = (value, context) => {
  if (!Array.isArray(value)) {
    throw new Error(`${context} must be an array`);
  }

  for (const item of value) {
    if (typeof item !== 'string' || item.trim() === '') {
      throw new Error(`${context} must contain non-empty string values`);
    }
  }
};

const ensureIncludesAll = ({
  actual,
  required,
  context,
  allowAdditional = true,
}) => {
  ensureStringArray(actual, context);
  required.forEach(item => {
    if (!actual.includes(item)) {
      throw new Error(`${context} is missing required value "${item}"`);
    }
  });

  if (!allowAdditional) {
    actual.forEach(item => {
      if (!required.includes(item)) {
        throw new Error(`${context} contains unsupported value "${item}"`);
      }
    });
  }
};

const ensureOptionalStringArray = (value, context) => {
  if (value === undefined) {
    return;
  }

  ensureStringArray(value, context);
};

const mergeRequirementArrays = (...values) => {
  const merged = new Set();
  values
    .filter(value => Array.isArray(value))
    .forEach(value => value.forEach(item => merged.add(item)));
  return Array.from(merged.values());
};

const validateSharedRequirementsShape = sharedRequirements => {
  if (!sharedRequirements || typeof sharedRequirements !== 'object') {
    throw new Error('sharedRequirements must be an object');
  }

  ensureIncludesAll({
    actual: sharedRequirements.requiredManifestFields,
    required: REQUIRED_MANIFEST_FIELDS,
    context: 'sharedRequirements.requiredManifestFields',
  });
  ensureIncludesAll({
    actual: sharedRequirements.requiredComplianceFlags,
    required: REQUIRED_COMPLIANCE_FLAGS,
    context: 'sharedRequirements.requiredComplianceFlags',
  });
  ensureIncludesAll({
    actual: sharedRequirements.requiredObservabilitySignals,
    required: REQUIRED_OBSERVABILITY_SIGNALS,
    context: 'sharedRequirements.requiredObservabilitySignals',
  });
  ensureIncludesAll({
    actual: sharedRequirements.requiredLifecycleHooks,
    required: REQUIRED_LIFECYCLE_HOOKS,
    context: 'sharedRequirements.requiredLifecycleHooks',
  });
  ensureIncludesAll({
    actual: sharedRequirements.requiredPolicyHooks,
    required: REQUIRED_POLICY_HOOKS,
    context: 'sharedRequirements.requiredPolicyHooks',
  });
  ensureIncludesAll({
    actual: sharedRequirements.requiredObservabilityHooks,
    required: REQUIRED_OBSERVABILITY_HOOKS,
    context: 'sharedRequirements.requiredObservabilityHooks',
  });
  ensureIncludesAll({
    actual: sharedRequirements.forbiddenCodePatterns,
    required: REQUIRED_FORBIDDEN_CODE_PATTERNS,
    context: 'sharedRequirements.forbiddenCodePatterns',
  });
};

const validateProfileContractShape = (profileName, profileContract) => {
  if (!profileContract || typeof profileContract !== 'object') {
    throw new Error(`profiles.${profileName} must be an object`);
  }

  ensureOptionalStringArray(
    profileContract.requiredManifestFields,
    `profiles.${profileName}.requiredManifestFields`,
  );
  ensureOptionalStringArray(
    profileContract.requiredComplianceFlags,
    `profiles.${profileName}.requiredComplianceFlags`,
  );
  ensureOptionalStringArray(
    profileContract.requiredObservabilitySignals,
    `profiles.${profileName}.requiredObservabilitySignals`,
  );
  ensureOptionalStringArray(
    profileContract.requiredLifecycleHooks,
    `profiles.${profileName}.requiredLifecycleHooks`,
  );
  ensureOptionalStringArray(
    profileContract.requiredPolicyHooks,
    `profiles.${profileName}.requiredPolicyHooks`,
  );
  ensureOptionalStringArray(
    profileContract.requiredObservabilityHooks,
    `profiles.${profileName}.requiredObservabilityHooks`,
  );
  ensureOptionalStringArray(
    profileContract.forbiddenCodePatterns,
    `profiles.${profileName}.forbiddenCodePatterns`,
  );
};

const resolveManifestRequirementSet = ({
  contract,
  manifest,
  manifestPath,
}) => {
  const sharedRequirements = contract.sharedRequirements;
  const manifestProfile =
    typeof manifest.profile === 'string' && manifest.profile.trim().length > 0
      ? manifest.profile.trim()
      : undefined;

  if (manifest.profile !== undefined && !manifestProfile) {
    throw new Error(
      `Manifest ${manifestPath} has invalid profile "${String(
        manifest.profile,
      )}"`,
    );
  }

  let profileRequirements;
  if (manifestProfile) {
    profileRequirements = contract.profiles?.[manifestProfile];
  }

  return {
    profile: manifestProfile,
    requiredManifestFields: mergeRequirementArrays(
      sharedRequirements.requiredManifestFields,
      profileRequirements?.requiredManifestFields,
    ),
    requiredComplianceFlags: mergeRequirementArrays(
      sharedRequirements.requiredComplianceFlags,
      profileRequirements?.requiredComplianceFlags,
    ),
    requiredObservabilitySignals: mergeRequirementArrays(
      sharedRequirements.requiredObservabilitySignals,
      profileRequirements?.requiredObservabilitySignals,
    ),
    requiredLifecycleHooks: mergeRequirementArrays(
      sharedRequirements.requiredLifecycleHooks,
      profileRequirements?.requiredLifecycleHooks,
    ),
    requiredPolicyHooks: mergeRequirementArrays(
      sharedRequirements.requiredPolicyHooks,
      profileRequirements?.requiredPolicyHooks,
    ),
    requiredObservabilityHooks: mergeRequirementArrays(
      sharedRequirements.requiredObservabilityHooks,
      profileRequirements?.requiredObservabilityHooks,
    ),
    forbiddenCodePatterns: mergeRequirementArrays(
      sharedRequirements.forbiddenCodePatterns,
      profileRequirements?.forbiddenCodePatterns,
    ),
  };
};

const validateContractShape = contract => {
  if (!contract || typeof contract !== 'object') {
    throw new Error('Contract must be a JSON object');
  }

  if (contract.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(
      `Unsupported contract schemaVersion: ${String(
        contract.schemaVersion,
      )}. Expected ${String(SCHEMA_VERSION)}.`,
    );
  }

  ensureIncludesAll({
    actual: contract.compatibilityLanes,
    required: REQUIRED_COMPATIBILITY_LANES,
    context: 'compatibilityLanes',
  });

  validateSharedRequirementsShape(contract.sharedRequirements);

  if (contract.profiles !== undefined) {
    if (!contract.profiles || typeof contract.profiles !== 'object') {
      throw new Error('profiles must be an object when provided');
    }

    for (const [profileName, profileContract] of Object.entries(
      contract.profiles,
    )) {
      validateProfileContractShape(profileName, profileContract);
    }
  }
};

const validateManifestShape = ({ manifest, contract, manifestPath }) => {
  if (!manifest || typeof manifest !== 'object') {
    throw new Error(`Manifest ${manifestPath} must be a JSON object`);
  }

  const requirements = resolveManifestRequirementSet({
    contract,
    manifest,
    manifestPath,
  });
  const requiredFields = requirements.requiredManifestFields;
  for (const field of requiredFields) {
    if (!(field in manifest)) {
      throw new Error(
        `Manifest ${manifestPath} is missing required field "${field}"`,
      );
    }
  }

  if (
    typeof manifest.runtime !== 'string' ||
    !contract.compatibilityLanes.includes(manifest.runtime)
  ) {
    throw new Error(
      `Manifest ${manifestPath} has unsupported runtime lane "${String(
        manifest.runtime,
      )}"`,
    );
  }

  ensureIncludesAll({
    actual: manifest.lifecycleHooks,
    required: requirements.requiredLifecycleHooks,
    context: `manifest(${manifestPath}).lifecycleHooks`,
  });
  ensureIncludesAll({
    actual: manifest.policyHooks,
    required: requirements.requiredPolicyHooks,
    context: `manifest(${manifestPath}).policyHooks`,
  });

  if (!manifest.observability || typeof manifest.observability !== 'object') {
    throw new Error(
      `Manifest ${manifestPath} must include observability object`,
    );
  }

  ensureIncludesAll({
    actual: manifest.observability.signals,
    required: requirements.requiredObservabilitySignals,
    context: `manifest(${manifestPath}).observability.signals`,
  });
  ensureIncludesAll({
    actual: manifest.observability.hooks,
    required: requirements.requiredObservabilityHooks,
    context: `manifest(${manifestPath}).observability.hooks`,
  });

  if (!manifest.compliance || typeof manifest.compliance !== 'object') {
    throw new Error(`Manifest ${manifestPath} must include compliance object`);
  }

  for (const flag of requirements.requiredComplianceFlags) {
    if (manifest.compliance[flag] !== true) {
      throw new Error(
        `Manifest ${manifestPath} compliance flag "${flag}" must be true`,
      );
    }
  }
};

const resolveManifestPaths = ({ manifestPaths = [], manifestsDir }) => {
  const resolved = new Set(
    manifestPaths.filter(Boolean).map(filePath => path.resolve(filePath)),
  );

  if (manifestsDir) {
    const dir = path.resolve(manifestsDir);
    if (!fs.existsSync(dir)) {
      throw new Error(`Manifest directory does not exist: ${dir}`);
    }
    const stat = fs.statSync(dir);
    if (!stat.isDirectory()) {
      throw new Error(`Manifest path is not a directory: ${dir}`);
    }

    const files = fs
      .readdirSync(dir)
      .filter(fileName => fileName.endsWith('.json'))
      .map(fileName => path.join(dir, fileName));
    files.forEach(filePath => resolved.add(filePath));
  }

  return Array.from(resolved.values());
};

const validateManifests = ({
  contract,
  manifestPaths,
  manifestsDir,
  allowEmpty = false,
}) => {
  const resolvedPaths = resolveManifestPaths({ manifestPaths, manifestsDir });
  if (resolvedPaths.length === 0) {
    if (allowEmpty) {
      return {
        validated: [],
      };
    }
    throw new Error(
      'No module manifest files were provided. Use --manifest or --manifest-dir.',
    );
  }

  const validated = [];
  for (const manifestPath of resolvedPaths) {
    if (!fs.existsSync(manifestPath)) {
      throw new Error(`Manifest file does not exist: ${manifestPath}`);
    }

    const manifest = readJsonFile(manifestPath);
    validateManifestShape({
      manifest,
      contract,
      manifestPath,
    });
    validated.push({
      path: manifestPath,
      moduleId: manifest.moduleId,
      profile: manifest.profile,
      runtime: manifest.runtime,
    });
  }

  return {
    validated,
  };
};

module.exports = {
  SCHEMA_VERSION,
  readJsonFile,
  resolveManifestPaths,
  resolveManifestRequirementSet,
  validateContractShape,
  validateManifestShape,
  validateManifests,
};
