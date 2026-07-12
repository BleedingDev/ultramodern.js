import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('generated runtime registry type surface', () => {
  test('types main and named entry aliases without a runtime fallback', () => {
    const packageJson = JSON.parse(
      readFileSync(path.join(__dirname, '../package.json'), 'utf8'),
    ) as {
      exports: Record<string, unknown>;
      typesVersions: Record<string, Record<string, string[]>>;
    };
    const registryTypes = './dist/types/cli/registry.d.ts';

    expect(packageJson.exports['./registry']).toEqual({
      types: registryTypes,
    });
    expect(packageJson.exports['./registry/*']).toEqual({
      types: registryTypes,
    });
    expect(packageJson.typesVersions['*']?.registry).toEqual([registryTypes]);
    expect(packageJson.typesVersions['*']?.['registry/*']).toEqual([
      registryTypes,
    ]);
  });
});
