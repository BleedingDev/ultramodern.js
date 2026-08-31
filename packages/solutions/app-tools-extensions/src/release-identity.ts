import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const BUILD_MARKER_NAMESPACE =
  'ultramodern-delivery-unit-release-build-marker:v1';
const PROMOTABLE_SOURCE_REVISION_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;

export type UltramodernReleaseIdentity = {
  buildMarker: string;
  sourceRevision: string;
};

const gitOutput = (
  workspaceRoot: string,
  args: string[],
): string | undefined => {
  try {
    return execFileSync('git', ['-C', workspaceRoot, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return undefined;
  }
};

export const createUltramodernReleaseBuildMarker = ({
  generationBuildMarker,
  sourceRevision,
  unitId,
}: {
  generationBuildMarker: string;
  sourceRevision: string;
  unitId: string;
}): string =>
  createHash('sha256')
    .update(
      `${BUILD_MARKER_NAMESPACE}:${unitId}:${generationBuildMarker}:${sourceRevision}`,
    )
    .digest('hex')
    .slice(0, 16);

export const resolveUltramodernSourceRevision = (
  workspaceRoot = process.cwd(),
  configuredSourceRevision?: string,
): string => {
  const configuredArgumentValue = configuredSourceRevision?.trim();
  const configuredEnvironmentValue =
    process.env.ULTRAMODERN_SOURCE_REVISION?.trim();
  const configuredArgument =
    configuredArgumentValue && configuredArgumentValue !== 'workspace'
      ? configuredArgumentValue
      : undefined;
  const configuredEnvironment =
    configuredEnvironmentValue && configuredEnvironmentValue !== 'workspace'
      ? configuredEnvironmentValue
      : undefined;
  if (
    configuredArgument &&
    configuredEnvironment &&
    configuredArgument !== configuredEnvironment
  ) {
    throw new Error(
      `Configured source revision ${configuredArgument} does not match environment source revision ${configuredEnvironment}.`,
    );
  }
  const configured = configuredArgument ?? configuredEnvironment;
  const gitRoot = gitOutput(workspaceRoot, ['rev-parse', '--show-toplevel']);
  if (!gitRoot) {
    // Source archives and synthetic non-Git proofs can provide an externally
    // authenticated immutable revision. Git worktrees are handled below so
    // this override can never conceal dirty or mismatched checkout bytes.
    if (!configured) {
      return 'workspace';
    }
    if (!PROMOTABLE_SOURCE_REVISION_PATTERN.test(configured)) {
      throw new Error(
        `Configured source revision ${configured} must be an exact lowercase 40- or 64-character Git object ID.`,
      );
    }
    return configured;
  }

  const revision = gitOutput(gitRoot, ['rev-parse', 'HEAD']);
  const status = gitOutput(gitRoot, [
    'status',
    '--porcelain=v1',
    '--untracked-files=all',
  ]);
  if (!revision || status === undefined || status.length > 0) {
    // Development remains usable, but the release-envelope gate rejects this
    // non-promotable identity. Never label dirty bytes with the clean HEAD.
    return 'workspace';
  }
  if (!PROMOTABLE_SOURCE_REVISION_PATTERN.test(revision)) {
    return 'workspace';
  }
  if (configured && configured !== revision) {
    throw new Error(
      `Configured source revision ${configured} does not match clean Git HEAD ${revision}.`,
    );
  }

  return revision;
};

export const resolveUltramodernReleaseIdentity = ({
  generationBuildMarker,
  sourceRevision: configuredSourceRevision,
  unitId,
  workspaceRoot,
}: {
  generationBuildMarker: string;
  sourceRevision?: string;
  unitId: string;
  workspaceRoot?: string;
}): UltramodernReleaseIdentity => {
  const explicitSourceRevision = configuredSourceRevision?.trim();
  const sourceRevision = resolveUltramodernSourceRevision(
    workspaceRoot,
    explicitSourceRevision,
  );
  return {
    buildMarker:
      sourceRevision === 'workspace'
        ? generationBuildMarker
        : createUltramodernReleaseBuildMarker({
            generationBuildMarker,
            sourceRevision,
            unitId,
          }),
    sourceRevision,
  };
};
