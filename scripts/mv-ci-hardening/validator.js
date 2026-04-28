const fs = require('fs');
const path = require('path');

const SCHEMA_VERSION = 1;
const DEFAULT_PROFILE_PATH = path.resolve(
  __dirname,
  'mv-ci-hardening-profile.json',
);
const REQUIRED_TIERS = ['golden', 'compat', 'experimental'];
const ISSUE_REF_PATTERN =
  /^(modernjs-[a-z0-9]+|https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/issues\/\d+)$/;
const PLACEHOLDER_VALUES = new Set([
  'tbd',
  'todo',
  'pending',
  'unknown',
  'n/a',
  'na',
  'none',
  'null',
  'undefined',
  'changeme',
]);

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

const ensureInteger = (value, context) => {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${context} must be a non-negative integer`);
  }
};

const ensurePositiveInteger = (value, context) => {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${context} must be a positive integer`);
  }
};

const normalizeIdentifier = value => String(value).trim().toLowerCase();

const isPlaceholder = value => {
  const normalized = normalizeIdentifier(value);
  return (
    PLACEHOLDER_VALUES.has(normalized) ||
    /^tbd\b/.test(normalized) ||
    /^todo\b/.test(normalized)
  );
};

const ensureNonPlaceholderString = (value, context) => {
  ensureString(value, context);
  if (isPlaceholder(value)) {
    throw new Error(`${context} must not use placeholder value "${value}"`);
  }
};

const parseIsoDate = (value, context) => {
  ensureString(value, context);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${context} must use YYYY-MM-DD format`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${context} must be a valid date`);
  }
  return parsed;
};

const daysBetweenInclusive = ({ from, to }) => {
  const milliseconds = to.getTime() - from.getTime();
  return Math.floor(milliseconds / 86400000);
};

const validatePolicy = policy => {
  ensureObject(policy, 'profile.policy');
  ensurePositiveInteger(
    policy.maxFlakeWaiverDays,
    'profile.policy.maxFlakeWaiverDays',
  );
  ensurePositiveInteger(
    policy.maxRetryAttempts,
    'profile.policy.maxRetryAttempts',
  );
  return {
    maxFlakeWaiverDays: policy.maxFlakeWaiverDays,
    maxRetryAttempts: policy.maxRetryAttempts,
  };
};

const validateTierBudgets = tiers => {
  ensureObject(tiers, 'profile.tiers');

  const report = {};
  for (const tierId of REQUIRED_TIERS) {
    const tier = tiers[tierId];
    const context = `profile.tiers.${tierId}`;
    ensureObject(tier, context);
    ensurePositiveInteger(
      tier.maxRuntimeMinutes,
      `${context}.maxRuntimeMinutes`,
    );
    ensurePositiveInteger(
      tier.maxTimeoutMinutes,
      `${context}.maxTimeoutMinutes`,
    );
    ensureInteger(tier.maxFlakeWaivers, `${context}.maxFlakeWaivers`);
    ensureString(tier.requiredEvidence, `${context}.requiredEvidence`);

    if (tier.maxTimeoutMinutes > tier.maxRuntimeMinutes) {
      throw new Error(
        `${context}.maxTimeoutMinutes must not exceed maxRuntimeMinutes`,
      );
    }

    report[tierId] = {
      maxRuntimeMinutes: tier.maxRuntimeMinutes,
      maxTimeoutMinutes: tier.maxTimeoutMinutes,
      maxFlakeWaivers: tier.maxFlakeWaivers,
      requiredEvidence: tier.requiredEvidence,
    };
  }

  return report;
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

const validateIssueRef = (issueRef, context) => {
  ensureString(issueRef, context);
  if (!ISSUE_REF_PATTERN.test(issueRef)) {
    throw new Error(
      `${context} must reference a bead or GitHub issue, found "${issueRef}"`,
    );
  }
};

const validateRetryPolicy = ({ retryPolicy, context, policy }) => {
  if (retryPolicy === undefined) {
    return {
      maxAttempts: 1,
      issueRef: undefined,
      reason: undefined,
    };
  }

  ensureObject(retryPolicy, context);
  ensurePositiveInteger(retryPolicy.maxAttempts, `${context}.maxAttempts`);

  if (retryPolicy.maxAttempts > policy.maxRetryAttempts) {
    throw new Error(
      `${context}.maxAttempts exceeds policy maxRetryAttempts ${String(
        policy.maxRetryAttempts,
      )}`,
    );
  }

  if (retryPolicy.maxAttempts > 1) {
    validateIssueRef(retryPolicy.issueRef, `${context}.issueRef`);
    ensureNonPlaceholderString(retryPolicy.reason, `${context}.reason`);
  }

  return {
    maxAttempts: retryPolicy.maxAttempts,
    issueRef: retryPolicy.issueRef,
    reason: retryPolicy.reason,
  };
};

const validateFlakeWaiver = ({
  waiver,
  context,
  today,
  policy,
  checkOwner,
}) => {
  ensureObject(waiver, context);
  validateIssueRef(waiver.issueRef, `${context}.issueRef`);
  ensureNonPlaceholderString(waiver.owner, `${context}.owner`);
  ensureNonPlaceholderString(waiver.reason, `${context}.reason`);
  const expiresOn = parseIsoDate(waiver.expiresOn, `${context}.expiresOn`);
  const openedOn = parseIsoDate(waiver.openedOn, `${context}.openedOn`);

  if (expiresOn.getTime() < today.getTime()) {
    throw new Error(`${context}.expiresOn is stale`);
  }

  const waiverDuration = daysBetweenInclusive({
    from: openedOn,
    to: expiresOn,
  });
  if (waiverDuration < 0) {
    throw new Error(`${context}.expiresOn must be on or after openedOn`);
  }
  if (waiverDuration > policy.maxFlakeWaiverDays) {
    throw new Error(
      `${context} duration ${String(
        waiverDuration,
      )} days exceeds maxFlakeWaiverDays ${String(policy.maxFlakeWaiverDays)}`,
    );
  }

  if (normalizeIdentifier(waiver.owner) !== normalizeIdentifier(checkOwner)) {
    throw new Error(`${context}.owner must match owning check owner`);
  }

  return {
    issueRef: waiver.issueRef,
    owner: waiver.owner,
    expiresOn: waiver.expiresOn,
    reason: waiver.reason,
  };
};

const validateCheck = ({ check, index, tiers, policy, today }) => {
  const context = `profile.checks[${index}]`;
  ensureNonPlaceholderString(check.id, `${context}.id`);
  ensureNonPlaceholderString(check.tier, `${context}.tier`);
  ensureNonPlaceholderString(check.owner, `${context}.owner`);
  ensureNonPlaceholderString(check.command, `${context}.command`);
  ensureNonPlaceholderString(check.riskClass, `${context}.riskClass`);
  ensurePositiveInteger(
    check.runtimeBudgetMinutes,
    `${context}.runtimeBudgetMinutes`,
  );
  ensurePositiveInteger(check.timeoutMinutes, `${context}.timeoutMinutes`);

  const tier = tiers[check.tier];
  if (!tier) {
    throw new Error(`${context}.tier references unknown tier "${check.tier}"`);
  }

  if (check.runtimeBudgetMinutes > tier.maxRuntimeMinutes) {
    throw new Error(
      `${context}.runtimeBudgetMinutes exceeds ${check.tier} maxRuntimeMinutes ${String(
        tier.maxRuntimeMinutes,
      )}`,
    );
  }

  if (check.timeoutMinutes > tier.maxTimeoutMinutes) {
    throw new Error(
      `${context}.timeoutMinutes exceeds ${check.tier} maxTimeoutMinutes ${String(
        tier.maxTimeoutMinutes,
      )}`,
    );
  }

  const retry = validateRetryPolicy({
    retryPolicy: check.retryPolicy,
    context: `${context}.retryPolicy`,
    policy,
  });

  const waiverSummaries = [];
  if (check.flakeWaivers !== undefined) {
    ensureArray(check.flakeWaivers, `${context}.flakeWaivers`);
    if (check.flakeWaivers.length > tier.maxFlakeWaivers) {
      throw new Error(
        `${context}.flakeWaivers exceeds ${check.tier} maxFlakeWaivers ${String(
          tier.maxFlakeWaivers,
        )}`,
      );
    }
    check.flakeWaivers.forEach((waiver, waiverIndex) => {
      waiverSummaries.push(
        validateFlakeWaiver({
          waiver,
          context: `${context}.flakeWaivers[${waiverIndex}]`,
          today,
          policy,
          checkOwner: check.owner,
        }),
      );
    });
  }

  return {
    id: check.id,
    tier: check.tier,
    owner: check.owner,
    runtimeBudgetMinutes: check.runtimeBudgetMinutes,
    timeoutMinutes: check.timeoutMinutes,
    retryAttempts: retry.maxAttempts,
    flakeWaiverCount: waiverSummaries.length,
  };
};

const summarizeByTier = checks =>
  checks.reduce((summary, check) => {
    if (!summary[check.tier]) {
      summary[check.tier] = {
        checkCount: 0,
        runtimeBudgetMinutes: 0,
        flakeWaiverCount: 0,
      };
    }
    summary[check.tier].checkCount += 1;
    summary[check.tier].runtimeBudgetMinutes += check.runtimeBudgetMinutes;
    summary[check.tier].flakeWaiverCount += check.flakeWaiverCount;
    return summary;
  }, {});

const validateCiHardeningProfile = (profile, options = {}) => {
  ensureObject(profile, 'profile');
  if (profile.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(
      `Unsupported profile schemaVersion: ${String(
        profile.schemaVersion,
      )}. Expected ${String(SCHEMA_VERSION)}.`,
    );
  }
  ensureString(profile.name, 'profile.name');
  const policy = validatePolicy(profile.policy);
  const tiers = validateTierBudgets(profile.tiers);
  ensureArray(profile.checks, 'profile.checks');
  if (profile.checks.length === 0) {
    throw new Error('profile.checks must not be empty');
  }
  ensureUniqueIds(profile.checks, 'profile.checks');

  const today = parseIsoDate(
    options.today || profile.validationDate,
    'validationDate',
  );
  const checks = profile.checks.map((check, index) =>
    validateCheck({
      check,
      index,
      tiers,
      policy,
      today,
    }),
  );

  return {
    name: profile.name,
    schemaVersion: profile.schemaVersion,
    validationDate: options.today || profile.validationDate,
    tiers,
    checkCount: checks.length,
    checksByTier: summarizeByTier(checks),
    checks,
  };
};

const loadCiHardeningProfile = (
  profilePath = DEFAULT_PROFILE_PATH,
  options = {},
) => {
  const profile = readJsonFile(profilePath);
  const evidenceSummary = validateCiHardeningProfile(profile, options);
  return {
    profile,
    evidenceSummary,
  };
};

module.exports = {
  DEFAULT_PROFILE_PATH,
  ISSUE_REF_PATTERN,
  REQUIRED_TIERS,
  SCHEMA_VERSION,
  loadCiHardeningProfile,
  readJsonFile,
  validateCiHardeningProfile,
};
