export const MICROVERTICAL_RELEASE_ENVELOPE_SCHEMA_VERSION =
  /** @type {const} */ (5);

export const MICROVERTICAL_RELEASE_ENVELOPE_KIND = /** @type {const} */ (
  'ultramodern-target-microvertical-release-envelope'
);

export const SHELL_RELEASE_ENVELOPE_KIND = /** @type {const} */ (
  'ultramodern-target-shell-release-envelope'
);

/**
 * @param {import('./types.js').ReleaseEnvelope} envelope
 * @returns {import('./types.js').ReleaseEnvelopePayload}
 */
export const releaseEnvelopePayload = envelope => {
  const payload = {
    schemaVersion: envelope.schemaVersion,
    target: envelope.target,
    identity: envelope.identity,
    ...(envelope.ui ? { ui: envelope.ui } : {}),
    artifacts: envelope.artifacts,
  };
  if (envelope.kind === SHELL_RELEASE_ENVELOPE_KIND) {
    return { ...payload, kind: envelope.kind, surfaces: envelope.surfaces };
  }
  return { ...payload, kind: envelope.kind, surfaces: envelope.surfaces };
};
