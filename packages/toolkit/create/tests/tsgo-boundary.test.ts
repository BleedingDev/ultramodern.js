import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  addUltramodernVertical,
  generateUltramodernWorkspace,
} from '../src/ultramodern-workspace';
import {
  TYPESCRIPT_STABLE_VERSION,
  TYPESCRIPT_VERSION,
} from '../src/ultramodern-workspace/versions';

const packageRoot = path.resolve(__dirname, '..');
const sourceRoots = ['src', 'templates', 'template-workspace'];
const sourceExtensions = new Set([
  '.cjs',
  '.handlebars',
  '.js',
  '.mjs',
  '.mts',
  '.ts',
  '.tsx',
]);

const compilerApiImportPattern =
  /\b(?:import(?:\s+type)?[\s\S]*?\sfrom\s*|require\()\s*['"](?:typescript|@typescript\/typescript6|@typescript\/native-preview(?:\/[^'"]*)?)['"]/u;
const nativePreviewImportPattern =
  /\b(?:import(?:\s+type)?[\s\S]*?\sfrom\s*|require\()\s*['"]@typescript\/native-preview(?:\/[^'"]*)?['"]/u;
const typescript6ImportPattern =
  /\b(?:import(?:\s+type)?[\s\S]*?\sfrom\s*|require\()\s*['"]@typescript\/typescript6['"]/u;

function listSourceFiles(root: string, dir = root): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listSourceFiles(root, entryPath));
    } else if (
      entry.isFile() &&
      sourceExtensions.has(path.extname(entry.name))
    ) {
      files.push(path.relative(root, entryPath).split(path.sep).join('/'));
    }
  }
  return files.sort();
}

function readPackageJson(relativePath = 'package.json'): any {
  return JSON.parse(
    fs.readFileSync(path.join(packageRoot, relativePath), 'utf-8'),
  );
}

function assertNoCompilerApiImports(root: string, label: string) {
  for (const relativePath of listSourceFiles(root)) {
    const source = fs.readFileSync(path.join(root, relativePath), 'utf-8');
    assert.doesNotMatch(
      source,
      compilerApiImportPattern,
      `${label}/${relativePath} must not import TypeScript compiler APIs`,
    );
  }
}

test('create package build keeps UltraModern generator declarations on tsgo:dts', () => {
  const packageJson = readPackageJson();

  assert.match(
    packageJson.scripts.build,
    /rslib build/u,
    'package build must still emit runtime artifacts before declarations',
  );
  assert.match(
    packageJson.scripts.build,
    /pnpm -w tsgo:dts "\$PWD"/u,
    'package build must emit declarations through the repo tsgo:dts flow',
  );
  assert.equal(
    packageJson.dependencies?.typescript,
    undefined,
    'published create runtime must not depend on the stable TypeScript package',
  );
  assert.equal(
    packageJson.dependencies?.['@typescript/native-preview'],
    undefined,
    'published create runtime must not depend on native-preview compiler internals',
  );
  assert.equal(
    typeof packageJson.devDependencies?.typescript,
    'string',
    'create tests may use the stable TypeScript package explicitly',
  );
  assert.equal(
    typeof packageJson.devDependencies?.['@typescript/native-preview'],
    'string',
    'create build tooling may depend on native-preview as a dev-only compiler',
  );
});

test('UltraModern generator runtime sources do not import TypeScript compiler APIs', () => {
  for (const sourceRoot of sourceRoots) {
    assertNoCompilerApiImports(path.join(packageRoot, sourceRoot), sourceRoot);
  }
});

test('compiler API tests use TypeScript 6 compatibility API and never native-preview internals', () => {
  const packageJson = readPackageJson();

  assert.equal(
    packageJson.devDependencies?.typescript,
    '^6.0.3',
    'create package keeps the repo-consistent TypeScript tooling line',
  );
  assert.equal(
    typeof packageJson.devDependencies?.['@typescript/typescript6'],
    'string',
    'compiler API tests use the TypeScript 6 compatibility package',
  );

  const compilerApiTests: string[] = [];

  for (const relativePath of listSourceFiles(path.join(packageRoot, 'tests'))) {
    const source = fs.readFileSync(
      path.join(packageRoot, 'tests', relativePath),
      'utf-8',
    );

    assert.doesNotMatch(
      source,
      nativePreviewImportPattern,
      `tests/${relativePath} must not import @typescript/native-preview`,
    );

    if (typescript6ImportPattern.test(source)) {
      compilerApiTests.push(relativePath);
    }
  }

  assert.ok(
    compilerApiTests.length > 0,
    'at least one compiler API test should exercise the TypeScript 6 compatibility boundary',
  );
});

test('generated package module scopes keep MF apps compatible with classic compiler consumers', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-ts7-package-'));
  const workspaceDir = path.join(tempRoot, 'ts7-package-workspace');

  try {
    generateUltramodernWorkspace({
      targetDir: workspaceDir,
      packageName: 'ts7-package-workspace',
      modernVersion: '3.2.1',
      enableTailwind: true,
      packageSource: {
        strategy: 'install',
        modernPackageVersion: '3.2.0-ultramodern.108',
      },
    });
    const rootPackageJson = JSON.parse(
      fs.readFileSync(path.join(workspaceDir, 'package.json'), 'utf-8'),
    );
    const shellPackageJson = JSON.parse(
      fs.readFileSync(
        path.join(workspaceDir, 'apps/shell-super-app/package.json'),
        'utf-8',
      ),
    );
    const sharedContractsPackageJson = JSON.parse(
      fs.readFileSync(
        path.join(workspaceDir, 'packages/shared-contracts/package.json'),
        'utf-8',
      ),
    );
    const ultramodernConfig = JSON.parse(
      fs.readFileSync(
        path.join(workspaceDir, '.modernjs/ultramodern.json'),
        'utf-8',
      ),
    );
    const shellConfig = ultramodernConfig.topology.apps.find(
      (app: { id: string }) => app.id === 'shell-super-app',
    );

    assert.equal(rootPackageJson.type, 'module');
    assert.equal(
      sharedContractsPackageJson.type,
      'module',
      'generated shared packages should stay ESM-native',
    );
    assert.equal(
      shellPackageJson.type,
      undefined,
      'generated MF app packages should not opt into package-level ESM',
    );
    assert.equal(
      shellPackageJson.devDependencies?.typescript,
      TYPESCRIPT_VERSION,
      'generated apps must install stable TypeScript 7 by default',
    );
    assert.equal(
      shellPackageJson.devDependencies?.['@typescript/native-preview'],
      undefined,
      'generated apps must not install native-preview when stable TypeScript 7 is available',
    );
    assert.equal(
      shellConfig?.moduleFederation?.dts?.compilerInstance,
      'effect-tsgo',
      'compact metadata should keep MF DTS generation on the effect-tsgo lane',
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('generated workspaces do not import TypeScript compiler APIs', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-tsgo-boundary-'));
  const workspaceDir = path.join(tempRoot, 'tsgo-boundary-workspace');

  try {
    generateUltramodernWorkspace({
      targetDir: workspaceDir,
      packageName: 'tsgo-boundary-workspace',
      modernVersion: '3.2.1',
      enableTailwind: true,
      packageSource: {
        strategy: 'install',
        modernPackageVersion: '3.2.0-ultramodern.108',
      },
    });
    addUltramodernVertical({
      workspaceRoot: workspaceDir,
      name: 'catalog',
      modernVersion: '3.2.1',
    });

    assertNoCompilerApiImports(workspaceDir, 'generated workspace');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
