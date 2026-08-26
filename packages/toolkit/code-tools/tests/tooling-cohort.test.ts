import fs from 'node:fs';
import path from 'node:path';

const repositoryRoot = path.resolve(import.meta.dirname, '../../../..');

const readJson = (relativePath: string): Record<string, unknown> =>
  JSON.parse(
    fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8'),
  ) as Record<string, unknown>;

describe('central tooling cohort', () => {
  test('pins the reviewed pnpm and Oxc versions consistently', () => {
    const rootPackage = readJson('package.json');
    const codeToolsPackage = readJson(
      'packages/toolkit/code-tools/package.json',
    );
    const miseConfig = fs.readFileSync(
      path.join(repositoryRoot, '.mise.toml'),
      'utf8',
    );

    expect(rootPackage.packageManager).toBe('pnpm@11.24.0');
    expect(rootPackage.devDependencies).toMatchObject({ oxfmt: '0.65.0' });
    expect(codeToolsPackage.dependencies).toMatchObject({ oxlint: '1.80.0' });
    expect(miseConfig).toMatch(/^pnpm = "11\.24\.0"$/m);
  });

  test('does not retain one-shot release-age exclusions for superseded Oxc artifacts', () => {
    const workspaceConfig = fs.readFileSync(
      path.join(repositoryRoot, 'pnpm-workspace.yaml'),
      'utf8',
    );

    expect(workspaceConfig).not.toMatch(
      /(?:^|\n)\s*- oxlint@1\.78\.0\s*(?:\n|$)/,
    );
    expect(workspaceConfig).not.toContain('@oxlint/binding-');
    expect(workspaceConfig).not.toMatch(
      /(?:^|\n)\s*- oxfmt@0\.63\.0\s*(?:\n|$)/,
    );
    expect(workspaceConfig).not.toContain('@oxfmt/binding-');
  });
});
