import assert from 'node:assert/strict';
import type { DeliveryUnitOwner } from '../src/ultramodern-workspace/delivery-unit-schema/types';
import { createNeutralOwnership } from '../src/ultramodern-workspace/descriptors';
import type { OwnerAttribution } from '../src/ultramodern-workspace/types';
import { resolveOwnerAttribution } from '../src/ultramodern-workspace/types';

test('owner attribution defaults to the neutral team owner (G3)', () => {
  const ownership = createNeutralOwnership('checkout');
  assert.equal(ownership.owner, undefined);
  assert.deepEqual(resolveOwnerAttribution(ownership), {
    kind: 'team',
    id: 'super-app-platform',
  });
});

test('neutral ownership stays byte-identical: no owner key is emitted (G3)', () => {
  const ownership = createNeutralOwnership('checkout');
  // Legacy output must be unchanged unless a caller opts in.
  assert.equal(Object.hasOwn(ownership, 'owner'), false);
  assert.equal(JSON.stringify(ownership).includes('"owner"'), false);
});

test('explicit owner attribution is passed through when a caller opts in (G3)', () => {
  const attribution: OwnerAttribution = {
    kind: 'agent-team',
    id: 'checkout-agents',
    contact: '#checkout-agents',
  };
  const ownership = {
    ...createNeutralOwnership('checkout'),
    owner: attribution,
  };
  assert.deepEqual(resolveOwnerAttribution(ownership), attribution);
});

test('an owner attribution is structurally a canonical DeliveryUnitOwner (G3)', () => {
  // One owner, many verticals: the attribution is the same shape the canonical
  // DeliveryUnitDescriptor.owner requires (keyed to the delivery unit).
  const owner: DeliveryUnitOwner = resolveOwnerAttribution(
    createNeutralOwnership('catalog'),
  );
  assert.equal(owner.kind, 'team');
  assert.equal(owner.id, 'super-app-platform');
});
