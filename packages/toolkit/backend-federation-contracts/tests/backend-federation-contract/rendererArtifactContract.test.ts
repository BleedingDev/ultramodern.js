import {
  assertRendererProfileCompatibility,
  assertUltramodernBuildArtifact,
  createUltramodernBuildArtifact,
  DELIVERY_UNIT_DEPLOY_PROFILE,
  DELIVERY_UNIT_KIND,
  DELIVERY_UNIT_SCHEMA_VERSION,
  type DeliveryUnitRecord,
  type RendererIdentity,
  type RendererName,
  type RendererProfile,
  type RendererRouterBindings,
  type RouterPackageBinding,
  stampUltramodernBuildArtifactIdentity,
  ULTRAMODERN_BUILD_ARTIFACT_SCHEMA_VERSION,
  validateRendererIdentity,
  validateRendererProfile,
  validateRendererProfileCompatibility,
  validateUltramodernBuildArtifact,
} from '../../src/backend-federation-contract';

const record: DeliveryUnitRecord = {
  schemaVersion: DELIVERY_UNIT_SCHEMA_VERSION,
  kind: DELIVERY_UNIT_KIND,
  appId: 'checkout',
  unitId: 'acme/checkout',
  packageName: '@acme/checkout',
  version: '0.1.0',
  buildMarker: 'checkout-build',
  sourceRevision: 'workspace',
  deployProfile: DELIVERY_UNIT_DEPLOY_PROFILE,
};

const profile = (renderer: RendererName): RendererProfile => ({
  renderer,
  protocolVersion: 1,
  compiler: { name: `${renderer}-compiler`, version: '2.0.0-rc.13' },
  hydration: { name: `${renderer}-hydration`, version: '1' },
  router: {
    name: `${renderer}-router`,
    version: '2.0.0-rc.8',
    coreName: '@tanstack/router-core',
    coreVersion: '1.171.15',
  },
});

const identity = (renderer: RendererName): RendererIdentity => ({
  renderer,
  appId: record.appId,
  entryName: 'main',
  protocolVersion: 1,
  buildId: record.buildMarker,
});

// Controlled owner evidence for schema fixtures, not installed-package admission.
const controlledRouterBindings = (
  renderer: RendererName,
): RendererRouterBindings => {
  const provider: RouterPackageBinding = {
    framework: renderer === 'react' ? 'react-router' : renderer,
    ...profile(renderer).router,
  };
  return {
    main: {
      owner: `@fixture/${renderer}-router-owner`,
      evidence: 'file-routes',
      defaultProvider: provider,
      providers: [provider],
    },
  };
};

const artifact = (renderer: RendererName = 'react') =>
  createUltramodernBuildArtifact(record, {
    ui: {
      identity: identity(renderer),
      profile: profile(renderer),
      routerBindings: controlledRouterBindings(renderer),
    },
  });

const jsonCopy = <T>(value: T): T => JSON.parse(JSON.stringify(value));

describe('persisted renderer artifact contract', () => {
  it.each([
    { renderer: 'solid', foreign: 'octane' },
    { renderer: 'octane', foreign: 'solid' },
    { renderer: 'react', foreign: 'solid' },
    { renderer: 'react', foreign: 'octane' },
  ] satisfies {
    renderer: RendererName;
    foreign: RendererName;
  }[])('rejects $foreign providers under a valid $renderer identity/profile at producer and reader boundaries', ({
    renderer,
    foreign,
  }) => {
    const routerBindings = controlledRouterBindings(foreign);
    expect(() =>
      createUltramodernBuildArtifact(record, {
        ui: {
          identity: identity(renderer),
          profile: profile(renderer),
          routerBindings,
        },
      }),
    ).toThrow(
      `artifact.ui.routerBindings.main.defaultProvider.framework: must be supported by the "${renderer}" renderer.`,
    );
    const value = artifact(renderer);
    expect(
      validateUltramodernBuildArtifact({
        ...value,
        surfaces: {
          ...value.surfaces,
          ui: { ...value.surfaces.ui, routerBindings },
        },
      }).errors,
    ).toContainEqual({
      path: 'artifact.surfaces.ui.routerBindings.main.defaultProvider.framework',
      message: `must be supported by the "${renderer}" renderer.`,
    });
  });

  it('accepts a controlled React registry containing React Router and TanStack providers', () => {
    const defaultProvider =
      controlledRouterBindings('react').main.defaultProvider;
    const tanstackProvider: RouterPackageBinding = {
      framework: 'tanstack',
      name: '@fixture/react-tanstack-router',
      version: '1.0.0',
      coreName: '@fixture/router-core',
      coreVersion: '1.0.0',
    };
    const routerBindings = {
      main: {
        owner: '@fixture/react-provider-registry',
        evidence: 'provider-registry',
        defaultProvider,
        providers: [defaultProvider, tanstackProvider],
      },
    } satisfies RendererRouterBindings;
    const value = createUltramodernBuildArtifact(record, {
      ui: {
        identity: identity('react'),
        profile: profile('react'),
        routerBindings,
      },
    });
    expect(validateUltramodernBuildArtifact(value)).toEqual({
      ok: true,
      errors: [],
    });
    expect(value.surfaces.ui?.routerBindings).toEqual(routerBindings);
  });

  it.each([
    'react',
    'solid',
    'octane',
  ] as const)('accepts an explicit %s UI identity', renderer => {
    const value = artifact(renderer);
    expect(value.schemaVersion).toBe(ULTRAMODERN_BUILD_ARTIFACT_SCHEMA_VERSION);
    expect(value.surfaces.ui?.rendererIdentity).toEqual(identity(renderer));
    expect(validateUltramodernBuildArtifact(value)).toEqual({
      ok: true,
      errors: [],
    });
  });

  it('does not invent UI identity for a headless delivery unit', () => {
    const value = createUltramodernBuildArtifact(record);
    expect(Object.keys(value.surfaces)).toEqual(['api']);
    expect(validateUltramodernBuildArtifact(value).ok).toBe(true);
    const stamped = stampUltramodernBuildArtifactIdentity(value, {
      buildMarker: 'new-build',
      sourceRevision: 'committed-revision',
    });
    expect(Object.hasOwn(stamped.surfaces, 'ui')).toBe(false);
    expect(stamped.surfaces.api.buildMarker).toBe('new-build');
  });

  it('rejects schema 1 instead of synthesizing renderer metadata', () => {
    expect(
      validateUltramodernBuildArtifact({ ...artifact(), schemaVersion: 1 })
        .errors,
    ).toContainEqual({
      path: 'artifact.schemaVersion',
      message: 'must be 2.',
    });
  });

  it.each([
    'rendererIdentity',
    'rendererProfile',
  ])('rejects a UI surface without %s', field => {
    const value = jsonCopy(artifact());
    delete (value.surfaces.ui as unknown as Record<string, unknown>)[field];
    expect(validateUltramodernBuildArtifact(value).errors).toContainEqual({
      path: `artifact.surfaces.ui.${field}`,
      message: 'must be an object.',
    });
  });

  it.each([
    'rendererIdentity',
    'rendererProfile',
    'routerBindings',
  ] as const)('forbids UI %s on the API surface', field => {
    const value = artifact();
    const api = {
      ...value.surfaces.api,
      [field]: value.surfaces.ui?.[field],
    };
    expect(
      validateUltramodernBuildArtifact({
        ...value,
        surfaces: { ...value.surfaces, api },
      }).errors,
    ).toContainEqual({
      path: `artifact.surfaces.api.${field}`,
      message: 'is forbidden on the API surface.',
    });
  });

  it('requires an explicit own router map on parsed UI artifacts', () => {
    const value = jsonCopy(artifact('solid'));
    Reflect.deleteProperty(value.surfaces.ui!, 'routerBindings');
    expect(validateUltramodernBuildArtifact(value).errors).toContainEqual({
      path: 'artifact.surfaces.ui.routerBindings',
      message: 'is required on the UI surface.',
    });
    const inheritedUi = Object.assign(
      Object.create({ routerBindings: controlledRouterBindings('solid') }),
      value.surfaces.ui,
    );
    expect(
      validateUltramodernBuildArtifact({
        ...value,
        surfaces: { ...value.surfaces, ui: inheritedUi },
      }).errors,
    ).toContainEqual({
      path: 'artifact.surfaces.ui.routerBindings',
      message: 'is required on the UI surface.',
    });
  });

  it('rejects producer options missing the required router map', () => {
    expect(() =>
      Reflect.apply(createUltramodernBuildArtifact, undefined, [
        record,
        { ui: { identity: identity('solid'), profile: profile('solid') } },
      ]),
    ).toThrow('artifact.ui.routerBindings: is required on the UI surface.');
  });

  it.each([
    undefined,
    null,
    [],
    'main',
  ])('rejects a malformed UI router map %s at producer and reader boundaries', routerBindings => {
    expect(() =>
      Reflect.apply(createUltramodernBuildArtifact, undefined, [
        record,
        {
          ui: {
            identity: identity('solid'),
            profile: profile('solid'),
            routerBindings,
          },
        },
      ]),
    ).toThrow('artifact.ui.routerBindings: must be a plain object.');
    const value = artifact('solid');
    expect(
      validateUltramodernBuildArtifact({
        ...value,
        surfaces: {
          ...value.surfaces,
          ui: { ...value.surfaces.ui, routerBindings },
        },
      }).errors,
    ).toContainEqual({
      path: 'artifact.surfaces.ui.routerBindings',
      message: 'must be a plain object.',
    });
  });

  it.each([
    {},
    { secondary: controlledRouterBindings('solid').main },
  ])('requires the exact primary entry in the router map', routerBindings => {
    expect(() =>
      createUltramodernBuildArtifact(record, {
        ui: {
          identity: identity('solid'),
          profile: profile('solid'),
          routerBindings,
        },
      }),
    ).toThrow(
      'artifact.ui.routerBindings: must include the primary renderer entry.',
    );
    const value = artifact('solid');
    expect(
      validateUltramodernBuildArtifact({
        ...value,
        surfaces: {
          ...value.surfaces,
          ui: { ...value.surfaces.ui, routerBindings },
        },
      }).errors,
    ).toContainEqual({
      path: 'artifact.surfaces.ui.routerBindings',
      message: 'must include the primary renderer entry.',
    });
  });

  it('validates nonprimary binding tuples instead of ignoring other entries', () => {
    const value = artifact('solid');
    const main = controlledRouterBindings('solid').main;
    const routerBindings = {
      main,
      secondary: {
        ...main,
        defaultProvider: { ...main.defaultProvider, coreVersion: 'latest' },
      },
    };
    expect(() =>
      createUltramodernBuildArtifact(record, {
        ui: {
          identity: identity('solid'),
          profile: profile('solid'),
          routerBindings,
        },
      }),
    ).toThrow(
      'artifact.ui.routerBindings.secondary.defaultProvider.coreVersion: must be an exact version.',
    );
    expect(
      validateUltramodernBuildArtifact({
        ...value,
        surfaces: {
          ...value.surfaces,
          ui: { ...value.surfaces.ui, routerBindings },
        },
      }).errors,
    ).toContainEqual({
      path: 'artifact.surfaces.ui.routerBindings.secondary.defaultProvider.coreVersion',
      message: 'must be an exact version.',
    });
  });

  it('preserves and freezes the complete router map when creating and stamping UI artifacts', () => {
    const controlled = controlledRouterBindings('solid');
    const routerBindings = {
      ...controlled,
      'catalog/detail': controlled.main,
    };
    const original = createUltramodernBuildArtifact(record, {
      ui: {
        identity: identity('solid'),
        profile: profile('solid'),
        routerBindings,
      },
    });
    const before = jsonCopy(routerBindings);
    expect(original.surfaces.ui?.routerBindings).toEqual(before);
    expect(original.surfaces.ui?.routerBindings).not.toBe(routerBindings);
    Object.assign(routerBindings.main.defaultProvider, { version: '9.0.0' });
    expect(original.surfaces.ui?.routerBindings).toEqual(before);

    const parsed = jsonCopy(original);
    const stamped = stampUltramodernBuildArtifactIdentity(parsed, {
      buildMarker: 'compiled-build',
      sourceRevision: 'compiled-revision',
    });
    expect(stamped.surfaces.ui?.routerBindings).toEqual(before);
    expect(stamped.surfaces.ui?.routerBindings).not.toBe(
      parsed.surfaces.ui?.routerBindings,
    );
    expect(Object.isFrozen(stamped.surfaces.ui?.routerBindings)).toBe(true);
    for (const binding of Object.values(stamped.surfaces.ui!.routerBindings)) {
      expect(Object.isFrozen(binding)).toBe(true);
      expect(Object.isFrozen(binding.defaultProvider)).toBe(true);
      expect(Object.isFrozen(binding.providers)).toBe(true);
      expect(Object.isFrozen(binding.providers[0])).toBe(true);
    }
    Object.assign(
      parsed.surfaces.ui!.routerBindings['catalog/detail'].providers[0],
      {
        coreVersion: '9.0.0',
      },
    );
    expect(stamped.surfaces.ui?.routerBindings).toEqual(before);
    expect(validateUltramodernBuildArtifact(stamped).ok).toBe(true);
  });

  it('rejects a fabricated UI marker with a different app identity', () => {
    const value = jsonCopy(artifact('solid'));
    const ui = value.surfaces.ui!;
    ui.appId = 'another-app';
    Object.assign(ui.rendererIdentity, { appId: 'another-app' });
    expect(validateUltramodernBuildArtifact(value).errors).toContainEqual({
      path: 'artifact.surfaces.ui.appId',
      message: 'must match artifact.deliveryUnit.appId.',
    });
  });

  it.each([
    'appId',
    'buildId',
  ])('binds UI renderer %s to the delivery identity', field => {
    const value = jsonCopy(artifact('octane'));
    Object.assign(value.surfaces.ui!.rendererIdentity, {
      [field]: 'different',
    });
    expect(
      validateUltramodernBuildArtifact(value).errors.some(
        error =>
          error.path === `artifact.surfaces.ui.rendererIdentity.${field}`,
      ),
    ).toBe(true);
  });

  it('requires the renderer profile and identity to name the same renderer', () => {
    const value = jsonCopy(artifact('solid'));
    Object.assign(value.surfaces.ui!.rendererProfile, { renderer: 'react' });
    expect(validateUltramodernBuildArtifact(value).errors).toContainEqual({
      path: 'artifact.surfaces.ui.rendererProfile.renderer',
      message: 'must match the renderer identity.',
    });
  });

  it('rejects an explicitly undefined UI surface and an unknown surface', () => {
    const value = createUltramodernBuildArtifact(record);
    expect(
      validateUltramodernBuildArtifact({
        ...value,
        surfaces: { ...value.surfaces, ui: undefined },
      }).ok,
    ).toBe(false);
    expect(
      validateUltramodernBuildArtifact({
        ...value,
        surfaces: { ...value.surfaces, legacy: value.surfaces.api },
      }).ok,
    ).toBe(false);
  });

  it('requires buildMarker even when an old build alias is present', () => {
    const value = jsonCopy(artifact());
    delete (value.deliveryUnit as unknown as Record<string, unknown>)
      .buildMarker;
    expect(
      validateUltramodernBuildArtifact(value).errors.some(
        error => error.path === 'artifact.deliveryUnit.buildMarker',
      ),
    ).toBe(true);
  });

  it('rejects invalid producer identity before returning an artifact', () => {
    expect(() =>
      createUltramodernBuildArtifact(record, {
        ui: {
          identity: { ...identity('solid'), buildId: 'wrong-build' },
          profile: profile('solid'),
          routerBindings: controlledRouterBindings('solid'),
        },
      }),
    ).toThrow('must match the UI delivery-unit buildMarker');
  });

  it('stamps the actual build ID while retaining the compiled compatibility tuple', () => {
    const original = artifact('octane');
    const stamped = stampUltramodernBuildArtifactIdentity(original, {
      buildMarker: 'actual-build',
      sourceRevision: 'actual-revision',
    });
    expect(stamped.surfaces.ui?.rendererIdentity.buildId).toBe('actual-build');
    expect(stamped.surfaces.ui?.rendererProfile).toEqual(
      original.surfaces.ui?.rendererProfile,
    );
    expect(original.surfaces.ui?.rendererIdentity.buildId).toBe(
      'checkout-build',
    );
    expect(validateUltramodernBuildArtifact(stamped).ok).toBe(true);
  });

  it('copies and freezes compiled profile input', () => {
    const input = profile('solid');
    const value = createUltramodernBuildArtifact(record, {
      ui: {
        identity: identity('solid'),
        profile: input,
        routerBindings: controlledRouterBindings('solid'),
      },
    });
    Object.assign(input.compiler, { version: '9.0.0' });
    expect(value.surfaces.ui?.rendererProfile.compiler.version).toBe(
      '2.0.0-rc.13',
    );
    expect(Object.isFrozen(value.surfaces.ui?.rendererProfile)).toBe(true);
    expect(Object.isFrozen(value.surfaces.ui?.rendererProfile.router)).toBe(
      true,
    );
  });
});

describe('immutable compiled renderer metadata', () => {
  it('asserts a parsed current artifact and reports strict reader failures', () => {
    const value: unknown = jsonCopy(artifact('solid'));
    assertUltramodernBuildArtifact(value);
    expect(value.surfaces.ui?.rendererIdentity.renderer).toBe('solid');
    expect(() =>
      assertUltramodernBuildArtifact({ ...value, schemaVersion: 1 }, 'remote'),
    ).toThrow('remote.schemaVersion: must be 2.');
  });
  it('freezes a parsed artifact profile when stamping compiled identity', () => {
    const parsed = jsonCopy(artifact('solid'));
    const stamped = stampUltramodernBuildArtifactIdentity(parsed, {
      buildMarker: 'compiled-build',
      sourceRevision: 'compiled-revision',
    });
    expect(Object.isFrozen(stamped.surfaces.ui?.rendererProfile.compiler)).toBe(
      true,
    );
    Object.assign(parsed.surfaces.ui!.rendererProfile.compiler, {
      version: '9.0.0',
    });
    expect(stamped.surfaces.ui?.rendererProfile.compiler.version).toBe(
      '2.0.0-rc.13',
    );
  });

  it('rejects explicitly missing UI metadata instead of producing headless output', () => {
    expect(() =>
      createUltramodernBuildArtifact(record, { ui: undefined }),
    ).toThrow('explicit identity and profile');
  });

  it.each([
    'rendererIdentity',
    'rendererProfile',
    'routerBindings',
  ] as const)('forbids %s on the delivery root', field => {
    const value = artifact('solid');
    expect(
      validateUltramodernBuildArtifact({
        ...value,
        deliveryUnit: {
          ...value.deliveryUnit,
          [field]: value.surfaces.ui?.[field],
        },
      }).ok,
    ).toBe(false);
  });
});

describe('renderer compatibility before remote loading', () => {
  it('accepts identical profiles independently of app and build identity', () => {
    const local = artifact('solid');
    const remote = createUltramodernBuildArtifact(
      { ...record, appId: 'cart', buildMarker: 'cart-build' },
      {
        ui: {
          identity: {
            ...identity('solid'),
            appId: 'cart',
            buildId: 'cart-build',
          },
          profile: profile('solid'),
          routerBindings: controlledRouterBindings('solid'),
        },
      },
    );
    expect(
      validateRendererProfileCompatibility(
        local.surfaces.ui?.rendererProfile,
        remote.surfaces.ui?.rendererProfile,
      ).ok,
    ).toBe(true);
  });

  it('rejects cross-renderer components before evaluating a remote', () => {
    expect(() =>
      assertRendererProfileCompatibility(profile('solid'), profile('octane')),
    ).toThrow('cross-renderer components are unsupported');
  });

  it.each([
    ['compiler', 'name'],
    ['compiler', 'version'],
    ['hydration', 'name'],
    ['hydration', 'version'],
    ['router', 'name'],
    ['router', 'version'],
    ['router', 'coreName'],
    ['router', 'coreVersion'],
  ])('rejects a different %s.%s compatibility field', (group, field) => {
    const changed = jsonCopy(profile('react'));
    const packageIdentity = changed[
      group as 'compiler' | 'hydration' | 'router'
    ] as unknown as Record<string, unknown>;
    packageIdentity[field] = field === 'name' ? 'different-package' : '9.0.0';
    expect(
      validateRendererProfileCompatibility(profile('react'), changed).errors,
    ).toContainEqual({
      path: `rendererProfile.${group}.${field}`,
      message: 'must match the consuming renderer profile.',
    });
  });

  it.each([
    '^2.0.0',
    '~2.0.0',
    'latest',
    'workspace:*',
    '',
    ' 2.0.0 ',
    '2',
    '2.0',
    '02.0.0',
    '2.0.0-01',
  ])('rejects a non-exact version %s', version => {
    const candidate = {
      ...profile('solid'),
      compiler: { name: 'compiler', version },
    };
    expect(validateRendererProfile(candidate).errors).toContainEqual({
      path: 'rendererProfile.compiler.version',
      message: 'must be an exact version.',
    });
  });

  it('requires router core evidence', () => {
    const candidate = jsonCopy(profile('solid'));
    delete (candidate.router as unknown as Record<string, unknown>).coreVersion;
    expect(validateRendererProfile(candidate).errors).toContainEqual({
      path: 'rendererProfile.router.coreVersion',
      message: 'must be an exact version.',
    });
  });

  it('requires the package that owns the router core', () => {
    const candidate = jsonCopy(profile('solid'));
    delete (candidate.router as unknown as Record<string, unknown>).coreName;
    expect(validateRendererProfile(candidate).errors).toContainEqual({
      path: 'rendererProfile.router.coreName',
      message: 'must be a non-empty trimmed string.',
    });
  });

  it('rejects unknown fields, missing identity, and unsupported protocol versions', () => {
    expect(
      validateRendererProfile({
        ...profile('solid'),
        buildId: 'not-compatibility',
      }).ok,
    ).toBe(false);
    expect(
      validateRendererIdentity({
        ...identity('solid'),
        legacyRenderer: 'solid',
      }).ok,
    ).toBe(false);
    expect(
      validateRendererIdentity({ ...identity('solid'), protocolVersion: 2 }).ok,
    ).toBe(false);
    expect(
      validateRendererProfileCompatibility(profile('solid'), undefined).ok,
    ).toBe(false);
    expect(
      validateRendererProfileCompatibility(profile('solid'), {
        ...profile('solid'),
        protocolVersion: 2,
      }).ok,
    ).toBe(false);
  });
});
