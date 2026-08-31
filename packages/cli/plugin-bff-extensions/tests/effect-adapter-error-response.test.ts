import type { Context, ServerPluginAPI } from '@modern-js/server-core';
import { describe, expect, test } from '@rstest/core';

import { createEffectAdapterRuntimeErrorResponse } from '../src/effect-adapter/error-response';

const createApi = (
  onError?: (error: Error, context: Context) => Response | void,
): ServerPluginAPI =>
  ({
    getServerConfig: () => ({ onError }),
  }) as unknown as ServerPluginAPI;

describe('Effect adapter failure responses', () => {
  test('keeps the safe failure envelope and drops private error fields', async () => {
    const response = await createEffectAdapterRuntimeErrorResponse(
      createApi(),
      Object.assign(new Error('database-password'), {
        status: 503,
        code: 'SECRET_CODE',
        details: 'internal-details',
        retryAfter: '120',
      }),
      {} as Context,
    );

    expect(response.status).toBe(503);
    expect(response.headers.get('retry-after')).toBe('120');
    const serialized = JSON.stringify(await response.json());
    expect(serialized).not.toContain('database-password');
    expect(serialized).not.toContain('SECRET_CODE');
    expect(serialized).not.toContain('internal-details');
  });

  test('provides c.json to a configured onError handler', async () => {
    const response = await createEffectAdapterRuntimeErrorResponse(
      createApi((_error, context) =>
        (
          context as Context & {
            json: (value: unknown, init: ResponseInit) => Response;
          }
        ).json(
          { handled: true },
          {
            status: 409,
            headers: { 'x-error-source': 'configured' },
          },
        ),
      ),
      new Error('hidden'),
      {} as Context,
    );

    expect(response.status).toBe(409);
    expect(response.headers.get('x-error-source')).toBe('configured');
    await expect(response.json()).resolves.toEqual({ handled: true });
  });

  test('falls back safely when configured onError throws', async () => {
    const response = await createEffectAdapterRuntimeErrorResponse(
      createApi(() => {
        throw new Error('configuration-secret');
      }),
      new Error('request-secret'),
      {} as Context,
    );

    expect(response.status).toBe(500);
    const serialized = JSON.stringify(await response.json());
    expect(serialized).not.toContain('configuration-secret');
    expect(serialized).not.toContain('request-secret');
  });
});
