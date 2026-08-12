import { readableErpVerticalNames } from './constants.mjs';

function generatedVerticalName(index) {
  return `erp-vertical-${String(index + 1).padStart(3, '0')}`;
}

function generateVerticalNames(count) {
  if (!Number.isInteger(count) || count < 0) {
    throw new Error('vertical count must be a non-negative integer');
  }
  return Array.from({ length: count }, (_, index) =>
    index < readableErpVerticalNames.length
      ? readableErpVerticalNames[index]
      : generatedVerticalName(index),
  );
}

export { generateVerticalNames };
