import {
  HttpApi,
  HttpApiBuilder,
  resolveEffectBffModuleHandler,
} from '../src/effect';

describe('Effect BFF module diagnostics', () => {
  test('points raw module authors to the public Effect BFF owner', async () => {
    const api = HttpApi.make('ModuleDiagnosticApi');
    const warnings: string[] = [];
    const loaded = await resolveEffectBffModuleHandler(
      { api, layer: HttpApiBuilder.layer(api) },
      { onWarning: message => warnings.push(message) },
    );

    try {
      expect(warnings).toEqual([
        '[BFF][Effect] Detected { api, layer } export without createHandler. Prefer `defineEffectBff(...)` from @modern-js/bff-effect/effect to avoid module instance mismatch.',
      ]);
    } finally {
      await loaded?.dispose?.();
    }
  });
});
