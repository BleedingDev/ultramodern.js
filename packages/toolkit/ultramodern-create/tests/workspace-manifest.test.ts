import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { yaml } from '@modern-js/utils';
import {
  addUltramodernVertical,
  generateUltramodernWorkspace,
} from '../src/ultramodern-workspace';

/**
 * Full relative-path manifest of a default (tailwind-enabled) workspace
 * scaffold. Future refactors of the generator or its template trees must not
 * silently drop or add generated files: update this snapshot intentionally.
 */
const expectedWorkspaceManifest = [
  '.agents/agent-reference-repos.json',
  '.codex/hooks.json',
  '.codex/rstackjs-agent-skills-LICENSE',
  '.codex/skills-lock.json',
  '.codex/skills/rsbuild-best-practices/SKILL.md',
  '.codex/skills/rsdoctor-analysis/SKILL.md',
  '.codex/skills/rsdoctor-analysis/references/command-map.md',
  '.codex/skills/rsdoctor-analysis/references/common-analysis-patterns.md',
  '.codex/skills/rsdoctor-analysis/references/install-rsdoctor-common.md',
  '.codex/skills/rsdoctor-analysis/references/install-rsdoctor-rspack.md',
  '.codex/skills/rsdoctor-analysis/references/install-rsdoctor-webpack.md',
  '.codex/skills/rsdoctor-analysis/references/install-rsdoctor.md',
  '.codex/skills/rsdoctor-analysis/references/rsdoctor-data-types.md',
  '.codex/skills/rslib-best-practices/SKILL.md',
  '.codex/skills/rslib-modern-package/SKILL.md',
  '.codex/skills/rspack-best-practices/SKILL.md',
  '.codex/skills/rspack-tracing/SKILL.md',
  '.codex/skills/rspack-tracing/references/bottlenecks.md',
  '.codex/skills/rspack-tracing/references/tracing-guide.md',
  '.codex/skills/rspack-tracing/scripts/analyze_trace.js',
  '.codex/skills/rstest-best-practices/SKILL.md',
  '.github/renovate.json',
  '.github/workflows/ultramodern-workspace-gates.yml',
  '.gitignore',
  '.mise.toml',
  '.modernjs/ultramodern.json',
  'AGENTS.md',
  'CLAUDE.md',
  'README.md',
  'apps/shell-super-app/locales/cs/shell.json',
  'apps/shell-super-app/locales/cs/translation.json',
  'apps/shell-super-app/locales/en/shell.json',
  'apps/shell-super-app/locales/en/translation.json',
  'apps/shell-super-app/modern.config.ts',
  'apps/shell-super-app/module-federation.config.ts',
  'apps/shell-super-app/package.json',
  'apps/shell-super-app/shared/ultramodern-build.json',
  'apps/shell-super-app/shared/ultramodern-build.ts',
  'apps/shell-super-app/src/api/vertical-clients.ts',
  'apps/shell-super-app/src/modern-app-env.d.ts',
  'apps/shell-super-app/src/modern.runtime.ts',
  'apps/shell-super-app/src/routes/[lang]/page.tsx',
  'apps/shell-super-app/src/routes/[lang]/route.meta.ts',
  'apps/shell-super-app/src/routes/index.css',
  'apps/shell-super-app/src/routes/layout.tsx',
  'apps/shell-super-app/src/routes/shell-frame.tsx',
  'apps/shell-super-app/src/routes/ultramodern-jsonld.ts',
  'apps/shell-super-app/src/routes/ultramodern-route-head.tsx',
  'apps/shell-super-app/src/routes/ultramodern-route-metadata.ts',
  'apps/shell-super-app/src/routes/vertical-components.tsx',
  'apps/shell-super-app/src/routes/vertical-components.worker.tsx',
  'apps/shell-super-app/src/ultramodern-build.ts',
  'apps/shell-super-app/tailwind.config.ts',
  'apps/shell-super-app/tsconfig.json',
  'apps/shell-super-app/tsconfig.mf-types.json',
  'lefthook.yml',
  'oxfmt.config.ts',
  'oxlint.config.ts',
  'package.json',
  'packages/shared-contracts/package.json',
  'packages/shared-contracts/src/index.ts',
  'packages/shared-contracts/tsconfig.json',
  'packages/shared-design-tokens/package.json',
  'packages/shared-design-tokens/src/index.ts',
  'packages/shared-design-tokens/src/tokens.css',
  'packages/shared-design-tokens/tsconfig.json',
  'patches/@module-federation__bridge-react@2.9.0.patch',
  'patches/@module-federation__dts-plugin@2.9.0.patch',
  'patches/@module-federation__modern-js-v3@2.9.0.patch',
  'patches/@module-federation__runtime-core@2.9.0.patch',
  'patches/@tanstack__router-core@1.171.27.patch',
  'patches/drizzle-orm-ts7-strict-declarations.patch',
  'patches/msgpackr@2.0.6.patch',
  'patches/zod@4.4.3.patch',
  'pnpm-workspace.yaml',
  'scripts/assert-mf-types.mts',
  'scripts/bootstrap-agent-skills.mts',
  'scripts/check-ultramodern-api-boundaries.mts',
  'scripts/check-ultramodern-i18n-boundaries.mts',
  'scripts/generate-public-surface-assets.mts',
  'scripts/generate-tanstack-routes.mts',
  'scripts/migrate-strict-effect.mts',
  'scripts/proof-cloudflare-version.mts',
  'scripts/setup-agent-reference-repos.mts',
  'scripts/ultramodern-performance-readiness.config.mjs',
  'scripts/ultramodern-performance-readiness.mts',
  'scripts/ultramodern-typecheck.mts',
  'scripts/validate-ultramodern-workspace.mts',
  'scripts/verify-cloudflare-output.mts',
  'topology/local-overlays/development.json',
  'topology/ownership.json',
  'topology/reference-topology.json',
  'tsconfig.base.json',
  'tsconfig.json',
];

/**
 * Files added under verticals/<name>/ when a full-stack MicroVertical named
 * "catalog" joins the workspace.
 */
const expectedVerticalManifest = [
  'scripts/generate-node-backend-federation.mts',
  'scripts/materialize-zerops-runtime.mjs',
  'scripts/proof-node-backend-federation.mts',
  'scripts/proof-workerd-ssr.mts',
  'verticals/catalog/api/backend-federation.ts',
  'verticals/catalog/api/effect-api.ts',
  'verticals/catalog/api/index.ts',
  'verticals/catalog/backend-federation.config.ts',
  'verticals/catalog/locales/cs/catalog.json',
  'verticals/catalog/locales/cs/translation.json',
  'verticals/catalog/locales/en/catalog.json',
  'verticals/catalog/locales/en/translation.json',
  'verticals/catalog/modern.config.ts',
  'verticals/catalog/module-federation.config.ts',
  'verticals/catalog/package.json',
  'verticals/catalog/shared/api.ts',
  'verticals/catalog/shared/ultramodern-build.json',
  'verticals/catalog/shared/ultramodern-build.ts',
  'verticals/catalog/src/api/catalog-client.ts',
  'verticals/catalog/src/components/catalog-widget.tsx',
  'verticals/catalog/src/federation-entry.tsx',
  'verticals/catalog/src/modern-app-env.d.ts',
  'verticals/catalog/src/modern.runtime.ts',
  'verticals/catalog/src/routes/[lang]/_mf/fragment/widget/page.tsx',
  'verticals/catalog/src/routes/[lang]/page.tsx',
  'verticals/catalog/src/routes/[lang]/route.meta.ts',
  'verticals/catalog/src/routes/index.css',
  'verticals/catalog/src/routes/layout.tsx',
  'verticals/catalog/src/routes/ultramodern-jsonld.ts',
  'verticals/catalog/src/routes/ultramodern-route-head.tsx',
  'verticals/catalog/src/routes/ultramodern-route-metadata.ts',
  'verticals/catalog/src/ultramodern-build.ts',
  'verticals/catalog/tailwind.config.ts',
  'verticals/catalog/tsconfig.json',
  'verticals/catalog/tsconfig.mf-types.json',
  'zerops.yaml',
];

function listFiles(root: string, dir = root): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(root, entryPath));
    } else if (entry.isFile()) {
      files.push(path.relative(root, entryPath).split(path.sep).join('/'));
    }
  }
  // Byte-order sort keeps the snapshot stable across machine locales.
  return files.sort();
}

function readWorkflowSteps(workspaceDir: string) {
  const workflow = yaml.load(
    fs.readFileSync(
      path.join(
        workspaceDir,
        '.github/workflows/ultramodern-workspace-gates.yml',
      ),
      'utf-8',
    ),
  ) as {
    jobs: {
      'workspace-gate': {
        steps: Array<{
          name: string;
          uses?: string;
          with?: Record<string, unknown>;
        }>;
      };
    };
  };
  return new Map(
    workflow.jobs['workspace-gate'].steps.map(step => [step.name, step]),
  );
}

test('generated workflow pins reviewed action commits and mise release', () => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'um-workspace-workflow-'),
  );
  const workspaceDir = path.join(tempRoot, 'workflow-workspace');

  try {
    generateUltramodernWorkspace({
      targetDir: workspaceDir,
      packageName: 'workflow-workspace',
      modernVersion: '3.2.1',
      enableTailwind: true,
      packageSource: { strategy: 'workspace' },
    });
    const workflowSteps = readWorkflowSteps(workspaceDir);
    assert.equal(
      workflowSteps.get('Checkout')?.uses,
      'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
    );
    assert.equal(
      workflowSteps.get('Setup Node.js')?.uses,
      'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020',
    );
    assert.equal(
      workflowSteps.get('Setup mise')?.uses,
      'jdx/mise-action@7e36c90d9ab29c415a2384db3006f3ec8a8cc654',
    );
    assert.equal(workflowSteps.get('Setup mise')?.with?.version, '2026.8.3');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('generated workspace file manifest matches the checked-in snapshot', () => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'um-workspace-manifest-'),
  );
  const workspaceDir = path.join(tempRoot, 'manifest-workspace');

  try {
    const workspaceResult = generateUltramodernWorkspace({
      targetDir: workspaceDir,
      packageName: 'manifest-workspace',
      modernVersion: '3.2.1',
      enableTailwind: true,
      packageSource: { strategy: 'workspace' },
    });
    assert.equal(workspaceResult.operation, 'workspace');
    assert.equal(workspaceResult.workspaceRoot, workspaceDir);
    assert.equal(workspaceResult.packageScope, 'manifest-workspace');
    assert.equal(workspaceResult.packageSource.strategy, 'workspace');
    assert.equal(
      workspaceResult.packageSource.modernPackageVersion,
      'workspace:*',
    );
    assert.deepEqual(workspaceResult.createdPaths, expectedWorkspaceManifest);
    assert.deepEqual(workspaceResult.rewrittenPaths, []);
    assert.deepEqual(workspaceResult.createdApps, [
      {
        id: 'shell-super-app',
        directory: 'apps/shell-super-app',
        packageName: '@manifest-workspace/shell-super-app',
        packageSuffix: 'shell-super-app',
        displayName: 'Shell Super App',
        kind: 'shell',
        portEnv: 'SHELL_SUPER_APP_PORT',
        port: 3020,
        moduleFederationName: 'shellSuperApp',
      },
    ]);
    assert.deepEqual(workspaceResult.assignedPorts, {
      'shell-super-app': 3020,
    });
    assert.deepEqual(workspaceResult.moduleFederationNames, {
      'shell-super-app': 'shellSuperApp',
    });
    assert.deepEqual(workspaceResult.apiPrefixes, {});
    assert.equal(
      workspaceResult.generatedContractPath,
      '.modernjs/ultramodern.json',
    );
    assert.deepEqual(workspaceResult.warnings, []);
    assert.deepEqual(listFiles(workspaceDir), expectedWorkspaceManifest);

    const verticalResult = addUltramodernVertical({
      workspaceRoot: workspaceDir,
      name: 'catalog',
      modernVersion: '3.2.1',
    });
    assert.equal(verticalResult.operation, 'vertical');
    assert.equal(verticalResult.workspaceRoot, workspaceDir);
    assert.equal(verticalResult.packageScope, 'manifest-workspace');
    assert.equal(verticalResult.packageSource.strategy, 'workspace');
    assert.deepEqual(verticalResult.createdPaths, expectedVerticalManifest);
    assert.ok(
      [
        '.modernjs/ultramodern.json',
        'apps/shell-super-app/package.json',
        'apps/shell-super-app/src/api/vertical-clients.ts',
        'apps/shell-super-app/src/routes/vertical-components.tsx',
        'apps/shell-super-app/src/routes/vertical-components.worker.tsx',
        'package.json',
        'topology/local-overlays/development.json',
        'topology/ownership.json',
        'topology/reference-topology.json',
        'tsconfig.json',
      ].every(relativePath =>
        verticalResult.rewrittenPaths.includes(relativePath),
      ),
      'MicroVertical result must report rewritten shell/topology integration surfaces',
    );
    assert.ok(
      !verticalResult.rewrittenPaths.includes(
        'apps/shell-super-app/tsconfig.json',
      ),
      'adding a remote must not couple the shell to remote declaration output',
    );
    assert.deepEqual(verticalResult.createdApps, [
      {
        id: 'catalog',
        directory: 'verticals/catalog',
        packageName: '@manifest-workspace/catalog',
        packageSuffix: 'catalog',
        displayName: 'Catalog Vertical',
        kind: 'vertical',
        portEnv: 'VERTICAL_CATALOG_PORT',
        port: 4101,
        moduleFederationName: 'verticalCatalog',
        exposes: {
          './Route': './src/federation-entry.tsx',
          './Widget': './src/components/catalog-widget.tsx',
        },
        apiPrefix: '/catalog-api',
      },
    ]);
    assert.deepEqual(verticalResult.assignedPorts, { catalog: 4101 });
    assert.deepEqual(verticalResult.moduleFederationNames, {
      catalog: 'verticalCatalog',
    });
    assert.deepEqual(verticalResult.apiPrefixes, {
      catalog: '/catalog-api',
    });
    assert.equal(
      verticalResult.generatedContractPath,
      '.modernjs/ultramodern.json',
    );
    assert.deepEqual(verticalResult.warnings, []);
    const expectedWorkspaceWithCatalog = [
      ...expectedWorkspaceManifest,
      ...expectedVerticalManifest,
    ].sort();
    assert.deepEqual(listFiles(workspaceDir), expectedWorkspaceWithCatalog);

    const filesAfterCatalog = listFiles(workspaceDir);
    assert.throws(
      () =>
        addUltramodernVertical({
          workspaceRoot: workspaceDir,
          name: 'catalog',
          modernVersion: '3.2.1',
        }),
      /Refusing to overwrite existing path: verticals\/catalog/,
    );
    assert.deepEqual(listFiles(workspaceDir), filesAfterCatalog);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('scaffold without tailwind drops only the tailwind config files', () => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'um-workspace-manifest-'),
  );
  const workspaceDir = path.join(tempRoot, 'manifest-workspace');

  try {
    generateUltramodernWorkspace({
      targetDir: workspaceDir,
      packageName: 'manifest-workspace',
      modernVersion: '3.2.1',
      enableTailwind: false,
      packageSource: { strategy: 'workspace' },
    });
    assert.deepEqual(
      listFiles(workspaceDir),
      expectedWorkspaceManifest.filter(
        relativePath =>
          relativePath !== 'apps/shell-super-app/tailwind.config.ts',
      ),
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
