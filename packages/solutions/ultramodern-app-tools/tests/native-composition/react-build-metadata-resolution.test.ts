import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { resolveReactMetadataServerPlugin } from '../../src/renderers/react/build-metadata';

describe('React metadata owning public export resolution', () => {
  it.each([
    '@modern-js/ultramodern-app-tools',
    '@bleedingdev/modern-js-ultramodern-app-tools',
  ])(
    'self-resolves the mapped package hosted under %s',
    async dependencyKey => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'um-react-owner-'));
      const owner = path.join(root, 'node_modules', dependencyKey);
      const registrar = path.join(
        owner,
        'src/renderers/react/build-metadata.ts',
      );
      const target = path.join(owner, 'dist/react-build-metadata-server.cjs');
      try {
        fs.mkdirSync(path.dirname(registrar), { recursive: true });
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(
          target,
          'module.exports = () => ({ name: "real-owner" });',
        );
        fs.writeFileSync(
          path.join(root, 'package.json'),
          JSON.stringify({ name: 'isolated-consumer' }),
        );
        fs.writeFileSync(
          path.join(owner, 'package.json'),
          JSON.stringify({
            name: '@bleedingdev/modern-js-ultramodern-app-tools',
            exports: {
              './react-build-metadata-server': {
                node: {
                  require: './dist/react-build-metadata-server.cjs',
                },
              },
            },
          }),
        );
        const resolved = await resolveReactMetadataServerPlugin(
          pathToFileURL(registrar).href,
        );
        expect(resolved).toBe(fs.realpathSync(target));
        const requireFromApplication = createRequire(
          path.join(root, 'package.json'),
        );
        expect(requireFromApplication(resolved)().name).toBe('real-owner');
        if (dependencyKey === '@modern-js/ultramodern-app-tools')
          expect(() =>
            requireFromApplication.resolve(
              '@bleedingdev/modern-js-ultramodern-app-tools/react-build-metadata-server',
            ),
          ).toThrow();
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it('rejects a foreign registrar instead of loading an application-selected package', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'um-react-foreign-'));
    try {
      fs.writeFileSync(
        path.join(root, 'package.json'),
        JSON.stringify({ name: 'foreign-owner', exports: {} }),
      );
      await expect(
        resolveReactMetadataServerPlugin(
          pathToFileURL(path.join(root, 'source.ts')).href,
        ),
      ).rejects.toThrow('not its owning package');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
