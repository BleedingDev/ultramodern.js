/**
 * Shared validation helpers for the scripts/ gate validators.
 *
 * Plain Node, zero dependencies, CommonJS so every validator (node + bun)
 * can require it without a build step. Keep error messages stable: several
 * validator test suites assert on them.
 */
const fs = require('fs');
const path = require('path');
const { readJsonFile } = require('./fs-kit');

/**
 * Placeholder tokens rejected by gate validators. Union of the historical
 * mv-ci-hardening and release-gates lists.
 */
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
  'to-be-filled',
]);

const ensureFileExists = (filePath, { label = 'Required file' } = {}) => {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} does not exist: ${filePath}`);
  }
};

const resolvePath = (value, baseDir = process.cwd()) =>
  path.resolve(baseDir, value);

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

/**
 * Possibly-empty array whose items must all be non-empty strings.
 */
const ensureStringArray = (value, context) => {
  ensureArray(value, context);
  for (const item of value) {
    if (typeof item !== 'string' || item.trim() === '') {
      throw new Error(`${context} must contain non-empty string values`);
    }
  }
};

/**
 * Non-empty array whose items must all be non-empty strings, with indexed
 * error messages (mv-lane-policy style).
 */
const ensureNonEmptyStringArray = (value, context) => {
  ensureNonEmptyArray(value, context);
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

const normalizeIdentifier = value => String(value).trim().toLowerCase();

const isPlaceholderValue = value => {
  const normalized = normalizeIdentifier(value);
  return (
    PLACEHOLDER_VALUES.has(normalized) ||
    /^tbd\b/.test(normalized) ||
    /^todo\b/.test(normalized)
  );
};

const ensureNonPlaceholderString = (value, context) => {
  ensureString(value, context);
  if (isPlaceholderValue(value)) {
    throw new Error(`${context} must not use placeholder value "${value}"`);
  }
};

const ensureSchemaVersion = ({ actual, expected, label }) => {
  if (actual !== expected) {
    throw new Error(
      `Unsupported ${label} schemaVersion: ${String(actual)}. Expected ${String(
        expected,
      )}.`,
    );
  }
};

const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

module.exports = {
  PLACEHOLDER_VALUES,
  ensureArray,
  ensureBoolean,
  ensureFileExists,
  ensureInteger,
  ensureNonEmptyArray,
  ensureNonEmptyStringArray,
  ensureNonPlaceholderString,
  ensureObject,
  ensurePositiveInteger,
  ensureSchemaVersion,
  ensureString,
  ensureStringArray,
  ensureUniqueIds,
  escapeRegExp,
  isPlaceholderValue,
  normalizeIdentifier,
  readJsonFile,
  resolvePath,
};
