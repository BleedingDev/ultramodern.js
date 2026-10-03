import {
  assertUltramodernBuildArtifact,
  stampUltramodernBuildArtifactIdentity,
} from './build-artifact';

interface BuildIdentityReaders {
  readonly buildMarker: () => string;
  readonly sourceRevision: () => string;
}

function readBuildValue(read: () => string, fallback: string): string {
  try {
    return read();
  } catch (error) {
    // An uncompiled generated module has no injected constants. Check the
    // error tag across realms, since source validators may evaluate in a VM.
    if (
      error !== null &&
      typeof error === 'object' &&
      'name' in error &&
      error.name === 'ReferenceError'
    ) {
      return fallback;
    }
    throw error;
  }
}

/** Read compiler constants in the caller, even when this package is external. */
export function resolveUltramodernBuildArtifact(
  artifact: unknown,
  readers?: BuildIdentityReaders,
) {
  assertUltramodernBuildArtifact(artifact);
  const buildMarker = readers
    ? readBuildValue(readers.buildMarker, artifact.deliveryUnit.buildMarker)
    : artifact.deliveryUnit.buildMarker;
  const sourceRevision = readers
    ? readBuildValue(
        readers.sourceRevision,
        artifact.deliveryUnit.sourceRevision,
      )
    : artifact.deliveryUnit.sourceRevision;
  return stampUltramodernBuildArtifactIdentity(artifact, {
    buildMarker,
    sourceRevision,
  });
}
