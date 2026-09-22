import {
  collectEffectEndpoints,
  toOperationContractSources,
} from '@modern-js/bff-effect/effect';
import {
  buildOperationContractMap,
  resolveOperationProducer,
} from '@modern-js/server-runtime-extensions/bff-policy/node';
import { upath as path } from '@modern-js/utils';
import { getHttpApiRuntime, loadEffectApi } from './http-api-runtime';

/** Derives server policy metadata without emitting or typing a client. */
export async function resolveEffectOperationContracts(options: {
  appDir: string;
  resourcePath: string;
  prefix: string;
  requestId?: string;
  onDependency?: (dependency: string) => void;
}) {
  const api = await loadEffectApi(options);
  if (api === null) {
    return null;
  }
  const runtime = await getHttpApiRuntime();
  const endpoints = collectEffectEndpoints(
    runtime.reflect,
    api,
    options.prefix,
  );
  return buildOperationContractMap({
    handlers: toOperationContractSources(endpoints),
    ...resolveOperationProducer({
      directories: [path.dirname(options.resourcePath), options.appDir],
      requestId: options.requestId,
      onDependency: options.onDependency,
    }),
  });
}
