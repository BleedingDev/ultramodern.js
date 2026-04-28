const fs = require('fs');
const path = require('path');
const {
  readJsonFile,
  resolveManifestRequirementSet,
  validateContractShape,
  validateManifests,
} = require('../module-sdk-contracts/validator');

const SCHEMA_VERSION = 1;
const DEFAULT_SCAN_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
const OWNERSHIP_TARGET_GROUPS = {
  routes: 'route',
  remotes: 'remote',
  services: 'service',
  sharedPackages: 'shared-package',
};
const OWNERSHIP_RULES = new Set([
  'owned',
  'shared-readonly',
  'shared-api-only',
  'forbidden',
]);
const DEFAULT_IGNORED_DIRECTORIES = new Set([
  '.git',
  '.hg',
  '.svn',
  '.turbo',
  '.nx',
  'node_modules',
  'dist',
  'lib',
  'build',
  'coverage',
]);

const toRegex = pattern => {
  try {
    return new RegExp(pattern);
  } catch (error) {
    throw new Error(`Invalid regex pattern "${pattern}": ${error.message}`);
  }
};

const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const globToRegex = glob => {
  const normalized = String(glob).replace(/\\/g, '/');
  let source = '';
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    if (char === '*') {
      const next = normalized[index + 1];
      if (next === '*') {
        source += '.*';
        index += 1;
      } else {
        source += '[^/]*';
      }
      continue;
    }
    source += escapeRegex(char);
  }
  return new RegExp(`^${source}$`);
};

const normalizePathForMatch = value => String(value).replace(/\\/g, '/');

const matchesAnyGlob = ({ value, globs = [] }) => {
  const normalized = normalizePathForMatch(value);
  return globs.some(glob => globToRegex(glob).test(normalized));
};

const isObject = value =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const isNonEmptyString = value =>
  typeof value === 'string' && value.trim().length > 0;

const assertStringArray = ({ value, label, allowEmpty = false }) => {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  if (!allowEmpty && value.length === 0) {
    throw new Error(`${label} must not be empty`);
  }
  value.forEach((item, index) => {
    if (!isNonEmptyString(item)) {
      throw new Error(`${label}[${String(index)}] must be non-empty`);
    }
  });
};

const walkFiles = (targetPath, extensions) => {
  const resolvedPath = path.resolve(targetPath);
  if (!fs.existsSync(resolvedPath)) {
    return [];
  }
  const stat = fs.statSync(resolvedPath);
  if (stat.isFile()) {
    return extensions.includes(path.extname(resolvedPath))
      ? [resolvedPath]
      : [];
  }
  if (!stat.isDirectory()) {
    return [];
  }

  const files = [];
  const queue = [resolvedPath];
  while (queue.length > 0) {
    const current = queue.pop();
    if (!current) {
      continue;
    }

    const entries = fs.readdirSync(current, { withFileTypes: true });
    entries.forEach(entry => {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!DEFAULT_IGNORED_DIRECTORIES.has(entry.name)) {
          queue.push(fullPath);
        }
        return;
      }

      if (extensions.includes(path.extname(entry.name))) {
        files.push(fullPath);
      }
    });
  }

  return files;
};

const extractImportSpecifiers = content => {
  const specifiers = [];
  const pattern =
    /\bimport\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)|\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)|\bexport\s+(?:\*|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/g;
  let match = pattern.exec(content);
  while (match) {
    const value = match[1] || match[2] || match[3] || match[4];
    if (value) {
      specifiers.push(value);
    }
    match = pattern.exec(content);
  }
  return specifiers;
};

const validateProfileShape = profile => {
  if (!profile || typeof profile !== 'object') {
    throw new Error('Boundary guard profile must be a JSON object');
  }

  if (profile.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(
      `Unsupported boundary guard profile schemaVersion: ${String(
        profile.schemaVersion,
      )}. Expected ${String(SCHEMA_VERSION)}.`,
    );
  }

  if (
    typeof profile.contractPath !== 'string' ||
    profile.contractPath.trim() === ''
  ) {
    throw new Error(
      'Boundary guard profile must include a non-empty contractPath',
    );
  }

  if (
    !Array.isArray(profile.moduleManifests) &&
    typeof profile.moduleManifestDir !== 'string'
  ) {
    throw new Error(
      'Boundary guard profile must include moduleManifests or moduleManifestDir',
    );
  }

  if (!Array.isArray(profile.importGuards)) {
    throw new Error('Boundary guard profile importGuards must be an array');
  }

  profile.importGuards.forEach((guard, index) => {
    if (!guard || typeof guard !== 'object') {
      throw new Error(`importGuards[${String(index)}] must be an object`);
    }
    if (typeof guard.id !== 'string' || guard.id.trim() === '') {
      throw new Error(`importGuards[${String(index)}].id must be non-empty`);
    }
    if (!Array.isArray(guard.roots)) {
      throw new Error(`importGuards[${String(index)}].roots must be an array`);
    }
    if (!Array.isArray(guard.bannedImportPatterns)) {
      throw new Error(
        `importGuards[${String(index)}].bannedImportPatterns must be an array`,
      );
    }
  });

  if (!Array.isArray(profile.requiredSnippets)) {
    throw new Error('Boundary guard profile requiredSnippets must be an array');
  }

  profile.requiredSnippets.forEach((check, index) => {
    if (!check || typeof check !== 'object') {
      throw new Error(`requiredSnippets[${String(index)}] must be an object`);
    }
    if (typeof check.id !== 'string' || check.id.trim() === '') {
      throw new Error(
        `requiredSnippets[${String(index)}].id must be non-empty`,
      );
    }
    if (typeof check.path !== 'string' || check.path.trim() === '') {
      throw new Error(
        `requiredSnippets[${String(index)}].path must be non-empty`,
      );
    }
    if (!Array.isArray(check.includes)) {
      throw new Error(
        `requiredSnippets[${String(index)}].includes must be an array`,
      );
    }
    if (check.orderedIncludes && !Array.isArray(check.orderedIncludes)) {
      throw new Error(
        `requiredSnippets[${String(index)}].orderedIncludes must be an array`,
      );
    }
  });

  if (profile.ownershipGate !== undefined) {
    validateOwnershipGateProfileShape(profile.ownershipGate);
  }
};

const validateOwnershipGateProfileShape = ownershipGate => {
  if (!isObject(ownershipGate)) {
    throw new Error('Boundary guard profile ownershipGate must be an object');
  }
  if (
    !isNonEmptyString(ownershipGate.contractPath) &&
    !isObject(ownershipGate.contract)
  ) {
    throw new Error(
      'Boundary guard profile ownershipGate must include contractPath or contract',
    );
  }
  if (!Array.isArray(ownershipGate.changedPaths)) {
    throw new Error(
      'Boundary guard profile ownershipGate.changedPaths must be an array',
    );
  }
  ownershipGate.changedPaths.forEach((changedPath, index) => {
    if (!isNonEmptyString(changedPath)) {
      throw new Error(
        `Boundary guard profile ownershipGate.changedPaths[${String(
          index,
        )}] must be non-empty`,
      );
    }
  });
  if (
    ownershipGate.dependencyGraph !== undefined &&
    !isObject(ownershipGate.dependencyGraph)
  ) {
    throw new Error(
      'Boundary guard profile ownershipGate.dependencyGraph must be an object',
    );
  }
  if (
    ownershipGate.approvedGateIds !== undefined &&
    !Array.isArray(ownershipGate.approvedGateIds)
  ) {
    throw new Error(
      'Boundary guard profile ownershipGate.approvedGateIds must be an array',
    );
  }
  if (
    ownershipGate.approvals !== undefined &&
    !Array.isArray(ownershipGate.approvals)
  ) {
    throw new Error(
      'Boundary guard profile ownershipGate.approvals must be an array',
    );
  }
};

const validateImportGuards = ({
  importGuards,
  rootDir,
  scanExtensions = DEFAULT_SCAN_EXTENSIONS,
}) => {
  const violations = [];
  const inspectedFiles = [];

  importGuards.forEach(guard => {
    const patterns = guard.bannedImportPatterns.map(toRegex);
    guard.roots.forEach(rootPath => {
      const resolvedRoot = path.resolve(rootDir, rootPath);
      if (!fs.existsSync(resolvedRoot)) {
        violations.push({
          type: 'import-guard-config',
          guardId: guard.id,
          message: `Configured root does not exist: ${resolvedRoot}`,
        });
        return;
      }

      const files = walkFiles(resolvedRoot, scanExtensions);
      files.forEach(filePath => {
        inspectedFiles.push(filePath);
        const content = fs.readFileSync(filePath, 'utf8');
        const imports = extractImportSpecifiers(content);
        imports.forEach(specifier => {
          patterns.forEach((pattern, patternIndex) => {
            if (pattern.test(specifier)) {
              violations.push({
                type: 'import-guard',
                guardId: guard.id,
                filePath,
                specifier,
                pattern: guard.bannedImportPatterns[patternIndex],
                message: `Import "${specifier}" matches banned pattern "${guard.bannedImportPatterns[patternIndex]}"`,
              });
            }
          });
        });
      });
    });
  });

  return {
    inspectedFiles: inspectedFiles.length,
    violations,
  };
};

const validateRequiredSnippets = ({ requiredSnippets, rootDir }) => {
  const validations = [];
  const violations = [];

  requiredSnippets.forEach(check => {
    const targetPath = path.resolve(rootDir, check.path);
    if (!fs.existsSync(targetPath)) {
      violations.push({
        type: 'required-snippet',
        checkId: check.id,
        filePath: targetPath,
        message: 'Target file does not exist',
      });
      return;
    }

    const content = fs.readFileSync(targetPath, 'utf8');
    check.includes.forEach(snippet => {
      if (!content.includes(snippet)) {
        violations.push({
          type: 'required-snippet',
          checkId: check.id,
          filePath: targetPath,
          snippet,
          message: `Missing required snippet "${snippet}"`,
        });
      }
    });

    let ordered = true;
    if (
      Array.isArray(check.orderedIncludes) &&
      check.orderedIncludes.length > 0
    ) {
      let previousIndex = -1;
      check.orderedIncludes.forEach(snippet => {
        const index = content.indexOf(snippet);
        if (index === -1) {
          ordered = false;
          violations.push({
            type: 'required-snippet-order',
            checkId: check.id,
            filePath: targetPath,
            snippet,
            message: `Missing ordered snippet "${snippet}"`,
          });
          return;
        }
        if (index < previousIndex) {
          ordered = false;
          violations.push({
            type: 'required-snippet-order',
            checkId: check.id,
            filePath: targetPath,
            snippet,
            message: `Snippet "${snippet}" appears out of required order`,
          });
        }
        previousIndex = index;
      });
    }

    validations.push({
      id: check.id,
      path: check.path,
      ordered,
    });
  });

  return {
    validations,
    violations,
  };
};

const validateModuleForbiddenPatterns = ({
  contract,
  manifestPaths = [],
  rootDir,
  scanExtensions = DEFAULT_SCAN_EXTENSIONS,
}) => {
  const validations = [];
  const violations = [];

  manifestPaths.forEach(manifestPath => {
    const resolvedManifestPath = path.resolve(manifestPath);
    const manifest = readJsonFile(resolvedManifestPath);
    let requirements;
    try {
      requirements = resolveManifestRequirementSet({
        contract,
        manifest,
        manifestPath: resolvedManifestPath,
      });
    } catch (error) {
      violations.push({
        type: 'manifest-profile',
        manifestPath: resolvedManifestPath,
        message: error.message,
      });
      return;
    }

    const sourceDir = path.resolve(rootDir, manifest.sourceDir);
    if (!fs.existsSync(sourceDir)) {
      violations.push({
        type: 'manifest-source',
        manifestPath: resolvedManifestPath,
        sourceDir,
        message: `sourceDir does not exist: ${sourceDir}`,
      });
      return;
    }

    const files = walkFiles(sourceDir, scanExtensions);
    const patterns = requirements.forbiddenCodePatterns.map(toRegex);
    files.forEach(filePath => {
      const content = fs.readFileSync(filePath, 'utf8');
      patterns.forEach((pattern, index) => {
        if (pattern.test(content)) {
          violations.push({
            type: 'forbidden-pattern',
            manifestPath: resolvedManifestPath,
            filePath,
            pattern: requirements.forbiddenCodePatterns[index],
            message: `Forbidden code pattern "${requirements.forbiddenCodePatterns[index]}" matched in ${filePath}`,
          });
        }
      });
    });

    validations.push({
      manifestPath: resolvedManifestPath,
      sourceDir,
      filesScanned: files.length,
    });
  });

  return {
    validations,
    violations,
  };
};

const getOwnershipTargetEntries = contract => {
  const entries = [];
  const ownershipTargets = contract.ownershipTargets || {};

  Object.entries(OWNERSHIP_TARGET_GROUPS).forEach(([groupName, kind]) => {
    const targets = Array.isArray(ownershipTargets[groupName])
      ? ownershipTargets[groupName]
      : [];
    targets.forEach(target => {
      entries.push({
        ...target,
        kind,
        groupName,
      });
    });
  });

  return entries;
};

const validatePrincipalRefs = ({ refs, knownPrincipalIds, label }) => {
  assertStringArray({ value: refs, label });
  refs.forEach(ref => {
    if (!knownPrincipalIds.has(ref)) {
      throw new Error(`${label} references unknown principal "${ref}"`);
    }
  });
};

const validateOwnershipContractShape = contract => {
  if (!isObject(contract)) {
    throw new Error('Ownership contract must be a JSON object');
  }
  if (contract.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(
      `Unsupported ownership contract schemaVersion: ${String(
        contract.schemaVersion,
      )}. Expected ${String(SCHEMA_VERSION)}.`,
    );
  }
  if (!isNonEmptyString(contract.contractId)) {
    throw new Error('Ownership contract contractId must be non-empty');
  }
  if (!Array.isArray(contract.principals) || contract.principals.length === 0) {
    throw new Error('Ownership contract principals must be a non-empty array');
  }

  const knownPrincipalIds = new Set();
  contract.principals.forEach((principal, index) => {
    if (!isObject(principal)) {
      throw new Error(
        `Ownership contract principals[${String(index)}] must be an object`,
      );
    }
    if (!isNonEmptyString(principal.id)) {
      throw new Error(
        `Ownership contract principals[${String(index)}].id must be non-empty`,
      );
    }
    if (knownPrincipalIds.has(principal.id)) {
      throw new Error(
        `Ownership contract contains duplicate principal "${principal.id}"`,
      );
    }
    knownPrincipalIds.add(principal.id);
    if (!isNonEmptyString(principal.type)) {
      throw new Error(
        `Ownership contract principals[${String(index)}].type must be non-empty`,
      );
    }
    if (!isNonEmptyString(principal.displayName)) {
      throw new Error(
        `Ownership contract principals[${String(index)}].displayName must be non-empty`,
      );
    }
  });

  if (!isObject(contract.ownershipTargets)) {
    throw new Error('Ownership contract ownershipTargets must be an object');
  }
  const targetEntries = getOwnershipTargetEntries(contract);
  const targetsById = new Map();
  targetEntries.forEach(target => {
    if (!isNonEmptyString(target.id)) {
      throw new Error('Ownership target id must be non-empty');
    }
    if (targetsById.has(target.id)) {
      throw new Error(
        `Ownership contract contains duplicate target "${target.id}"`,
      );
    }
    targetsById.set(target.id, target);
    if (!isNonEmptyString(target.vertical)) {
      throw new Error(
        `Ownership target "${target.id}" must include a non-empty vertical`,
      );
    }
    validatePrincipalRefs({
      refs: target.owners,
      knownPrincipalIds,
      label: `Ownership target "${target.id}" owners`,
    });
    if (target.approvers !== undefined) {
      validatePrincipalRefs({
        refs: target.approvers,
        knownPrincipalIds,
        label: `Ownership target "${target.id}" approvers`,
      });
    }
  });

  if (!Array.isArray(contract.pathRules) || contract.pathRules.length === 0) {
    throw new Error('Ownership contract pathRules must be a non-empty array');
  }
  contract.pathRules.forEach((rule, index) => {
    if (!isObject(rule)) {
      throw new Error(
        `Ownership contract pathRules[${String(index)}] must be an object`,
      );
    }
    if (!isNonEmptyString(rule.id)) {
      throw new Error(
        `Ownership contract pathRules[${String(index)}].id must be non-empty`,
      );
    }
    if (!isNonEmptyString(rule.targetId) || !targetsById.has(rule.targetId)) {
      throw new Error(
        `Ownership contract pathRules[${String(
          index,
        )}].targetId must reference an ownership target`,
      );
    }
    assertStringArray({
      value: rule.includeGlobs,
      label: `Ownership contract pathRules[${String(index)}].includeGlobs`,
    });
    if (rule.excludeGlobs !== undefined) {
      assertStringArray({
        value: rule.excludeGlobs,
        label: `Ownership contract pathRules[${String(index)}].excludeGlobs`,
      });
    }
    if (!OWNERSHIP_RULES.has(rule.rule)) {
      throw new Error(
        `Ownership contract pathRules[${String(index)}].rule is unsupported`,
      );
    }
    if (rule.requiresApprovalGateIds !== undefined) {
      assertStringArray({
        value: rule.requiresApprovalGateIds,
        label: `Ownership contract pathRules[${String(
          index,
        )}].requiresApprovalGateIds`,
      });
    }
  });

  if (!Array.isArray(contract.approvalGates)) {
    throw new Error('Ownership contract approvalGates must be an array');
  }
  const approvalGateIds = new Set();
  contract.approvalGates.forEach((gate, index) => {
    if (!isObject(gate)) {
      throw new Error(
        `Ownership contract approvalGates[${String(index)}] must be an object`,
      );
    }
    if (!isNonEmptyString(gate.id)) {
      throw new Error(
        `Ownership contract approvalGates[${String(index)}].id must be non-empty`,
      );
    }
    approvalGateIds.add(gate.id);
    if (!isNonEmptyString(gate.name)) {
      throw new Error(
        `Ownership contract approvalGates[${String(index)}].name must be non-empty`,
      );
    }
  });

  contract.pathRules.forEach(rule => {
    (rule.requiresApprovalGateIds || []).forEach(gateId => {
      if (!approvalGateIds.has(gateId)) {
        throw new Error(
          `Ownership contract pathRule "${rule.id}" references unknown approval gate "${gateId}"`,
        );
      }
    });
  });

  const impactRules =
    contract.dependencyGraphImpact &&
    Array.isArray(contract.dependencyGraphImpact.impactRules)
      ? contract.dependencyGraphImpact.impactRules
      : [];
  impactRules.forEach(rule => {
    const requiredGateIds = Array.isArray(rule?.then?.requireApprovalGateIds)
      ? rule.then.requireApprovalGateIds
      : [];
    requiredGateIds.forEach(gateId => {
      if (!approvalGateIds.has(gateId)) {
        throw new Error(
          `Ownership impact rule "${rule.id}" references unknown approval gate "${gateId}"`,
        );
      }
    });
  });

  return {
    targetsById,
    approvalGateIds,
  };
};

const resolvePathOwnership = ({ contract, changedPath }) => {
  const normalizedPath = normalizePathForMatch(changedPath);
  const targetsById = new Map(
    getOwnershipTargetEntries(contract).map(target => [target.id, target]),
  );
  const matches = [];

  contract.pathRules.forEach(rule => {
    const included = matchesAnyGlob({
      value: normalizedPath,
      globs: rule.includeGlobs,
    });
    const excluded = matchesAnyGlob({
      value: normalizedPath,
      globs: rule.excludeGlobs || [],
    });
    if (included && !excluded) {
      matches.push({
        path: changedPath,
        rule,
        target: targetsById.get(rule.targetId),
      });
    }
  });

  return matches;
};

const normalizeGraphConsumers = dependencyGraph => {
  if (!isObject(dependencyGraph)) {
    return [];
  }

  const consumers = [];
  [
    ['consumers', false],
    ['directConsumers', false],
    ['transitiveConsumers', false],
    ['crossVerticalConsumers', true],
  ].forEach(([key, crossesVertical]) => {
    if (!Array.isArray(dependencyGraph[key])) {
      return;
    }
    dependencyGraph[key].forEach(consumer => {
      consumers.push({
        ...(isObject(consumer) ? consumer : { id: String(consumer) }),
        crossesVertical:
          consumer && typeof consumer.crossesVertical === 'boolean'
            ? consumer.crossesVertical
            : crossesVertical,
      });
    });
  });

  return consumers;
};

const getApprovedGateIds = ownershipGate => {
  const approvedGateIds = new Set();
  (ownershipGate.approvedGateIds || []).forEach(gateId => {
    if (isNonEmptyString(gateId)) {
      approvedGateIds.add(gateId);
    }
  });
  (ownershipGate.approvals || []).forEach(approval => {
    if (approval && isNonEmptyString(approval.gateId)) {
      approvedGateIds.add(approval.gateId);
    }
  });
  return approvedGateIds;
};

const impactRuleMatches = ({
  impactRule,
  changedOwnership,
  changedPaths,
  crossesVertical,
  maxGraphDepth,
}) => {
  const when = impactRule.when || {};
  if (
    Array.isArray(when.targetKinds) &&
    !when.targetKinds.includes(changedOwnership.target.kind)
  ) {
    return false;
  }
  if (
    Array.isArray(when.changedPathMatches) &&
    !changedPaths.some(changedPath =>
      matchesAnyGlob({ value: changedPath, globs: when.changedPathMatches }),
    )
  ) {
    return false;
  }
  if (
    typeof when.crossesVertical === 'boolean' &&
    when.crossesVertical !== crossesVertical
  ) {
    return false;
  }
  if (
    Number.isFinite(when.graphDepthGreaterThan) &&
    !(maxGraphDepth > when.graphDepthGreaterThan)
  ) {
    return false;
  }
  return true;
};

const validateOwnershipBlastRadius = ({ contract, ownershipGate }) => {
  validateOwnershipContractShape(contract);
  validateOwnershipGateProfileShape({
    ...ownershipGate,
    contract: ownershipGate.contract || contract,
  });

  const changedPaths = ownershipGate.changedPaths || [];
  const violations = [];
  const changedOwnership = [];

  changedPaths.forEach(changedPath => {
    const matches = resolvePathOwnership({ contract, changedPath });
    if (matches.length === 0) {
      violations.push({
        type: 'ownership-unowned-changed-path',
        filePath: changedPath,
        message: `Changed path "${changedPath}" is not covered by an ownership pathRule`,
      });
      return;
    }
    matches.forEach(match => {
      if (match.rule.rule === 'forbidden') {
        violations.push({
          type: 'ownership-forbidden-changed-path',
          filePath: changedPath,
          targetId: match.rule.targetId,
          message: `Changed path "${changedPath}" matches forbidden ownership pathRule "${match.rule.id}"`,
        });
        return;
      }
      if (!match.target) {
        violations.push({
          type: 'ownership-missing-target',
          filePath: changedPath,
          targetId: match.rule.targetId,
          message: `Changed path "${changedPath}" maps to missing ownership target "${match.rule.targetId}"`,
        });
        return;
      }
      changedOwnership.push(match);
    });
  });

  const targetsById = new Map(
    getOwnershipTargetEntries(contract).map(target => [target.id, target]),
  );
  const consumers = normalizeGraphConsumers(ownershipGate.dependencyGraph);
  let crossesVertical = false;
  let maxGraphDepth = 0;
  const consumerSummaries = [];

  consumers.forEach(consumer => {
    const consumerTarget = consumer.targetId
      ? targetsById.get(consumer.targetId)
      : undefined;
    const consumerVertical = consumer.vertical || consumerTarget?.vertical;
    const depth =
      Number.isFinite(consumer.depth) && consumer.depth >= 0
        ? consumer.depth
        : 1;
    maxGraphDepth = Math.max(maxGraphDepth, depth);

    if (consumer.targetId && !consumerTarget) {
      violations.push({
        type: 'ownership-unowned-consumer',
        consumerId: consumer.id,
        targetId: consumer.targetId,
        message: `Graph consumer "${consumer.id || consumer.targetId}" references unknown ownership target "${consumer.targetId}"`,
      });
      return;
    }

    const consumerCrossesVertical =
      Boolean(consumer.crossesVertical) ||
      changedOwnership.some(
        changed =>
          consumerVertical &&
          changed.target &&
          consumerVertical !== changed.target.vertical,
      );
    crossesVertical = crossesVertical || consumerCrossesVertical;
    consumerSummaries.push({
      id: consumer.id,
      targetId: consumer.targetId,
      vertical: consumerVertical,
      depth,
      crossesVertical: consumerCrossesVertical,
    });
  });

  const requiredGateIds = new Set();
  changedOwnership.forEach(changed => {
    (changed.rule.requiresApprovalGateIds || []).forEach(gateId =>
      requiredGateIds.add(gateId),
    );
  });

  const impactRules =
    contract.dependencyGraphImpact &&
    Array.isArray(contract.dependencyGraphImpact.impactRules)
      ? contract.dependencyGraphImpact.impactRules
      : [];
  impactRules.forEach(rule => {
    changedOwnership.forEach(changed => {
      if (
        impactRuleMatches({
          impactRule: rule,
          changedOwnership: changed,
          changedPaths,
          crossesVertical,
          maxGraphDepth,
        })
      ) {
        const then = rule.then || {};
        (then.requireApprovalGateIds || []).forEach(gateId =>
          requiredGateIds.add(gateId),
        );
        if (then.blockIfUnownedConsumer) {
          consumers.forEach(consumer => {
            if (consumer.targetId && !targetsById.has(consumer.targetId)) {
              violations.push({
                type: 'ownership-unowned-consumer',
                consumerId: consumer.id,
                targetId: consumer.targetId,
                impactRuleId: rule.id,
                message: `Impact rule "${rule.id}" blocks unowned graph consumer "${consumer.id || consumer.targetId}"`,
              });
            }
          });
        }
      }
    });
  });

  const approvalGateIds = new Set(contract.approvalGates.map(gate => gate.id));
  const approvedGateIds = getApprovedGateIds(ownershipGate);
  requiredGateIds.forEach(gateId => {
    if (!approvalGateIds.has(gateId)) {
      violations.push({
        type: 'ownership-unknown-approval-gate',
        gateId,
        message: `Required approval gate "${gateId}" is not declared in the ownership contract`,
      });
      return;
    }
    if (!approvedGateIds.has(gateId)) {
      violations.push({
        type: 'ownership-missing-approval-gate',
        gateId,
        message: `Required approval gate "${gateId}" is missing from ownershipGate approvals`,
      });
    }
  });

  return {
    changedTargets: changedOwnership.map(changed => ({
      path: changed.path,
      pathRuleId: changed.rule.id,
      targetId: changed.target.id,
      kind: changed.target.kind,
      vertical: changed.target.vertical,
    })),
    consumers: consumerSummaries,
    crossesVertical,
    requiredGateIds: Array.from(requiredGateIds).sort(),
    violations,
  };
};

const flattenViolations = sections =>
  sections.flatMap(section =>
    section.violations.map(violation => ({
      ...violation,
      section: section.section,
    })),
  );

const formatViolations = violations =>
  violations
    .map(violation => {
      const location =
        violation.filePath ||
        violation.manifestPath ||
        violation.guardId ||
        'n/a';
      return `- [${violation.section}] ${violation.message} (${location})`;
    })
    .join('\n');

const runBoundaryGuardChecks = ({
  profilePath,
  rootDir = process.cwd(),
  allowEmptyManifests = false,
}) => {
  const resolvedProfilePath = path.resolve(profilePath);
  const profile = readJsonFile(resolvedProfilePath);
  validateProfileShape(profile);

  const contractPath = path.resolve(rootDir, profile.contractPath);
  const contract = readJsonFile(contractPath);
  validateContractShape(contract);

  const moduleManifestPaths = Array.isArray(profile.moduleManifests)
    ? profile.moduleManifests.map(filePath => path.resolve(rootDir, filePath))
    : [];
  const moduleManifestDir = profile.moduleManifestDir
    ? path.resolve(rootDir, profile.moduleManifestDir)
    : undefined;

  const manifestValidationReport = validateManifests({
    contract,
    manifestPaths: moduleManifestPaths,
    manifestsDir: moduleManifestDir,
    allowEmpty: allowEmptyManifests,
  });
  const manifestPaths = manifestValidationReport.validated.map(
    manifest => manifest.path,
  );

  const scanExtensions = Array.isArray(profile.scanExtensions)
    ? profile.scanExtensions
    : DEFAULT_SCAN_EXTENSIONS;

  const importGuardReport = validateImportGuards({
    importGuards: profile.importGuards,
    rootDir,
    scanExtensions,
  });
  const requiredSnippetReport = validateRequiredSnippets({
    requiredSnippets: profile.requiredSnippets,
    rootDir,
  });
  const forbiddenPatternReport = validateModuleForbiddenPatterns({
    contract,
    manifestPaths,
    rootDir,
    scanExtensions,
  });
  let ownershipGateReport = {
    changedTargets: [],
    consumers: [],
    crossesVertical: false,
    requiredGateIds: [],
    violations: [],
  };
  if (profile.ownershipGate) {
    const ownershipContract = profile.ownershipGate.contract
      ? profile.ownershipGate.contract
      : readJsonFile(path.resolve(rootDir, profile.ownershipGate.contractPath));
    ownershipGateReport = validateOwnershipBlastRadius({
      contract: ownershipContract,
      ownershipGate: profile.ownershipGate,
    });
  }

  const allViolations = flattenViolations([
    { section: 'import-guards', violations: importGuardReport.violations },
    {
      section: 'required-snippets',
      violations: requiredSnippetReport.violations,
    },
    {
      section: 'module-forbidden-patterns',
      violations: forbiddenPatternReport.violations,
    },
    {
      section: 'ownership-gates',
      violations: ownershipGateReport.violations,
    },
  ]);
  if (allViolations.length > 0) {
    throw new Error(
      `Boundary anti-pattern checks failed with ${String(
        allViolations.length,
      )} violation(s):\n${formatViolations(allViolations)}`,
    );
  }

  return {
    profilePath: resolvedProfilePath,
    contractPath,
    validatedManifests: manifestValidationReport.validated.length,
    importGuardFilesScanned: importGuardReport.inspectedFiles,
    requiredSnippetChecks: requiredSnippetReport.validations.length,
    moduleSourceValidations: forbiddenPatternReport.validations.length,
    ownershipGateChangedTargets: ownershipGateReport.changedTargets.length,
    ownershipGateRequiredApprovals: ownershipGateReport.requiredGateIds.length,
  };
};

module.exports = {
  SCHEMA_VERSION,
  DEFAULT_SCAN_EXTENSIONS,
  extractImportSpecifiers,
  resolvePathOwnership,
  runBoundaryGuardChecks,
  validateImportGuards,
  validateModuleForbiddenPatterns,
  validateOwnershipBlastRadius,
  validateOwnershipContractShape,
  validateOwnershipGateProfileShape,
  validateProfileShape,
  validateRequiredSnippets,
  walkFiles,
};
