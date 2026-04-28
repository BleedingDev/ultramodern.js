const fs = require('fs');
const path = require('path');

const SCHEMA_VERSION = 1;
const CONSUMER_STATUSES = new Set(['affected', 'unaffected']);

const DEFAULT_DRILL_PATH = path.resolve(
  __dirname,
  '__fixtures__/design-system-bad-release.json',
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

const ensureStringArray = (value, context) => {
  ensureArray(value, context);
  value.forEach((item, index) => ensureString(item, `${context}[${index}]`));
};

const createArtifactMap = artifacts =>
  new Map(artifacts.map(artifact => [artifact.id, artifact]));

const validateArtifact = (artifact, context) => {
  ensureObject(artifact, context);
  ['id', 'version', 'contractVersion'].forEach(field =>
    ensureString(artifact[field], `${context}.${field}`),
  );
  ensureStringArray(artifact.tokens, `${context}.tokens`);
  ensureStringArray(artifact.apis, `${context}.apis`);
};

const diffConsumerImpact = ({ consumer, badArtifact }) => {
  const issues = [];

  if (consumer.expectedContractVersion !== badArtifact.contractVersion) {
    issues.push({
      type: 'version-skew',
      consumerId: consumer.id,
      expected: consumer.expectedContractVersion,
      received: badArtifact.contractVersion,
    });
  }

  for (const token of consumer.requiredTokens) {
    if (!badArtifact.tokens.includes(token)) {
      issues.push({
        type: 'missing-token',
        consumerId: consumer.id,
        token,
      });
    }
  }

  for (const api of consumer.requiredApis) {
    if (!badArtifact.apis.includes(api)) {
      issues.push({
        type: 'missing-api',
        consumerId: consumer.id,
        api,
      });
    }
  }

  return issues;
};

const validateDesignSystemBadReleaseDrill = drill => {
  ensureObject(drill, 'drill');
  if (drill.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(
      `Unsupported drill schemaVersion: ${String(
        drill.schemaVersion,
      )}. Expected ${String(SCHEMA_VERSION)}.`,
    );
  }

  ['id', 'description', 'environment'].forEach(field =>
    ensureString(drill[field], `drill.${field}`),
  );

  ensureObject(drill.designSystemRemote, 'drill.designSystemRemote');
  ensureString(drill.designSystemRemote.id, 'drill.designSystemRemote.id');
  if (drill.designSystemRemote.kind !== 'horizontal-design-system') {
    throw new Error(
      'drill.designSystemRemote.kind must be "horizontal-design-system"',
    );
  }

  ensureArray(drill.artifacts, 'drill.artifacts');
  ensureUniqueIds(drill.artifacts, 'drill.artifacts');
  drill.artifacts.forEach((artifact, index) =>
    validateArtifact(artifact, `drill.artifacts[${index}]`),
  );
  const artifactMap = createArtifactMap(drill.artifacts);

  const badArtifact = artifactMap.get(drill.designSystemRemote.badArtifactId);
  if (!badArtifact) {
    throw new Error(
      `drill.designSystemRemote.badArtifactId references unknown artifact "${drill.designSystemRemote.badArtifactId}"`,
    );
  }

  ensureArray(drill.consumers, 'drill.consumers');
  ensureUniqueIds(drill.consumers, 'drill.consumers');

  const impactedConsumers = [];
  const unaffectedConsumers = [];
  const impactIssues = [];

  drill.consumers.forEach((consumer, index) => {
    const context = `drill.consumers[${index}]`;
    ['id', 'kind', 'expectedStatus', 'expectedContractVersion'].forEach(field =>
      ensureString(consumer[field], `${context}.${field}`),
    );
    if (!CONSUMER_STATUSES.has(consumer.expectedStatus)) {
      throw new Error(
        `${context}.expectedStatus must be "affected" or "unaffected"`,
      );
    }
    ensureStringArray(consumer.requiredTokens, `${context}.requiredTokens`);
    ensureStringArray(consumer.requiredApis, `${context}.requiredApis`);

    ensureObject(consumer.pin, `${context}.pin`);
    ['currentArtifactId', 'rollbackArtifactId', 'evidenceRef'].forEach(field =>
      ensureString(consumer.pin[field], `${context}.pin.${field}`),
    );
    if (!artifactMap.has(consumer.pin.currentArtifactId)) {
      throw new Error(
        `${context}.pin.currentArtifactId references unknown artifact "${consumer.pin.currentArtifactId}"`,
      );
    }
    if (!artifactMap.has(consumer.pin.rollbackArtifactId)) {
      throw new Error(
        `${context}.pin.rollbackArtifactId references unknown artifact "${consumer.pin.rollbackArtifactId}"`,
      );
    }

    const consumerImpact = diffConsumerImpact({ consumer, badArtifact });
    if (consumerImpact.length > 0) {
      impactedConsumers.push(consumer);
      impactIssues.push(...consumerImpact);
    } else {
      unaffectedConsumers.push(consumer);
    }

    if (consumer.expectedStatus === 'unaffected' && consumerImpact.length > 0) {
      throw new Error(
        `${context} is declared unaffected but bad release impacts "${consumer.id}"`,
      );
    }
    if (consumer.expectedStatus === 'affected' && consumerImpact.length === 0) {
      throw new Error(
        `${context} is declared affected but no bad-release impact was detected`,
      );
    }
  });

  ensureObject(drill.rollback, 'drill.rollback');
  [
    'targetArtifactId',
    'targetVersion',
    'targetContractVersion',
    'reason',
    'approvedBy',
    'runbookRef',
  ].forEach(field =>
    ensureString(drill.rollback[field], `drill.rollback.${field}`),
  );

  const rollbackArtifact = artifactMap.get(drill.rollback.targetArtifactId);
  if (!rollbackArtifact) {
    throw new Error(
      `drill.rollback.targetArtifactId references unknown artifact "${drill.rollback.targetArtifactId}"`,
    );
  }
  if (rollbackArtifact.version !== drill.rollback.targetVersion) {
    throw new Error('drill.rollback.targetVersion must match target artifact');
  }
  if (
    rollbackArtifact.contractVersion !== drill.rollback.targetContractVersion
  ) {
    throw new Error(
      'drill.rollback.targetContractVersion must match target artifact',
    );
  }

  const rollbackPinnedConsumers = new Set(
    drill.consumers
      .filter(
        consumer => consumer.pin.rollbackArtifactId === rollbackArtifact.id,
      )
      .map(consumer => consumer.id),
  );
  for (const consumer of impactedConsumers) {
    if (!rollbackPinnedConsumers.has(consumer.id)) {
      throw new Error(
        `affected consumer "${consumer.id}" is missing rollback pin to "${rollbackArtifact.id}"`,
      );
    }
  }

  ensureObject(drill.evidence, 'drill.evidence');
  ensureStringArray(
    drill.evidence.detectionNotes,
    'drill.evidence.detectionNotes',
  );
  ensureStringArray(
    drill.evidence.remediationNotes,
    'drill.evidence.remediationNotes',
  );

  return {
    drillId: drill.id,
    environment: drill.environment,
    designSystemRemoteId: drill.designSystemRemote.id,
    badArtifactId: badArtifact.id,
    badVersion: badArtifact.version,
    badContractVersion: badArtifact.contractVersion,
    rollbackTargetArtifactId: rollbackArtifact.id,
    rollbackTargetVersion: rollbackArtifact.version,
    impactedConsumers: impactedConsumers.map(consumer => consumer.id),
    unaffectedConsumers: unaffectedConsumers.map(consumer => consumer.id),
    affectedVerticals: impactedConsumers
      .filter(consumer => consumer.kind === 'vertical')
      .map(consumer => consumer.id),
    unaffectedVerticals: unaffectedConsumers
      .filter(consumer => consumer.kind === 'vertical')
      .map(consumer => consumer.id),
    impactIssues,
    evidenceNotes: drill.evidence.detectionNotes.length,
    remediationNotes: drill.evidence.remediationNotes.length,
  };
};

const loadDesignSystemBadReleaseDrill = (drillPath = DEFAULT_DRILL_PATH) => {
  const drill = readJsonFile(drillPath);
  const evidenceSummary = validateDesignSystemBadReleaseDrill(drill);
  return {
    drill,
    evidenceSummary,
  };
};

module.exports = {
  DEFAULT_DRILL_PATH,
  diffConsumerImpact,
  loadDesignSystemBadReleaseDrill,
  readJsonFile,
  validateDesignSystemBadReleaseDrill,
};
