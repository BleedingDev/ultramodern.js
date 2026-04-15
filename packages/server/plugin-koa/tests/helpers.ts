import type { APIHandlerInfo } from '@modern-js/bff-core';
import type { ServerPlugin } from '@modern-js/server-core';

const parseCookies = (cookieHeader: unknown): Record<string, string> => {
  if (typeof cookieHeader !== 'string' || cookieHeader.trim().length === 0) {
    return {};
  }

  return cookieHeader.split(';').reduce<Record<string, string>>((acc, pair) => {
    const [rawKey, ...rawValue] = pair.split('=');
    const key = (rawKey || '').trim();
    if (!key) {
      return acc;
    }
    acc[key] = rawValue.join('=').trim();
    return acc;
  }, {});
};

const getInput = (input: unknown) =>
  input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
const HANDLER_WITH_SCHEMA = 'HANDLER_WITH_SCHEMA';

const createApiHandlerInfos = (): APIHandlerInfo[] => {
  const filename = 'tests/function-mode/mock-api.ts';

  const patchUserHandler = (input: unknown) => {
    const normalized = getInput(input);
    const payload =
      normalized.data && typeof normalized.data === 'object'
        ? (normalized.data as Record<string, unknown>)
        : {};
    const id = payload.id;

    if (typeof id === 'number') {
      return {
        type: 'HandleSuccess',
        value: payload,
      };
    }

    if (id === 'aaa') {
      return {
        type: 'InputValidationError',
        message: 'invalid schema',
      };
    }

    return {
      type: 'OutputValidationError',
      message: 'server_error',
    };
  };

  (patchUserHandler as Record<string, unknown>)[HANDLER_WITH_SCHEMA] = true;

  return [
    {
      name: 'getUser',
      httpMethod: 'GET',
      routeName: '/nest/user',
      routePath: '/nest/user',
      filename,
      handler: (input: unknown) => {
        const normalized = getInput(input);
        return {
          query: normalized.query || {},
        };
      },
    },
    {
      name: 'postUser',
      httpMethod: 'POST',
      routeName: '/nest/user',
      routePath: '/nest/user',
      filename,
      handler: (input: unknown) => {
        const normalized = getInput(input);
        return {
          data: normalized.data,
          query: normalized.query || {},
          cookies: parseCookies(normalized.cookies),
        };
      },
    },
    {
      name: 'patchUser',
      httpMethod: 'PATCH',
      routeName: '/nest/user',
      routePath: '/nest/user',
      filename,
      handler: patchUserHandler as any,
    },
    {
      name: 'postUpload',
      httpMethod: 'POST',
      routeName: '/upload',
      routePath: '/upload',
      filename,
      handler: (input: unknown) => {
        const normalized = getInput(input);
        return {
          message: 'success',
          formData: normalized.formData || {},
        };
      },
    },
  ];
};

export const APIPlugin = (): ServerPlugin => ({
  name: '@modern-js/test-plugin-koa-api',
  setup: (api: any) => {
    api.setAppContext({
      apiMode: 'function',
      apiHandlerInfos: createApiHandlerInfos(),
      apiDirectory: '',
    });
    return {};
  },
});
