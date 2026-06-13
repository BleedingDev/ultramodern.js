import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('tanstack package public surface', () => {
  test('package manifest exposes the runtime subpath used by app fixtures', () => {
    const packageJson = JSON.parse(
      readFileSync(path.join(__dirname, '../../package.json'), 'utf-8'),
    ) as {
      exports: Record<string, unknown>;
      typesVersions?: Record<string, Record<string, string[]>>;
    };

    expect(packageJson.exports['./runtime']).toEqual({
      types: './dist/types/runtime/index.d.ts',
      node: {
        module: './dist/esm/runtime/index.mjs',
      },
      default: './dist/esm/runtime/index.mjs',
    });
    expect(packageJson.typesVersions?.['*']?.runtime).toEqual([
      './dist/types/runtime/index.d.ts',
    ]);
  });
});
