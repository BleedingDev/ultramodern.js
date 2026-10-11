import * as Effect from 'effect/Effect';
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from 'effect/http-api';
import * as Layer from 'effect/Layer';
import * as Schema from 'effect/Schema';
import {
  assembleEffectBffRuntime,
  type EffectBffRuntimeAssembly,
} from '../src/assembly';
import { defineEffectBff } from '../src/effect/handler/definition';

const group = HttpApiGroup.make('status').add(
  HttpApiEndpoint.get('read', '/status', {
    query: { fail: Schema.optional(Schema.String) },
    success: Schema.Struct({ ok: Schema.Boolean }),
    error: Schema.String.pipe(HttpApiSchema.status(409)),
  }),
);
const api = HttpApi.make('AssemblyApi').add(group);
const handlers = HttpApiBuilder.group(api, 'status', handlers =>
  handlers.handle('read', ({ query }) =>
    query.fail === 'true'
      ? Effect.fail('status conflict')
      : Effect.succeed({ ok: true }),
  ),
);
const assembly: EffectBffRuntimeAssembly<'AssemblyApi', typeof group, never> = {
  api,
  handlers,
};

describe('Effect BFF runtime assembly', () => {
  test.each([false, true])(
    'preserves native requests, errors, and handler options with transport=%s',
    async withTransport => {
      const transport = withTransport ? Layer.empty : undefined;
      const runtime = assembleEffectBffRuntime({ ...assembly, transport });
      const nativeApiLayer = HttpApiBuilder.layer(api).pipe(
        Layer.provide(handlers),
      );
      const native = defineEffectBff({
        api,
        layer:
          transport === undefined
            ? nativeApiLayer
            : nativeApiLayer.pipe(Layer.merge(transport)),
      });
      const options = { openapi: { path: '/schema.json' } };
      const assembledHandler = runtime.createHandler(options);
      const nativeHandler = native.createHandler(options);

      try {
        for (const [pathname, status] of [
          ['/status', 200],
          ['/status?fail=true', 409],
          ['/missing', 404],
          ['/schema.json', 200],
          ['/openapi.json', 404],
        ] as const) {
          const response = await assembledHandler.handler(
            new Request(`http://localhost${pathname}`),
          );
          const reference = await nativeHandler.handler(
            new Request(`http://localhost${pathname}`),
          );
          expect(response.status).toBe(status);
          expect(response.status).toBe(reference.status);
          expect(response.headers.get('content-type')).toBe(
            reference.headers.get('content-type'),
          );
          expect(await response.text()).toBe(await reference.text());
        }
      } finally {
        await assembledHandler.dispose();
        await nativeHandler.dispose();
      }
    },
  );

  test('forwards validation options through the canonical factory', async () => {
    const runtime = assembleEffectBffRuntime(assembly);
    const denial = new Response('denied by policy', { status: 403 });
    const validated = runtime.createHandler({ validateRequest: () => denial });
    const strict = runtime.createHandler({
      dataPlatform: { requireEnvelope: true },
    });

    try {
      expect(
        await validated.handler(new Request('http://localhost/status')),
      ).toBe(denial);
      const response = await strict.handler(
        new Request('http://localhost/status'),
      );
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual(
        expect.objectContaining({
          message: expect.stringContaining(
            'Missing required data envelope header',
          ),
        }),
      );
    } finally {
      await validated.dispose();
      await strict.dispose();
    }
  });

  test('acquires the supplied transport lazily and releases it once', async () => {
    const lifecycle: string[] = [];
    const transport = Layer.effectDiscard(
      Effect.acquireRelease(
        Effect.sync(() => lifecycle.push('acquire')),
        () => Effect.sync(() => lifecycle.push('release')),
      ),
    );
    const runtime = assembleEffectBffRuntime({ ...assembly, transport });
    expect(lifecycle).toEqual([]);
    const handler = runtime.createHandler();

    try {
      for (let index = 0; index < 2; index++) {
        const response = await handler.handler(
          new Request('http://localhost/status'),
        );
        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ ok: true });
      }
      expect(lifecycle).toEqual(['acquire']);
    } finally {
      await handler.dispose();
    }
    await handler.dispose();
    expect(lifecycle).toEqual(['acquire', 'release']);
  });
});
