import * as dataPlatform from '@modern-js/bff-effect/data-platform';
import * as effectClient from '@modern-js/bff-effect/effect-client';
import * as effectClientRuntime from '@modern-js/bff-effect/effect-client-runtime';
import * as effectEdgeDispatcher from '@modern-js/bff-effect/effect-edge';

import * as compatibleDataPlatform from '../src/runtime/data-platform';
import * as compatibleEffectEdgeDispatcher from '../src/runtime/effect/edge-dispatcher';
import * as compatibleEffectClient from '../src/runtime/effect-client';
import * as compatibleEffectClientRuntime from '../src/runtime/effect-client/runtime';

describe('pure Effect runtime compatibility paths', () => {
  test('delegate directly to the owning package', () => {
    expect(compatibleDataPlatform.createOperationId).toBe(
      dataPlatform.createOperationId,
    );
    expect(compatibleEffectClient.makeEffectHttpApiClient).toBe(
      effectClient.makeEffectHttpApiClient,
    );
    expect(compatibleEffectClientRuntime.createGeneratedEffectClient).toBe(
      effectClientRuntime.createGeneratedEffectClient,
    );
    expect(compatibleEffectEdgeDispatcher.createEffectBffEdgeDispatcher).toBe(
      effectEdgeDispatcher.createEffectBffEdgeDispatcher,
    );
  });
});
