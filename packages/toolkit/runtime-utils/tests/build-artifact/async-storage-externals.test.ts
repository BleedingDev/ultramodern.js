import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const asyncStorageArtifactPaths = [
  path.resolve(__dirname, '../../dist/esm/universal/async_storage.server.mjs'),
  path.resolve(
    __dirname,
    '../../dist/esm-node/universal/async_storage.server.mjs',
  ),
];

describe('async storage build artifact', () => {
  test('preserves context across async work in every ESM artifact', async () => {
    expect(
      asyncStorageArtifactPaths.filter(file => !fs.existsSync(file)),
    ).toEqual([]);

    for (const artifactPath of asyncStorageArtifactPaths) {
      const runtime = await import(
        `${pathToFileURL(artifactPath).href}?artifact=${path.basename(path.dirname(artifactPath))}`
      );
      await expect(
        runtime.storage.run(
          { headers: { 'x-contract': 'preserved' } },
          async () => {
            await Promise.resolve();
            return runtime.storage.useContext().headers['x-contract'];
          },
        ),
      ).resolves.toBe('preserved');
    }
  });
});
