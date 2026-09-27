import { createHash } from 'node:crypto';
import { EFFECT_BFF_HANDLER_FACTORY_REGISTRY_SHARE } from '@modern-js/bff-effect/effect-edge';
import {
  type BackendFederationCommonJsEvaluator,
  evaluateNodeBackendFederationCommonJs,
} from '@modern-js/server-runtime-extensions/backend-federation-security/node';
import type { ModuleFederationRuntimePlugin } from '@module-federation/runtime';
import {
  type BackendFederationRemote,
  type BackendFederationRuntimeOptions,
  createBackendFederationLoadEntryPlugin,
  createBackendFederationRuntime,
} from '../src/backend-federation';
import { effectBffHostShared } from '../src/backend-federation/node-shared';

const remoteName = 'verticalIntegrityBackend';

// Each evaluation owns fresh container state; `./init-scopes` reports the
// share scopes this evaluation's init() received.
const containerSource = `
const initScopes = [];
const state = { evaluation: {} };
module.exports = {
  init(shareScope) { initScopes.push(shareScope); },
  get(id) {
    if (id === './init-scopes') return () => initScopes;
    if (id === './effect-api' || id === './other-api') return () => ({ id, state });
    throw new Error('Unexpected expose ' + id);
  },
};
`;

const dataEntry = `data:text/javascript;charset=utf-8,${encodeURIComponent(
  containerSource,
)}`;

function countingEvaluator() {
  const sources: string[] = [];
  const evaluateCommonJs: BackendFederationCommonJsEvaluator = (
    source,
    context,
  ) => {
    sources.push(source);
    return evaluateNodeBackendFederationCommonJs(source, context);
  };
  return { evaluateCommonJs, sources };
}

function createRuntime(
  remote: BackendFederationRemote,
  options: Partial<BackendFederationRuntimeOptions> = {},
) {
  const evaluator = countingEvaluator();
  const runtime = createBackendFederationRuntime({
    hostName: 'integrityHost',
    remote,
    shared: effectBffHostShared,
    ...options,
    entryPolicy: {
      evaluateCommonJs: evaluator.evaluateCommonJs,
      ...options.entryPolicy,
    },
  });
  return { evaluator, runtime };
}

describe('backend federation integrity plugin', () => {
  const globals = globalThis as Record<string, unknown>;

  afterEach(() => {
    delete globals[remoteName];
  });

  test('never uses a preset global container for an unverified or unprovided remote', async () => {
    const presetGet = rs.fn();
    globals[remoteName] = { init() {}, get: presetGet };

    await expect(
      createRuntime({
        entry: 'https://catalog.example.test/backendRemoteEntry.cjs',
        name: remoteName,
        type: 'commonjs-module',
      }).runtime.loadRemote(`${remoteName}/effect-api`),
    ).rejects.toThrow(/requires verified entry bytes/u);
    await expect(
      createRuntime({
        entry: `static:${remoteName}`,
        name: remoteName,
      }).runtime.loadRemote(`${remoteName}/effect-api`),
    ).rejects.toThrow(`${remoteName} has no entry provider`);

    expect(presetGet).not.toHaveBeenCalled();
  });

  test('evaluates and initializes a container once across exposes with the host share scope', async () => {
    const { evaluator, runtime } = createRuntime({
      entry: dataEntry,
      name: remoteName,
      type: 'commonjs-module',
    });

    const first = await runtime.loadRemote<{ id: string }>(
      `${remoteName}/effect-api`,
    );
    const second = await runtime.loadRemote<{ id: string }>(
      `${remoteName}/other-api`,
    );
    const initScopes = await runtime.loadRemote<Record<string, unknown>[]>(
      `${remoteName}/init-scopes`,
    );

    expect([first?.id, second?.id]).toEqual(['./effect-api', './other-api']);
    expect(evaluator.sources).toHaveLength(1);
    expect(initScopes).toHaveLength(1);
    expect(Object.keys(initScopes?.[0] ?? {})).toContain(
      EFFECT_BFF_HANDLER_FACTORY_REGISTRY_SHARE,
    );
  });

  test('isolates runtimes that load the same remote entry', async () => {
    const remote: BackendFederationRemote = {
      entry: dataEntry,
      name: remoteName,
      type: 'commonjs-module',
    };
    const first = createRuntime(remote);
    const second = createRuntime(remote);

    const [firstModule, secondModule] = await Promise.all([
      first.runtime.loadRemote<{ state: object }>(`${remoteName}/effect-api`),
      second.runtime.loadRemote<{ state: object }>(`${remoteName}/effect-api`),
    ]);

    expect(firstModule?.state).not.toBe(secondModule?.state);
    expect(first.evaluator.sources).toHaveLength(1);
    expect(second.evaluator.sources).toHaveLength(1);
    expect(first.runtime.options.remotes.map(({ entry }) => entry)).toEqual([
      dataEntry,
    ]);
  });

  test('lets caller plugins observe Module Federation lifecycle hooks', async () => {
    const events: string[] = [];
    const observer: ModuleFederationRuntimePlugin = {
      name: 'lifecycle-observer',
      async afterMatchRemote({ remoteInfo }) {
        events.push(`afterMatchRemote:${remoteInfo?.name}`);
      },
      async beforeInitContainer(args) {
        events.push(`beforeInitContainer:${args.remoteInfo.name}`);
        return args;
      },
      async onLoad({ expose }) {
        events.push(`onLoad:${expose}`);
      },
    };
    const { runtime } = createRuntime(
      { entry: dataEntry, name: remoteName, type: 'commonjs-module' },
      { plugins: [observer] },
    );

    await runtime.loadRemote(`${remoteName}/effect-api`);

    expect(events).toEqual([
      `afterMatchRemote:${remoteName}`,
      `beforeInitContainer:${remoteName}`,
      'onLoad:./effect-api',
    ]);
  });

  test('rejects entry bytes whose SHA-256 does not match before evaluation', async () => {
    const entryUrl = 'https://catalog.example.test/backendRemoteEntry.cjs';
    const tampered = containerSource.replace('evaluation', 'tampered__');
    const { evaluator, runtime } = createRuntime(
      {
        entry: entryUrl,
        name: remoteName,
        type: 'commonjs-module',
        verification: {
          byteLength: Buffer.byteLength(containerSource),
          entryUrl,
          remoteName,
          sha256: createHash('sha256').update(containerSource).digest('hex'),
        },
      },
      { entryPolicy: { fetch: async () => new Response(tampered) } },
    );

    await expect(
      runtime.loadRemote(`${remoteName}/effect-api`),
    ).rejects.toMatchObject({ code: 'integrity_mismatch' });
    expect(evaluator.sources).toHaveLength(0);
  });

  test('uses the first entry provider that serves a remote', async () => {
    const provider = (brand: string) =>
      createBackendFederationLoadEntryPlugin({
        resolveEntry: rs.fn(() => ({
          get: () => () => ({ brand }),
        })),
      });
    const specific = provider('specific');
    const fallback = provider('fallback');
    const { runtime } = createRuntime(
      { entry: `service:${remoteName}`, name: remoteName },
      { plugins: [specific, fallback] },
    );

    await expect(
      runtime.loadRemote(`${remoteName}/effect-api`),
    ).resolves.toEqual({ brand: 'specific' });
    await expect(
      runtime.loadRemote(`${remoteName}/effect-api`),
    ).resolves.toEqual({ brand: 'specific' });
  });

  test('names the remote when its entry scheme has no load path', async () => {
    await expect(
      createRuntime({
        entry: 'ftp://catalog.example.test/backendRemoteEntry.cjs',
        name: remoteName,
      }).runtime.loadRemote(`${remoteName}/effect-api`),
    ).rejects.toThrow(`${remoteName} uses unsupported entry ftp:`);
  });
});
