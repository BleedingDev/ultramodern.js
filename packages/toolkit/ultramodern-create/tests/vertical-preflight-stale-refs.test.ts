import assert from 'node:assert/strict';
import { resolveAddedVerticalComposition } from '../src/ultramodern-workspace/add-vertical/preflight';
import {
  createVerticalDescriptor,
  shellApp,
} from '../src/ultramodern-workspace/descriptors';

test('new vertical repairs only its own stale shell refs and remains composed once', () => {
  const inventory = createVerticalDescriptor('inventory', 4101);
  const catalog = createVerticalDescriptor('catalog', 4102);
  const shell = {
    ...shellApp,
    verticalRefs: [inventory.id, catalog.id, catalog.id],
  };
  const existing = [inventory];
  const composition = resolveAddedVerticalComposition(shell, existing, catalog);

  assert.deepEqual(composition, [inventory, catalog]);
  assert.equal(composition[0], inventory);
  assert.equal(composition[1], catalog);
  assert.deepEqual(shell.verticalRefs, [inventory.id, catalog.id, catalog.id]);
  assert.deepEqual(existing, [inventory]);
  assert.throws(
    () =>
      resolveAddedVerticalComposition(
        {
          ...shell,
          verticalRefs: [...shell.verticalRefs, 'unrelated-missing'],
        },
        existing,
        catalog,
      ),
    /Unknown remote vertical reference unrelated-missing for shell-super-app/,
  );
});
