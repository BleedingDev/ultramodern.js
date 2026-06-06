import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type OxlintRuleConfig = Record<string, unknown>;

type RunOxlintOptions = {
  readonly cwd: string;
  readonly targets: readonly string[];
  readonly rules: OxlintRuleConfig;
};

const require = createRequire(import.meta.url);

const resolveExistingPath = (candidates: readonly string[]) =>
  candidates.find(candidate => fs.existsSync(candidate));

const packageRoot = () =>
  path.resolve(fileURLToPath(import.meta.url), '../../');

const resolvePluginPath = () => {
  const root = packageRoot();
  const pluginPath = resolveExistingPath([
    path.join(root, 'oxlint-plugin.mjs'),
    path.join(root, 'oxlint-plugin.js'),
    path.join(root, '../src/oxlint-plugin.ts'),
  ]);
  if (!pluginPath) {
    throw new Error(
      'Unable to resolve @modern-js/ultramodern-checks Oxlint plugin.',
    );
  }
  return pluginPath;
};

const resolveOxlintBin = () => {
  const packageJsonPath = require.resolve('oxlint/package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as {
    bin?: string | Record<string, string>;
  };
  const binRelativePath =
    typeof packageJson.bin === 'string'
      ? packageJson.bin
      : packageJson.bin?.oxlint;
  if (!binRelativePath) {
    throw new Error('Unable to resolve oxlint binary.');
  }
  return path.join(path.dirname(packageJsonPath), binRelativePath);
};

const existingTargets = (cwd: string, targets: readonly string[]) =>
  targets
    .map(target => path.resolve(cwd, target))
    .filter(target => fs.existsSync(target));

const ignoredDirectories = new Set([
  '.modern',
  '.modernjs',
  '.output',
  'dist',
  'node_modules',
]);

const containsLintableSource = (filePath: string): boolean => {
  if (!fs.existsSync(filePath)) {
    return false;
  }

  const stats = fs.statSync(filePath);
  if (stats.isFile()) {
    return (
      /\.(?:js|jsx|ts|tsx)$/u.test(filePath) && !filePath.endsWith('.d.ts')
    );
  }

  if (!stats.isDirectory()) {
    return false;
  }

  for (const entry of fs.readdirSync(filePath, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) {
      continue;
    }
    if (containsLintableSource(path.join(filePath, entry.name))) {
      return true;
    }
  }

  return false;
};

export const runOxlintRules = ({
  cwd,
  targets,
  rules,
}: RunOxlintOptions): number => {
  const resolvedTargets = existingTargets(cwd, targets);
  if (
    resolvedTargets.length === 0 ||
    !resolvedTargets.some(target => containsLintableSource(target))
  ) {
    return 0;
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ultramodern-oxlint-'));
  const configPath = path.join(tempDir, 'oxlint.config.mjs');
  const pluginPath = resolvePluginPath();
  fs.writeFileSync(
    configPath,
    `export default {
  jsPlugins: [${JSON.stringify(pluginPath)}],
  rules: ${JSON.stringify(rules, null, 2)}
};
`,
    'utf-8',
  );

  try {
    const result = spawnSync(
      process.execPath,
      [
        resolveOxlintBin(),
        ...resolvedTargets,
        '--config',
        configPath,
        '--format',
        'unix',
        '--quiet',
      ],
      {
        cwd,
        stdio: 'inherit',
      },
    );
    return result.status ?? 1;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
};
