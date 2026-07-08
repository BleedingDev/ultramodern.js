import { appHasApi, resolveApiStem } from '../descriptors';
import { toPascalCase } from '../naming';
import type { JsonValue, WorkspaceApi, WorkspaceApp } from '../types';
import { serviceHasCheckoutCartState } from './checkout-cart';
import {
  verticalApiErrorStem,
  verticalApiGroupName,
  verticalApiNotFoundErrorExport,
} from './names';

export function createApiReadinessContract(app: {
  id: string;
  api?: WorkspaceApi;
}): JsonValue {
  const stem = resolveApiStem(app);
  return {
    endpoint: `/${stem}/readiness`,
    marker: {
      ui: 'ultramodernUiMarker',
      api: 'ultramodernApiMarker',
      skew: 'none',
    },
    checks: ['moduleFederation', 'ssr', 'translations', 'api'],
  };
}

export function createApiRequestContextContract(): JsonValue {
  return {
    propagatedHeaders: [
      'accept-language',
      'authorization',
      'traceparent',
      'x-correlation-id',
      'x-tenant-id',
      'x-ultramodern-env',
      'x-vertical-version-id',
    ],
    source: 'shell-to-vertical-api-client',
  };
}

export function createApiDomainOperations(app: {
  id: string;
  api?: WorkspaceApi;
}): JsonValue {
  const stem = resolveApiStem(app);
  const group = verticalApiGroupName(app);
  const basePath = `/${stem}`;
  const checkoutCartOperations: Record<string, JsonValue> =
    serviceHasCheckoutCartState(app)
      ? {
          checkoutCartAddItem: {
            client: 'addCheckoutCartItem',
            method: 'POST',
            path: '/checkout/cart/items',
            resource: 'checkout-cart',
            owner: app.id,
          },
          checkoutCartClear: {
            client: 'clearCheckoutCart',
            method: 'POST',
            path: '/checkout/cart/clear',
            resource: 'checkout-cart',
            owner: app.id,
          },
          checkoutCartRead: {
            client: 'getCheckoutCart',
            method: 'GET',
            path: '/checkout/cart',
            resource: 'checkout-cart',
            owner: app.id,
          },
          checkoutCartRemoveItem: {
            client: 'removeCheckoutCartItem',
            method: 'POST',
            path: '/checkout/cart/remove',
            resource: 'checkout-cart',
            owner: app.id,
          },
        }
      : {};

  return {
    ...checkoutCartOperations,
    workspaceFeed: {
      client: `list${toPascalCase(stem)}`,
      method: 'GET',
      path: basePath,
      resource: 'workspace-items',
      owner: app.id,
    },
    workspaceDetail: {
      client: `get${toPascalCase(verticalApiErrorStem(app))}`,
      method: 'GET',
      path: `${basePath}/:id`,
      resource: 'workspace-item',
      owner: app.id,
    },
    workspaceCreate: {
      client: `create${toPascalCase(verticalApiErrorStem(app))}`,
      method: 'POST',
      path: basePath,
      resource: group,
      owner: app.id,
    },
  };
}

export function apiTopologyMetadata(app: WorkspaceApp): JsonValue | undefined {
  if (!appHasApi(app)) {
    return undefined;
  }

  return {
    runtime: 'effect',
    bff: {
      prefix: app.api.prefix,
      openapi: '/openapi.json',
      strictEffectApproach: true,
    },
    contract: {
      export: './api',
      path: `${app.directory}/shared/api.ts`,
    },
    client: {
      export: './api/client',
      path: `${app.directory}/src/api/${app.api.stem}-client.ts`,
    },
    serverEntry: `${app.directory}/api/index.ts`,
    basePath: `${app.api.prefix}/${app.api.stem}`,
    consumedBy: app.api.consumedBy,
    readiness: createApiReadinessContract(app),
    requestContext: createApiRequestContextContract(),
    domainOperations: createApiDomainOperations(app),
  };
}

export function createApiOperationContract(target: {
  id: string;
  api?: WorkspaceApi;
}): JsonValue {
  const stem = resolveApiStem(target);
  const checkoutCartOperations: Record<string, JsonValue> =
    serviceHasCheckoutCartState(target)
      ? {
          addCartItem: {
            method: 'POST',
            path: '/checkout/cart/items',
            source: 'generated-client',
          },
          clearCart: {
            method: 'POST',
            path: '/checkout/cart/clear',
            source: 'generated-client',
          },
          getCart: {
            method: 'GET',
            path: '/checkout/cart',
            source: 'generated-client',
          },
          removeCartItem: {
            method: 'POST',
            path: '/checkout/cart/remove',
            source: 'generated-client',
          },
        }
      : {};
  return {
    group: verticalApiGroupName(target),
    notFound: verticalApiNotFoundErrorExport(target),
    operations: {
      ...checkoutCartOperations,
      list: {
        method: 'GET',
        path: `/${stem}`,
        source: 'generated-client',
      },
      readiness: {
        method: 'GET',
        path: `/${stem}/readiness`,
        source: 'generated-client',
      },
      get: {
        method: 'GET',
        path: `/${stem}/:id`,
        source: 'generated-client',
      },
      create: {
        method: 'POST',
        path: `/${stem}`,
        source: 'generated-client',
      },
    },
  };
}
