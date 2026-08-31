import { resolveApiPrefix, resolveApiStem } from '../descriptors';
import { renderFileTemplate } from '../fs-io';
import { toPascalCase } from '../naming';
import type { WorkspaceApi } from '../types';
import { verticalApiGroupName, verticalApiName } from './names';

export function serviceHasCheckoutCartState(service: {
  id: string;
  api?: WorkspaceApi;
}) {
  return resolveApiStem(service) === 'checkout';
}

export function createCheckoutCartSharedSchemas(service: {
  id: string;
  api?: WorkspaceApi;
}) {
  if (!serviceHasCheckoutCartState(service)) {
    return '';
  }

  return renderFileTemplate(
    'workspace/verticals/shared/api.checkout-cart-schemas.ts',
    {},
  );
}

export function createCheckoutCartEndpointDefinitions(service: {
  id: string;
  api?: WorkspaceApi;
}) {
  if (!serviceHasCheckoutCartState(service)) {
    return '';
  }

  return renderFileTemplate(
    'workspace/verticals/shared/api.checkout-cart-endpoints.ts',
    {},
  );
}

export function createCheckoutCartOperationContexts(service: {
  id: string;
  api?: WorkspaceApi;
}) {
  const apiName = verticalApiName(service);
  const groupName = verticalApiGroupName(service);

  if (!serviceHasCheckoutCartState(service)) {
    return '';
  }

  return renderFileTemplate(
    'workspace/verticals/shared/api.checkout-cart-operation-contexts.ts',
    {
      value0: apiName,
      value1: groupName,
      value2: apiName,
      value3: groupName,
      value4: apiName,
      value5: groupName,
      value6: apiName,
      value7: groupName,
    },
  );
}

export function createCheckoutCartApiContractFields(service: {
  id: string;
  api?: WorkspaceApi;
}) {
  if (!serviceHasCheckoutCartState(service)) {
    return '';
  }

  return renderFileTemplate(
    'workspace/verticals/shared/api.checkout-cart-contract-fields.ts',
    {
      value0: resolveApiPrefix(service),
    },
  );
}

export function createCheckoutCartServerState(service: {
  id: string;
  api?: WorkspaceApi;
}) {
  if (!serviceHasCheckoutCartState(service)) {
    return '';
  }

  return renderFileTemplate(
    'workspace/verticals/server/checkout-cart-state.ts',
    {},
  );
}

export function createCheckoutCartServerHandlers(service: {
  id: string;
  api?: WorkspaceApi;
}) {
  const groupName = verticalApiGroupName(service);

  if (!serviceHasCheckoutCartState(service)) {
    return '';
  }

  return renderFileTemplate(
    'workspace/verticals/server/checkout-cart-handlers.ts',
    {
      value0: groupName,
      value1: groupName,
      value2: groupName,
      value3: groupName,
      value4: groupName,
      value5: groupName,
      value6: groupName,
      value7: groupName,
    },
  );
}

export function createCheckoutCartClientExports(service: {
  id: string;
  api?: WorkspaceApi;
}) {
  if (!serviceHasCheckoutCartState(service)) {
    return '';
  }

  const stem = resolveApiStem(service);
  const groupName = verticalApiGroupName(service);
  const pascalStem = toPascalCase(stem);
  const clientOptionsName = `${pascalStem}ClientOptions`;
  const createClientName = `create${pascalStem}Client`;
  const clientEffectTypeName = `${pascalStem}ClientEffect`;

  return renderFileTemplate(
    'workspace/verticals/src/api/checkout-cart-client-exports.ts',
    {
      value0: clientOptionsName,
      value1: clientEffectTypeName,
      value2: createClientName,
      value3: groupName,
      value4: groupName,
      value5: clientOptionsName,
      value6: clientEffectTypeName,
      value7: createClientName,
      value8: groupName,
      value9: groupName,
      value10: clientOptionsName,
      value11: clientEffectTypeName,
      value12: createClientName,
      value13: groupName,
      value14: groupName,
      value15: clientOptionsName,
      value16: clientEffectTypeName,
      value17: createClientName,
      value18: groupName,
      value19: groupName,
    },
  );
}
