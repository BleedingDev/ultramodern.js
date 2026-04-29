import type { HttpMethodDecider } from '@modern-js/types';
import * as path from 'path';
import { ApiRouter } from '../router';
import {
  createOperationEntries,
  createOperationSchemaHash,
} from '../security/operationContracts';
import { Err, Ok, type Result } from './result';

/**
 * Get package name from package.json file
 * @param appDir - Application directory path
 * @returns Package name or undefined if not found
 */
const getPackageName = (appDir: string): string | undefined => {
  try {
    const packageJsonPath = path.resolve(appDir, './package.json');
    const packageJson = require(packageJsonPath);
    return packageJson.name;
  } catch (error) {
    // If package.json doesn't exist or is invalid, return undefined
    return undefined;
  }
};

export type GenClientResult = Result<string>;

export type GenClientOptions = {
  resourcePath: string;
  source: string;
  appDir: string;
  apiDir: string;
  lambdaDir: string;
  prefix: string;
  port: number;
  requestCreator?: string;
  fetcher?: string;
  target?: string;
  requireResolve?: typeof require.resolve;
  httpMethodDecider?: HttpMethodDecider;
  domain?: string;
  requestId?: string;
};

export const INNER_CLIENT_REQUEST_CREATOR = '@modern-js/plugin-bff/client';

export const generateClient = async ({
  appDir,
  resourcePath,
  apiDir,
  lambdaDir,
  prefix,
  port,
  target,
  requestCreator,
  fetcher,
  requireResolve = require.resolve,
  httpMethodDecider,
  domain,
  requestId,
}: GenClientOptions): Promise<GenClientResult> => {
  requestCreator = requestCreator || INNER_CLIENT_REQUEST_CREATOR;

  const apiRouter = new ApiRouter({
    appDir,
    apiDir,
    lambdaDir,
    prefix,
    httpMethodDecider,
  });
  const handlerInfos = await apiRouter.getSingleModuleHandlers(resourcePath);
  if (!handlerInfos) {
    return Err(`generate client error: Cannot require module ${resourcePath}`);
  }

  const operationEntries = createOperationEntries(handlerInfos);
  const operationVersion = 1;
  const schemaHash = createOperationSchemaHash(
    operationEntries,
    requestId || 'default',
  );

  let handlersCode = '';
  for (const handlerInfo of handlerInfos) {
    const { name, httpMethod, routePath, action } = handlerInfo;
    let exportStatement = `var ${name} =`;
    if (name.toLowerCase() === 'default') {
      exportStatement = 'default';
    }
    const upperHttpMethod = httpMethod.toUpperCase();

    const serializedRouteName = JSON.stringify(routePath);
    const serializedMethod = JSON.stringify(upperHttpMethod);
    const serializedMethodDecider = JSON.stringify(
      httpMethodDecider ? httpMethodDecider : 'functionName',
    );
    const serializedOperationContext = JSON.stringify({
      operationId: name,
      routePath,
      method: upperHttpMethod,
      schemaHash,
      operationVersion,
    });
    const tailArgs = `, ${
      fetcher ? 'fetch' : 'undefined'
    }, ${requestId ? JSON.stringify(requestId) : 'undefined'}, ${serializedOperationContext}`;
    if (target === 'server') {
      handlersCode += `export ${exportStatement} createRequest(${serializedRouteName}, ${serializedMethod}, process.env.PORT || ${String(
        port,
      )}, ${serializedMethodDecider}${tailArgs});
      `;
    } else {
      handlersCode += `export ${exportStatement} createRequest(${serializedRouteName}, ${serializedMethod}, ${String(
        port,
      )}, ${serializedMethodDecider}${tailArgs});
      `;
    }
  }

  const serializedRequestCreator = JSON.stringify(requestCreator);
  const serializedFetcher = fetcher ? JSON.stringify(fetcher) : undefined;
  const importCode = requestId
    ? `import * as requestRuntime from ${serializedRequestCreator};
const { createRequest } = requestRuntime;
${serializedFetcher ? `import { fetch } from ${serializedFetcher};\n` : ''}`
    : `import { createRequest } from ${serializedRequestCreator};
${serializedFetcher ? `import { fetch } from ${serializedFetcher};\n` : ''}`;

  const bootstrapCode = requestId
    ? `export const initProducerClient = (options = {}) => {
  const configure = requestRuntime.configure;
  if (typeof configure !== 'function') {
    console.warn('[modernjs] Compatibility request creator path does not expose configure(); use default @modern-js/create-request or migrate the compatibility path.');
    return undefined;
  }
  const defaultSecureOptions = {
    requestId: ${JSON.stringify(requestId)},
    requireEnvelope: true,
    identityBinding: {
      enabled: true,
      strict: true,
    },
    operationContract: {
      enabled: true,
      strict: true,
      requireSchemaHash: true,
      requireOperationVersion: true,
    },
  };
  return configure({
    ...defaultSecureOptions,
    ...options,
    identityBinding: {
      ...defaultSecureOptions.identityBinding,
      ...(options && options.identityBinding ? options.identityBinding : {}),
    },
    operationContract: {
      ...defaultSecureOptions.operationContract,
      ...(options && options.operationContract ? options.operationContract : {}),
    },
  });
};
`
    : '';
  const manifestCode = `export const operationVersion = ${String(
    operationVersion,
  )};
export const operationSchemaHash = '${schemaHash}';
export const operationManifest = ${JSON.stringify(
    {
      operationVersion,
      schemaHash,
      operations: operationEntries,
    },
    null,
    2,
  )};
`;
  const generatedParts = [
    importCode.trimEnd(),
    bootstrapCode.trimEnd(),
    manifestCode.trimEnd(),
    handlersCode.trimEnd(),
  ].filter(Boolean);

  return Ok(`${generatedParts.join('\n\n')}
`);
};
