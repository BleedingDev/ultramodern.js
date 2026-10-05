import {
  type NativeRouteEmissionOptions,
  prepareNativeRouteEmission,
} from '../../native-composition/native-routes';

/** Emit the Solid native router source contract. */
export function emitSolidNativeRouteModule(
  options: NativeRouteEmissionOptions,
): string {
  const prepared = prepareNativeRouteEmission(options);
  const imports = prepared.imports.map(
    ({ file, binding }) =>
      `import * as ${binding} from ${JSON.stringify(file)};`,
  );
  const configurations = prepared.routeModules.map(modules => {
    const fields: string[] = [];
    if (modules.component)
      fields.push(`component: ${modules.component}.default`);
    if (modules.loading)
      fields.push(`pendingComponent: ${modules.loading}.default`);
    if (modules.error) fields.push(`errorComponent: ${modules.error}.default`);
    if (modules.notFound)
      fields.push(`notFoundComponent: ${modules.notFound}.default`);
    if (modules.head)
      fields.push(`head: resolveNativeHeadModule(${modules.head})`);
    if (modules.search)
      fields.push(
        `validateSearch: resolveNativeSearchModule(${modules.search})`,
      );
    return `${JSON.stringify(modules.id)}: { ${fields.join(', ')} }`;
  });
  const data = prepared.dataModules.map(
    ({ id, binding }) => `${JSON.stringify(id)}: ${binding}`,
  );
  const hasHead = prepared.routeModules.some(modules => modules.head);
  const hasSearch = prepared.routeModules.some(modules => modules.search);
  const { routeIR, serverDataRoutes } = prepared;
  const loader =
    options.mode === 'server'
      ? `const module = dataModules[route.id];
      if (!module?.loader) return { kind: 'success', value: undefined, status: 200 };
      return invokeRouteData(module.loader, input);`
      : `const module = dataModules[route.id];
      if (module?.loader) return invokeRouteData(module.loader, input, { production: process.env.NODE_ENV === 'production' });
      if (!serverDataRoutes.has(route.id)) return { kind: 'success', value: undefined, status: 200 };
      return createDataClient(route.id, identity).loader({ request: input.request });`;
  return `${imports.join('\n')}
import { createFileSystemRouteTree, createApplicationRouter, createMemoryHistory } from "@modern-js/renderer-solid/router";
import { ${options.mode === 'client' ? 'createDataClient, ' : ''}invokeRouteData } from '@modern-js/renderer-core/data';
import type { AnyRouter, FileSystemRouteModule } from "@modern-js/renderer-solid/router";
import type { DataHandler, DataOutcome, DecodedDataOutcome, FileSystemRouteIR } from '@modern-js/renderer-core/data';
import type { RendererIdentity } from '@modern-js/renderer-core/identity';
import type { RequestSession } from '@modern-js/renderer-core/session';
${options.mode === 'client' ? 'declare const process: { env: { NODE_ENV?: string } };' : ''}
${hasHead ? `function resolveNativeHeadModule(module: { head?: FileSystemRouteModule['head']; default?: FileSystemRouteModule['head'] }): FileSystemRouteModule['head'] { return module.head ?? module.default; }` : ''}
${hasSearch ? `function resolveNativeSearchModule(module: { validateSearch?: FileSystemRouteModule['validateSearch']; default?: FileSystemRouteModule['validateSearch'] }): NonNullable<FileSystemRouteModule['validateSearch']> { const validateSearch = module.validateSearch ?? module.default; if (typeof validateSearch !== 'function') throw new Error('A native search module must export validateSearch or a default validator'); return validateSearch; }` : ''}
export const routeIR: FileSystemRouteIR[] = ${JSON.stringify(routeIR, null, 2)};
export const routeModules: Record<string, FileSystemRouteModule> = { ${configurations.join(',\n')} };
export const dataModules: Record<string, { loader?: DataHandler; action?: DataHandler }> = { ${data.join(',\n')} };
${options.mode === 'client' ? `const serverDataRoutes = new Set<string>(${JSON.stringify(serverDataRoutes)});` : ''}
export function createNativeRouter(identity: RendererIdentity, request?: Request, context: object = {}, onOutcome?: (routeId: string, outcome: DataOutcome | DecodedDataOutcome) => void, session?: RequestSession, nonce?: string): AnyRouter {
  if (Object.hasOwn(context, 'ultramodern')) throw new Error('The native router context reserves ultramodern metadata');
  const nativeContext = { ultramodern: Object.freeze({ rendererIdentity: Object.freeze({ ...identity }) }) };
  const routeTree = createFileSystemRouteTree(routeIR, routeModules, {
    ...(request ? { request } : {}),
    context,
    ...(onOutcome ? { onOutcome } : {}),
    ...(session ? { session } : {}),
    ${''}
    async loadRoute(route, input) {
      ${loader}
    },
  });
  const url = request ? new URL(request.url) : undefined;
  const router: AnyRouter = createApplicationRouter({
    routeTree,
    basepath: ${JSON.stringify(options.basePath)},
    context: nativeContext,
    // Router-emitted scripts carry the document's CSP nonce.
    ...(nonce === undefined ? {} : { ssr: { nonce } }),
    ...(url ? { origin: url.origin, history: createMemoryHistory({ initialEntries: [url.pathname + url.search + url.hash] }) } : {}),
  });
  return router;
}
`;
}
