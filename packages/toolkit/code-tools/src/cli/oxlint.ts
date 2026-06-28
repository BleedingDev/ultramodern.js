import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

type OxlintRuleConfig =
  | string
  | readonly [
      string,
      {
        readonly [key: string]: unknown;
      },
    ];

type OxlintRules = {
  readonly [ruleName: string]: OxlintRuleConfig;
};

type OxlintRulesOptions = {
  readonly cwd: string;
  readonly targets: readonly string[];
  readonly rules: OxlintRules;
};

type OxlintRulesResult = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
};

const ignoredDirectories = new Set([
  '.modern',
  '.modernjs',
  '.output',
  'dist',
  'node_modules',
]);

const packageNames = new Set([
  '@modern-js/code-tools',
  '@bleedingdev/modern-js-code-tools',
]);

const resolveExistingPath = (
  candidates: readonly string[],
): string | undefined => candidates.find(candidate => fs.existsSync(candidate));

const findPackageRoot = (): string => {
  let directory = path.dirname(fileURLToPath(import.meta.url));

  while (directory !== path.dirname(directory)) {
    const packageJsonPath = path.join(directory, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(
          fs.readFileSync(packageJsonPath, 'utf-8'),
        );
        if (packageNames.has(packageJson.name)) {
          return directory;
        }
      } catch {
        return directory;
      }
    }
    directory = path.dirname(directory);
  }

  throw new Error('Unable to resolve @modern-js/code-tools package root.');
};

const resolvePluginPath = (): string => {
  const root = findPackageRoot();
  const sourcePluginPath = path.join(root, 'src/oxlint-plugin.ts');
  const pluginPath = resolveExistingPath([
    sourcePluginPath,
    path.join(root, 'dist/esm-node/oxlint-plugin.mjs'),
    path.join(root, 'dist/esm-node/oxlint-plugin.js'),
    path.join(root, 'dist/esm/oxlint-plugin.mjs'),
    path.join(root, 'dist/esm/oxlint-plugin.js'),
    path.join(root, 'dist/cjs/oxlint-plugin.js'),
    path.join(root, 'dist/cjs/oxlint-plugin.cjs'),
  ]);

  if (!pluginPath) {
    throw new Error('Unable to resolve @modern-js/code-tools Oxlint plugin.');
  }

  return pluginPath;
};

const resolveOxlintBin = (): string => {
  const packageJsonPath = require.resolve('oxlint/package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
  const binRelativePath =
    typeof packageJson.bin === 'string'
      ? packageJson.bin
      : packageJson.bin?.oxlint;

  if (!binRelativePath) {
    throw new Error('Unable to resolve oxlint binary.');
  }

  return path.join(path.dirname(packageJsonPath), binRelativePath);
};

const existingTargets = (cwd: string, targets: readonly string[]): string[] =>
  targets
    .map(target => path.resolve(cwd, target))
    .filter(target => fs.existsSync(target));

const containsLintableSource = (filePath: string): boolean => {
  if (!fs.existsSync(filePath)) {
    return false;
  }

  const stats = fs.statSync(filePath);
  if (stats.isFile()) {
    return /\.(?:[cm]?[jt]sx?)$/u.test(filePath) && !filePath.endsWith('.d.ts');
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
}: OxlintRulesOptions): OxlintRulesResult => {
  const resolvedTargets = existingTargets(cwd, targets);
  if (
    resolvedTargets.length === 0 ||
    !resolvedTargets.some(target => containsLintableSource(target))
  ) {
    return {
      exitCode: 0,
      stdout: '',
      stderr: '',
    };
  }

  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'modern-code-tools-oxlint-'),
  );
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
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    return {
      exitCode: result.status ?? 1,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
    };
  } finally {
    fs.rmSync(tempDir, {
      recursive: true,
      force: true,
    });
  }
};

export const printOxlintOutput = ({
  stdout,
  stderr,
}: OxlintRulesResult): void => {
  if (stdout) {
    process.stdout.write(stdout);
  }
  if (stderr) {
    process.stderr.write(stderr);
  }
};
