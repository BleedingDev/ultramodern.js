export const MICROVERTICAL_RELEASE_ENVELOPE_SCHEMA_VERSION = 2 as const;

export const MICROVERTICAL_RELEASE_ENVELOPE_KIND =
  'ultramodern-target-microvertical-release-envelope' as const;

export const MICROVERTICAL_RELEASE_TARGETS = ['node', 'cloudflare'] as const;

export type MicroVerticalReleaseTarget =
  (typeof MICROVERTICAL_RELEASE_TARGETS)[number];

export type MicroVerticalReleaseIdentity = {
  unitId: string;
  buildMarker: string;
  sourceRevision: string;
  releaseVersion: string;
};

export type MicroVerticalReleaseArtifactInput = {
  logicalPath: string;
  runtime: string;
};

export type MicroVerticalReleaseArtifact = MicroVerticalReleaseArtifactInput & {
  byteLength: number;
  sha256: string;
};

export type MicroVerticalReleaseArtifactInputs = {
  artifacts: MicroVerticalReleaseArtifactInput[];
  surfaces: MicroVerticalReleaseSurfaces;
};

export type MicroVerticalReleaseSurfaces = {
  uiClient: string[];
  ssr: string[];
  apiBackend: string[];
  backendFederation: {
    manifest: string;
    container: string;
  };
};

export type MicroVerticalReleaseEnvelopePayload = {
  schemaVersion: typeof MICROVERTICAL_RELEASE_ENVELOPE_SCHEMA_VERSION;
  kind: typeof MICROVERTICAL_RELEASE_ENVELOPE_KIND;
  target: MicroVerticalReleaseTarget;
  identity: MicroVerticalReleaseIdentity;
  artifacts: MicroVerticalReleaseArtifact[];
  surfaces: MicroVerticalReleaseSurfaces;
};

export type MicroVerticalReleaseEnvelope =
  MicroVerticalReleaseEnvelopePayload & {
    envelopeDigest: string;
  };

export type CreateMicroVerticalReleaseEnvelopeInput = {
  artifactRoot: string;
  target: MicroVerticalReleaseTarget;
  identity: MicroVerticalReleaseIdentity;
  artifacts: MicroVerticalReleaseArtifactInput[];
  surfaces: MicroVerticalReleaseSurfaces;
};

export type VerifyMicroVerticalReleaseEnvelopeOptions = {
  artifactRoot: string;
  logicalPathForArtifact?: (artifact: MicroVerticalReleaseArtifact) => string;
  expectedTarget?: MicroVerticalReleaseTarget;
};
