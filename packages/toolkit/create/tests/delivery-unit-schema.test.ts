import assert from 'node:assert/strict';
import type {
  BaselineCohort,
  DeliveryUnitDescriptor,
  ParsedSurfaceRef,
  SurfaceDescriptor,
  SurfaceRefParseError,
  V1ProjectionContext,
} from '../src/ultramodern-workspace/delivery-unit-schema/types';
import {
  assertNever,
  formatSurfaceRef,
  parseDeliveryUnitDescriptor,
  parseSurfaceRef,
  projectDeliveryUnitToV1,
  resolvePublicationZone,
  serializeDeliveryUnitDescriptor,
} from '../src/ultramodern-workspace/delivery-unit-schema/types';
import type { Ownership } from '../src/ultramodern-workspace/types';

const baselineCohort: BaselineCohort = {
  cohortId: 'baseline-2026-07',
  resolved: {
    react: '^19.2.7',
    tanstackRouter: '1.170.17',
    effect: '4.0.0-beta.102',
    tailwind: '4.3.2',
  },
};

const ownership: Ownership = {
  team: 'checkout',
  slack: '#checkout',
  pagerDuty: 'checkout-oncall',
  runbookRef: 'runbooks/checkout.md',
  adrRef: 'ADR-0019',
  blastRadius: { tier: 'tier-1', references: ['payments'] },
};

function context(
  overrides: Partial<V1ProjectionContext> = {},
): V1ProjectionContext {
  return {
    directory: 'apps/checkout',
    packageSuffix: 'checkout',
    displayName: 'Checkout',
    portEnv: 'CHECKOUT_PORT',
    port: 8300,
    mfName: 'checkout',
    ownership,
    packageName: '@acme/checkout',
    version: '0.1.0',
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- */
/* SurfaceRef parse / format round-trips                                       */
/* -------------------------------------------------------------------------- */

test('SurfaceRef round-trips canonical forms', () => {
  const canonical = [
    'checkout#cart',
    'acme/checkout#cart',
    'acme/checkout#cart@v2',
    'a.b-c_d/e#surface_1@v10',
  ];
  for (const input of canonical) {
    const result = parseSurfaceRef(input);
    assert.equal(result.ok, true, `expected ${input} to parse`);
    if (result.ok) {
      assert.equal(formatSurfaceRef(result.ref), input);
    }
  }
});

test('SurfaceRef parses fields correctly', () => {
  const withMajor = parseSurfaceRef('acme/checkout#cart@v2');
  assert.deepEqual(withMajor.ok && withMajor.ref, {
    unitId: 'acme/checkout',
    surfaceId: 'cart',
    major: 2,
  } satisfies ParsedSurfaceRef);

  const noMajor = parseSurfaceRef('checkout#cart');
  assert.deepEqual(noMajor.ok && noMajor.ref, {
    unitId: 'checkout',
    surfaceId: 'cart',
  } satisfies ParsedSurfaceRef);
});

test('SurfaceRef rejects invalid forms with typed errors', () => {
  const cases: Array<[string, SurfaceRefParseError['code']]> = [
    ['', 'empty'],
    ['checkout', 'missing-surface-separator'],
    ['a#b#c', 'multiple-surface-separators'],
    ['#cart', 'empty-unit-id'],
    ['acme//checkout#cart', 'invalid-unit-id'],
    ['acme/che kout#cart', 'invalid-unit-id'],
    ['checkout#', 'empty-surface-id'],
    ['checkout#ca rt', 'invalid-surface-id'],
    ['checkout#cart@', 'empty-major'],
    ['checkout#cart@2', 'invalid-major'],
    ['checkout#cart@v0', 'invalid-major'],
    ['checkout#cart@v01', 'invalid-major'],
    ['checkout#cart@vx', 'invalid-major'],
    ['checkout#cart@v9007199254740992', 'invalid-major'],
  ];
  for (const [input, code] of cases) {
    const result = parseSurfaceRef(input);
    assert.equal(result.ok, false, `expected ${input} to fail`);
    if (!result.ok) {
      assert.equal(result.error.code, code, `wrong error code for ${input}`);
    }
  }
});

test('SurfaceRef formatter rejects direct inputs outside the canonical invariant', () => {
  const cases: Array<[ParsedSurfaceRef, SurfaceRefParseError['code']]> = [
    [{ unitId: 'acme//checkout', surfaceId: 'cart' }, 'invalid-unit-id'],
    [
      { unitId: 'acme/checkout', surfaceId: 'cart route' },
      'invalid-surface-id',
    ],
    [{ unitId: 'acme/checkout', surfaceId: 'cart', major: 0 }, 'invalid-major'],
    [
      { unitId: 'acme/checkout', surfaceId: 'cart', major: 1.5 },
      'invalid-major',
    ],
    [
      {
        unitId: 'acme/checkout',
        surfaceId: 'cart',
        major: Number.MAX_SAFE_INTEGER + 1,
      },
      'invalid-major',
    ],
  ];

  for (const [ref, code] of cases) {
    assert.throws(
      () => formatSurfaceRef(ref),
      new RegExp(`Cannot format invalid SurfaceRef: ${code}`),
    );
  }
});

/* -------------------------------------------------------------------------- */
/* Publication zone default                                                    */
/* -------------------------------------------------------------------------- */

test('publication zone defaults to coordinated', () => {
  assert.deepEqual(resolvePublicationZone(undefined), { zone: 'coordinated' });
  assert.deepEqual(
    resolvePublicationZone({
      zone: 'external',
      external: { surfaceMajor: 2, baselineCompatibility: 'baseline-2026-07' },
    }),
    {
      zone: 'external',
      external: { surfaceMajor: 2, baselineCompatibility: 'baseline-2026-07' },
    },
  );
});

/* -------------------------------------------------------------------------- */
/* v1 down-projection golden cases                                             */
/* -------------------------------------------------------------------------- */

test('down-projects a shell descriptor', () => {
  const descriptor: DeliveryUnitDescriptor = {
    unitId: 'acme/shell-super-app',
    kind: 'shell',
    owner: { kind: 'team', id: 'platform' },
    sourceRevision: 'rev-shell',
    buildMarker: 'marker-shell',
    baselineCohort,
    surfaces: [
      {
        kind: 'route',
        surfaceId: 'root',
        locations: [
          { platform: 'browser-mf', manifestUrl: 'https://s/mf-manifest.json' },
        ],
      },
    ],
  };
  const { app, deliveryUnitRecord } = projectDeliveryUnitToV1(
    descriptor,
    context({ directory: 'apps/shell', packageSuffix: 'shell' }),
  );
  assert.equal(app.kind, 'shell');
  assert.equal(app.id, 'shell-super-app');
  assert.equal(app.api, undefined);
  assert.equal(deliveryUnitRecord.unitId, 'acme/shell-super-app');
  assert.equal(deliveryUnitRecord.buildMarker, 'marker-shell');
  assert.equal(deliveryUnitRecord.sourceRevision, 'rev-shell');
  assert.equal(deliveryUnitRecord.appId, 'shell-super-app');
});

test('down-projects a full-stack microvertical descriptor', () => {
  const descriptor: DeliveryUnitDescriptor = {
    unitId: 'acme/checkout',
    kind: 'microvertical',
    owner: { kind: 'agent-team', id: 'checkout-agents', contact: '#checkout' },
    sourceRevision: 'rev-42',
    buildMarker: 'marker-42',
    baselineCohort,
    surfaces: [
      {
        kind: 'component',
        surfaceId: 'cart',
        locations: [
          { platform: 'browser-mf', manifestUrl: 'https://c/mf-manifest.json' },
        ],
      },
      {
        kind: 'api',
        surfaceId: 'checkout-api',
        protocol: 'rest',
        locations: [{ platform: 'http', address: '/api/checkout' }],
      },
      {
        kind: 'backend',
        surfaceId: 'checkout-server',
        locations: [
          { platform: 'node-mf', manifestUrl: 'https://c/backend-mf.json' },
          { platform: 'cloudflare-binding', serviceBinding: 'CHECKOUT_SVC' },
        ],
      },
    ],
  };
  const { app, deliveryUnitRecord } = projectDeliveryUnitToV1(
    descriptor,
    context(),
  );
  assert.equal(app.kind, 'vertical');
  assert.equal(app.id, 'checkout');
  assert.deepEqual(app.api, {
    stem: 'checkout-api',
    prefix: '/api/checkout',
    consumedBy: [],
  });
  assert.equal(deliveryUnitRecord.buildMarker, 'marker-42');
  assert.equal(deliveryUnitRecord.packageName, '@acme/checkout');
});

test('down-projects a headless microvertical (no api http address)', () => {
  const descriptor: DeliveryUnitDescriptor = {
    unitId: 'acme/pricing',
    kind: 'microvertical',
    owner: { kind: 'agent', id: 'pricing-agent' },
    sourceRevision: 'rev-9',
    buildMarker: 'marker-9',
    baselineCohort,
    surfaces: [
      {
        kind: 'api',
        surfaceId: 'pricing',
        protocol: 'rpc',
        locations: [
          { platform: 'node-mf', manifestUrl: 'https://p/backend-mf.json' },
        ],
      },
    ],
  };
  const { app } = projectDeliveryUnitToV1(descriptor, context());
  assert.equal(app.kind, 'vertical');
  // No http location -> prefix falls back to '/' + surfaceId.
  assert.deepEqual(app.api, {
    stem: 'pricing',
    prefix: '/pricing',
    consumedBy: [],
  });
});

test('down-projection never leaks an unsupported GraphQL protocol into v1', () => {
  const descriptor: DeliveryUnitDescriptor = {
    unitId: 'acme/catalog',
    kind: 'microvertical',
    owner: { kind: 'team', id: 'catalog' },
    sourceRevision: 'rev-graphql',
    buildMarker: 'marker-graphql',
    baselineCohort,
    surfaces: [
      {
        kind: 'api',
        surfaceId: 'catalog',
        protocol: 'graphql',
        locations: [{ platform: 'http', address: '/graphql' }],
      },
    ],
  };

  const { app } = projectDeliveryUnitToV1(
    descriptor,
    context({ mode: 'extended-v1' }),
  );

  assert.deepEqual(app.api, {
    stem: 'catalog',
    prefix: '/graphql',
    consumedBy: [],
  });
});

test('horizontal-remote collapses to vertical (lossy)', () => {
  const descriptor: DeliveryUnitDescriptor = {
    unitId: 'acme/design-system',
    kind: 'horizontal-remote',
    owner: { kind: 'team', id: 'design' },
    sourceRevision: 'rev-ds',
    buildMarker: 'marker-ds',
    baselineCohort,
    surfaces: [
      {
        kind: 'component',
        surfaceId: 'button',
        locations: [
          { platform: 'browser-mf', manifestUrl: 'https://d/mf-manifest.json' },
        ],
      },
    ],
  };
  const { app, deliveryUnitRecord } = projectDeliveryUnitToV1(
    descriptor,
    context(),
  );
  assert.equal(app.kind, 'vertical');
  assert.equal(deliveryUnitRecord.unitId, 'acme/design-system');
  assert.equal(deliveryUnitRecord.buildMarker, 'marker-ds');
});

/* -------------------------------------------------------------------------- */
/* Marker preservation                                                         */
/* -------------------------------------------------------------------------- */

test('down-projection preserves markers (never regenerates)', () => {
  const descriptor: DeliveryUnitDescriptor = {
    unitId: 'acme/checkout',
    kind: 'microvertical',
    owner: { kind: 'team', id: 'checkout' },
    sourceRevision: 'exact-source-rev',
    buildMarker: 'exact-build-marker',
    baselineCohort,
    surfaces: [],
  };
  const { deliveryUnitRecord } = projectDeliveryUnitToV1(descriptor, context());
  assert.equal(deliveryUnitRecord.buildMarker, 'exact-build-marker');
  assert.equal(deliveryUnitRecord.sourceRevision, 'exact-source-rev');
  assert.equal(deliveryUnitRecord.unitId, 'acme/checkout');
});

/* -------------------------------------------------------------------------- */
/* Unknown-field preservation (round-trip parse -> serialize)                  */
/* -------------------------------------------------------------------------- */

test('parse -> serialize preserves unknown top-level and surface fields', () => {
  const json = {
    unitId: 'acme/checkout',
    kind: 'microvertical',
    owner: { kind: 'team', id: 'checkout' },
    sourceRevision: 'rev-1',
    buildMarker: 'marker-1',
    baselineCohort,
    futureUnitField: { experimental: true },
    surfaces: [
      {
        kind: 'component',
        surfaceId: 'cart',
        locations: [
          { platform: 'browser-mf', manifestUrl: 'https://c/mf.json' },
        ],
        futureSurfaceField: 'preserve-me',
      },
    ],
  };

  const parsed = parseDeliveryUnitDescriptor(json);
  assert.deepEqual(parsed.unknownFields, {
    futureUnitField: { experimental: true },
  });
  assert.deepEqual(parsed.surfaces[0]?.unknownFields, {
    futureSurfaceField: 'preserve-me',
  });

  const serialized = serializeDeliveryUnitDescriptor(parsed);
  assert.deepEqual(serialized, json);
});

test('parse leaves unknownFields absent when there are none', () => {
  const json = {
    unitId: 'acme/checkout',
    kind: 'microvertical',
    owner: { kind: 'team', id: 'checkout' },
    sourceRevision: 'rev-1',
    buildMarker: 'marker-1',
    baselineCohort,
    surfaces: [],
  };
  const parsed = parseDeliveryUnitDescriptor(json);
  assert.equal(parsed.unknownFields, undefined);
  assert.deepEqual(serializeDeliveryUnitDescriptor(parsed), json);
});

/* -------------------------------------------------------------------------- */
/* Type-level exhaustiveness (compile-time switch checks)                      */
/* -------------------------------------------------------------------------- */

test('surface-kind switch is exhaustive', () => {
  const describe = (surface: SurfaceDescriptor): string => {
    switch (surface.kind) {
      case 'component':
        return 'component';
      case 'route':
        return 'route';
      case 'api':
        return `api:${surface.protocol}`;
      case 'backend':
        return 'backend';
      default:
        // Compile-time guard: a new SurfaceKind makes this a type error.
        return assertNever(surface);
    }
  };

  assert.equal(
    describe({
      kind: 'api',
      surfaceId: 's',
      protocol: 'graphql',
      locations: [],
    }),
    'api:graphql',
  );
  assert.equal(
    describe({ kind: 'component', surfaceId: 's', locations: [] }),
    'component',
  );
});
