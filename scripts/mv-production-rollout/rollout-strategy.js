const fs = require('fs');
const path = require('path');

const SCHEMA_VERSION = 1;
const ENVIRONMENT_ORDER = ['development', 'staging', 'canary', 'production'];
const MAX_PERCENTAGE_JUMP = 50;
const DEFAULT_STRATEGY_PATH = path.resolve(
  __dirname,
  '__fixtures__/rollout-strategy.json',
);

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

const ensureNumber = (value, context) => {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${context} must be a non-negative number`);
  }
};

const ensureStringArray = (value, context) => {
  ensureArray(value, context);
  value.forEach((item, index) => ensureString(item, `${context}[${index}]`));
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

const validateSignedManifest = (signedManifest, context) => {
  ensureObject(signedManifest, context);
  ['policyRef', 'manifestRef', 'signatureRef', 'attestationRef'].forEach(
    field => ensureString(signedManifest[field], `${context}.${field}`),
  );
  ensureBoolean(signedManifest.enforced, `${context}.enforced`);
  if (!signedManifest.enforced) {
    throw new Error(`${context}.enforced must be true`);
  }
};

const validateSloChecks = (sloChecks, context) => {
  ensureArray(sloChecks, context);
  if (sloChecks.length === 0) {
    throw new Error(`${context} must not be empty`);
  }

  return sloChecks.map((check, index) => {
    const checkContext = `${context}[${index}]`;
    ensureObject(check, checkContext);
    ['name', 'evidenceRef'].forEach(field =>
      ensureString(check[field], `${checkContext}.${field}`),
    );
    ['budget', 'observed'].forEach(field =>
      ensureNumber(check[field], `${checkContext}.${field}`),
    );
    if (check.observed > check.budget) {
      throw new Error(`${checkContext}.observed breaches budget`);
    }
    return check.name;
  });
};

const validateApprovals = (approvals, context) => {
  ensureArray(approvals, context);
  if (approvals.length === 0) {
    throw new Error(`${context} must not be empty`);
  }

  approvals.forEach((approval, index) => {
    const approvalContext = `${context}[${index}]`;
    ensureObject(approval, approvalContext);
    ['owner', 'role', 'approvedAt', 'evidenceRef'].forEach(field =>
      ensureString(approval[field], `${approvalContext}.${field}`),
    );
  });
};

const validateRollbackTriggers = (rollbackTriggers, context) => {
  ensureArray(rollbackTriggers, context);
  if (rollbackTriggers.length === 0) {
    throw new Error(`${context} must not be empty`);
  }

  rollbackTriggers.forEach((trigger, index) => {
    const triggerContext = `${context}[${index}]`;
    ensureObject(trigger, triggerContext);
    ['metric', 'threshold', 'action', 'evidenceRef'].forEach(field =>
      ensureString(trigger[field], `${triggerContext}.${field}`),
    );
    if (!['rollback', 'hold', 'disable'].includes(trigger.action)) {
      throw new Error(
        `${triggerContext}.action must be rollback, hold, or disable`,
      );
    }
  });
};

const validateKillSwitch = (killSwitch, context) => {
  ensureObject(killSwitch, context);
  ['flag', 'owner', 'runbookRef', 'evidenceRef'].forEach(field =>
    ensureString(killSwitch[field], `${context}.${field}`),
  );
  ensureBoolean(killSwitch.available, `${context}.available`);
  if (!killSwitch.available) {
    throw new Error(`${context}.available must be true`);
  }
};

const validateGate = ({ gate, context, previousGate }) => {
  ensureObject(gate, context);
  ['environment', 'entryCriteriaRef', 'exitCriteriaRef', 'holdWindow'].forEach(
    field => ensureString(gate[field], `${context}.${field}`),
  );
  ensureNumber(gate.percentage, `${context}.percentage`);
  if (gate.percentage > 100) {
    throw new Error(`${context}.percentage must not exceed 100`);
  }

  if (previousGate) {
    const jump = gate.percentage - previousGate.percentage;
    if (jump < 0) {
      throw new Error(`${context}.percentage must not decrease`);
    }
    if (jump > MAX_PERCENTAGE_JUMP) {
      throw new Error(
        `${context}.percentage jump from ${String(
          previousGate.percentage,
        )} to ${String(gate.percentage)} exceeds ${String(
          MAX_PERCENTAGE_JUMP,
        )}`,
      );
    }
  }

  validateSignedManifest(gate.signedManifest, `${context}.signedManifest`);
  const sloNames = validateSloChecks(gate.sloChecks, `${context}.sloChecks`);
  validateRollbackTriggers(
    gate.rollbackTriggers,
    `${context}.rollbackTriggers`,
  );
  validateKillSwitch(gate.killSwitch, `${context}.killSwitch`);
  validateApprovals(gate.approvals, `${context}.approvals`);

  return {
    environment: gate.environment,
    percentage: gate.percentage,
    holdWindow: gate.holdWindow,
    sloChecks: sloNames,
    approvalOwners: gate.approvals.map(approval => approval.owner),
    killSwitchFlag: gate.killSwitch.flag,
  };
};

const validateVertical = vertical => {
  ensureObject(vertical, 'strategy.verticals item');
  ['id', 'ownerTeam'].forEach(field =>
    ensureString(
      vertical[field],
      `strategy.verticals.${vertical.id || 'item'}.${field}`,
    ),
  );
  ensureStringArray(
    vertical.environments,
    `strategy.verticals.${vertical.id}.environments`,
  );
  if (
    JSON.stringify(vertical.environments) !== JSON.stringify(ENVIRONMENT_ORDER)
  ) {
    throw new Error(
      `strategy.verticals.${vertical.id}.environments must be ${ENVIRONMENT_ORDER.join(
        ' -> ',
      )}`,
    );
  }

  ensureArray(vertical.gates, `strategy.verticals.${vertical.id}.gates`);
  if (vertical.gates.length !== ENVIRONMENT_ORDER.length) {
    throw new Error(
      `strategy.verticals.${vertical.id}.gates must include ${String(
        ENVIRONMENT_ORDER.length,
      )} gates`,
    );
  }

  const gateEvidence = [];
  let previousGate;
  vertical.gates.forEach((gate, index) => {
    const expectedEnvironment = ENVIRONMENT_ORDER[index];
    const context = `strategy.verticals.${vertical.id}.gates[${index}]`;
    if (gate.environment !== expectedEnvironment) {
      throw new Error(
        `${context}.environment must be "${expectedEnvironment}"`,
      );
    }
    const summary = validateGate({ gate, context, previousGate });
    gateEvidence.push(summary);
    previousGate = gate;
  });

  const finalGate = vertical.gates[vertical.gates.length - 1];
  if (finalGate.percentage !== 100) {
    throw new Error(
      `strategy.verticals.${vertical.id}.gates production percentage must be 100`,
    );
  }

  return {
    verticalId: vertical.id,
    ownerTeam: vertical.ownerTeam,
    environments: vertical.environments,
    gates: gateEvidence,
    finalPercentage: finalGate.percentage,
  };
};

const summarizeRolloutStrategy = strategy => ({
  strategyId: strategy.id,
  schemaVersion: strategy.schemaVersion,
  environmentOrder: ENVIRONMENT_ORDER,
  maxPercentageJump: MAX_PERCENTAGE_JUMP,
  verticals: strategy.verticals.map(validateVertical),
});

const validateRolloutStrategy = strategy => {
  ensureObject(strategy, 'strategy');
  if (strategy.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(
      `Unsupported strategy schemaVersion: ${String(
        strategy.schemaVersion,
      )}. Expected ${String(SCHEMA_VERSION)}.`,
    );
  }
  ensureString(strategy.id, 'strategy.id');
  ensureArray(strategy.verticals, 'strategy.verticals');
  ensureUniqueIds(strategy.verticals, 'strategy.verticals');
  if (strategy.verticals.length === 0) {
    throw new Error('strategy.verticals must not be empty');
  }

  return summarizeRolloutStrategy(strategy);
};

const loadRolloutStrategy = (strategyPath = DEFAULT_STRATEGY_PATH) => {
  const strategy = readJsonFile(strategyPath);
  const evidenceSummary = validateRolloutStrategy(strategy);
  return {
    strategy,
    evidenceSummary,
  };
};

module.exports = {
  DEFAULT_STRATEGY_PATH,
  ENVIRONMENT_ORDER,
  MAX_PERCENTAGE_JUMP,
  loadRolloutStrategy,
  readJsonFile,
  summarizeRolloutStrategy,
  validateRolloutStrategy,
};
