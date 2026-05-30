import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { getLocaleLanguage } from '@modern-js/i18n-utils/language-detector';
import { i18n, localeKeys } from './locale';
import {
  addUltramodernVertical,
  generateUltramodernWorkspace,
  ULTRAMODERN_WORKSPACE_FLAG,
} from './ultramodern-workspace';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const templateDir = path.resolve(__dirname, '..', 'template');
type RouterFramework = 'react-router' | 'tanstack';
type BffRuntime = 'none' | 'hono' | 'effect';
type TemplateSourceType = 'builtin' | 'npm' | 'git' | 'local';
type UltramodernPackageSource = {
  strategy: 'workspace' | 'install';
  modernPackageVersion: string;
  registry?: string;
  aliasScope?: string;
  aliasPackageNamePrefix?: string;
};
type CreatePackageJson = {
  name?: string;
  version?: string;
  ultramodern?: {
    frameworkVersion?: string;
  };
};

type TemplateManifest = {
  schemaVersion: 1;
  template: {
    id: string;
    version: string;
    displayName?: string;
    description?: string;
    compatibilityLane:
      | 'ultramodern-mv'
      | 'ultramodern-shell'
      | 'ultramodern-remote';
    minimumModernVersion?: string;
  };
  source:
    | {
        type: 'builtin';
        name: string;
        repositoryPath?: string;
      }
    | {
        type: 'npm';
        packageName: string;
        version: string;
        registry?: string;
        tarballSha256: string;
      }
    | {
        type: 'git';
        repository: string;
        ref:
          | {
              kind: 'sha';
              sha: string;
            }
          | {
              kind: 'tag';
              tag: string;
              tagSha: string;
            };
        checkoutSha: string;
        subdirectory?: string;
      }
    | {
        type: 'local';
        path: string;
        allowOutsideWorkspace?: boolean;
      };
  integrity: {
    checksums: Array<{
      algorithm: 'sha256';
      value: string;
      scope: 'manifest' | 'source-archive' | 'source-tree' | 'lockfile';
    }>;
    provenance: {
      kind: 'repo-local' | 'npm-provenance' | 'slsa' | 'manual-attestation';
      issuer: string;
      subject: string;
      attestationUrl?: string;
      buildSha?: string;
    };
    lockfile?: {
      path: string;
      sha256: string;
    };
  };
  materialization: {
    targetRoot: 'generated-project-root' | 'workspace-package-root';
    allowedPaths: string[];
    deniedPaths: string[];
    overwritePolicy?: 'deny-existing' | 'allow-generated-only';
  };
  lifecyclePolicy: {
    denyByDefault: true;
    deniedScripts: string[];
    allowedScripts: string[];
    requiresExplicitOptIn?: true;
  };
  validation: {
    schemaValidation: true;
    sourceValidation: string[];
    materializationValidation: string[];
    postMaterializationValidation: string[];
    expectedCommands?: string[];
  };
};

const semverPattern =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const semverTagPattern =
  /^v?(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$/;
const sha1Pattern = /^[0-9a-f]{40}$/;
const sha256Pattern = /^[0-9a-f]{64}$/;
const templateIdPattern = /^[a-z0-9][a-z0-9._-]*$/;
const packageNamePattern = /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/;
const TANSTACK_ROUTER_VERSION = '1.170.8';
const TAILWIND_VERSION = '4.3.0';
const TAILWIND_POSTCSS_VERSION = '4.3.0';
const PNPM_VERSION = '11.5.0';
const requiredDeniedPaths = [
  '.git/**',
  '.npmrc',
  '.yarnrc',
  '.env',
  '.env.*',
  'node_modules/**',
  'dist/**',
];
const requiredLifecycleDeniedScripts = ['preinstall', 'install', 'prepare'];
const requiredLifecycleAllowedScripts = ['postinstall'];

function getOptionValue(args: string[], names: string[]): string | undefined {
  for (const name of names) {
    const prefix = `${name}=`;
    const byEquals = args.find(arg => arg.startsWith(prefix));
    if (byEquals) {
      return byEquals.slice(prefix.length);
    }

    const index = args.findIndex(arg => arg === name);
    if (index !== -1 && args[index + 1] && !args[index + 1].startsWith('-')) {
      return args[index + 1];
    }
  }

  return undefined;
}

const detectLanguage = (): 'zh' | 'en' => {
  const lang = getOptionValue(process.argv.slice(2), ['--lang', '-l']);
  if (lang) {
    return lang === 'zh' ? 'zh' : 'en';
  }

  const detectedLang = getLocaleLanguage();
  if (detectedLang === 'zh') {
    return 'zh';
  }

  return 'en';
};

i18n.changeLanguage({ locale: detectLanguage() });

function detectRouterFramework(): RouterFramework {
  const args = process.argv.slice(2);
  if (args.includes('--tanstack')) {
    return 'tanstack';
  }

  const routerValue = getOptionValue(args, ['--router', '-r']);
  if (!routerValue || routerValue === 'tanstack') {
    return 'tanstack';
  }

  if (routerValue === 'react-router') {
    return 'react-router';
  }

  console.error(
    i18n.t(localeKeys.error.invalidRouter, {
      router: routerValue,
    }),
  );
  process.exit(1);
}

function detectBffRuntime(): BffRuntime {
  const args = process.argv.slice(2);
  const runtimeValue = getOptionValue(args, ['--bff-runtime']);

  if (!runtimeValue) {
    return args.includes('--bff') ? 'effect' : 'none';
  }

  if (runtimeValue === 'hono' || runtimeValue === 'effect') {
    return runtimeValue;
  }

  console.error(
    i18n.t(localeKeys.error.invalidBffRuntime, {
      runtime: runtimeValue,
    }),
  );
  process.exit(1);
}

function renderTemplate(
  template: string,
  data: Record<string, unknown>,
): string {
  type ConditionalKind = 'if' | 'unless';
  const tagRegex = /\{\{(~?)(#if|#unless|\/if|\/unless)(?:\s+(\w+))?(~?)\}\}/g;

  function renderConditionals(
    startIndex: number,
    expectedClose?: ConditionalKind,
  ): {
    rendered: string;
    nextIndex: number;
  } {
    let rendered = '';
    let cursor = startIndex;
    tagRegex.lastIndex = startIndex;

    while (true) {
      const match = tagRegex.exec(template);
      if (!match) {
        return {
          rendered: rendered + template.slice(cursor),
          nextIndex: template.length,
        };
      }

      const [raw, , tag, condition, rightTrim] = match;
      const tagIndex = match.index;
      rendered += template.slice(cursor, tagIndex);
      cursor = tagIndex + raw.length;

      if (tag === '#if' || tag === '#unless') {
        const kind: ConditionalKind = tag === '#if' ? 'if' : 'unless';
        const innerResult = renderConditionals(cursor, kind);
        cursor = innerResult.nextIndex;
        tagRegex.lastIndex = cursor;

        const conditionValue = Boolean(data[condition ?? '']);
        const shouldInclude = kind === 'if' ? conditionValue : !conditionValue;
        if (shouldInclude) {
          rendered += innerResult.rendered;
        }
        continue;
      }

      if (tag === '/if' || tag === '/unless') {
        const kind: ConditionalKind = tag === '/if' ? 'if' : 'unless';
        if (expectedClose === kind) {
          let nextIndex = cursor;
          if (rightTrim === '~') {
            const trailingWhitespace = /^\s*/u.exec(template.slice(nextIndex));
            nextIndex += trailingWhitespace?.[0].length ?? 0;
          }
          return {
            rendered,
            nextIndex,
          };
        }
        rendered += raw;
      }
    }
  }

  let result = renderConditionals(0).rendered;
  const varRegex = /\{\{(\w+)\}\}/g;
  result = result.replace(varRegex, (match, key) => {
    const value = data[key];
    return value !== undefined && value !== null ? String(value) : match;
  });

  return result;
}

function normalizePathForManifest(filePath: string): string {
  return filePath.split(path.sep).join('/');
}

function isUnsafeRelativePath(filePath: string): boolean {
  return (
    filePath.length === 0 ||
    path.isAbsolute(filePath) ||
    filePath.startsWith('/') ||
    /^[A-Za-z]:[\\/]/.test(filePath) ||
    filePath.split(/[\\/]+/).includes('..')
  );
}

function hashFile(filePath: string): string {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(filePath))
    .digest('hex');
}

function getTemplateFiles(dir: string): string[] {
  const files: string[] = [];

  function collect(currentDir: string) {
    const entries = fs
      .readdirSync(currentDir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const entryPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        collect(entryPath);
      } else if (entry.isFile()) {
        files.push(normalizePathForManifest(path.relative(dir, entryPath)));
      }
    }
  }

  collect(dir);
  return files;
}

function hashTemplateTree(dir: string): string {
  const hash = crypto.createHash('sha256');

  for (const relativePath of getTemplateFiles(dir)) {
    const fileHash = hashFile(path.join(dir, relativePath));
    hash.update(relativePath);
    hash.update('\0');
    hash.update(fileHash);
    hash.update('\0');
  }

  return hash.digest('hex');
}

function createBuiltinTemplateManifest(version: string): TemplateManifest {
  return {
    schemaVersion: 1,
    template: {
      id: 'modernjs-ultramodern-app',
      version,
      displayName: 'Modern.js Ultramodern App',
      description:
        'Repository-owned Modern.js application scaffold with UltraModern preset defaults.',
      compatibilityLane: 'ultramodern-mv',
      minimumModernVersion: version,
    },
    source: {
      type: 'builtin',
      name: 'modernjs-ultramodern-app',
      repositoryPath: 'packages/toolkit/create/template',
    },
    integrity: {
      checksums: [
        {
          algorithm: 'sha256',
          value: hashTemplateTree(templateDir),
          scope: 'source-tree',
        },
      ],
      provenance: {
        kind: 'repo-local',
        issuer: '@modern-js/create',
        subject: 'packages/toolkit/create/template',
      },
    },
    materialization: {
      targetRoot: 'generated-project-root',
      allowedPaths: [
        '.agents/**',
        '.browserslistrc',
        '.codex/**',
        '.github/**',
        '.gitignore',
        '.mise.toml',
        '.modernjs/**',
        '.nvmrc',
        'AGENTS.md',
        'README.md',
        'api/**',
        'config/**',
        'lefthook.yml',
        'modern.config.ts',
        'oxfmt.config.ts',
        'oxlint.config.ts',
        'package.json',
        'pnpm-workspace.yaml',
        'postcss.config.mjs',
        'rstest.config.mts',
        'scripts/**',
        'shared/**',
        'src/**',
        'tailwind.config.ts',
        'tests/**',
        'tsconfig.json',
      ],
      deniedPaths: requiredDeniedPaths,
      overwritePolicy: 'deny-existing',
    },
    lifecyclePolicy: {
      denyByDefault: true,
      deniedScripts: requiredLifecycleDeniedScripts,
      allowedScripts: requiredLifecycleAllowedScripts,
      requiresExplicitOptIn: true,
    },
    validation: {
      schemaValidation: true,
      sourceValidation: [
        'source-type-supported',
        'checksum-verified',
        'provenance-present',
      ],
      materializationValidation: [
        'path-boundary-allowlist',
        'path-boundary-denylist',
        'no-path-traversal',
        'no-absolute-paths',
        'overwrite-policy-enforced',
      ],
      postMaterializationValidation: [
        'ultramodern-contract-check',
        'agent-skill-postinstall-allowed',
        'github-workflow-security-enforced',
        'package-source-retained',
        'pnpm-11-policy-enforced',
        'rstest-smoke-tests',
        'template-manifest-retained',
      ],
      expectedCommands: [
        'mise install',
        'pnpm install',
        'pnpm test',
        'pnpm run ultramodern:check',
      ],
    },
  };
}

function assertTemplateManifest(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) {
    throw new Error(`Template manifest validation failed: ${message}`);
  }
}

function assertSafeManifestPath(filePath: string, label: string) {
  assertTemplateManifest(!isUnsafeRelativePath(filePath), `${label} is unsafe`);
}

function validateTemplateSource(source: TemplateManifest['source']) {
  const sourceType = source.type as TemplateSourceType;
  assertTemplateManifest(
    sourceType === 'builtin' ||
      sourceType === 'npm' ||
      sourceType === 'git' ||
      sourceType === 'local',
    `unsupported source type "${source.type}"`,
  );

  if (source.type === 'builtin') {
    assertTemplateManifest(
      templateIdPattern.test(source.name),
      'builtin source name must be a template id',
    );
    if (source.repositoryPath) {
      assertSafeManifestPath(source.repositoryPath, 'builtin repositoryPath');
    }
  }

  if (source.type === 'npm') {
    assertTemplateManifest(
      packageNamePattern.test(source.packageName),
      'npm packageName must be exact package metadata',
    );
    assertTemplateManifest(
      semverPattern.test(source.version),
      'npm source version must be an exact semver',
    );
    assertTemplateManifest(
      sha256Pattern.test(source.tarballSha256),
      'npm source tarballSha256 must be sha256 hex',
    );
  }

  if (source.type === 'git') {
    assertTemplateManifest(
      sha1Pattern.test(source.checkoutSha),
      'git checkoutSha must pin a commit',
    );
    if (source.ref.kind === 'sha') {
      assertTemplateManifest(
        sha1Pattern.test(source.ref.sha),
        'git sha ref must be pinned to a commit',
      );
    } else {
      assertTemplateManifest(
        semverTagPattern.test(source.ref.tag),
        'git tag ref must be a semver tag',
      );
      assertTemplateManifest(
        sha1Pattern.test(source.ref.tagSha),
        'git tag ref must include the resolved tag sha',
      );
    }
    if (source.subdirectory) {
      assertSafeManifestPath(source.subdirectory, 'git subdirectory');
    }
  }

  if (source.type === 'local') {
    assertSafeManifestPath(source.path, 'local source path');
    assertTemplateManifest(
      source.allowOutsideWorkspace !== true,
      'local source cannot allow outside workspace materialization',
    );
  }
}

function validateTemplateManifest(manifest: TemplateManifest) {
  assertTemplateManifest(
    manifest.schemaVersion === 1,
    'schemaVersion must be 1',
  );
  assertTemplateManifest(
    templateIdPattern.test(manifest.template.id),
    'template.id must be a template id',
  );
  assertTemplateManifest(
    semverPattern.test(manifest.template.version),
    'template.version must be exact semver',
  );
  assertTemplateManifest(
    manifest.template.compatibilityLane === 'ultramodern-mv' ||
      manifest.template.compatibilityLane === 'ultramodern-shell' ||
      manifest.template.compatibilityLane === 'ultramodern-remote',
    'template.compatibilityLane is unsupported',
  );
  if (manifest.template.minimumModernVersion) {
    assertTemplateManifest(
      semverPattern.test(manifest.template.minimumModernVersion),
      'template.minimumModernVersion must be exact semver',
    );
  }

  validateTemplateSource(manifest.source);

  assertTemplateManifest(
    manifest.integrity.checksums.length > 0,
    'integrity.checksums must not be empty',
  );
  for (const checksum of manifest.integrity.checksums) {
    assertTemplateManifest(
      checksum.algorithm === 'sha256',
      'checksum algorithm must be sha256',
    );
    assertTemplateManifest(
      sha256Pattern.test(checksum.value),
      'checksum value must be sha256 hex',
    );
    assertTemplateManifest(
      checksum.scope === 'manifest' ||
        checksum.scope === 'source-archive' ||
        checksum.scope === 'source-tree' ||
        checksum.scope === 'lockfile',
      'checksum scope is unsupported',
    );
  }
  assertTemplateManifest(
    manifest.integrity.provenance.kind &&
      manifest.integrity.provenance.issuer &&
      manifest.integrity.provenance.subject,
    'provenance kind, issuer, and subject are required',
  );

  if (manifest.integrity.lockfile) {
    assertSafeManifestPath(manifest.integrity.lockfile.path, 'lockfile path');
    assertTemplateManifest(
      sha256Pattern.test(manifest.integrity.lockfile.sha256),
      'lockfile sha256 must be sha256 hex',
    );
  }

  assertTemplateManifest(
    manifest.materialization.targetRoot === 'generated-project-root' ||
      manifest.materialization.targetRoot === 'workspace-package-root',
    'materialization.targetRoot is unsupported',
  );
  assertTemplateManifest(
    manifest.materialization.allowedPaths.length > 0,
    'materialization.allowedPaths must not be empty',
  );
  for (const allowedPath of manifest.materialization.allowedPaths) {
    assertSafeManifestPath(
      allowedPath.replace(/\/\*\*$/, '/placeholder'),
      'allowed path',
    );
  }
  for (const deniedPath of manifest.materialization.deniedPaths) {
    assertSafeManifestPath(
      deniedPath.replace(/\/\*\*$/, '/placeholder'),
      'denied path',
    );
  }
  for (const deniedPath of requiredDeniedPaths) {
    assertTemplateManifest(
      manifest.materialization.deniedPaths.includes(deniedPath),
      `materialization.deniedPaths must include ${deniedPath}`,
    );
  }
  assertTemplateManifest(
    !manifest.materialization.overwritePolicy ||
      manifest.materialization.overwritePolicy === 'deny-existing' ||
      manifest.materialization.overwritePolicy === 'allow-generated-only',
    'materialization.overwritePolicy is unsupported',
  );

  assertTemplateManifest(
    manifest.lifecyclePolicy.denyByDefault === true,
    'lifecyclePolicy.denyByDefault must be true',
  );
  for (const scriptName of requiredLifecycleDeniedScripts) {
    assertTemplateManifest(
      manifest.lifecyclePolicy.deniedScripts.includes(scriptName),
      `lifecyclePolicy.deniedScripts must include ${scriptName}`,
    );
  }
  assertTemplateManifest(
    JSON.stringify(manifest.lifecyclePolicy.allowedScripts) ===
      JSON.stringify(requiredLifecycleAllowedScripts),
    'lifecyclePolicy.allowedScripts must only allow generated postinstall',
  );

  assertTemplateManifest(
    manifest.validation.schemaValidation === true,
    'validation.schemaValidation must be true',
  );
  for (const token of [
    'source-type-supported',
    'checksum-verified',
    'provenance-present',
  ]) {
    assertTemplateManifest(
      manifest.validation.sourceValidation.includes(token),
      `validation.sourceValidation must include ${token}`,
    );
  }
  for (const token of [
    'path-boundary-allowlist',
    'path-boundary-denylist',
    'no-path-traversal',
    'no-absolute-paths',
    'overwrite-policy-enforced',
  ]) {
    assertTemplateManifest(
      manifest.validation.materializationValidation.includes(token),
      `validation.materializationValidation must include ${token}`,
    );
  }
  assertTemplateManifest(
    manifest.validation.postMaterializationValidation.includes(
      'template-manifest-retained',
    ),
    'validation.postMaterializationValidation must retain manifest evidence',
  );
}

function matchesManifestPattern(
  pattern: string,
  relativePath: string,
): boolean {
  if (pattern.endsWith('/**')) {
    const prefix = pattern.slice(0, -3);
    return relativePath === prefix || relativePath.startsWith(`${prefix}/`);
  }

  if (pattern.endsWith('.*')) {
    const prefix = pattern.slice(0, -1);
    return relativePath.startsWith(prefix);
  }

  return relativePath === pattern;
}

function canMaterializePath(
  manifest: TemplateManifest,
  relativePath: string,
): boolean {
  if (isUnsafeRelativePath(relativePath)) {
    throw new Error(`Unsafe template path rejected: ${relativePath}`);
  }

  if (
    manifest.materialization.deniedPaths.some(pattern =>
      matchesManifestPattern(pattern, relativePath),
    )
  ) {
    return false;
  }

  if (
    !manifest.materialization.allowedPaths.some(pattern =>
      matchesManifestPattern(pattern, relativePath),
    )
  ) {
    throw new Error(
      `Template path is not allowed by manifest: ${relativePath}`,
    );
  }

  return true;
}

function writeTemplateManifestEvidence(
  targetDir: string,
  manifest: TemplateManifest,
) {
  const evidencePath = path.join(
    targetDir,
    '.modernjs',
    'mv-template-manifest.json',
  );
  const evidenceRelativePath = normalizePathForManifest(
    path.relative(targetDir, evidencePath),
  );

  if (!canMaterializePath(manifest, evidenceRelativePath)) {
    throw new Error('Template manifest evidence path is denied by manifest');
  }

  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  fs.writeFileSync(evidencePath, `${JSON.stringify(manifest, null, 2)}\n`);
}

function readCreatePackageJson(): CreatePackageJson {
  const createPackageJson = path.resolve(__dirname, '..', 'package.json');
  return JSON.parse(fs.readFileSync(createPackageJson, 'utf-8'));
}

function isBleedingDevCreatePackage(createPackage: CreatePackageJson): boolean {
  return createPackage.name === '@bleedingdev/modern-js-create';
}

function getBleedingDevFrameworkVersion(
  createPackage: CreatePackageJson,
  fallbackVersion: string,
): string {
  const frameworkVersion = createPackage.ultramodern?.frameworkVersion;
  return typeof frameworkVersion === 'string' && frameworkVersion.length > 0
    ? frameworkVersion
    : fallbackVersion;
}

function showVersion() {
  const createPackage = readCreatePackageJson();
  const version = createPackage.version || 'unknown';
  console.log(i18n.t(localeKeys.version.message, { version }));
  process.exit(0);
}

function showHelp() {
  console.log(i18n.t(localeKeys.help.title));
  console.log(i18n.t(localeKeys.help.description));
  console.log('');
  console.log(i18n.t(localeKeys.help.usage));
  console.log(i18n.t(localeKeys.help.usageExample));
  console.log('');
  console.log(i18n.t(localeKeys.help.options));
  console.log(i18n.t(localeKeys.help.optionHelp));
  console.log(i18n.t(localeKeys.help.optionVersion));
  console.log(i18n.t(localeKeys.help.optionLang));
  console.log(i18n.t(localeKeys.help.optionRouter));
  if (localeKeys.help.optionBff) {
    console.log(i18n.t(localeKeys.help.optionBff));
  }
  if (localeKeys.help.optionBffRuntime) {
    console.log(i18n.t(localeKeys.help.optionBffRuntime));
  }
  if (localeKeys.help.optionTailwind) {
    console.log(i18n.t(localeKeys.help.optionTailwind));
  }
  if (localeKeys.help.optionWorkspace) {
    console.log(i18n.t(localeKeys.help.optionWorkspace));
  }
  if (localeKeys.help.optionUltramodernWorkspace) {
    console.log(i18n.t(localeKeys.help.optionUltramodernWorkspace));
  }
  if (localeKeys.help.optionUltramodernPackageSource) {
    console.log(i18n.t(localeKeys.help.optionUltramodernPackageSource));
  }
  if (localeKeys.help.optionUltramodernPackageScope) {
    console.log(i18n.t(localeKeys.help.optionUltramodernPackageScope));
  }
  if (localeKeys.help.optionUltramodernPackageNamePrefix) {
    console.log(i18n.t(localeKeys.help.optionUltramodernPackageNamePrefix));
  }
  if (localeKeys.help.optionVertical) {
    console.log(i18n.t(localeKeys.help.optionVertical));
  }
  console.log(i18n.t(localeKeys.help.optionSub));
  console.log('');
  console.log(i18n.t(localeKeys.help.examples));
  console.log(i18n.t(localeKeys.help.example1));
  console.log(i18n.t(localeKeys.help.example2));
  console.log(i18n.t(localeKeys.help.example3));
  if (localeKeys.help.example4) {
    console.log(i18n.t(localeKeys.help.example4));
  }
  if (localeKeys.help.example5) {
    console.log(i18n.t(localeKeys.help.example5));
  }
  if (localeKeys.help.example6) {
    console.log(i18n.t(localeKeys.help.example6));
  }
  if (localeKeys.help.example7) {
    console.log(i18n.t(localeKeys.help.example7));
  }
  if (localeKeys.help.example8) {
    console.log(i18n.t(localeKeys.help.example8));
  }
  if (localeKeys.help.example9) {
    console.log(i18n.t(localeKeys.help.example9));
  }
  if (localeKeys.help.example10) {
    console.log(i18n.t(localeKeys.help.example10));
  }
  if (localeKeys.help.example11) {
    console.log(i18n.t(localeKeys.help.example11));
  }
  console.log('');
  console.log(i18n.t(localeKeys.help.moreInfo));
  console.log('');
  process.exit(0);
}

function promptInput(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function detectSubprojectFlag(): boolean | null {
  const args = process.argv.slice(2);
  if (args.includes('--sub') || args.includes('-s')) {
    return true;
  }
  if (args.includes('--no-sub')) {
    return false;
  }
  return null;
}

function detectTailwindFlag(): boolean {
  const args = process.argv.slice(2);
  return !args.includes('--no-tailwind');
}

function detectExplicitTailwindFlag(): boolean | undefined {
  const args = process.argv.slice(2);
  if (args.includes('--no-tailwind')) {
    return false;
  }
  if (args.includes('--tailwind')) {
    return true;
  }
  return undefined;
}

function detectWorkspaceProtocolFlag(): boolean {
  const args = process.argv.slice(2);
  return args.includes('--workspace');
}

function detectVerticalFlag(): boolean {
  const args = process.argv.slice(2);
  if (args.some(arg => arg.startsWith('--vertical='))) {
    console.error(
      '--vertical does not accept a value. Use: create <name> --vertical',
    );
    process.exit(1);
  }
  return args.includes('--vertical');
}

function detectUltramodernWorkspaceFlag(
  createPackage: CreatePackageJson,
): boolean {
  const args = process.argv.slice(2);
  return (
    args.includes(ULTRAMODERN_WORKSPACE_FLAG) ||
    isBleedingDevCreatePackage(createPackage)
  );
}

function detectUltramodernPackageSource(
  args: string[],
  defaultPackageVersion: string,
  createPackage: CreatePackageJson,
): UltramodernPackageSource {
  const bleedingDevDefaults = isBleedingDevCreatePackage(createPackage);
  const strategy =
    getOptionValue(args, ['--ultramodern-package-source']) ??
    (bleedingDevDefaults ? 'install' : 'workspace');
  if (strategy !== 'workspace' && strategy !== 'install') {
    console.error(
      '--ultramodern-package-source must be "workspace" or "install"',
    );
    process.exit(1);
  }
  return {
    strategy,
    modernPackageVersion:
      getOptionValue(args, ['--ultramodern-package-version']) ??
      defaultPackageVersion,
    registry: getOptionValue(args, ['--ultramodern-package-registry']),
    aliasScope:
      getOptionValue(args, ['--ultramodern-package-scope']) ??
      (bleedingDevDefaults && strategy === 'install'
        ? 'bleedingdev'
        : undefined),
    aliasPackageNamePrefix:
      getOptionValue(args, ['--ultramodern-package-name-prefix']) ??
      'modern-js-',
  };
}

function modernAliasPackageName(
  packageName: string,
  packageSource: UltramodernPackageSource,
): string {
  if (!packageSource.aliasScope) {
    return packageName;
  }

  const scope = packageSource.aliasScope.replace(/^@/, '');
  const unscopedName = packageName.split('/').at(-1);
  return `@${scope}/${packageSource.aliasPackageNamePrefix ?? ''}${unscopedName}`;
}

function singleAppModernPackageSpecifier(
  packageName: string,
  packageSource: UltramodernPackageSource,
  useWorkspaceProtocol: boolean,
): string {
  if (useWorkspaceProtocol) {
    return 'workspace:*';
  }

  if (packageSource.strategy !== 'install' || !packageSource.aliasScope) {
    return packageSource.modernPackageVersion;
  }

  return `npm:${modernAliasPackageName(packageName, packageSource)}@${
    packageSource.modernPackageVersion
  }`;
}

const singleAppModernPackages = [
  '@modern-js/runtime',
  '@modern-js/app-tools',
  '@modern-js/tsconfig',
  '@modern-js/plugin-i18n',
  '@modern-js/plugin-tanstack',
  '@modern-js/plugin-bff',
  '@modern-js/adapter-rstest',
];

function createSingleAppPackageSourceEvidence(
  packageSource: UltramodernPackageSource,
  useWorkspaceProtocol: boolean,
) {
  const strategy = useWorkspaceProtocol ? 'workspace' : 'install';
  const specifier = useWorkspaceProtocol
    ? 'workspace:*'
    : packageSource.modernPackageVersion;
  const aliases =
    strategy === 'install' && packageSource.aliasScope
      ? Object.fromEntries(
          singleAppModernPackages.map(packageName => [
            packageName,
            modernAliasPackageName(packageName, packageSource),
          ]),
        )
      : undefined;

  return {
    schemaVersion: 1,
    preset: 'presetUltramodern',
    strategy,
    modernPackages: {
      specifier,
      packages: singleAppModernPackages,
      ...(packageSource.registry ? { registry: packageSource.registry } : {}),
      ...(aliases ? { aliases } : {}),
    },
  };
}

function writeSingleAppPackageSourceEvidence(
  targetDir: string,
  packageSource: UltramodernPackageSource,
  useWorkspaceProtocol: boolean,
) {
  const evidencePath = path.join(
    targetDir,
    '.modernjs',
    'ultramodern-package-source.json',
  );
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  fs.writeFileSync(
    evidencePath,
    `${JSON.stringify(
      createSingleAppPackageSourceEvidence(packageSource, useWorkspaceProtocol),
      null,
      2,
    )}\n`,
  );
}

function isDirectoryEmpty(dirPath: string): boolean {
  if (!fs.existsSync(dirPath)) {
    return false;
  }
  try {
    const files = fs.readdirSync(dirPath);
    return files.length === 0;
  } catch {
    return false;
  }
}

async function getProjectName(): Promise<{
  name: string;
  useCurrentDir: boolean;
}> {
  const args = process.argv.slice(2);
  const optionWithValue = new Set([
    '--lang',
    '-l',
    '--router',
    '-r',
    '--bff-runtime',
    '--ultramodern-package-source',
    '--ultramodern-package-version',
    '--ultramodern-package-registry',
    '--ultramodern-package-scope',
    '--ultramodern-package-name-prefix',
  ]);
  const optionWithoutValue = new Set([
    '--help',
    '-h',
    '--version',
    '-v',
    '--sub',
    '-s',
    '--no-sub',
    '--tanstack',
    '--bff',
    '--tailwind',
    '--no-tailwind',
    '--workspace',
    '--vertical',
    ULTRAMODERN_WORKSPACE_FLAG,
  ]);
  const positionalArgs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (optionWithoutValue.has(arg)) {
      continue;
    }

    if (optionWithValue.has(arg)) {
      i += 1;
      continue;
    }

    if (
      arg.startsWith('--lang=') ||
      arg.startsWith('--router=') ||
      arg.startsWith('--bff-runtime=') ||
      arg.startsWith('--ultramodern-package-source=') ||
      arg.startsWith('--ultramodern-package-version=') ||
      arg.startsWith('--ultramodern-package-registry=') ||
      arg.startsWith('--ultramodern-package-scope=') ||
      arg.startsWith('--ultramodern-package-name-prefix=')
    ) {
      continue;
    }

    positionalArgs.push(arg);
  }

  if (positionalArgs.length > 1) {
    console.error(`Unexpected positional argument: ${positionalArgs[1]}`);
    process.exit(1);
  }

  const projectNameArg = positionalArgs[0];

  if (projectNameArg) {
    return { name: projectNameArg, useCurrentDir: false };
  }

  // 如果当前目录为空，直接使用当前目录名作为项目名
  const currentDir = process.cwd();
  if (isDirectoryEmpty(currentDir)) {
    return { name: path.basename(currentDir), useCurrentDir: true };
  }

  const projectName = await promptInput(i18n.t(localeKeys.prompt.projectName));

  if (!projectName) {
    console.error(i18n.t(localeKeys.error.projectNameEmpty));
    process.exit(1);
  }

  return { name: projectName, useCurrentDir: false };
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    showHelp();
    return;
  }

  if (args.includes('--version') || args.includes('-v')) {
    showVersion();
    return;
  }

  console.log(`\n${i18n.t(localeKeys.message.welcome)}\n`);
  const { name: projectName, useCurrentDir } = await getProjectName();
  const targetDir = useCurrentDir
    ? process.cwd()
    : path.isAbsolute(projectName)
      ? projectName
      : path.resolve(process.cwd(), projectName);
  const generatedPackageName =
    useCurrentDir || path.isAbsolute(projectName)
      ? path.basename(targetDir)
      : projectName;
  const createPackage = readCreatePackageJson();
  const version = createPackage.version || 'latest';
  const ultramodernPackageVersion = isBleedingDevCreatePackage(createPackage)
    ? getBleedingDevFrameworkVersion(createPackage, version)
    : version;
  const addVertical = detectVerticalFlag();

  if (addVertical) {
    const overridePackageSource = args.some(arg =>
      arg.startsWith('--ultramodern-package-'),
    )
      ? detectUltramodernPackageSource(
          args,
          ultramodernPackageVersion,
          createPackage,
        )
      : undefined;
    addUltramodernVertical({
      workspaceRoot: process.cwd(),
      name: generatedPackageName,
      modernVersion: version,
      enableTailwind: detectExplicitTailwindFlag(),
      packageSource: overridePackageSource,
    });

    const dim = '\x1b[2m\x1b[3m';
    const reset = '\x1b[0m';

    console.log(`${i18n.t(localeKeys.message.success)}\n`);
    console.log(`${dim}   pnpm ultramodern:check${reset}\n`);
    return;
  }

  if (fs.existsSync(targetDir)) {
    const files = fs.readdirSync(targetDir);
    if (files.length > 0) {
      console.error(i18n.t(localeKeys.error.directoryExists, { projectName }));
      process.exit(1);
    }
  }

  const generateWorkspace = detectUltramodernWorkspaceFlag(createPackage);

  if (generateWorkspace) {
    generateUltramodernWorkspace({
      targetDir,
      packageName: generatedPackageName,
      modernVersion: version,
      enableTailwind: detectTailwindFlag(),
      packageSource: detectUltramodernPackageSource(
        args,
        ultramodernPackageVersion,
        createPackage,
      ),
    });

    const dim = '\x1b[2m\x1b[3m';
    const reset = '\x1b[0m';

    console.log(`${i18n.t(localeKeys.message.success)}\n`);
    console.log(i18n.t(localeKeys.message.nextSteps));
    if (!useCurrentDir) {
      console.log(
        `${dim}   ${i18n.t(localeKeys.message.step1, { projectName })}${reset}`,
      );
    }
    console.log(`${dim}   ${i18n.t(localeKeys.message.step2)}${reset}`);
    console.log(`${dim}   pnpm ultramodern:check${reset}`);
    console.log(`${dim}   ${i18n.t(localeKeys.message.step3)}${reset}\n`);
    return;
  }

  const subprojectFlag = detectSubprojectFlag();
  const isSubproject = subprojectFlag === true;
  const routerFramework = detectRouterFramework();
  const bffRuntime = detectBffRuntime();
  const enableTailwind = detectTailwindFlag();
  const useWorkspaceProtocol = detectWorkspaceProtocolFlag();
  const packageSource = detectUltramodernPackageSource(
    args,
    ultramodernPackageVersion,
    createPackage,
  );
  const templateManifest = createBuiltinTemplateManifest(version);
  validateTemplateManifest(templateManifest);

  copyTemplate(templateDir, targetDir, {
    packageName: generatedPackageName,
    version: useWorkspaceProtocol
      ? 'workspace:*'
      : packageSource.modernPackageVersion,
    runtimeVersion: singleAppModernPackageSpecifier(
      '@modern-js/runtime',
      packageSource,
      useWorkspaceProtocol,
    ),
    appToolsVersion: singleAppModernPackageSpecifier(
      '@modern-js/app-tools',
      packageSource,
      useWorkspaceProtocol,
    ),
    adapterRstestVersion: singleAppModernPackageSpecifier(
      '@modern-js/adapter-rstest',
      packageSource,
      useWorkspaceProtocol,
    ),
    tsconfigVersion: singleAppModernPackageSpecifier(
      '@modern-js/tsconfig',
      packageSource,
      useWorkspaceProtocol,
    ),
    pluginTanstackVersion: singleAppModernPackageSpecifier(
      '@modern-js/plugin-tanstack',
      packageSource,
      useWorkspaceProtocol,
    ),
    pluginBffVersion: singleAppModernPackageSpecifier(
      '@modern-js/plugin-bff',
      packageSource,
      useWorkspaceProtocol,
    ),
    pluginI18nVersion: singleAppModernPackageSpecifier(
      '@modern-js/plugin-i18n',
      packageSource,
      useWorkspaceProtocol,
    ),
    tanstackRouterVersion: TANSTACK_ROUTER_VERSION,
    tailwindVersion: TAILWIND_VERSION,
    tailwindPostcssVersion: TAILWIND_POSTCSS_VERSION,
    pnpmVersion: PNPM_VERSION,
    isSubproject,
    routerFramework,
    bffRuntime,
    enableTailwind,
    templateManifest,
  });

  const targetPackageJson = path.join(targetDir, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(targetPackageJson, 'utf-8'));
  packageJson.name = generatedPackageName;
  packageJson.modernjs = {
    ...(packageJson.modernjs ?? {}),
    preset: 'presetUltramodern',
    packageSource: {
      strategy: useWorkspaceProtocol ? 'workspace' : 'install',
      config: './.modernjs/ultramodern-package-source.json',
    },
  };

  if (isSubproject) {
    delete packageJson['lint-staged'];
    delete packageJson['simple-git-hooks'];
    if (packageJson.scripts) {
      delete packageJson.scripts.prepare;
      delete packageJson.scripts.format;
      delete packageJson.scripts['format:check'];
      delete packageJson.scripts.lint;
      delete packageJson.scripts['lint:fix'];
      delete packageJson.scripts['skills:install'];
      delete packageJson.scripts['skills:check'];
      delete packageJson.scripts.postinstall;
    }
    if (packageJson.devDependencies) {
      delete packageJson.devDependencies['lint-staged'];
      delete packageJson.devDependencies.lefthook;
      delete packageJson.devDependencies['simple-git-hooks'];
      delete packageJson.devDependencies.oxlint;
      delete packageJson.devDependencies.oxfmt;
      delete packageJson.devDependencies.ultracite;
    }
    fs.rmSync(path.join(targetDir, '.codex'), { recursive: true, force: true });
    fs.rmSync(path.join(targetDir, 'lefthook.yml'), { force: true });
  }

  fs.writeFileSync(
    targetPackageJson,
    `${JSON.stringify(packageJson, null, 2)}\n`,
  );
  writeTemplateManifestEvidence(targetDir, templateManifest);
  writeSingleAppPackageSourceEvidence(
    targetDir,
    packageSource,
    useWorkspaceProtocol,
  );

  // ANSI escape codes: \x1b[2m = dim, \x1b[3m = italic, \x1b[0m = reset
  const dim = '\x1b[2m\x1b[3m';
  const reset = '\x1b[0m';

  console.log(`${i18n.t(localeKeys.message.success)}\n`);
  console.log(i18n.t(localeKeys.message.nextSteps));
  if (!useCurrentDir) {
    console.log(
      `${dim}   ${i18n.t(localeKeys.message.step1, { projectName })}${reset}`,
    );
  }
  console.log(`${dim}   ${i18n.t(localeKeys.message.step2)}${reset}`);
  console.log(`${dim}   ${i18n.t(localeKeys.message.step3)}${reset}\n`);
}

function copyTemplate(
  src: string,
  dest: string,
  options: {
    packageName: string;
    version: string;
    runtimeVersion: string;
    appToolsVersion: string;
    adapterRstestVersion: string;
    tsconfigVersion: string;
    pluginTanstackVersion: string;
    pluginBffVersion: string;
    pluginI18nVersion: string;
    tanstackRouterVersion: string;
    tailwindVersion: string;
    tailwindPostcssVersion: string;
    pnpmVersion: string;
    isSubproject: boolean;
    routerFramework: RouterFramework;
    bffRuntime: BffRuntime;
    enableTailwind: boolean;
    templateManifest: TemplateManifest;
  },
) {
  fs.mkdirSync(dest, { recursive: true });

  const excludeInSubproject = [
    '.agents',
    '.github',
    '.gitignore.handlebars',
    'AGENTS.md',
    '.npmrc',
    '.nvmrc',
    'oxfmt.config.ts',
    'oxlint.config.ts',
  ];

  function copyRecursive(srcDir: string, destDir: string) {
    const entries = fs.readdirSync(srcDir, { withFileTypes: true });

    for (const entry of entries) {
      if (options.isSubproject && excludeInSubproject.includes(entry.name)) {
        continue;
      }

      const srcPath = path.join(srcDir, entry.name);
      let destPath = path.join(destDir, entry.name);
      const sourceRelativePath = normalizePathForManifest(
        path.relative(src, srcPath),
      );
      const finalRelativePath = normalizePathForManifest(
        sourceRelativePath.replace(/\.handlebars$/, ''),
      );

      if (
        !canMaterializePath(options.templateManifest, finalRelativePath) ||
        (entry.isDirectory() &&
          options.templateManifest.materialization.deniedPaths.some(pattern =>
            matchesManifestPattern(pattern, finalRelativePath),
          ))
      ) {
        continue;
      }

      if (entry.isDirectory()) {
        fs.mkdirSync(destPath, { recursive: true });
        copyRecursive(srcPath, destPath);
      } else {
        if (entry.name.endsWith('.handlebars')) {
          const templateContent = fs.readFileSync(srcPath, 'utf-8');
          const rendered = renderTemplate(templateContent, {
            packageName: options.packageName,
            version: options.version,
            runtimeVersion: options.runtimeVersion,
            appToolsVersion: options.appToolsVersion,
            adapterRstestVersion: options.adapterRstestVersion,
            tsconfigVersion: options.tsconfigVersion,
            pluginTanstackVersion: options.pluginTanstackVersion,
            pluginBffVersion: options.pluginBffVersion,
            pluginI18nVersion: options.pluginI18nVersion,
            tanstackRouterVersion: options.tanstackRouterVersion,
            tailwindVersion: options.tailwindVersion,
            tailwindPostcssVersion: options.tailwindPostcssVersion,
            pnpmVersion: options.pnpmVersion,
            isSubproject: options.isSubproject,
            isTanstackRouter: options.routerFramework === 'tanstack',
            enableBff: options.bffRuntime !== 'none',
            useEffectBff: options.bffRuntime === 'effect',
            useHonoBff: options.bffRuntime === 'hono',
            bffRuntime: options.bffRuntime,
            enableTailwind: options.enableTailwind,
            routerRuntimeImport:
              options.routerFramework === 'tanstack'
                ? '@modern-js/plugin-tanstack/runtime'
                : '@modern-js/runtime/router',
          });
          if (rendered.trim().length === 0) {
            continue;
          }
          destPath = destPath.replace(/\.handlebars$/, '');
          if (
            options.templateManifest.materialization.overwritePolicy ===
              'deny-existing' &&
            fs.existsSync(destPath)
          ) {
            throw new Error(
              `Template refused to overwrite existing file: ${finalRelativePath}`,
            );
          }
          fs.writeFileSync(destPath, rendered, 'utf-8');
        } else {
          if (
            options.templateManifest.materialization.overwritePolicy ===
              'deny-existing' &&
            fs.existsSync(destPath)
          ) {
            throw new Error(
              `Template refused to overwrite existing file: ${finalRelativePath}`,
            );
          }
          fs.copyFileSync(srcPath, destPath);
        }
      }
    }
  }

  copyRecursive(src, dest);
}

main().catch(error => {
  console.error(i18n.t(localeKeys.error.createFailed), error);
  process.exit(1);
});
