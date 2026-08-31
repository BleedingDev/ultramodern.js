import path from 'node:path';
import { fs as fse } from '@modern-js/utils';
import type {
  CloudflareWorkerArtifactConfig,
  CloudflareWorkerPublicAssetConfig,
} from '../config';
import {
  RESERVED_ARTIFACT_DESTINATION_DIRECTORIES,
  RESERVED_ARTIFACT_DESTINATION_FILES,
  ROUTE_SPEC_OUTPUT,
} from './constants';
import type { CloudflareModernConfig } from './types';
import { normalizeRelativePath } from './utils';

const normalizeCloudflareArtifact = (
  artifact: CloudflareWorkerArtifactConfig,
  index: number,
) => {
  const from = normalizeRelativePath(
    artifact.from,
    `deploy.worker.artifacts[${index}].from`,
    'app root',
  );
  const to = normalizeRelativePath(
    artifact.to,
    `deploy.worker.artifacts[${index}].to`,
    'Cloudflare output',
  );
  const [topLevelDestination] = to.split('/');
  const reservedDestination = RESERVED_ARTIFACT_DESTINATION_FILES.has(to)
    ? to
    : topLevelDestination;

  if (
    RESERVED_ARTIFACT_DESTINATION_FILES.has(to) ||
    RESERVED_ARTIFACT_DESTINATION_DIRECTORIES.has(topLevelDestination)
  ) {
    throw new Error(
      `deploy.worker.artifacts[${index}].to must not target generated Cloudflare output path ${JSON.stringify(
        reservedDestination,
      )}.`,
    );
  }

  return {
    from,
    to,
    index,
  };
};

export const getCloudflareArtifacts = (modernConfig: CloudflareModernConfig) =>
  (modernConfig.deploy?.worker?.artifacts ?? []).map(
    normalizeCloudflareArtifact,
  );

const normalizeCloudflarePublicAsset = (
  asset: CloudflareWorkerPublicAssetConfig,
  index: number,
) => {
  const from = normalizeRelativePath(
    asset.from,
    `deploy.worker.publicAssets[${index}].from`,
    'app root',
  );
  const to = normalizeRelativePath(
    asset.to,
    `deploy.worker.publicAssets[${index}].to`,
    'Cloudflare public output',
    { allowRoot: true },
  );

  return {
    from,
    to,
    index,
  };
};

export const getCloudflarePublicAssets = (
  modernConfig: CloudflareModernConfig,
) =>
  (modernConfig.deploy?.worker?.publicAssets ?? []).map(
    normalizeCloudflarePublicAsset,
  );

export const copyCloudflareArtifacts = async (
  appDirectory: string,
  outputDirectory: string,
  artifacts: ReturnType<typeof getCloudflareArtifacts>,
) => {
  for (const artifact of artifacts) {
    const sourcePath = path.join(appDirectory, artifact.from);

    if (!(await fse.pathExists(sourcePath))) {
      throw new Error(
        `deploy.worker.artifacts[${artifact.index}].from does not exist: ${artifact.from}`,
      );
    }

    await fse.copy(sourcePath, path.join(outputDirectory, artifact.to));
  }
};

export const copyCloudflarePublicAssets = async (
  appDirectory: string,
  publicDirectory: string,
  publicAssets: ReturnType<typeof getCloudflarePublicAssets>,
) => {
  for (const asset of publicAssets) {
    const sourcePath = path.join(appDirectory, asset.from);

    if (!(await fse.pathExists(sourcePath))) {
      throw new Error(
        `deploy.worker.publicAssets[${asset.index}].from does not exist: ${asset.from}`,
      );
    }

    await fse.copy(sourcePath, path.join(publicDirectory, asset.to));
  }
};

export const copyCloudflareD1Migrations = async (
  appDirectory: string,
  outputDirectory: string,
  modernConfig: CloudflareModernConfig,
) => {
  for (const [index, database] of (
    modernConfig.deploy?.worker?.d1Databases ?? []
  ).entries()) {
    if (!database.migrationsDir) {
      continue;
    }

    const migrationsDir = normalizeRelativePath(
      database.migrationsDir,
      `deploy.worker.d1Databases[${index}].migrationsDir`,
      'app root',
    );
    const sourcePath = path.join(appDirectory, migrationsDir);

    if (!(await fse.pathExists(sourcePath))) {
      throw new Error(
        `deploy.worker.d1Databases[${index}].migrationsDir does not exist: ${migrationsDir}`,
      );
    }

    await fse.copy(sourcePath, path.join(outputDirectory, migrationsDir));
  }
};

export const readRouteSpec = async (outputDirectory: string) => {
  const routeSpecPath = path.join(outputDirectory, ROUTE_SPEC_OUTPUT);

  if (!(await fse.pathExists(routeSpecPath))) {
    return { routes: [] };
  }

  const routeSpec = await fse.readJSON(routeSpecPath);

  return {
    ...routeSpec,
    routes: Array.isArray(routeSpec.routes) ? routeSpec.routes : [],
  };
};
