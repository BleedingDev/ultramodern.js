import assert from 'node:assert/strict';
import { shellApp } from '../src/ultramodern-workspace/descriptors';
import { createModuleFederationRemotesConfig } from '../src/ultramodern-workspace/module-federation';

test('module federation remote refs fail closed when a configured vertical is missing', () => {
  const shellHost = {
    ...shellApp,
    verticalRefs: ['catalog'],
  };

  assert.throws(
    () => createModuleFederationRemotesConfig('tractor-store', shellHost, []),
    /Unknown remote vertical reference catalog for shell-super-app/,
  );
});
