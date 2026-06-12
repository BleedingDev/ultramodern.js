import path from 'node:path';
import { expect, test } from '@playwright/test';
import { build } from '@scripts/shared';

test('should load postcss.config.ts correctly', async () => {
  const builder = await build({
    cwd: __dirname,
    entry: { index: path.resolve(__dirname, './src/index.ts') },
    builderConfig: {
      html: {
        template: './src/index.html',
      },
    },
  });

  const files = await builder.unwrapOutputJSON();
  const indexCssFile = Object.keys(files).find(
    file => file.includes('index.') && file.endsWith('.css'),
  )!;
  const css = files[indexCssFile];

  // Strict assertions (upstream pinned the exact file content for Tailwind v3;
  // Tailwind v4 output includes the full preflight, so pin the exact rule
  // bodies instead): each utility must be emitted exactly once. A duplicated
  // or mutated rule means the user postcss config was applied twice
  // (loadUserPostcssrc double-apply regression).
  expect(
    css.match(
      /\.text-3xl\{font-size:var\(--text-3xl\);line-height:var\(--tw-leading,var\(--text-3xl--line-height\)\)\}/g,
    ),
  ).toHaveLength(1);
  expect(
    css.match(
      /\.font-bold\{--tw-font-weight:var\(--font-weight-bold\);font-weight:var\(--font-weight-bold\)\}/g,
    ),
  ).toHaveLength(1);
});
