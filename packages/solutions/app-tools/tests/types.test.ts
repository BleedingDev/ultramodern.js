import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// The static `template/src/modern-app-env.d.ts` file was replaced by the
// ultramodern workspace generator; assert against the generated contents
// the scaffolder actually writes to `src/modern-app-env.d.ts`.
import { createAppEnvDts } from '../../../toolkit/create/src/ultramodern-workspace/app-files';
import { shellApp } from '../../../toolkit/create/src/ultramodern-workspace/descriptors';

const repoRoot = join(__dirname, '../../../..');

describe('app-tools types', () => {
  it('includes Rsbuild client types from the shared app-tools type reference', () => {
    const appToolsTypes = readFileSync(
      join(repoRoot, 'packages/solutions/app-tools/lib/types.d.ts'),
      'utf-8',
    );
    const appEnvTemplate = createAppEnvDts(shellApp);

    expect(appToolsTypes).toContain(
      '/// <reference types="@rsbuild/core/types" />',
    );
    expect(appEnvTemplate).toContain(
      "/// <reference types='@modern-js/app-tools/types' />",
    );
    expect(appEnvTemplate).not.toContain('@rsbuild/core/types');
  });
});
