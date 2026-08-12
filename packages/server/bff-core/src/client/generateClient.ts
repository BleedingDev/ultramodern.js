import type { HttpMethodDecider } from '@modern-js/types';
import * as path from 'path';
import { ApiRouter } from '../router';
import {
  buildOperationContractMap,
  createOperationSchemaHash,
  deriveOperationVersion,
} from '../security/operationContracts';
import { Err, Ok, type Result } from './result';

/**
 * Get package name/version from package.json file
 * @param appDir - Application directory path
 * @returns Package info, empty when package.json is missing or invalid
 */
const getPackageInfo = (
  appDir: string,
): { name?: string; version?: string } => {
  try {
    const packageJsonPath = path.resolve(appDir, './package.json');
    const packageJson = require(packageJsonPath);
    return { name: packageJson.name, version: packageJson.version };
  } catch (error) {
    // If package.json doesn't exist or is invalid, return empty info
    return {};
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

  const normalizedRequestId = requestId || 'default';
  const operationVersion = deriveOperationVersion(
    getPackageInfo(appDir).version,
  );
  const operationContracts = buildOperationContractMap({
    handlers: handlerInfos,
    requestId: normalizedRequestId,
    operationVersion,
  });
  const operationEntries = handlerInfos
    .map(handlerInfo => {
      const upperHttpMethod = handlerInfo.httpMethod.toUpperCase();
      const contract =
        operationContracts[`${upperHttpMethod}:${handlerInfo.routePath}`];
      return {
        name: handlerInfo.name,
        httpMethod: upperHttpMethod,
        routePath: handlerInfo.routePath,
        schemaHash: contract?.schemaHash ?? '',
      };
    })
    .sort((a, b) => {
      const keyA = `${a.routePath}:${a.httpMethod}:${a.name}`;
      const keyB = `${b.routePath}:${b.httpMethod}:${b.name}`;
      return keyA.localeCompare(keyB);
    });
  const schemaHash = createOperationSchemaHash(
    operationEntries,
    normalizedRequestId,
  );

  let hasUploadHandler = false;
  let handlersCode = '';
  for (const handlerInfo of handlerInfos) {
    const { name, httpMethod, routePath, action } = handlerInfo;
    let exportStatement = `var ${name} =`;
    if (name.toLowerCase() === 'default') {
      exportStatement = 'default';
    }
    const upperHttpMethod = httpMethod.toUpperCase();

    const operationSchemaHash =
      operationContracts[`${upperHttpMethod}:${routePath}`]?.schemaHash ?? '';
    const operationContext = {
      operationId: name,
      routePath,
      method: upperHttpMethod,
      schemaHash: operationSchemaHash,
      operationVersion,
    };

    if (action === 'upload') {
      hasUploadHandler = true;
      const uploadOptions = {
        path: routePath,
        ...(domain ? { domain } : {}),
        ...(requestId ? { requestId } : {}),
        ...(requestId ? { operationContext } : {}),
      };
      handlersCode += `export ${exportStatement} createUploader(${JSON.stringify(
        uploadOptions,
      )});
      `;
      continue;
    }

    // `port` is emitted as a raw expression for the server target, so the
    // options bag has to be assembled as source text rather than JSON.
    const portExpression =
      target === 'server'
        ? `process.env.PORT || ${String(port)}`
        : String(port);
    const requestOptionProperties = [
      `path: ${JSON.stringify(routePath)}`,
      `method: ${JSON.stringify(upperHttpMethod)}`,
      `port: ${portExpression}`,
      `httpMethodDecider: ${JSON.stringify(
        httpMethodDecider ? httpMethodDecider : 'functionName',
      )}`,
    ];
    if (domain) {
      requestOptionProperties.push(`domain: ${JSON.stringify(domain)}`);
    }
    if (fetcher) {
      // `fetch` is the identifier imported from the configured fetcher module.
      requestOptionProperties.push('fetch');
    }
    if (requestId) {
      requestOptionProperties.push(`requestId: ${JSON.stringify(requestId)}`);
    }
    requestOptionProperties.push(
      `operationContext: ${JSON.stringify(operationContext)}`,
    );

    handlersCode += `export ${exportStatement} createRequest({ ${requestOptionProperties.join(
      ', ',
    )} });
      `;
  }

  const serializedRequestCreator = JSON.stringify(requestCreator);
  const serializedFetcher = fetcher ? JSON.stringify(fetcher) : undefined;
  const namedRequestImports = `createRequest${
    hasUploadHandler ? ', createUploader' : ''
  }`;
  const importCode = requestId
    ? `import * as requestRuntime from ${serializedRequestCreator};
const { ${namedRequestImports} } = requestRuntime;
${serializedFetcher ? `import { fetch } from ${serializedFetcher};\n` : ''}`
    : `import { ${namedRequestImports} } from ${serializedRequestCreator};
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
