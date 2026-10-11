import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { createSharedApi } from '../src/ultramodern-workspace/api/shared';

const require = createRequire(import.meta.url);
const {
  microVerticalApiBaselineViolation,
} = require('../../code-tools/dist/cjs/microvertical-api-boundary.cjs');
const owner = path.resolve(__dirname, '../../../server/bff-effect');
const service = {
  id: 'inventory-stock',
  api: { consumedBy: [], prefix: '/warehouse-api', stem: 'warehouse-items' },
};
const source = createSharedApi(service, { scope: 'warehouse' });
const validate = (content: string) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'um-generated-api-owner-'),
  );
  try {
    fs.mkdirSync(path.join(root, 'node_modules/@modern-js'), {
      recursive: true,
    });
    fs.symlinkSync(
      owner,
      path.join(root, 'node_modules/@modern-js/bff-effect'),
      'dir',
    );
    const file = path.join(root, 'api.ts');
    fs.writeFileSync(file, content);
    return microVerticalApiBaselineViolation('warehouse-items', file, {
      baselinePackage: '@modern-js/bff-effect/microvertical-api',
      baselinePackageDirectory: owner,
      apiPrefix: '/warehouse-api',
      basePath: '/warehouse-api/warehouse-items',
      effectClientPackage: '@modern-js/bff-effect/effect-client',
      ownerId: 'inventory-stock',
      readinessPath: '/warehouse-api/warehouse-items/readiness',
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};
test('generated public API uses the installed native owner with unchanged business operation IDs', () => {
  expect(validate(source)).toBeUndefined();
});
test.each([
  [
    'foreign owner',
    '@modern-js/bff-effect/microvertical-api',
    '@foreign/bff-effect/microvertical-api',
  ],
  ['discarded foundation', '.addHttpApi(warehouseItemsFoundationApi)', ''],
  ['wrong metadata', "ownerId: 'inventory-stock'", "ownerId: 'foreign-stock'"],
  [
    'unconstructed operation',
    'readiness: createMicroVerticalOperationContext(',
    'readiness: fake(',
  ],
  ['replaced readiness', '= MicroVerticalReadinessSchema', '= Schema.String'],
])(
  'package checker rejects %s in generated source',
  (_label, before, after) => {
    expect(source).toContain(before);
    expect(validate(source.replace(before, after))).toBeDefined();
  },
);
