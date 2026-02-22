import * as path from 'path';
import { createHash } from 'crypto';
import type { HttpMethodDecider } from '@modern-js/types';
import { ApiRouter } from '../router';
import { Result, Ok, Err } from './result';

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
  requestId?: string;
};

export const DEFAULT_CLIENT_REQUEST_CREATOR = '@modern-js/create-request';

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
  requestId,
}: GenClientOptions): Promise<GenClientResult> => {
  if (!requestCreator) {
    // eslint-disable-next-line no-param-reassign
    requestCreator = requireResolve(
      `${DEFAULT_CLIENT_REQUEST_CREATOR}${target ? `/${target}` : ''}`,
    ).replace(/\\/g, '/');
  } else {
    // 这里约束传入的 requestCreator 包也必须有两个导出 client 和 server，因为目前的机制 client 和 server 要导出不同的 configure 函数；该 api 不对使用者暴露，后续可优化
    let resolvedPath = requestCreator;
    try {
      resolvedPath = path.dirname(requireResolve(requestCreator));
    } catch (error) {}
    // eslint-disable-next-line no-param-reassign
    requestCreator = `${resolvedPath}${target ? `/${target}` : ''}`.replace(
      /\\/g,
      '/',
    );
  }

  const apiRouter = new ApiRouter({
    appDir,
    apiDir,
    lambdaDir,
    prefix,
    httpMethodDecider,
  });

  const handlerInfos = apiRouter.getSingleModuleHandlers(resourcePath);
  if (!handlerInfos) {
    return Err(`generate client error: Cannot require module ${resourcePath}`);
  }

  const operationEntries = handlerInfos
    .map(({ name, httpMethod, routePath }) => ({
      name,
      httpMethod: httpMethod.toUpperCase(),
      routePath,
    }))
    .sort((a, b) => {
      const keyA = `${a.routePath}:${a.httpMethod}:${a.name}`;
      const keyB = `${b.routePath}:${b.httpMethod}:${b.name}`;
      return keyA.localeCompare(keyB);
    });
  const operationVersion = 1;
  const schemaHash = createHash('sha256')
    .update(
      JSON.stringify({
        operations: operationEntries,
        requestId: requestId || 'default',
      }),
    )
    .digest('hex');

  let handlersCode = '';
  for (const handlerInfo of handlerInfos) {
    const { name, httpMethod, routePath } = handlerInfo;
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
  const configure = requestRuntime.configure || requestRuntime.default?.configure;
  if (typeof configure !== 'function') {
    console.warn('[modernjs] Compatibility request creator path does not expose configure(); use default @modern-js/create-request or migrate the compatibility path.');
    return undefined;
  }
  return configure({ ...options, requestId: ${JSON.stringify(requestId)} });
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
