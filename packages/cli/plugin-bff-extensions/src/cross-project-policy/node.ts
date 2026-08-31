import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  deriveOperationVersion,
  type OperationContractSource,
  resolveCrossProjectPolicy,
} from '@modern-js/bff-core';
import type { ServerPluginAPI } from '@modern-js/server-core';

import type { ResolvedCrossProjectPolicy } from './evaluation';

const readNearestPackageVersion = (
  startDir: string | undefined,
): string | undefined => {
  if (!startDir) {
    return undefined;
  }

  let current = path.resolve(startDir);
  for (let depth = 0; depth < 10; depth += 1) {
    try {
      const packageJson = JSON.parse(
        readFileSync(path.join(current, 'package.json'), 'utf8'),
      ) as { version?: unknown };
      if (typeof packageJson.version === 'string') {
        return packageJson.version;
      }
    } catch {
      // The producer package may be nested below its package.json.
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }

  return undefined;
};

export const resolveAdapterCrossProjectPolicy = (
  api: ServerPluginAPI,
  handlers: OperationContractSource[],
): ResolvedCrossProjectPolicy | undefined => {
  const bff = api.getServerConfig()?.bff;
  const { apiDirectory, appDirectory } = api.getServerContext() as {
    apiDirectory?: string;
    appDirectory?: string;
  };

  return resolveCrossProjectPolicy({
    crossProjectPolicy: bff?.crossProjectPolicy,
    handlers,
    requestId: bff?.requestId,
    isCrossProjectServer: bff?.isCrossProjectServer,
    operationVersion: deriveOperationVersion(
      readNearestPackageVersion(apiDirectory) ??
        readNearestPackageVersion(appDirectory),
    ),
  });
};
