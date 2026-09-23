import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import {
  createRootTsConfig,
  createSharedPackageTsConfig,
  createTsConfigBase,
} from '../src/ultramodern-workspace/tsconfigs';
import { createWorkspaceRootScriptPlan } from '../src/ultramodern-workspace/workspace-script-plan';

test('generated root typecheck follows references and includes Node types under TypeScript 7', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'um-node-types-'));
  const require = createRequire(import.meta.url);
  try {
    const source = path.join(root, 'packages/shared-contracts/src');
    fs.mkdirSync(source, { recursive: true });
    fs.mkdirSync(path.join(root, 'node_modules/@types'), { recursive: true });
    fs.symlinkSync(
      path.dirname(require.resolve('@types/node/package.json')),
      path.join(root, 'node_modules/@types/node'),
      'dir',
    );
    fs.writeFileSync(
      path.join(root, 'tsconfig.base.json'),
      JSON.stringify(createTsConfigBase()),
    );
    fs.writeFileSync(
      path.join(source, '../tsconfig.json'),
      JSON.stringify(createSharedPackageTsConfig('packages/shared-contracts')),
    );
    fs.writeFileSync(
      path.join(root, 'tsconfig.json'),
      JSON.stringify(createRootTsConfig()),
    );
    const designTokens = path.join(root, 'packages/shared-design-tokens');
    fs.mkdirSync(path.join(designTokens, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(designTokens, 'src/index.ts'),
      'export const color = "red";\n',
    );
    fs.writeFileSync(
      path.join(designTokens, 'tsconfig.json'),
      JSON.stringify(
        createSharedPackageTsConfig('packages/shared-design-tokens'),
      ),
    );
    const input = path.join(source, 'index.ts');
    fs.writeFileSync(
      input,
      'export const bytes: Buffer = Buffer.from("ok");\n',
    );
    const compiler = path.join(
      path.dirname(
        require.resolve(
          `@typescript/native-preview-${process.platform}-${process.arch}/package.json`,
          {
            paths: [
              path.dirname(
                require.resolve('@typescript/native-preview/package.json'),
              ),
            ],
          },
        ),
      ),
      'lib',
      process.platform === 'win32' ? 'tsgo.exe' : 'tsgo',
    );
    const compile = () =>
      spawnSync(
        compiler,
        [
          ...createWorkspaceRootScriptPlan([]).typecheck.split(' ').slice(3),
          '--pretty',
          'false',
        ],
        { cwd: root, encoding: 'utf8' },
      );
    const accepted = compile();
    expect(accepted.error).toBeUndefined();
    expect(accepted.stdout + accepted.stderr).toBe('');
    expect(accepted.status).toBe(0);
    fs.writeFileSync(input, 'export const bytes: Buffer = 123;\n');
    const rejected = compile();
    expect(rejected.status).not.toBe(0);
    expect(rejected.stdout + rejected.stderr).toContain('TS2322');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
