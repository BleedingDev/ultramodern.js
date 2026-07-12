/**
 * Round-trip laws for the delivery-unit schema projections (MicroVertical
 * Phase 1, G1b): v1 -> canonical -> v1 and canonical -> v1 -> canonical.
 *
 * Law as implemented (v1 -> canonical -> v1): for every current v1 fixture
 * `app` and its `record = createDeliveryUnitRecord(scope, app)`, threading
 * `scope` / `record.sourceRevision` / `record.buildMarker` through the up
 * context and `app.*` generator fields + `record.packageName/version` through
 * the down context, the composition
 * `projectDeliveryUnitToV1(projectV1ToDeliveryUnit(app, upCtx), downCtx)`
 * reproduces `record` field-for-field and reproduces `app` field-for-field on
 * every field the projection pair owns. The exact loss set is enumerated by
 * SPEC section 5: `exposes` / `verticalRefs` / `domain` are not projected and
 * `api.consumedBy` (an emergent v1 graph fact) is re-zeroed to `[]`.
 * `buildMarker` / `sourceRevision` / `unitId` survive untouched (marker
 * preservation, SPEC invariant 5).
 *
 * Law as implemented (canonical -> v1 -> canonical): for descriptors PASSING
 * `checkV1Representable` (kind `shell` | `microvertical`, coordinated zone,
 * any owner kind, at most one `rest` api surface with a single http location,
 * no component/route/backend surfaces), the reverse composition deep-equals
 * the original descriptor — the round-trip is lossless on every
 * representability-covered field. Every construct outside that subset
 * (`horizontal-remote`, `external` zone, component/route or backend surfaces,
 * multiple api surfaces, non-rest protocols, unsupported api shapes) is
 * detected by the guard and rejected with a typed error instead of degrading
 * silently. Where the v1 -> canonical -> v1 direction
 * still strips fields (`exposes`), the loss is asserted to be
 * representability-covered: the up-projected descriptor is checked first and
 * the guard must have flagged exactly the descriptors whose apps carried
 * exposes.
 */
import assert from 'node:assert/strict';
import type { DeliveryUnitRecord } from '@modern-js/utils/universal';
import { createDeliveryUnitRecord } from '../src/ultramodern-workspace/delivery-unit';
import type {
  BaselineCohort,
  DeliveryUnitDescriptor,
  V1ProjectionContext,
} from '../src/ultramodern-workspace/delivery-unit-schema/types';
import {
  parseSurfaceRef,
  projectDeliveryUnitToV1,
} from '../src/ultramodern-workspace/delivery-unit-schema/types';
import type { V1UpProjectionContext } from '../src/ultramodern-workspace/delivery-unit-schema/up-projection';
import {
  assertV1Representable,
  checkV1Representable,
  projectV1ToDeliveryUnit,
  V1UnrepresentableError,
} from '../src/ultramodern-workspace/delivery-unit-schema/up-projection';
import {
  createShellHost,
  createVerticalDescriptor,
} from '../src/ultramodern-workspace/descriptors';
import type { WorkspaceApp } from '../src/ultramodern-workspace/types';

const SCOPE = 'acme';

const baselineCohort: BaselineCohort = {
  cohortId: 'baseline-2026-07',
  resolved: {
    react: '^19.2.7',
    tanstackRouter: '1.170.17',
    effect: '4.0.0-beta.97',
    tailwind: '4.3.2',
  },
};

/* -------------------------------------------------------------------------- */
/* v1 fixtures, built the way descriptors.ts builds them                       */
/* -------------------------------------------------------------------------- */

const fullStackVertical = createVerticalDescriptor('checkout', 8300);

/** Api-bearing vertical (consumedBy populated by the real helper), no MF UI. */
const apiOnlyVertical: WorkspaceApp = (() => {
  const { exposes: _exposes, ...rest } = createVerticalDescriptor(
    'pricing',
    8301,
  );
  return rest;
})();

/** Vertical without an api surface. */
const noApiVertical: WorkspaceApp = (() => {
  const { api: _api, ...rest } = createVerticalDescriptor('catalog', 8302);
  return rest;
})();

const shellHost = createShellHost([fullStackVertical]);

const fixtures: Array<[string, WorkspaceApp]> = [
  ['shell', shellHost],
  ['full-stack vertical', fullStackVertical],
  ['api-bearing vertical', apiOnlyVertical],
  ['vertical without api', noApiVertical],
];

/* -------------------------------------------------------------------------- */
/* Context threading (the composition contract of the two projections)         */
/* -------------------------------------------------------------------------- */

function upContext(record: DeliveryUnitRecord): V1UpProjectionContext {
  return {
    scope: SCOPE,
    sourceRevision: record.sourceRevision,
    buildMarker: record.buildMarker,
    baselineCohort,
  };
}

function downContext(
  app: WorkspaceApp,
  record: DeliveryUnitRecord,
): V1ProjectionContext {
  return {
    directory: app.directory,
    packageSuffix: app.packageSuffix,
    displayName: app.displayName,
    portEnv: app.portEnv,
    port: app.port,
    mfName: app.mfName,
    ownership: app.ownership,
    packageName: record.packageName,
    version: record.version,
  };
}

/**
 * The v1 fields the projection pair owns. `verticalRefs` (emergent-resolution
 * metadata) and `api.consumedBy` (an emergent v1 graph fact re-zeroed by the
 * down-projection) are genuinely v1-generator-owned; `domain` is reconstructed
 * into `unitId` but not restored as a field. `exposes` is a
 * representability-covered loss: `roundTrip` asserts `checkV1Representable`
 * flagged the descriptor before this stripping is allowed to hide it.
 * Everything else must round-trip exactly.
 */
function v1ProjectedView(app: WorkspaceApp): WorkspaceApp {
  const {
    domain: _domain,
    exposes: _exposes,
    verticalRefs: _verticalRefs,
    api,
    ...rest
  } = app;
  return {
    ...rest,
    ...(api === undefined ? {} : { api: { ...api, consumedBy: [] } }),
  };
}

function roundTrip(app: WorkspaceApp) {
  const record = createDeliveryUnitRecord(SCOPE, app);
  const descriptor = projectV1ToDeliveryUnit(app, upContext(record));

  // The loss below (v1ProjectedView) must be representability-covered, never
  // silent: descriptors are checked BEFORE down-projecting, and the guard
  // must flag exactly the apps whose exposes become component/route surfaces
  // that v1 cannot carry back.
  const check = checkV1Representable(descriptor);
  const hasExposes = Object.keys(app.exposes ?? {}).length > 0;
  if (hasExposes) {
    assert.deepEqual(check, {
      representable: false,
      code: 'unrepresentable-in-v1',
      reason: 'component-or-route-surface',
    });
  } else {
    assert.deepEqual(check, { representable: true });
  }

  const projected = projectDeliveryUnitToV1(
    descriptor,
    downContext(app, record),
  );
  return { record, descriptor, projected, check };
}

/* -------------------------------------------------------------------------- */
/* v1 -> canonical -> v1                                                       */
/* -------------------------------------------------------------------------- */

test('v1 -> canonical -> v1 round-trips the shell field-for-field', () => {
  const { record, descriptor, projected } = roundTrip(shellHost);

  assert.equal(descriptor.kind, 'shell');
  assert.deepEqual(descriptor.surfaces, []);
  assert.deepEqual(projected.app, v1ProjectedView(shellHost));
  assert.deepEqual(projected.deliveryUnitRecord, record);
  assert.equal(projected.app.api, undefined);
});

test('v1 -> canonical -> v1 round-trips a full-stack vertical field-for-field', () => {
  const { record, projected } = roundTrip(fullStackVertical);

  assert.deepEqual(projected.app, v1ProjectedView(fullStackVertical));
  assert.deepEqual(projected.deliveryUnitRecord, record);

  // The projected fields, spelled out against the ORIGINAL app.
  assert.equal(projected.app.id, fullStackVertical.id);
  assert.equal(projected.app.kind, 'vertical');
  assert.equal(projected.app.directory, fullStackVertical.directory);
  assert.equal(projected.app.port, fullStackVertical.port);
  assert.equal(projected.app.mfName, fullStackVertical.mfName);
  assert.deepEqual(projected.app.ownership, fullStackVertical.ownership);
  assert.equal(projected.app.api?.stem, fullStackVertical.api?.stem);
  assert.equal(projected.app.api?.prefix, fullStackVertical.api?.prefix);

  // The enumerated loss set (SPEC section 5), asserted rather than implied.
  assert.equal(projected.app.exposes, undefined);
  assert.equal(projected.app.domain, undefined);
  assert.deepEqual(projected.app.api?.consumedBy, []);
});

test('v1 -> canonical -> v1 round-trips an api-bearing vertical with consumedBy', () => {
  assert.ok((apiOnlyVertical.api?.consumedBy.length ?? 0) > 0);

  const { record, descriptor, projected } = roundTrip(apiOnlyVertical);

  assert.deepEqual(descriptor.surfaces, [
    {
      kind: 'api',
      surfaceId: 'pricing',
      protocol: 'rest',
      locations: [{ platform: 'http', address: '/pricing-api' }],
    },
  ]);
  assert.deepEqual(projected.app, v1ProjectedView(apiOnlyVertical));
  assert.deepEqual(projected.deliveryUnitRecord, record);
  // consumedBy is an emergent v1 graph fact: dropped up, re-zeroed down.
  assert.deepEqual(projected.app.api?.consumedBy, []);
});

test('v1 -> canonical -> v1 round-trips a vertical without api', () => {
  const { record, descriptor, projected } = roundTrip(noApiVertical);

  assert.equal(
    descriptor.surfaces.some(surface => surface.kind === 'api'),
    false,
  );
  assert.equal(projected.app.api, undefined);
  assert.deepEqual(projected.app, v1ProjectedView(noApiVertical));
  assert.deepEqual(projected.deliveryUnitRecord, record);
});

test('round-trip keeps buildMarker/sourceRevision/unitId untouched (marker preservation)', () => {
  for (const [name, app] of fixtures) {
    const { record, descriptor, projected } = roundTrip(app);

    assert.equal(descriptor.buildMarker, record.buildMarker, name);
    assert.equal(descriptor.sourceRevision, record.sourceRevision, name);
    assert.equal(descriptor.unitId, record.unitId, name);

    assert.equal(projected.deliveryUnitRecord.buildMarker, record.buildMarker);
    assert.equal(
      projected.deliveryUnitRecord.sourceRevision,
      record.sourceRevision,
    );
    assert.equal(projected.deliveryUnitRecord.unitId, record.unitId, name);
    assert.equal(projected.deliveryUnitRecord.appId, record.appId, name);
  }
});

/* -------------------------------------------------------------------------- */
/* Up-projection mapping rules (SPEC section 5 read in reverse)                */
/* -------------------------------------------------------------------------- */

test('up-projection maps v1 vocabulary onto canonical surfaces', () => {
  const { descriptor } = roundTrip(fullStackVertical);

  assert.equal(descriptor.unitId, 'acme/checkout');
  assert.equal(descriptor.kind, 'microvertical');
  assert.deepEqual(descriptor.owner, {
    kind: 'team',
    id: fullStackVertical.ownership.team,
    contact: fullStackVertical.ownership.slack,
  });
  assert.deepEqual(descriptor.publicationZone, { zone: 'coordinated' });
  assert.deepEqual(descriptor.surfaces, [
    {
      kind: 'route',
      surfaceId: 'Route',
      locations: [
        {
          platform: 'browser-mf',
          manifestUrl: 'http://localhost:8300/mf-manifest.json',
        },
      ],
    },
    {
      kind: 'component',
      surfaceId: 'Widget',
      locations: [
        {
          platform: 'browser-mf',
          manifestUrl: 'http://localhost:8300/mf-manifest.json',
        },
      ],
    },
    {
      kind: 'api',
      surfaceId: 'checkout',
      protocol: 'rest',
      locations: [{ platform: 'http', address: '/checkout-api' }],
    },
  ]);
});

test('up-projected surface ids are SurfaceRef-valid', () => {
  for (const [name, app] of fixtures) {
    const { descriptor } = roundTrip(app);
    for (const surface of descriptor.surfaces) {
      const ref = `${descriptor.unitId}#${surface.surfaceId}`;
      assert.equal(parseSurfaceRef(ref).ok, true, `${name}: ${ref}`);
    }
  }
});

test('up-projection api protocol defaults to rest and honours context override', () => {
  const record = createDeliveryUnitRecord(SCOPE, apiOnlyVertical);

  const defaulted = projectV1ToDeliveryUnit(apiOnlyVertical, upContext(record));
  const apiSurface = defaulted.surfaces.find(surface => surface.kind === 'api');
  assert.equal(apiSurface?.kind === 'api' && apiSurface.protocol, 'rest');

  const overridden = projectV1ToDeliveryUnit(apiOnlyVertical, {
    ...upContext(record),
    apiProtocol: 'rpc',
  });
  const rpcSurface = overridden.surfaces.find(
    surface => surface.kind === 'api',
  );
  assert.equal(rpcSurface?.kind === 'api' && rpcSurface.protocol, 'rpc');
});

/* -------------------------------------------------------------------------- */
/* canonical -> v1 -> canonical (v1-representable subset)                      */
/* -------------------------------------------------------------------------- */

function canonicalRoundTrip(
  descriptor: DeliveryUnitDescriptor,
): DeliveryUnitDescriptor {
  const scope = descriptor.unitId.slice(0, descriptor.unitId.lastIndexOf('/'));
  const { app } = projectDeliveryUnitToV1(descriptor, {
    directory: 'apps/anywhere',
    packageSuffix: 'anywhere',
    displayName: 'Anywhere',
    portEnv: 'ANYWHERE_PORT',
    port: 8400,
    mfName: 'anywhere',
    ownership: {
      team: descriptor.owner.id,
      slack: descriptor.owner.contact ?? '',
      pagerDuty: 'pd-anywhere',
      runbookRef: 'runbooks/anywhere.md',
      adrRef: 'ADR-0019',
      blastRadius: { tier: 'tier-2-vertical', references: [] },
    },
    packageName: '@acme/anywhere',
    version: '0.1.0',
  });
  return projectV1ToDeliveryUnit(app, {
    scope,
    sourceRevision: descriptor.sourceRevision,
    buildMarker: descriptor.buildMarker,
    baselineCohort: descriptor.baselineCohort,
  });
}

test('canonical -> v1 -> canonical is lossless for descriptors passing checkV1Representable', () => {
  const apiBearing: DeliveryUnitDescriptor = {
    unitId: 'acme/checkout',
    kind: 'microvertical',
    owner: { kind: 'team', id: 'checkout', contact: '#checkout' },
    sourceRevision: 'rev-42',
    buildMarker: 'marker-42',
    baselineCohort,
    publicationZone: { zone: 'coordinated' },
    surfaces: [
      {
        kind: 'api',
        surfaceId: 'checkout-api',
        protocol: 'rest',
        locations: [{ platform: 'http', address: '/api/checkout' }],
      },
    ],
  };
  // The law's precondition: the descriptor is representability-checked first.
  assert.deepEqual(checkV1Representable(apiBearing), { representable: true });
  assert.deepEqual(canonicalRoundTrip(apiBearing), apiBearing);

  const surfacelessShell: DeliveryUnitDescriptor = {
    unitId: 'acme/shell-super-app',
    kind: 'shell',
    owner: { kind: 'team', id: 'super-app-platform', contact: '#platform' },
    sourceRevision: 'rev-shell',
    buildMarker: 'marker-shell',
    baselineCohort,
    publicationZone: { zone: 'coordinated' },
    surfaces: [],
  };
  assert.deepEqual(checkV1Representable(surfacelessShell), {
    representable: true,
  });
  assert.deepEqual(canonicalRoundTrip(surfacelessShell), surfacelessShell);
});

/* -------------------------------------------------------------------------- */
/* Owner round-trip (G3): agent / agent-team owners carried via ownership.owner */
/* -------------------------------------------------------------------------- */

test('canonical agent / agent-team owner round-trips through the projection pair (G3)', () => {
  const owners = [
    { kind: 'agent', id: 'bot-7', contact: '#bot-7' },
    { kind: 'agent-team', id: 'swarm-3' },
  ] as const;

  for (const owner of owners) {
    const descriptor: DeliveryUnitDescriptor = {
      unitId: 'acme/checkout',
      kind: 'microvertical',
      owner,
      sourceRevision: 'rev-a',
      buildMarker: 'marker-a',
      baselineCohort,
      publicationZone: { zone: 'coordinated' },
      surfaces: [],
    };

    const { app } = projectDeliveryUnitToV1(descriptor, {
      directory: 'apps/checkout',
      packageSuffix: 'checkout',
      displayName: 'Checkout',
      portEnv: 'CHECKOUT_PORT',
      port: 8500,
      mfName: 'checkout',
      ownership: {
        team: 'human-fallback',
        slack: '#human-fallback',
        pagerDuty: 'pd',
        runbookRef: 'runbooks/checkout.md',
        adrRef: 'ADR-0019',
        blastRadius: { tier: 'tier-2-vertical', references: [] },
      },
      packageName: '@acme/checkout',
      version: '0.1.0',
    });

    // Down-projection carries the non-team owner into ownership.owner...
    assert.deepEqual(app.ownership.owner, owner, owner.kind);
    assert.deepEqual(checkV1Representable(descriptor), { representable: true });
    assert.doesNotThrow(() => assertV1Representable(descriptor), owner.kind);

    // ...and the up-projection reads it straight back, faithfully.
    const back = projectV1ToDeliveryUnit(app, {
      scope: 'acme',
      sourceRevision: descriptor.sourceRevision,
      buildMarker: descriptor.buildMarker,
      baselineCohort,
    });
    assert.deepEqual(back.owner, owner, owner.kind);
  }
});

/* -------------------------------------------------------------------------- */
/* Unrepresentable-in-v1 cases: typed rejection, never silent degradation      */
/* -------------------------------------------------------------------------- */

const horizontalRemote: DeliveryUnitDescriptor = {
  unitId: 'acme/design-system',
  kind: 'horizontal-remote',
  owner: { kind: 'team', id: 'design-system' },
  sourceRevision: 'rev-ds',
  buildMarker: 'marker-ds',
  baselineCohort,
  surfaces: [],
};

const externallyPublished: DeliveryUnitDescriptor = {
  unitId: 'acme/checkout',
  kind: 'microvertical',
  owner: { kind: 'team', id: 'checkout' },
  sourceRevision: 'rev-ext',
  buildMarker: 'marker-ext',
  baselineCohort,
  publicationZone: {
    zone: 'external',
    external: { surfaceMajor: 2, baselineCompatibility: 'baseline-2026-07' },
  },
  surfaces: [],
};

test('horizontal-remote is unrepresentable in v1 (typed, not silent)', () => {
  assert.deepEqual(checkV1Representable(horizontalRemote), {
    representable: false,
    code: 'unrepresentable-in-v1',
    reason: 'horizontal-remote-kind',
  });

  assert.throws(
    () => assertV1Representable(horizontalRemote),
    (error: unknown) =>
      error instanceof V1UnrepresentableError &&
      error.code === 'unrepresentable-in-v1' &&
      error.reason === 'horizontal-remote-kind',
  );
});

test('external publication zone is unrepresentable in v1 (typed, not silent)', () => {
  assert.deepEqual(checkV1Representable(externallyPublished), {
    representable: false,
    code: 'unrepresentable-in-v1',
    reason: 'external-zone',
  });

  assert.throws(
    () => assertV1Representable(externallyPublished),
    (error: unknown) =>
      error instanceof V1UnrepresentableError &&
      error.code === 'unrepresentable-in-v1' &&
      error.reason === 'external-zone',
  );
});

test('the guard exhaustively detects every construct the v1 shape cannot carry', () => {
  const base = (
    overrides: Partial<DeliveryUnitDescriptor>,
  ): DeliveryUnitDescriptor => ({
    unitId: 'acme/checkout',
    kind: 'microvertical',
    owner: { kind: 'team', id: 'checkout' },
    sourceRevision: 'rev-x',
    buildMarker: 'marker-x',
    baselineCohort,
    publicationZone: { zone: 'coordinated' },
    surfaces: [],
    ...overrides,
  });
  const restApi = (surfaceId: string) =>
    ({
      kind: 'api',
      surfaceId,
      protocol: 'rest',
      locations: [{ platform: 'http', address: `/${surfaceId}` }],
    }) as const;

  const cases: Array<[string, DeliveryUnitDescriptor]> = [
    ['unknown-fields', base({ unknownFields: { forwardCompat: 'x' } })],
    // No publicationZone: down drops the field, up re-adds an explicit
    // coordinated zone, so the absence is not round-trippable.
    ['non-canonical-zone', base({ publicationZone: undefined })],
    [
      'component-or-route-surface',
      base({
        surfaces: [
          {
            kind: 'component',
            surfaceId: 'Widget',
            locations: [
              { platform: 'browser-mf', manifestUrl: 'http://x/mf.json' },
            ],
          },
        ],
      }),
    ],
    [
      'backend-surface',
      base({
        surfaces: [
          {
            kind: 'backend',
            surfaceId: 'worker',
            locations: [
              { platform: 'cloudflare-binding', serviceBinding: 'W' },
            ],
          },
        ],
      }),
    ],
    [
      'multiple-api-surfaces',
      base({ surfaces: [restApi('one'), restApi('two')] }),
    ],
    [
      'non-rest-protocol',
      base({ surfaces: [{ ...restApi('rpc-api'), protocol: 'rpc' }] }),
    ],
    [
      'unsupported-surface-shape',
      base({
        surfaces: [
          {
            ...restApi('multi'),
            locations: [
              { platform: 'http', address: '/a' },
              { platform: 'node-mf', manifestUrl: 'http://x/mf.json' },
            ],
          },
        ],
      }),
    ],
    [
      'unsupported-surface-shape',
      base({
        surfaces: [{ ...restApi('flagged'), externallyPublished: true }],
      }),
    ],
  ];

  for (const [reason, descriptor] of cases) {
    assert.deepEqual(
      checkV1Representable(descriptor),
      { representable: false, code: 'unrepresentable-in-v1', reason },
      reason,
    );
    assert.throws(
      () => assertV1Representable(descriptor),
      (error: unknown) =>
        error instanceof V1UnrepresentableError &&
        error.code === 'unrepresentable-in-v1' &&
        error.reason === reason,
      reason,
    );
  }
});

test('up-projected descriptors are representable exactly when the app has no exposes', () => {
  for (const [name, app] of fixtures) {
    const { descriptor, check } = roundTrip(app);
    assert.notEqual(descriptor.kind, 'horizontal-remote', name);
    assert.deepEqual(descriptor.publicationZone, { zone: 'coordinated' }, name);

    const hasExposes = Object.keys(app.exposes ?? {}).length > 0;
    if (hasExposes) {
      // v1 cannot carry component/route surfaces back (its down-projection
      // reconstructs no exposes): the documented loss is detected, not silent.
      assert.deepEqual(
        check,
        {
          representable: false,
          code: 'unrepresentable-in-v1',
          reason: 'component-or-route-surface',
        },
        name,
      );
      assert.throws(() => assertV1Representable(descriptor), name);
    } else {
      assert.deepEqual(check, { representable: true }, name);
      assert.doesNotThrow(() => assertV1Representable(descriptor), name);
    }
  }
});
