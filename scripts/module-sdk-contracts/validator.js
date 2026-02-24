const fs = require('fs');
const path = require('path');

const SCHEMA_VERSION = 1;
const REQUIRED_FAMILIES = [
  'crm',
  'project-management',
  'invoicing',
  'docs',
  'chat',
  'automation',
];
const REQUIRED_COMPATIBILITY_LANES = ['effect-first', 'tanstack-first'];
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

const validateFamilyContractShape = (familyName, familyContract) => {
  if (!familyContract || typeof familyContract !== 'object') {
    throw new Error(`families.${familyName} must be an object`);
  }

  ensureIncludesAll({
    actual: familyContract.requiredLifecycleHooks,
    required: REQUIRED_LIFECYCLE_HOOKS,
    context: `families.${familyName}.requiredLifecycleHooks`,
  });
  ensureIncludesAll({
    actual: familyContract.requiredPolicyHooks,
    required: REQUIRED_POLICY_HOOKS,
    context: `families.${familyName}.requiredPolicyHooks`,
  });
  ensureIncludesAll({
    actual: familyContract.requiredObservabilityHooks,
    required: REQUIRED_OBSERVABILITY_HOOKS,
    context: `families.${familyName}.requiredObservabilityHooks`,
  });
  ensureStringArray(
    familyContract.forbiddenCodePatterns,
    `families.${familyName}.forbiddenCodePatterns`,
  );
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

  if (
    !contract.sharedRequirements ||
    typeof contract.sharedRequirements !== 'object'
  ) {
    throw new Error('sharedRequirements must be an object');
  }

  ensureStringArray(
    contract.sharedRequirements.requiredManifestFields,
    'sharedRequirements.requiredManifestFields',
  );
  ensureIncludesAll({
    actual: contract.sharedRequirements.requiredComplianceFlags,
    required: [
      'usesSdkContracts',
      'usesPolicyMiddleware',
      'usesObservabilityHooks',
    ],
    context: 'sharedRequirements.requiredComplianceFlags',
  });
  ensureIncludesAll({
    actual: contract.sharedRequirements.requiredObservabilitySignals,
    required: REQUIRED_OBSERVABILITY_SIGNALS,
    context: 'sharedRequirements.requiredObservabilitySignals',
  });

  if (!contract.families || typeof contract.families !== 'object') {
    throw new Error('families must be an object');
  }

  for (const familyName of REQUIRED_FAMILIES) {
    if (!contract.families[familyName]) {
      throw new Error(`families is missing required family "${familyName}"`);
    }
    validateFamilyContractShape(familyName, contract.families[familyName]);
  }
};

const validateManifestShape = ({ manifest, contract, manifestPath }) => {
  if (!manifest || typeof manifest !== 'object') {
    throw new Error(`Manifest ${manifestPath} must be a JSON object`);
  }

  const requiredFields = contract.sharedRequirements.requiredManifestFields;
  for (const field of requiredFields) {
    if (!(field in manifest)) {
      throw new Error(
        `Manifest ${manifestPath} is missing required field "${field}"`,
      );
    }
  }

  const familyContract = contract.families[manifest.family];
  if (!familyContract) {
    throw new Error(
      `Manifest ${manifestPath} has unsupported family "${String(
        manifest.family,
      )}"`,
    );
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
    required: familyContract.requiredLifecycleHooks,
    context: `manifest(${manifestPath}).lifecycleHooks`,
  });
  ensureIncludesAll({
    actual: manifest.policyHooks,
    required: familyContract.requiredPolicyHooks,
    context: `manifest(${manifestPath}).policyHooks`,
  });

  if (!manifest.observability || typeof manifest.observability !== 'object') {
    throw new Error(
      `Manifest ${manifestPath} must include observability object`,
    );
  }

  ensureIncludesAll({
    actual: manifest.observability.signals,
    required: contract.sharedRequirements.requiredObservabilitySignals,
    context: `manifest(${manifestPath}).observability.signals`,
  });
  ensureIncludesAll({
    actual: manifest.observability.hooks,
    required: familyContract.requiredObservabilityHooks,
    context: `manifest(${manifestPath}).observability.hooks`,
  });

  if (!manifest.compliance || typeof manifest.compliance !== 'object') {
    throw new Error(`Manifest ${manifestPath} must include compliance object`);
  }

  for (const flag of contract.sharedRequirements.requiredComplianceFlags) {
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
      family: manifest.family,
      runtime: manifest.runtime,
    });
  }

  return {
    validated,
  };
};

module.exports = {
  SCHEMA_VERSION,
  REQUIRED_FAMILIES,
  readJsonFile,
  resolveManifestPaths,
  validateContractShape,
  validateManifestShape,
  validateManifests,
};
