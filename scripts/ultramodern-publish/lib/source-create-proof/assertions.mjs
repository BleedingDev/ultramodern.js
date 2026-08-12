// Consumer: run-release-acceptance.mjs ephemeral registry validation.
import path from 'node:path';

class SourceCreateProofError extends Error {
  constructor(category, message) {
    super(`${category}: ${message}`);
    this.name = 'SourceCreateProofError';
    this.category = category;
  }
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function failProof(category, message) {
  throw new SourceCreateProofError(category, message);
}

function assertProof(condition, category, message) {
  if (!condition) {
    failProof(category, message);
  }
}

function assertString(value, label) {
  assert(typeof value === 'string' && value.trim() !== '', `${label} missing`);
}

function assertPathInside(rootDir, candidatePath, label) {
  const relative = path.relative(rootDir, candidatePath);
  assert(
    relative === '' ||
      (!relative.startsWith('..') && !path.isAbsolute(relative)),
    `${label} escapes repository root: ${candidatePath}`,
  );
}

export {
  SourceCreateProofError,
  assert,
  assertPathInside,
  assertProof,
  assertString,
  failProof,
  isObject,
};
