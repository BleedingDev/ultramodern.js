import { createBackendFederationContractFile } from '../backend-federation';
import { appHasApi, resolveApiProtocol } from '../descriptors';
import { writeFile } from '../fs-io';
import type { WorkspaceApp } from '../types';
import { createApiClient } from './client';
import { createRpcClientFile, createRpcContractFile } from './rpc';
import { createApiServiceEntry, createBackendEffectApiExpose } from './service';
import { createSharedApi } from './shared';

/** Effect API sources are independent of the application's UI renderer. */
export function writeAppApiFiles({
  targetDir,
  scope,
  resolvedApp,
  emitsUi,
}: {
  targetDir: string;
  scope: string;
  resolvedApp: WorkspaceApp;
  emitsUi: boolean;
}): void {
  if (appHasApi(resolvedApp)) {
    const rpcProtocol = resolveApiProtocol(resolvedApp) === 'rpc';
    const clientDirectory = emitsUi ? 'src/api' : 'shared';
    if (rpcProtocol) {
      writeFile(
        targetDir,
        `${resolvedApp.directory}/shared/rpc.ts`,
        createRpcContractFile(resolvedApp),
      );
    } else {
      writeFile(
        targetDir,
        `${resolvedApp.directory}/shared/api.ts`,
        createSharedApi(resolvedApp, { scope }),
      );
    }
    writeFile(
      targetDir,
      `${resolvedApp.directory}/api/index.ts`,
      createApiServiceEntry(
        resolvedApp,
        rpcProtocol ? '../shared/rpc.ts' : '../shared/api.ts',
        { scope },
      ),
    );
    writeFile(
      targetDir,
      `${resolvedApp.directory}/api/backend-federation.ts`,
      createBackendFederationContractFile(resolvedApp),
    );
    writeFile(
      targetDir,
      `${resolvedApp.directory}/api/effect-api.ts`,
      createBackendEffectApiExpose(scope, resolvedApp),
    );
    if (rpcProtocol) {
      writeFile(
        targetDir,
        `${resolvedApp.directory}/${clientDirectory}/${resolvedApp.api.stem}-rpc-client.ts`,
        createRpcClientFile(
          resolvedApp,
          emitsUi ? '../../shared/rpc.ts' : './rpc.ts',
        ),
      );
    } else {
      writeFile(
        targetDir,
        `${resolvedApp.directory}/${clientDirectory}/${resolvedApp.api.stem}-client.ts`,
        createApiClient(resolvedApp, emitsUi ? '../../shared/api' : './api', {
          scope,
        }),
      );
    }
  }
}
