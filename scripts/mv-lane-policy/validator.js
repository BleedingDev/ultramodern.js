const fs = require('fs');
const path = require('path');

const SCHEMA_VERSION = 1;
const DEFAULT_POLICY_PATH = path.resolve(__dirname, 'lane-policy.json');

const readJsonFile = filePath => {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
};

const ensureObject = (value, context) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${context} must be an object`);
  }
};

const ensureArray = (value, context) => {
  if (!Array.isArray(value)) {
    throw new Error(`${context} must be an array`);
  }
};

const ensureNonEmptyArray = (value, context) => {
  ensureArray(value, context);
  if (value.length === 0) {
    throw new Error(`${context} must not be empty`);
  }
};

const ensureString = (value, context) => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${context} must be a non-empty string`);
  }
};

const ensureBoolean = (value, context) => {
  if (typeof value !== 'boolean') {
    throw new Error(`${context} must be a boolean`);
  }
};

const ensureStringArray = (value, context) => {
  ensureNonEmptyArray(value, context);
  value.forEach((item, index) => ensureString(item, `${context}[${index}]`));
};

const createSet = (items, context) => {
  ensureStringArray(items, context);
  const seen = new Set();
  items.forEach(item => {
    if (seen.has(item)) {
      throw new Error(`${context} contains duplicate value "${item}"`);
    }
    seen.add(item);
  });
  return seen;
};

const ensureKnownValues = ({ values, knownValues, context, knownContext }) => {
  ensureStringArray(values, context);
  values.forEach(value => {
    if (!knownValues.has(value)) {
      throw new Error(`${context} contains unknown ${knownContext} "${value}"`);
    }
  });
};

const ensureUniqueIds = (items, context) => {
  const seen = new Set();
  items.forEach((item, index) => {
    ensureObject(item, `${context}[${index}]`);
    ensureString(item.id, `${context}[${index}].id`);
    if (seen.has(item.id)) {
      throw new Error(`${context} contains duplicate id "${item.id}"`);
    }
    seen.add(item.id);
  });
};

const combinationKey = combination =>
  `${combination.runtime}|${combination.router}|${combination.service}`;

const validateAllowedCombinations = ({ tierName, tierPolicy }) => {
  ensureNonEmptyArray(
    tierPolicy.allowedCombinations,
    `tierPolicies.${tierName}.allowedCombinations`,
  );

  const seen = new Set();
  tierPolicy.allowedCombinations.forEach((combination, index) => {
    const context = `tierPolicies.${tierName}.allowedCombinations[${index}]`;
    ensureObject(combination, context);
    ['runtime', 'router', 'service'].forEach(field =>
      ensureString(combination[field], `${context}.${field}`),
    );

    const key = combinationKey(combination);
    if (seen.has(key)) {
      throw new Error(
        `tierPolicies.${tierName}.allowedCombinations contains duplicate combination "${key}"`,
      );
    }
    seen.add(key);
  });

  return seen;
};

const validateTierPolicies = ({ policy, gateCatalog, evidenceCatalog }) => {
  ensureObject(policy.tierPolicies, 'tierPolicies');
  const tierEntries = Object.entries(policy.tierPolicies);
  if (tierEntries.length === 0) {
    throw new Error('tierPolicies must not be empty');
  }

  const tierPolicySummary = new Map();
  for (const [tierName, tierPolicy] of tierEntries) {
    const context = `tierPolicies.${tierName}`;
    ensureObject(tierPolicy, context);
    ensureString(tierPolicy.description, `${context}.description`);
    ensureString(tierPolicy.ciBudget, `${context}.ciBudget`);
    ensureBoolean(tierPolicy.productionDefault, `${context}.productionDefault`);
    ensureBoolean(
      tierPolicy.requiresExplicitOptIn,
      `${context}.requiresExplicitOptIn`,
    );
    ensureKnownValues({
      values: tierPolicy.requiredGates,
      knownValues: gateCatalog,
      context: `${context}.requiredGates`,
      knownContext: 'gate',
    });
    ensureKnownValues({
      values: tierPolicy.requiredEvidence,
      knownValues: evidenceCatalog,
      context: `${context}.requiredEvidence`,
      knownContext: 'evidence',
    });

    tierPolicySummary.set(tierName, {
      allowedCombinations: validateAllowedCombinations({
        tierName,
        tierPolicy,
      }),
      requiredGates: new Set(tierPolicy.requiredGates),
      requiredEvidence: new Set(tierPolicy.requiredEvidence),
      ciBudget: tierPolicy.ciBudget,
      productionDefault: tierPolicy.productionDefault,
      requiresExplicitOptIn: tierPolicy.requiresExplicitOptIn,
    });
  }

  return tierPolicySummary;
};

const validatePromotionRules = ({ policy, tierNames, signalCatalog }) => {
  ensureNonEmptyArray(policy.promotionRules, 'promotionRules');
  policy.promotionRules.forEach((rule, index) => {
    const context = `promotionRules[${index}]`;
    ensureObject(rule, context);
    ['fromTier', 'toTier'].forEach(field => {
      ensureString(rule[field], `${context}.${field}`);
      if (!tierNames.has(rule[field])) {
        throw new Error(`${context}.${field} references unknown tier`);
      }
    });
    if (rule.fromTier === rule.toTier) {
      throw new Error(`${context} must promote between different tiers`);
    }
    ensureKnownValues({
      values: rule.requiredSignals,
      knownValues: signalCatalog,
      context: `${context}.requiredSignals`,
      knownContext: 'promotion signal',
    });
  });
};

const validateDemotionRules = ({
  policy,
  tierNames,
  demotionTriggerCatalog,
}) => {
  ensureNonEmptyArray(policy.demotionRules, 'demotionRules');
  policy.demotionRules.forEach((rule, index) => {
    const context = `demotionRules[${index}]`;
    ensureObject(rule, context);
    ensureString(rule.fromTier, `${context}.fromTier`);
    ensureString(rule.toTier, `${context}.toTier`);
    if (!tierNames.has(rule.fromTier)) {
      throw new Error(`${context}.fromTier references unknown tier`);
    }
    if (rule.toTier !== 'disabled' && !tierNames.has(rule.toTier)) {
      throw new Error(`${context}.toTier references unknown tier`);
    }
    if (rule.fromTier === rule.toTier) {
      throw new Error(`${context} must demote between different tiers`);
    }
    ensureKnownValues({
      values: rule.triggers,
      knownValues: demotionTriggerCatalog,
      context: `${context}.triggers`,
      knownContext: 'demotion trigger',
    });
  });
};

const validatePolicyShape = policy => {
  ensureObject(policy, 'policy');
  if (policy.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(
      `Unsupported policy schemaVersion: ${String(
        policy.schemaVersion,
      )}. Expected ${String(SCHEMA_VERSION)}.`,
    );
  }

  ensureString(policy.name, 'policy.name');
  const gateCatalog = createSet(policy.gateCatalog, 'gateCatalog');
  const evidenceCatalog = createSet(policy.evidenceCatalog, 'evidenceCatalog');
  const signalCatalog = createSet(policy.signalCatalog, 'signalCatalog');
  const demotionTriggerCatalog = createSet(
    policy.demotionTriggerCatalog,
    'demotionTriggerCatalog',
  );
  const tierPolicySummary = validateTierPolicies({
    policy,
    gateCatalog,
    evidenceCatalog,
  });
  const tierNames = new Set(tierPolicySummary.keys());

  validatePromotionRules({ policy, tierNames, signalCatalog });
  validateDemotionRules({ policy, tierNames, demotionTriggerCatalog });
  ensureNonEmptyArray(policy.laneDefinitions, 'laneDefinitions');

  return {
    demotionTriggerCatalog,
    evidenceCatalog,
    gateCatalog,
    signalCatalog,
    tierNames,
    tierPolicySummary,
  };
};

const ensureIncludesAll = ({ values, requiredValues, context, kind }) => {
  const valueSet = new Set(values);
  for (const requiredValue of requiredValues) {
    if (!valueSet.has(requiredValue)) {
      throw new Error(
        `${context} is missing required ${kind} "${requiredValue}"`,
      );
    }
  }
};

const validateLaneDefinitions = ({ lanes, policy, policySummary }) => {
  ensureNonEmptyArray(lanes, 'laneDefinitions');
  ensureUniqueIds(lanes, 'laneDefinitions');

  const laneSummaries = lanes.map((lane, index) => {
    const context = `laneDefinitions[${index}]`;
    ensureObject(lane, context);
    ['id', 'tier', 'runtime', 'router', 'service', 'ciBudget'].forEach(field =>
      ensureString(lane[field], `${context}.${field}`),
    );
    ensureBoolean(lane.productionDefault, `${context}.productionDefault`);
    ensureBoolean(lane.explicitOptIn, `${context}.explicitOptIn`);

    if (!policySummary.tierNames.has(lane.tier)) {
      throw new Error(`${context}.tier references unknown tier "${lane.tier}"`);
    }

    const tierPolicy = policySummary.tierPolicySummary.get(lane.tier);
    const key = combinationKey(lane);
    if (!tierPolicy.allowedCombinations.has(key)) {
      throw new Error(
        `${context} uses unsupported ${lane.tier} combination ${lane.runtime}/${lane.router}/${lane.service}`,
      );
    }

    ensureKnownValues({
      values: lane.gates,
      knownValues: policySummary.gateCatalog,
      context: `${context}.gates`,
      knownContext: 'gate',
    });
    ensureKnownValues({
      values: lane.evidence,
      knownValues: policySummary.evidenceCatalog,
      context: `${context}.evidence`,
      knownContext: 'evidence',
    });
    ensureIncludesAll({
      values: lane.gates,
      requiredValues: tierPolicy.requiredGates,
      context: `${context}.gates`,
      kind: 'gate',
    });
    ensureIncludesAll({
      values: lane.evidence,
      requiredValues: tierPolicy.requiredEvidence,
      context: `${context}.evidence`,
      kind: 'evidence',
    });

    if (lane.ciBudget !== tierPolicy.ciBudget) {
      throw new Error(
        `${context}.ciBudget must be "${tierPolicy.ciBudget}" for ${lane.tier}`,
      );
    }
    if (lane.productionDefault !== tierPolicy.productionDefault) {
      throw new Error(
        `${context}.productionDefault must be ${String(
          tierPolicy.productionDefault,
        )} for ${lane.tier}`,
      );
    }
    if (lane.explicitOptIn !== tierPolicy.requiresExplicitOptIn) {
      throw new Error(
        `${context}.explicitOptIn must be ${String(
          tierPolicy.requiresExplicitOptIn,
        )} for ${lane.tier}`,
      );
    }

    return {
      id: lane.id,
      tier: lane.tier,
      combination: {
        runtime: lane.runtime,
        router: lane.router,
        service: lane.service,
      },
      gateCount: lane.gates.length,
      evidenceCount: lane.evidence.length,
      ciBudget: lane.ciBudget,
      productionDefault: lane.productionDefault,
      explicitOptIn: lane.explicitOptIn,
    };
  });

  const productionDefaults = laneSummaries.filter(
    lane => lane.productionDefault,
  );
  if (productionDefaults.length !== 1) {
    throw new Error(
      `laneDefinitions must contain exactly one production default lane. Found ${String(
        productionDefaults.length,
      )}.`,
    );
  }

  return {
    policyName: policy.name,
    laneCount: laneSummaries.length,
    lanes: laneSummaries,
    productionDefaultLane: productionDefaults[0].id,
  };
};

const validateLanePolicy = policy => {
  const policySummary = validatePolicyShape(policy);
  return validateLaneDefinitions({
    lanes: policy.laneDefinitions,
    policy,
    policySummary,
  });
};

const validateLaneDefinitionsAgainstPolicy = ({ lanes, policy }) => {
  const policySummary = validatePolicyShape(policy);
  return validateLaneDefinitions({ lanes, policy, policySummary });
};

const loadLanePolicy = (policyPath = DEFAULT_POLICY_PATH) => {
  const policy = readJsonFile(policyPath);
  const summary = validateLanePolicy(policy);
  return {
    policy,
    summary,
  };
};

module.exports = {
  DEFAULT_POLICY_PATH,
  SCHEMA_VERSION,
  loadLanePolicy,
  readJsonFile,
  validateLaneDefinitions,
  validateLaneDefinitionsAgainstPolicy,
  validateLanePolicy,
  validatePolicyShape,
};
