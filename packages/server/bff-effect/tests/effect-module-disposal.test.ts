import {
  defineEffectBff,
  Effect,
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  Layer,
  resolveEffectBffModuleHandler,
  Schema,
} from '../src/effect';

describe('Effect BFF module resolver disposal', () => {
  test('shares and awaits one underlying dispose for a defineEffectBff factory', async () => {
    const api = HttpApi.make('ModuleDisposalApi').add(
      HttpApiGroup.make('health').add(
        HttpApiEndpoint.get('status', '/status', {
          success: Schema.Struct({ ok: Schema.Boolean }),
        }),
      ),
    );
    const groupLayer = HttpApiBuilder.group(api, 'health', handlers =>
      handlers.handle('status', () => Effect.succeed({ ok: true })),
    );

    let markDisposeStarted!: () => void;
    const disposeStarted = new Promise<void>(resolve => {
      markDisposeStarted = resolve;
    });
    let releaseDispose!: () => void;
    const disposeReleased = new Promise<void>(resolve => {
      releaseDispose = resolve;
    });
    const disposeRuntime = rs.fn(async () => {
      markDisposeStarted();
      await disposeReleased;
    });
    const disposalLayer = Layer.effectDiscard(
      Effect.acquireRelease(Effect.succeed(undefined), () =>
        Effect.promise(disposeRuntime),
      ),
    );
    const runtime = defineEffectBff({
      api,
      layer: Layer.mergeAll(
        HttpApiBuilder.layer(api).pipe(Layer.provide(groupLayer)),
        disposalLayer,
      ),
    });

    const loaded = await resolveEffectBffModuleHandler(runtime);
    expect(loaded).not.toBeNull();
    await expect(
      loaded?.handler(new Request('https://example.com/status')),
    ).resolves.toMatchObject({ status: 200 });

    const firstDispose = loaded!.dispose!();
    const concurrentDispose = loaded!.dispose!();
    expect(concurrentDispose).toBe(firstDispose);
    await disposeStarted;
    expect(disposeRuntime).toHaveBeenCalledTimes(1);

    let settled = false;
    void firstDispose.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    releaseDispose();
    await Promise.all([firstDispose, concurrentDispose]);
    expect(settled).toBe(true);
    expect(loaded!.dispose!()).toBe(firstDispose);
    expect(disposeRuntime).toHaveBeenCalledTimes(1);
  });
});
