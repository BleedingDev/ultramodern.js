const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  extractImportSpecifiers,
  runBoundaryGuardChecks,
  validateImportGuards,
  validateProfileShape,
  validateRequiredSnippets,
} = require('../validator');

const makeTempDir = () =>
  fs.mkdtempSync(path.join(os.tmpdir(), 'modern-boundary-guards-'));

const removeDir = directory => {
  fs.rmSync(directory, { recursive: true, force: true });
};

test('validateProfileShape accepts valid profile schema', () => {
  const profile = {
    schemaVersion: 1,
    contractPath: 'contract.json',
    moduleManifests: ['manifest.json'],
    importGuards: [
      {
        id: 'guard',
        roots: ['packages/runtime'],
        bannedImportPatterns: ['^@modules/'],
      },
    ],
    requiredSnippets: [
      {
        id: 'snippet',
        path: 'file.ts',
        includes: ['token'],
      },
    ],
  };

  assert.doesNotThrow(() => validateProfileShape(profile));
});

test('validateImportGuards detects banned imports', () => {
  const dir = makeTempDir();
  try {
    const filePath = path.join(dir, 'input.ts');
    fs.writeFileSync(filePath, "import crm from '@modules/crm';\n");

    const report = validateImportGuards({
      importGuards: [
        {
          id: 'no-domain',
          roots: [dir],
          bannedImportPatterns: ['^@modules/(crm|chat)'],
        },
      ],
      rootDir: process.cwd(),
      scanExtensions: ['.ts'],
    });

    assert.equal(report.violations.length, 1);
    assert.equal(report.violations[0].guardId, 'no-domain');
  } finally {
    removeDir(dir);
  }
});

test('extractImportSpecifiers includes export-from statements', () => {
  const content = [
    "import sdk from '@modern-js/runtime';",
    "export * from '@modules/crm';",
    "export { helper } from '@integrations/email';",
    "const dep = require('@modules/chat');",
  ].join('\n');

  const specifiers = extractImportSpecifiers(content);
  assert.deepEqual(specifiers, [
    '@modern-js/runtime',
    '@modules/crm',
    '@integrations/email',
    '@modules/chat',
  ]);
});

test('validateImportGuards detects banned re-export specifiers', () => {
  const dir = makeTempDir();
  try {
    const filePath = path.join(dir, 'barrel.ts');
    fs.writeFileSync(filePath, "export * from '@modules/crm';\n");

    const report = validateImportGuards({
      importGuards: [
        {
          id: 'no-domain-reexport',
          roots: [dir],
          bannedImportPatterns: ['^@modules/(crm|chat)'],
        },
      ],
      rootDir: process.cwd(),
      scanExtensions: ['.ts'],
    });

    assert.equal(report.violations.length, 1);
    assert.equal(report.violations[0].guardId, 'no-domain-reexport');
    assert.equal(report.violations[0].specifier, '@modules/crm');
  } finally {
    removeDir(dir);
  }
});

test('validateRequiredSnippets detects order violations', () => {
  const dir = makeTempDir();
  try {
    const filePath = path.join(dir, 'runtime.ts');
    fs.writeFileSync(filePath, 'register();\nvalidate();\ntrust();\n');

    const report = validateRequiredSnippets({
      requiredSnippets: [
        {
          id: 'ordered-check',
          path: path.relative(process.cwd(), filePath),
          includes: ['register();', 'validate();', 'trust();'],
          orderedIncludes: ['trust();', 'validate();'],
        },
      ],
      rootDir: process.cwd(),
    });

    assert.equal(report.violations.length, 1);
    assert.match(report.violations[0].message, /out of required order/);
  } finally {
    removeDir(dir);
  }
});

test('runBoundaryGuardChecks validates happy path', () => {
  const dir = makeTempDir();
  try {
    const contractPath = path.join(dir, 'contract.json');
    const manifestPath = path.join(dir, 'manifest.json');
    const sourceDir = path.join(dir, 'module');
    const runtimeFile = path.join(dir, 'runtime.ts');
    const policyFile = path.join(dir, 'policy.ts');
    fs.mkdirSync(sourceDir, { recursive: true });

    fs.writeFileSync(
      contractPath,
      JSON.stringify(
        {
          schemaVersion: 1,
          compatibilityLanes: ['effect-first', 'tanstack-first'],
          sharedRequirements: {
            requiredManifestFields: [
              'moduleId',
              'family',
              'version',
              'runtime',
              'sourceDir',
              'lifecycleHooks',
              'policyHooks',
              'observability',
              'compliance',
            ],
            requiredComplianceFlags: [
              'usesSdkContracts',
              'usesPolicyMiddleware',
              'usesObservabilityHooks',
            ],
            requiredObservabilitySignals: ['metrics', 'audit', 'trace'],
          },
          families: {
            crm: {
              requiredLifecycleHooks: [
                'registerRoutes',
                'registerCapabilities',
                'registerMigrations',
              ],
              requiredPolicyHooks: [
                'authorize',
                'enforceTenantScope',
                'validateOperationContext',
              ],
              requiredObservabilityHooks: [
                'emitBusinessMetric',
                'emitAuditEvent',
                'emitTraceContext',
              ],
              forbiddenCodePatterns: ['createRequest\\('],
            },
            'project-management': {
              requiredLifecycleHooks: [
                'registerRoutes',
                'registerCapabilities',
                'registerMigrations',
              ],
              requiredPolicyHooks: [
                'authorize',
                'enforceTenantScope',
                'validateOperationContext',
              ],
              requiredObservabilityHooks: [
                'emitBusinessMetric',
                'emitAuditEvent',
                'emitTraceContext',
              ],
              forbiddenCodePatterns: ['createRequest\\('],
            },
            invoicing: {
              requiredLifecycleHooks: [
                'registerRoutes',
                'registerCapabilities',
                'registerMigrations',
              ],
              requiredPolicyHooks: [
                'authorize',
                'enforceTenantScope',
                'validateOperationContext',
              ],
              requiredObservabilityHooks: [
                'emitBusinessMetric',
                'emitAuditEvent',
                'emitTraceContext',
              ],
              forbiddenCodePatterns: ['createRequest\\('],
            },
            docs: {
              requiredLifecycleHooks: [
                'registerRoutes',
                'registerCapabilities',
                'registerMigrations',
              ],
              requiredPolicyHooks: [
                'authorize',
                'enforceTenantScope',
                'validateOperationContext',
              ],
              requiredObservabilityHooks: [
                'emitBusinessMetric',
                'emitAuditEvent',
                'emitTraceContext',
              ],
              forbiddenCodePatterns: ['createRequest\\('],
            },
            chat: {
              requiredLifecycleHooks: [
                'registerRoutes',
                'registerCapabilities',
                'registerMigrations',
              ],
              requiredPolicyHooks: [
                'authorize',
                'enforceTenantScope',
                'validateOperationContext',
              ],
              requiredObservabilityHooks: [
                'emitBusinessMetric',
                'emitAuditEvent',
                'emitTraceContext',
              ],
              forbiddenCodePatterns: ['createRequest\\('],
            },
            automation: {
              requiredLifecycleHooks: [
                'registerRoutes',
                'registerCapabilities',
                'registerMigrations',
              ],
              requiredPolicyHooks: [
                'authorize',
                'enforceTenantScope',
                'validateOperationContext',
              ],
              requiredObservabilityHooks: [
                'emitBusinessMetric',
                'emitAuditEvent',
                'emitTraceContext',
              ],
              forbiddenCodePatterns: ['createRequest\\('],
            },
          },
        },
        null,
        2,
      ),
    );

    fs.writeFileSync(
      manifestPath,
      JSON.stringify(
        {
          moduleId: 'crm',
          family: 'crm',
          version: '1.0.0',
          runtime: 'effect-first',
          sourceDir: path.relative(dir, sourceDir),
          lifecycleHooks: [
            'registerRoutes',
            'registerCapabilities',
            'registerMigrations',
          ],
          policyHooks: [
            'authorize',
            'enforceTenantScope',
            'validateOperationContext',
          ],
          observability: {
            signals: ['metrics', 'audit', 'trace'],
            hooks: ['emitBusinessMetric', 'emitAuditEvent', 'emitTraceContext'],
          },
          compliance: {
            usesSdkContracts: true,
            usesPolicyMiddleware: true,
            usesObservabilityHooks: true,
          },
        },
        null,
        2,
      ),
    );

    fs.writeFileSync(
      path.join(sourceDir, 'index.ts'),
      'export const crm = "ok";\n',
    );
    fs.writeFileSync(
      runtimeFile,
      'await enforceRemoteTrustPolicy();\nvalidateRuntimeCompatibility();\nGarfishInstance.registerApp(apps);\n',
    );
    fs.writeFileSync(
      policyFile,
      'export const evaluateCrossProjectPolicy = () => "missing_operation_context operation_context_mismatch";\n',
    );

    const profilePath = path.join(dir, 'profile.json');
    fs.writeFileSync(
      profilePath,
      JSON.stringify(
        {
          schemaVersion: 1,
          contractPath: path.relative(dir, contractPath),
          moduleManifests: [path.relative(dir, manifestPath)],
          importGuards: [
            {
              id: 'guard',
              roots: [path.relative(dir, sourceDir)],
              bannedImportPatterns: ['^@modules/'],
            },
          ],
          requiredSnippets: [
            {
              id: 'runtime',
              path: path.relative(dir, runtimeFile),
              includes: [
                'enforceRemoteTrustPolicy',
                'validateRuntimeCompatibility',
                'GarfishInstance.registerApp',
              ],
              orderedIncludes: [
                'enforceRemoteTrustPolicy',
                'validateRuntimeCompatibility',
                'GarfishInstance.registerApp',
              ],
            },
            {
              id: 'policy',
              path: path.relative(dir, policyFile),
              includes: [
                'evaluateCrossProjectPolicy',
                'missing_operation_context',
                'operation_context_mismatch',
              ],
            },
          ],
          scanExtensions: ['.ts'],
        },
        null,
        2,
      ),
    );

    const report = runBoundaryGuardChecks({
      profilePath,
      rootDir: dir,
      allowEmptyManifests: false,
    });

    assert.equal(report.validatedManifests, 1);
    assert.equal(report.requiredSnippetChecks, 2);
  } finally {
    removeDir(dir);
  }
});
