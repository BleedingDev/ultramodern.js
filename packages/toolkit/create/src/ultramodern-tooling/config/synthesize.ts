import fs from 'node:fs';
import path from 'node:path';

import { shellApp } from '../../ultramodern-workspace/descriptors';
import { toKebabCase } from '../../ultramodern-workspace/naming';
import {
  LEGACY_DEVELOPMENT_OVERLAY_PATH,
  LEGACY_GENERATED_CONTRACT_PATH,
  LEGACY_PACKAGE_SOURCE_METADATA_PATH,
} from './constants';
import { readJsonObject } from './json';
import {
  packageScopeFromRoot,
  packageSourceFromMetadata,
  readOverlayPorts,
} from './metadata';

export function synthesizeCompactUltramodernConfig(workspaceRoot: string):
  | {
      compact: Record<string, any>;
      missing: string[];
      sources: string[];
    }
  | undefined {
  const contractPath = path.join(workspaceRoot, LEGACY_GENERATED_CONTRACT_PATH);
  if (!fs.existsSync(contractPath)) {
    return undefined;
  }

  const contract = readJsonObject(contractPath);
  const sources: string[] = [LEGACY_GENERATED_CONTRACT_PATH];
  const missing: string[] = [];

  const packageSource = packageSourceFromMetadata(workspaceRoot);
  if (packageSource) {
    sources.push(LEGACY_PACKAGE_SOURCE_METADATA_PATH);
  } else {
    missing.push(LEGACY_PACKAGE_SOURCE_METADATA_PATH);
  }

  const ports = readOverlayPorts(workspaceRoot);
  if (
    fs.existsSync(path.join(workspaceRoot, LEGACY_DEVELOPMENT_OVERLAY_PATH))
  ) {
    sources.push(LEGACY_DEVELOPMENT_OVERLAY_PATH);
  } else {
    missing.push(LEGACY_DEVELOPMENT_OVERLAY_PATH);
  }

  const apps = Array.isArray(contract.apps) ? contract.apps : [];
  const shell = apps.find(
    (app: Record<string, any>) => app?.id === shellApp.id,
  );

  const compact: Record<string, any> = {
    schemaVersion:
      typeof contract.schemaVersion === 'number' ? contract.schemaVersion : 1,
    ...(typeof contract.profile === 'string'
      ? { profile: contract.profile }
      : {}),
    workspace: {
      packageScope: packageScopeFromRoot(workspaceRoot),
    },
    ...(packageSource
      ? {
          packageSource: {
            strategy: packageSource.strategy,
            modernPackageVersion: packageSource.modernPackageVersion,
            ...(packageSource.registry
              ? { registry: packageSource.registry }
              : {}),
            ...(packageSource.aliasScope
              ? { aliasScope: packageSource.aliasScope }
              : {}),
            ...(packageSource.aliasPackageNamePrefix
              ? { aliasPackageNamePrefix: packageSource.aliasPackageNamePrefix }
              : {}),
          },
        }
      : {}),
    features: {
      tailwind: shell?.styling?.tailwind !== false,
    },
    topology: {
      apps: apps.map((app: Record<string, any>) => {
        const id = String(app.id);
        const appPath =
          typeof app.path === 'string'
            ? app.path
            : id === shellApp.id
              ? shellApp.directory
              : `verticals/${toKebabCase(id)}`;
        const domain =
          typeof app.i18n?.namespace === 'string' &&
          app.i18n.namespace !== 'shell'
            ? app.i18n.namespace
            : appPath.split('/').at(-1);

        const moduleFederation =
          app.moduleFederation && typeof app.moduleFederation === 'object'
            ? {
                role: app.kind === 'vertical' ? 'remote' : 'host',
                ...(typeof app.moduleFederation.name === 'string'
                  ? { name: app.moduleFederation.name }
                  : {}),
                ...(Array.isArray(app.moduleFederation.exposes)
                  ? {
                      exposes: app.moduleFederation.exposes.filter(
                        (expose: unknown): expose is string =>
                          typeof expose === 'string',
                      ),
                    }
                  : {}),
                ...(Array.isArray(app.moduleFederation.verticalRefs)
                  ? {
                      verticalRefs: app.moduleFederation.verticalRefs.filter(
                        (ref: unknown): ref is string =>
                          typeof ref === 'string',
                      ),
                    }
                  : {}),
              }
            : undefined;

        const api =
          app.effect && typeof app.effect === 'object'
            ? {
                stem:
                  typeof app.effect.prefix === 'string'
                    ? (app.effect.prefix.split('/').filter(Boolean).at(-1) ??
                      domain ??
                      id)
                    : (domain ?? id),
                prefix:
                  typeof app.effect.prefix === 'string'
                    ? app.effect.prefix
                    : `/${domain ?? id}-api`,
                consumedBy: [shellApp.id, id],
              }
            : undefined;

        return {
          id,
          kind: app.kind === 'vertical' ? 'vertical' : 'shell',
          path: appPath,
          ...(typeof app.package === 'string' ? { package: app.package } : {}),
          packageSuffix:
            typeof app.package === 'string'
              ? app.package.split('/').at(-1)
              : appPath.split('/').at(-1),
          ...(id === shellApp.id ? { displayName: shellApp.displayName } : {}),
          ...(domain ? { domain } : {}),
          ...(typeof ports[id] === 'number' ? { port: ports[id] } : {}),
          ...(moduleFederation ? { moduleFederation } : {}),
          ...(api ? { api } : {}),
        };
      }),
    },
  };

  return { compact, missing, sources };
}
