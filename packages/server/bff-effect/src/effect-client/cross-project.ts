import {
  BFF_ENVELOPE_HEADER,
  BFF_OPERATION_CONTEXT_DETAIL_HEADER,
  BFF_OPERATION_CONTEXT_HEADER,
  digestOperationContract,
  resolveCrossProjectRequestObservation,
} from '@modern-js/server-runtime-extensions/bff-policy';
import * as Effect from 'effect/Effect';
import * as Schema from 'effect/Schema';

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

import { HttpClient, HttpClientRequest } from 'effect/unstable/http';
import { HttpApi, type HttpApiGroup } from 'effect/unstable/httpapi';

export interface EffectCrossProjectClientOptions {
  requestId: string;
  operationVersion: number;
  /** Server mount path, independent of the API origin. */
  prefix: string;
}

/** Native transport middleware; endpoint encoding and inference stay in Effect. */
export function withCrossProjectPolicy<
  Id extends string,
  Groups extends HttpApiGroup.Constraint,
>(
  api: HttpApi.HttpApi<Id, Groups>,
  options: EffectCrossProjectClientOptions,
  client: HttpClient.HttpClient,
): HttpClient.HttpClient {
  const contracts: Record<
    string,
    { operationId: string; name: string; method: string; routePath: string }
  > = {};
  const prefix = options.prefix.replace(/\/$/, '');
  HttpApi.reflect(api, {
    onGroup: () => {},
    onEndpoint: ({ endpoint }) => {
      const routePath =
        `${prefix}${endpoint.path === '/' ? '' : endpoint.path}` || '/';
      const name = endpoint.identifier;
      contracts[`${endpoint.method}:${routePath}`] = {
        operationId: `${options.requestId}:${name}`,
        name,
        method: endpoint.method,
        routePath,
      };
    },
  });
  return client.pipe(
    HttpClient.mapRequestEffect(request => {
      const observed = resolveCrossProjectRequestObservation(
        {
          method: request.method,
          pathname: new URL(request.url, 'http://effect.invalid').pathname,
        },
        { expectedOperationContracts: contracts },
      );
      const contract =
        observed && contracts[`${observed.method}:${observed.routePath}`];
      if (contract === undefined) {
        return Effect.die(
          new Error(
            '[BFF][Effect] Request has no matching shared operation contract.',
          ),
        );
      }
      return Effect.gen(function* () {
        const schemaHash = yield* Effect.promise(() =>
          digestOperationContract(
            {
              httpMethod: contract.method,
              name: contract.name,
              routePath: contract.routePath,
            },
            options.requestId,
          ),
        );
        return request.pipe(
          HttpClientRequest.setHeader(
            BFF_ENVELOPE_HEADER,
            encodeJson({ requestId: options.requestId }),
          ),
          HttpClientRequest.setHeader(
            BFF_OPERATION_CONTEXT_HEADER,
            contract.operationId,
          ),
          HttpClientRequest.setHeader(
            BFF_OPERATION_CONTEXT_DETAIL_HEADER,
            encodeJson({
              requestId: options.requestId,
              operationId: contract.operationId,
              method: contract.method,
              routePath: contract.routePath,
              schemaHash,
              operationVersion: options.operationVersion,
            }),
          ),
        );
      });
    }),
  );
}
