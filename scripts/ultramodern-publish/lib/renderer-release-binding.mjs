const releaseEnvelopeKind = 'ultramodern-target-microvertical-release-envelope';
const renderers = ['react', 'solid', 'octane'];
const sourceRevisionPattern = /^(?:[a-f\d]{40}|[a-f\d]{64})$/u;
const exactPackageVersion =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u;

function assertRecord(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

function assertExactKeys(value, expected, label) {
  assertRecord(value, label);
  if (Reflect.ownKeys(value).some(field => typeof field !== 'string'))
    throw new Error(`${label} contains an unsupported symbol field.`);
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (
    actual.length !== required.length ||
    actual.some((field, index) => field !== required[index])
  ) {
    throw new Error(`${label} must contain exactly ${required.join(', ')}.`);
  }
}

function assertString(value, label) {
  if (typeof value !== 'string' || !value || value.trim() !== value) {
    throw new Error(`${label} must be a non-empty trimmed string.`);
  }
  return value;
}

function assertRendererProtocol(value, label) {
  if (!renderers.includes(value.renderer)) {
    throw new Error(`${label}.renderer must be react, solid, or octane.`);
  }
  if (value.protocolVersion !== 1) {
    throw new Error(`${label}.protocolVersion must be 1.`);
  }
}

function rendererIdentity(value, label) {
  assertExactKeys(
    value,
    ['renderer', 'appId', 'entryName', 'protocolVersion', 'buildId'],
    label,
  );
  assertRendererProtocol(value, label);
  return {
    renderer: value.renderer,
    appId: assertString(value.appId, `${label}.appId`),
    entryName: assertString(value.entryName, `${label}.entryName`),
    protocolVersion: value.protocolVersion,
    buildId: assertString(value.buildId, `${label}.buildId`),
  };
}

function rendererPackage(
  value,
  label,
  { router = false, hydration = false } = {},
) {
  const fields = router
    ? ['name', 'version', 'coreName', 'coreVersion']
    : ['name', 'version'];
  assertExactKeys(value, fields, label);
  const result = { name: assertString(value.name, `${label}.name`) };
  if (router)
    result.coreName = assertString(value.coreName, `${label}.coreName`);
  for (const field of router ? ['version', 'coreVersion'] : ['version']) {
    const version = assertString(value[field], `${label}.${field}`);
    if (
      !exactPackageVersion.test(version) &&
      !(hydration && /^[1-9]\d*$/u.test(version))
    ) {
      throw new Error(`${label}.${field} must be an exact version.`);
    }
    result[field] = version;
  }
  return result;
}

function rendererProfile(value, label) {
  assertExactKeys(
    value,
    ['renderer', 'protocolVersion', 'compiler', 'hydration', 'router'],
    label,
  );
  assertRendererProtocol(value, label);
  return {
    renderer: value.renderer,
    protocolVersion: value.protocolVersion,
    compiler: rendererPackage(value.compiler, `${label}.compiler`),
    hydration: rendererPackage(value.hydration, `${label}.hydration`, {
      hydration: true,
    }),
    router: rendererPackage(value.router, `${label}.router`, { router: true }),
  };
}

function canonical(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map(field => `${JSON.stringify(field)}:${canonical(value[field])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function assertSame(value, expected, label) {
  if (canonical(value) !== canonical(expected)) {
    throw new Error(`${label} must match the release envelope.`);
  }
}

function routerBindings(value, entryName, renderer, label) {
  assertRecord(value, label);
  if (
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null
  )
    throw new Error(`${label} must be a plain object.`);
  if (!Object.hasOwn(value, entryName))
    throw new Error(
      `${label} must include the primary rendererIdentity.entryName.`,
    );
  const result = {};
  const frameworks = ['react-router', 'tanstack', 'solid', 'octane'];
  const provider = (input, location) => {
    assertRecord(input, location);
    if (
      Object.getPrototypeOf(input) !== Object.prototype &&
      Object.getPrototypeOf(input) !== null
    )
      throw new Error(`${location} must be a plain object.`);
    assertExactKeys(
      input,
      ['framework', 'name', 'version', 'coreName', 'coreVersion'],
      location,
    );
    if (!frameworks.includes(input.framework))
      throw new Error(`${location}.framework is invalid.`);
    if (
      !(renderer === 'react'
        ? ['react-router', 'tanstack'].includes(input.framework)
        : input.framework === renderer)
    )
      throw new Error(
        `${location}.framework must belong to the selected renderer.`,
      );
    const { framework, ...identity } = input;
    return {
      framework,
      ...rendererPackage(identity, location, { router: true }),
    };
  };
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || key === '__proto__')
      throw new Error(`${label} contains an invalid entry name.`);
    assertString(key, `${label} entry name`);
    const location = `${label}.${key}`;
    const binding = value[key];
    assertRecord(binding, location);
    if (
      Object.getPrototypeOf(binding) !== Object.prototype &&
      Object.getPrototypeOf(binding) !== null
    )
      throw new Error(`${location} must be a plain object.`);
    assertExactKeys(
      binding,
      ['owner', 'evidence', 'defaultProvider', 'providers'],
      location,
    );
    const owner = assertString(binding.owner, `${location}.owner`);
    if (
      !['owned-default', 'file-routes', 'provider-registry'].includes(
        binding.evidence,
      )
    )
      throw new Error(`${location}.evidence is invalid.`);
    const defaultProvider = provider(
      binding.defaultProvider,
      `${location}.defaultProvider`,
    );
    if (
      !Array.isArray(binding.providers) ||
      binding.providers.length < 1 ||
      binding.providers.length > frameworks.length
    )
      throw new Error(
        `${location}.providers must be a non-empty bounded array.`,
      );
    const providers = binding.providers.map((item, index) =>
      provider(item, `${location}.providers[${index}]`),
    );
    if (
      new Set(providers.map(item => item.framework)).size !== providers.length
    )
      throw new Error(`${location}.providers frameworks must be unique.`);
    if (!providers.some(item => canonical(item) === canonical(defaultProvider)))
      throw new Error(
        `${location}.defaultProvider must exactly match a registered provider.`,
      );
    if (binding.evidence === 'provider-registry') {
      if (defaultProvider.framework !== 'react-router')
        throw new Error(
          `${location}.defaultProvider.framework must be react-router for provider-registry evidence.`,
        );
    } else if (providers.length !== 1) {
      throw new Error(
        `${location}.providers must contain only the owned default provider.`,
      );
    }
    result[key] = {
      owner,
      evidence: binding.evidence,
      defaultProvider,
      providers,
    };
  }
  return result;
}

function rendererEvidence(
  identityValue,
  profileValue,
  bindingsValue,
  buildMarker,
  label,
) {
  const identity = rendererIdentity(identityValue, `${label}.rendererIdentity`);
  const profile = rendererProfile(profileValue, `${label}.rendererProfile`);
  if (identity.buildId !== buildMarker) {
    throw new Error(
      `${label}.rendererIdentity.buildId must match the release buildMarker.`,
    );
  }
  for (const field of ['renderer', 'protocolVersion']) {
    if (profile[field] !== identity[field]) {
      throw new Error(
        `${label}.rendererProfile.${field} must match rendererIdentity.`,
      );
    }
  }
  return {
    rendererIdentity: identity,
    rendererProfile: profile,
    routerBindings: routerBindings(
      bindingsValue,
      identity.entryName,
      identity.renderer,
      `${label}.routerBindings`,
    ),
  };
}

function assertReleaseEnvelopeRendererBinding(
  envelope,
  {
    label = 'release envelope',
    expectedAppId,
    expectedRendererIdentity,
    expectedRendererProfile,
  } = {},
) {
  assertRecord(envelope, label);
  if (envelope.schemaVersion !== 4 || envelope.kind !== releaseEnvelopeKind) {
    throw new Error(`${label} has an unsupported release envelope schema.`);
  }
  assertExactKeys(
    envelope,
    [
      'schemaVersion',
      'kind',
      'target',
      'identity',
      ...(Object.hasOwn(envelope, 'ui') ? ['ui'] : []),
      'artifacts',
      'surfaces',
      'envelopeDigest',
    ],
    label,
  );
  if (!['node', 'cloudflare'].includes(envelope.target)) {
    throw new Error(`${label}.target must be node or cloudflare.`);
  }
  assertExactKeys(
    envelope.identity,
    ['unitId', 'buildMarker', 'sourceRevision', 'releaseVersion'],
    `${label}.identity`,
  );
  for (const field of ['unitId', 'sourceRevision', 'releaseVersion']) {
    assertString(envelope.identity[field], `${label}.identity.${field}`);
  }
  if (!sourceRevisionPattern.test(envelope.identity.sourceRevision)) {
    throw new Error(
      `${label}.identity.sourceRevision must be an exact lowercase Git object ID.`,
    );
  }
  const buildMarker = assertString(
    envelope.identity.buildMarker,
    `${label}.identity.buildMarker`,
  );
  assertRecord(envelope.surfaces, `${label}.surfaces`);
  for (const field of ['uiClient', 'ssr']) {
    if (!Array.isArray(envelope.surfaces[field])) {
      throw new Error(`${label}.surfaces.${field} must be an array.`);
    }
  }
  const hasUi =
    envelope.surfaces.uiClient.length > 0 || envelope.surfaces.ssr.length > 0;
  if (!hasUi) {
    if (Object.hasOwn(envelope, 'ui')) {
      throw new Error(`${label}.ui is forbidden without a UI or SSR surface.`);
    }
    if (
      expectedRendererIdentity !== undefined ||
      expectedRendererProfile !== undefined
    ) {
      throw new Error(
        `${label} has no UI renderer to match the expected renderer.`,
      );
    }
    return undefined;
  }
  assertExactKeys(
    envelope.ui,
    ['rendererIdentity', 'rendererProfile', 'routerBindings'],
    `${label}.ui`,
  );
  const ui = rendererEvidence(
    envelope.ui.rendererIdentity,
    envelope.ui.rendererProfile,
    envelope.ui.routerBindings,
    buildMarker,
    `${label}.ui`,
  );
  if (
    expectedAppId !== undefined &&
    ui.rendererIdentity.appId !== expectedAppId
  ) {
    throw new Error(
      `${label}.ui.rendererIdentity.appId must match ${expectedAppId}.`,
    );
  }
  if (expectedRendererIdentity !== undefined) {
    assertSame(
      ui.rendererIdentity,
      rendererIdentity(expectedRendererIdentity, 'expectedRendererIdentity'),
      `${label}.ui.rendererIdentity`,
    );
  }
  if (expectedRendererProfile !== undefined) {
    assertSame(
      ui.rendererProfile,
      rendererProfile(expectedRendererProfile, 'expectedRendererProfile'),
      `${label}.ui.rendererProfile`,
    );
  }
  return ui;
}

function releaseEnvelopePayload(envelope) {
  return {
    schemaVersion: envelope.schemaVersion,
    kind: envelope.kind,
    target: envelope.target,
    identity: envelope.identity,
    ...(Object.hasOwn(envelope, 'ui') ? { ui: envelope.ui } : {}),
    artifacts: envelope.artifacts,
    surfaces: envelope.surfaces,
  };
}

function assertRendererReleaseArtifactBinding(
  envelope,
  artifact,
  { label = 'immutable build artifact', expectedAppId } = {},
) {
  const ui = assertReleaseEnvelopeRendererBinding(envelope, { expectedAppId });
  assertExactKeys(
    artifact,
    ['schemaVersion', 'kind', 'deliveryUnit', 'surfaces'],
    label,
  );
  if (
    artifact.schemaVersion !== 2 ||
    artifact.kind !== 'ultramodern-build-artifact'
  ) {
    throw new Error(
      `${label} has an unsupported immutable build artifact schema.`,
    );
  }
  const deliveryUnit = assertRecord(
    artifact.deliveryUnit,
    `${label}.deliveryUnit`,
  );
  assertExactKeys(
    artifact.surfaces,
    ['api', ...(ui ? ['ui'] : [])],
    `${label}.surfaces`,
  );
  const releaseFields = {
    unitId: envelope.identity.unitId,
    buildMarker: envelope.identity.buildMarker,
    build: envelope.identity.buildMarker,
    sourceRevision: envelope.identity.sourceRevision,
    version: envelope.identity.releaseVersion,
  };
  for (const [name, marker] of [
    ['deliveryUnit', deliveryUnit],
    [
      'surfaces.api',
      assertRecord(artifact.surfaces.api, `${label}.surfaces.api`),
    ],
    ...(ui
      ? [
          [
            'surfaces.ui',
            assertRecord(artifact.surfaces.ui, `${label}.surfaces.ui`),
          ],
        ]
      : []),
  ]) {
    for (const [field, expected] of Object.entries({
      schemaVersion: 1,
      kind: 'microvertical-delivery-unit',
      deployProfile: 'cloudflare-ssr-mf-effect-v1',
    })) {
      if (marker[field] !== expected) {
        throw new Error(
          `${label}.${name}.${field} must be ${JSON.stringify(expected)}.`,
        );
      }
    }
    for (const field of ['appId', 'packageName']) {
      assertString(marker[field], `${label}.${name}.${field}`);
      if (marker[field] !== deliveryUnit[field]) {
        throw new Error(
          `${label}.${name}.${field} must match deliveryUnit.${field}.`,
        );
      }
    }
    for (const [field, expected] of Object.entries(releaseFields)) {
      if (marker[field] !== expected) {
        throw new Error(
          `${label}.${name}.${field} must match the release envelope.`,
        );
      }
    }
    if (
      marker.appId !== deliveryUnit.appId ||
      (expectedAppId !== undefined && marker.appId !== expectedAppId)
    ) {
      throw new Error(`${label}.${name}.appId must match the release appId.`);
    }
    if (
      name.startsWith('surfaces.') &&
      marker.surface !== name.slice('surfaces.'.length)
    ) {
      throw new Error(
        `${label}.${name}.surface must match its artifact surface.`,
      );
    }
  }
  for (const field of [
    'rendererIdentity',
    'rendererProfile',
    'routerBindings',
  ]) {
    if (
      Object.hasOwn(deliveryUnit, field) ||
      Object.hasOwn(artifact.surfaces.api, field)
    ) {
      throw new Error(`${label}.${field} is only allowed on the UI surface.`);
    }
  }
  if (!ui) {
    return undefined;
  }
  const marker = assertRecord(artifact.surfaces.ui, `${label}.surfaces.ui`);
  const artifactUi = rendererEvidence(
    marker.rendererIdentity,
    marker.rendererProfile,
    marker.routerBindings,
    envelope.identity.buildMarker,
    `${label}.surfaces.ui`,
  );
  if (
    marker.appId !== artifactUi.rendererIdentity.appId ||
    deliveryUnit.appId !== artifactUi.rendererIdentity.appId
  ) {
    throw new Error(
      `${label}.surfaces.ui.rendererIdentity.appId must match the artifact appId.`,
    );
  }
  assertSame(artifactUi, ui, `${label}.surfaces.ui renderer evidence`);
  return artifactUi;
}

export {
  assertReleaseEnvelopeRendererBinding,
  assertRendererReleaseArtifactBinding,
  releaseEnvelopePayload,
};
