import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import ts from '@typescript/typescript6';
import {
  addUltramodernVertical,
  generateUltramodernWorkspace,
} from '../src/ultramodern-workspace';

function scaffoldSharedContractsWorkspace() {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'um-shared-contracts-'),
  );
  const workspaceDir = path.join(tempRoot, 'shared-contracts-workspace');

  generateUltramodernWorkspace({
    targetDir: workspaceDir,
    packageName: 'shared-contracts-workspace',
    modernVersion: '3.2.1',
    enableTailwind: true,
    packageSource: {
      strategy: 'workspace',
    },
  });
  addUltramodernVertical({
    workspaceRoot: workspaceDir,
    name: 'checkout',
    modernVersion: '3.2.1',
  });
  addUltramodernVertical({
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
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const module = { exports: {} as Record<string, any> };
  const context = vm.createContext({
    CustomEvent,
    Error,
    Event,
    EventTarget,
    exports: module.exports,
    module,
    Number,
    Object,
    console,
  });

  vm.runInContext(outputText, context, {
    filename: 'generated-shared-contracts.cjs',
  });

  return module.exports;
}

test('generated shared contracts expose neutral workspace event helpers', () => {
  const { tempRoot, workspaceDir } = scaffoldSharedContractsWorkspace();

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
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('generated checkout vertical keeps Effect-backed cart state out of shared contracts', () => {
  const { tempRoot, workspaceDir } = scaffoldSharedContractsWorkspace();

  try {
    const readGenerated = (relativePath: string) =>
      fs.readFileSync(path.join(workspaceDir, relativePath), 'utf-8');
    const sharedContracts = readGenerated(
      'packages/shared-contracts/src/index.ts',
    );
    const checkoutSharedApi = readGenerated('verticals/checkout/shared/api.ts');
    const checkoutServer = readGenerated('verticals/checkout/api/index.ts');
    const checkoutClient = readGenerated(
      'verticals/checkout/src/api/checkout-client.ts',
    );
    const exploreSharedApi = readGenerated('verticals/explore/shared/api.ts');
    const shellClients = readGenerated(
      'apps/shell-super-app/src/api/vertical-clients.ts',
    );

    assert.match(sharedContracts, /ultramodern:navigate/);
    assert.match(sharedContracts, /ultramodern:performance-signal/);
    assert.match(sharedContracts, /ultramodern:remote-ready/);
    assert.match(sharedContracts, /ultramodern:route-settled/);
    assert.doesNotMatch(sharedContracts, /Tractor|tractor|checkout:/);
    assert.doesNotMatch(sharedContracts, /explore:selected-shop|mf:navigate/);
    assert.match(checkoutSharedApi, /checkoutCartSchema/);
    assert.match(checkoutSharedApi, /addCartItem/);
    assert.match(checkoutSharedApi, /clearCart/);
    assert.match(checkoutServer, /const checkoutCartLines = new Map/);
    assert.match(
      checkoutServer,
      /Effect\.sync\(\(\) => createCheckoutCartSnapshot\(\)\)/,
    );
    assert.match(checkoutClient, /export const addCheckoutCartItem/);
    assert.match(checkoutClient, /export const clearCheckoutCart/);
    assert.match(shellClients, /addCheckoutCartItem/);
    assert.doesNotMatch(exploreSharedApi, /checkoutCartSchema/);
    assert.doesNotMatch(sharedContracts, /createRuntimeEventBus/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
