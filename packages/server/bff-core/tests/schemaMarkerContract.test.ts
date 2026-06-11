import { match } from '@modern-js/bff-runtime';
import { getApiHandlerMode, isSchemaApiHandler } from '../src/adapter-kit';
import type { ApiHandler } from '../src/types';

/**
 * adapter-kit re-declares the HANDLER_WITH_SCHEMA marker instead of depending
 * on @modern-js/bff-runtime at runtime. This contract test imports the real
 * bff-runtime and pins the two packages together: if bff-runtime ever renames
 * its private marker, schema handlers would silently degrade to 'plain' mode
 * (validation results returned as 200 payloads instead of 400/500) and this
 * test is the only thing that would catch it.
 */
describe('HANDLER_WITH_SCHEMA cross-package contract', () => {
  const schemaHandler = match(
    {
      request: {
        data: {
          message: String,
        },
      },
      response: {
        reply: String,
      },
    },
    async ({ data }) => ({ reply: data.message }),
  );

  test('a handler produced by bff-runtime match() is detected as schema mode', () => {
    expect(isSchemaApiHandler(schemaHandler)).toBe(true);
    expect(getApiHandlerMode(schemaHandler as unknown as ApiHandler)).toBe(
      'schema',
    );
  });

  test('plain functions are not detected as schema handlers', () => {
    expect(isSchemaApiHandler(async () => ({}))).toBe(false);
  });
});
