import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import {
  addUltramodernVertical,
  generateUltramodernWorkspace,
} from '../src/ultramodern-workspace';

function scaffoldTractorWorkspace() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-tractor-events-'));
  const workspaceDir = path.join(tempRoot, 'tractor-workspace');

  generateUltramodernWorkspace({
    targetDir: workspaceDir,
    packageName: 'tractor-workspace',
    modernVersion: '3.2.1',
    enableTailwind: true,
    packageSource: {
      strategy: 'install',
      modernPackageVersion: '3.2.0-ultramodern.108',
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

const toPlainJson = (value: unknown) => JSON.parse(JSON.stringify(value));

test('generated Tractor event helpers validate payloads and dispatch browser CustomEvents', () => {
  const { tempRoot, workspaceDir } = scaffoldTractorWorkspace();

  try {
    const contracts = loadGeneratedSharedContracts(workspaceDir);
    const target = new EventTarget();
    const observedPayloads: unknown[] = [];
    const unsubscribe = contracts.onCheckoutAddToCart(
      target,
      (payload: unknown, event: CustomEvent) => {
        assert.equal(event.type, 'checkout:add-to-cart');
        observedPayloads.push(payload);
      },
    );
    const addPayload = {
      sku: 'sku-1',
      quantity: 2,
      name: 'Demo Shoe',
      unitPriceCents: 1299,
    };
    const event = contracts.createTractorEvent(
      contracts.tractorEventNames.checkoutAddToCart,
      addPayload,
    );

    assert.equal(event.type, 'checkout:add-to-cart');
    assert.equal(event.bubbles, true);
    assert.equal(event.composed, true);
    assert.deepEqual(event.detail, addPayload);
    target.dispatchEvent(event);
    assert.deepEqual(observedPayloads, [addPayload]);

    unsubscribe();
    contracts.dispatchCheckoutAddToCart(target, {
      sku: 'sku-2',
      quantity: 1,
    });
    assert.deepEqual(observedPayloads, [addPayload]);

    assert.throws(
      () =>
        contracts.createTractorEvent('checkout:add-to-cart', {
          sku: '',
          quantity: 1,
        }),
      /Invalid payload for Tractor event "checkout:add-to-cart"/,
    );
    assert.equal(
      contracts.isTractorEventPayload('mf:navigate', {
        to: '/cart',
        replace: false,
        state: { from: 'explore' },
      }),
      true,
    );
    assert.equal(
      contracts.isTractorEventPayload('explore:selected-shop', {
        shopId: 42,
      }),
      false,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('generated Tractor cart helpers mirror checkout-owned cart update patterns', () => {
  const { tempRoot, workspaceDir } = scaffoldTractorWorkspace();

  try {
    const contracts = loadGeneratedSharedContracts(workspaceDir);
    const emptyCart = contracts.createCheckoutCartSnapshot([]);
    const withItem = contracts.applyCheckoutCartEvent(
      emptyCart,
      'checkout:add-to-cart',
      {
        sku: 'sku-1',
        quantity: 2,
        name: 'Demo Shoe',
        unitPriceCents: 1299,
      },
    );
    const incremented = contracts.applyCheckoutCartEvent(
      withItem,
      'checkout:add-to-cart',
      {
        sku: 'sku-1',
        quantity: 1,
      },
    );
    const removed = contracts.applyCheckoutCartEvent(
      incremented,
      'checkout:remove-from-cart',
      { sku: 'sku-1' },
    );

    assert.deepEqual(toPlainJson(withItem), {
      lines: [
        {
          sku: 'sku-1',
          quantity: 2,
          name: 'Demo Shoe',
          unitPriceCents: 1299,
        },
      ],
      subtotalCents: 2598,
      totalQuantity: 2,
    });
    assert.equal(incremented.totalQuantity, 3);
    assert.equal(incremented.subtotalCents, 3897);
    assert.deepEqual(toPlainJson(removed), {
      lines: [],
      totalQuantity: 0,
    });
    assert.deepEqual(
      toPlainJson(
        contracts.applyCheckoutCartEvent(
          incremented,
          'checkout:clear-cart',
          {},
        ),
      ),
      {
        lines: [],
        totalQuantity: 0,
      },
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('generated checkout vertical gets Effect-backed cart state without broad event bus changes', () => {
  const { tempRoot, workspaceDir } = scaffoldTractorWorkspace();

  try {
    const readGenerated = (relativePath: string) =>
      fs.readFileSync(path.join(workspaceDir, relativePath), 'utf-8');
    const sharedContracts = readGenerated(
      'packages/shared-contracts/src/index.ts',
    );
    const checkoutSharedApi = readGenerated(
      'verticals/checkout/shared/effect/api.ts',
    );
    const checkoutServer = readGenerated(
      'verticals/checkout/api/effect/index.ts',
    );
    const checkoutClient = readGenerated(
      'verticals/checkout/src/effect/checkout-client.ts',
    );
    const exploreSharedApi = readGenerated(
      'verticals/explore/shared/effect/api.ts',
    );
    const shellClients = readGenerated(
      'apps/shell-super-app/src/effect/vertical-clients.ts',
    );

    for (const eventName of [
      'checkout:add-to-cart',
      'checkout:cart-updated',
      'checkout:remove-from-cart',
      'checkout:clear-cart',
      'explore:selected-shop',
      'mf:navigate',
    ]) {
      assert.match(sharedContracts, new RegExp(eventName));
    }
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
