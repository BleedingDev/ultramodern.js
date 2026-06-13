import fs from 'node:fs';
import path from 'node:path';

const asyncStorageArtifactPaths = [
  path.resolve(__dirname, '../../dist/esm/universal/async_storage.server.mjs'),
  path.resolve(
    __dirname,
    '../../dist/esm-node/universal/async_storage.server.mjs',
  ),
];
describe('async storage build artifact', () => {
  test('preserves the Cloudflare-compatible node:async_hooks builtin import', () => {
    const missingArtifacts = asyncStorageArtifactPaths.filter(
      artifactPath => !fs.existsSync(artifactPath),
    );

    expect(missingArtifacts).toEqual([]);

    const contents = asyncStorageArtifactPaths
      .map(artifactPath => fs.readFileSync(artifactPath, 'utf8'))
      .join('\n');

    expect(contents).toContain('from "node:async_hooks"');
    expect(contents).not.toContain('from "async_hooks"');
  });
});
