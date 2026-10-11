import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import {
  addUltramodernVertical,
  generateUltramodernWorkspace,
} from '../src/ultramodern-workspace';
import { linkBuiltRuntimeExtensions } from './helpers/build-module';
import { runStableTypeScript } from './helpers/stable-typescript';
import { linkInstalledEffectCompiler } from './helpers/workspace-kit';

async function scaffoldSharedContractsWorkspace() {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'um-shared-contracts-'),
  );
  const workspaceDir = path.join(tempRoot, 'shared-contracts-workspace');

  await generateUltramodernWorkspace({
    targetDir: workspaceDir,
    packageName: 'shared-contracts-workspace',
    modernVersion: '3.2.1',
    enableTailwind: true,
    packageSource: {
      strategy: 'workspace',
    },
  });
  linkInstalledEffectCompiler(workspaceDir);
  await addUltramodernVertical({
    workspaceRoot: workspaceDir,
    name: 'checkout',
    modernVersion: '3.2.1',
  });
  await addUltramodernVertical({
    workspaceRoot: workspaceDir,
    name: 'explore',
    modernVersion: '3.2.1',
  });

  return { tempRoot, workspaceDir };
}

function loadGeneratedSharedContracts(workspaceDir: string) {
  const source = fs.readFileSync(
    path.join(workspaceDir, 'packages/shared-contracts/src/index.ts'),
    'utf-8',
  );
  const compilerRoot = path.join(workspaceDir, '.test-compiled-contracts');
  const sourcePath = path.join(compilerRoot, 'generated-shared-contracts.ts');
  const outputDirectory = path.join(compilerRoot, 'dist');
  fs.mkdirSync(compilerRoot, { recursive: true });
  fs.writeFileSync(sourcePath, source);
  fs.writeFileSync(
    path.join(compilerRoot, 'package.json'),
    JSON.stringify({ type: 'commonjs' }),
  );
  linkBuiltRuntimeExtensions(
    path.join(compilerRoot, 'node_modules'),
    'workspace-events',
  );
  const result = runStableTypeScript(
    [
      sourcePath,
      '--ignoreConfig',
      '--module',
      'NodeNext',
      '--moduleResolution',
      'NodeNext',
      '--outDir',
      outputDirectory,
      '--pretty',
      'false',
      '--strict',
      '--target',
      'es2022',
    ],
    compilerRoot,
  );
  assert.equal(result.status, 0, result.output);
  const require = createRequire(sourcePath);
  const contracts = require(
    path.join(outputDirectory, 'generated-shared-contracts.js'),
  ) as Record<string, any>;
  const provider = require('@modern-js/runtime-extensions/workspace-events');
  assert.equal(
    contracts.createUltramodernWorkspaceEvent,
    provider.createUltramodernWorkspaceEvent,
    'generated contracts must expose the actual public event implementation',
  );
  return contracts;
}

test('generated shared contracts expose neutral workspace event helpers', async () => {
  const { tempRoot, workspaceDir } = await scaffoldSharedContractsWorkspace();

  try {
    const contracts = loadGeneratedSharedContracts(workspaceDir);
    const target = new EventTarget();
    const observedPayloads: unknown[] = [];
    const unsubscribe = contracts.onUltramodernNavigate(
      target,
      (payload: unknown, event: CustomEvent) => {
        assert.equal(event.type, 'ultramodern:navigate');
        observedPayloads.push(payload);
      },
    );
    const navigatePayload = {
      to: '/dashboard',
      replace: false,
      state: { from: 'shell' },
    };
    const event = contracts.createUltramodernWorkspaceEvent(
      contracts.ultramodernWorkspaceEventNames.navigate,
      navigatePayload,
    );

    assert.equal(event.type, 'ultramodern:navigate');
    assert.equal(event.bubbles, true);
    assert.equal(event.composed, true);
    assert.deepEqual(event.detail, navigatePayload);
    target.dispatchEvent(event);
    assert.deepEqual(observedPayloads, [navigatePayload]);

    unsubscribe();
    contracts.dispatchUltramodernNavigate(target, {
      to: '/after-unsubscribe',
    });
    assert.deepEqual(observedPayloads, [navigatePayload]);

    let invalidNavigatePayloadError:
      | { readonly message?: string; readonly name?: string }
      | undefined;
    try {
      contracts.createUltramodernWorkspaceEvent('ultramodern:navigate', {
        to: '',
      });
    } catch (error) {
      invalidNavigatePayloadError = error as {
        readonly message?: string;
        readonly name?: string;
      };
    }
    assert.equal(
      invalidNavigatePayloadError?.name,
      'UltramodernWorkspaceEventValidationError',
    );
    assert.equal(
      invalidNavigatePayloadError?.message,
      'Invalid payload for UltraModern workspace event "ultramodern:navigate"',
    );
    assert.equal(
      contracts.isUltramodernWorkspaceEventPayload(
        'ultramodern:performance-signal',
        {
          signalId: 'bfcache',
          status: 'pass',
          durationMs: 12,
          detail: { source: 'diagnostic' },
        },
      ),
      true,
    );
    assert.equal(
      contracts.isUltramodernWorkspaceEventPayload('ultramodern:remote-ready', {
        appId: 42,
      }),
      false,
    );
    assert.equal(
      contracts.isUltramodernWorkspaceEventPayload(
        'ultramodern:route-settled',
        {
          pathname: '/cs',
          locale: 'de',
        },
      ),
      false,
    );
    for (const domainExport of [
      'checkoutCartSchema',
      'addCartItem',
      'clearCart',
      'createRuntimeEventBus',
    ]) {
      assert.equal(Object.hasOwn(contracts, domainExport), false);
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
