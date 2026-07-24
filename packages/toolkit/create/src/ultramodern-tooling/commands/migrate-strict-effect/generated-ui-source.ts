import fs from 'node:fs';
import type { MigrationIo } from './io';
import { writeTextIfChanged } from './io';

function normalizeGeneratedUiSource(source: string) {
  // This comparison is deliberately limited to generator-owned federation
  // registries and fragment markers, whose string literals cannot contain
  // meaningful whitespace. Never use it for arbitrary application UI source.
  return source.replace(/\s+/gu, ' ').trim();
}

export function generatedUiSourceRequiresRewrite(
  existingSource: string,
  nextSource: string,
) {
  return (
    normalizeGeneratedUiSource(existingSource) !==
    normalizeGeneratedUiSource(nextSource)
  );
}

export function writeGeneratedUiSourceIfChanged(
  io: MigrationIo,
  filePath: string,
  nextSource: string,
) {
  if (
    fs.existsSync(filePath) &&
    !generatedUiSourceRequiresRewrite(
      fs.readFileSync(filePath, 'utf-8'),
      nextSource,
    )
  ) {
    return false;
  }
  return writeTextIfChanged(io, filePath, nextSource);
}
