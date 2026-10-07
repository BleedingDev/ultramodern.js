import type { RendererIdentity } from '@modern-js/renderer-core/identity';
import { createRequestSession } from '@modern-js/renderer-core/session';
import { expect, rstest, test } from '@rstest/core';
import { createElement } from 'octane/server';
import { createNativeServerEntry } from '../src/entry-server';
import { useI18n } from '../src/i18n/useI18n';
import {
  OCTANE_COMPILER_VERSION,
  OCTANE_RUNTIME_VERSION,
} from '../src/manifest';

test('a component-only entry renders with its request localization instance and handoff', async () => {
  const identity: RendererIdentity = {
    renderer: 'octane',
    appId: 'component-store',
    entryName: 'main',
    protocolVersion: 1,
    buildId: 'component-build',
  };
  const instance = { language: 'cs', t: () => 'Ahoj' };
  let renderedInstance: unknown;
  const create = rstest.fn(async () => instance);
  const handoff = rstest.fn((language: string, resolved?: typeof instance) => ({
    id: 'component-i18n',
    payload: JSON.stringify({
      language,
      resources: { translation: { greeting: resolved?.t() } },
    }),
  }));
  const entry = createNativeServerEntry({
    identity,
    app: async () => ({
      default: () => {
        const i18n = useI18n();
        renderedInstance = i18n.instance;
        return createElement(
          'main',
          null,
          `${i18n.language}: ${i18n.t('greeting')}`,
        );
      },
    }),
    i18n: {
      languages: ['en', 'cs'],
      resolveRequest: () => ({ kind: 'language', language: 'cs' }),
      redirect: location => Response.redirect(location),
      create,
      rewrite: () => ({}),
      handoff,
      clientHandoff: () => ({ language: 'cs' }),
      syncWithRouter: () => {},
    },
  });
  const request = new Request('https://component.test/cs/');
  const session = createRequestSession({
    request,
    identity,
    platform: { kind: 'node', bindings: {} },
  });
  const response = await entry.nativeRequestHandler(request, {
    session,
    entry: identity,
    nativeManifest: {
      schemaVersion: 1,
      renderer: 'octane',
      runtimeVersion: OCTANE_RUNTIME_VERSION,
      compilerVersion: OCTANE_COMPILER_VERSION,
      rendererIdentity: identity,
      nativeHydrationBuildId: 'native-component-build',
      sourceModules: [
        {
          resource: 'src/App.tsrx',
          canonicalId: 'component-store:src/App.tsrx',
          moduleId: './src/App.tsrx',
          transformKind: 'compile',
          emittedSourceSha256: 'b'.repeat(64),
          assets: ['static/js/main.js'],
        },
      ],
      assets: [{ file: 'static/js/main.js', sha256: 'c'.repeat(64) }],
    },
  });
  const html = await response.text();

  expect(create).toHaveBeenCalledExactlyOnceWith('cs');
  expect(renderedInstance).toBe(instance);
  expect(handoff).toHaveBeenCalledExactlyOnceWith('cs', instance);
  expect(html).toContain('<html lang="cs">');
  expect(html).toContain('<main>cs: Ahoj</main>');
  expect(html).toContain('"resources":{"translation":{"greeting":"Ahoj"}}');
});
