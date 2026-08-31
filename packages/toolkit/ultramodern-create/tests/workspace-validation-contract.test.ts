import assert from 'node:assert/strict';
import { createVerticalDescriptor } from '../src/ultramodern-workspace/descriptors';
import { createWorkspaceValidationContract } from '../src/ultramodern-workspace/workspace-validation-contract';

test('workspace validation contract requires semantic evidence and structured architecture descriptors', () => {
  const catalog = createVerticalDescriptor('catalog', 3101);
  const contract = createWorkspaceValidationContract('acme', true, [catalog]);

  assert.equal(contract.schemaVersion, 2);
  assert.deepEqual(contract.validationEvidencePolicy, {
    schemaVersion: 1,
    required: [
      { id: 'typescript-compiler', kind: 'compiler' },
      { id: 'architecture-compiler', kind: 'compiler' },
      { id: 'executable-modern-config', kind: 'runtime' },
      { id: 'executable-runtime-config', kind: 'runtime' },
      { id: 'executable-module-federation-config', kind: 'runtime' },
      { id: 'executable-build-facade', kind: 'runtime' },
      { id: 'structured-package-config', kind: 'structured' },
      { id: 'structured-deploy-config', kind: 'structured' },
      { id: 'public-behavior-gates', kind: 'behavior' },
    ],
  });

  assert.deepEqual(Object.keys(contract.structuralShellPolicy).toSorted(), [
    'forbiddenPathClasses',
    'schemaVersion',
    'shells',
  ]);
  assert.deepEqual(contract.structuralShellPolicy.shells, [
    {
      id: 'shell-super-app',
      packageDir: 'apps/shell-super-app',
      srcDir: 'apps/shell-super-app/src',
    },
  ]);
  assert.deepEqual(
    contract.structuralShellPolicy.forbiddenPathClasses.map(({ id, path }) => ({
      id,
      path,
    })),
    [
      { id: 'shell-api-surface', path: 'api' },
      { id: 'shell-server-surface', path: 'server' },
      {
        id: 'shell-backend-federation',
        path: 'backend-federation.config.ts',
      },
    ],
  );

  assert.deepEqual(
    Object.keys(contract.federatedCompositionPolicy).toSorted(),
    ['hosts', 'schemaVersion'],
  );
  assert.deepEqual(contract.federatedCompositionPolicy.hosts, [
    {
      id: 'shell-super-app',
      srcDir: 'apps/shell-super-app/src',
      remotes: [
        {
          id: 'catalog',
          directory: 'verticals/catalog',
          packageName: '@acme/catalog',
        },
      ],
    },
  ]);

  assert.equal(Object.hasOwn(contract, 'generatedSurfacePolicy'), false);
  assert.equal(
    Object.hasOwn(contract, 'federatedCompositionSourcePolicy'),
    false,
  );
});
