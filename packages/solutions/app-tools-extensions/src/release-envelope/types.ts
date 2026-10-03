import type {
  RendererIdentity,
  RendererProfile,
  RendererRouterBindings,
} from '@modern-js/backend-federation-contracts';

export const MICROVERTICAL_RELEASE_ENVELOPE_SCHEMA_VERSION = 4 as const;

export const MICROVERTICAL_RELEASE_ENVELOPE_KIND =
  'ultramodern-target-microvertical-release-envelope' as const;

export const SHELL_RELEASE_ENVELOPE_KIND =
  'ultramodern-target-shell-release-envelope' as const;

export type ReleaseEnvelopeKind =
  | typeof MICROVERTICAL_RELEASE_ENVELOPE_KIND
  | typeof SHELL_RELEASE_ENVELOPE_KIND;

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

export type MicroVerticalReleaseFileArtifact =
  MicroVerticalReleaseArtifactInput & {
    kind: 'file';
    byteLength: number;
    sha256: string;
  };

export type MicroVerticalReleaseSymbolicLinkArtifact =
  MicroVerticalReleaseArtifactInput & {
    kind: 'symbolic-link';
    linkTarget: string;
    targetKind: 'directory' | 'file';
    targetLogicalPath: string;
  };

export type MicroVerticalReleaseArtifact =
  | MicroVerticalReleaseFileArtifact
  | MicroVerticalReleaseSymbolicLinkArtifact;

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

export type MicroVerticalReleaseUi = {
  rendererIdentity: RendererIdentity;
  rendererProfile: RendererProfile;
  routerBindings: RendererRouterBindings;
};

export type MicroVerticalReleaseEnvelopePayload = {
  schemaVersion: typeof MICROVERTICAL_RELEASE_ENVELOPE_SCHEMA_VERSION;
  kind: typeof MICROVERTICAL_RELEASE_ENVELOPE_KIND;
  target: MicroVerticalReleaseTarget;
  identity: MicroVerticalReleaseIdentity;
  ui?: MicroVerticalReleaseUi;
  artifacts: MicroVerticalReleaseArtifact[];
  surfaces: MicroVerticalReleaseSurfaces;
};

export type MicroVerticalReleaseEnvelope =
  MicroVerticalReleaseEnvelopePayload & {
    envelopeDigest: string;
  };

export type ShellReleaseEnvelopePayload = {
  schemaVersion: typeof MICROVERTICAL_RELEASE_ENVELOPE_SCHEMA_VERSION;
  kind: typeof SHELL_RELEASE_ENVELOPE_KIND;
  target: MicroVerticalReleaseTarget;
  identity: MicroVerticalReleaseIdentity;
  artifacts: MicroVerticalReleaseArtifact[];
  surfaces: ShellReleaseSurfaces;
};

export type ShellReleaseEnvelope = ShellReleaseEnvelopePayload & {
  envelopeDigest: string;
};

export type ReleaseEnvelopePayload =
  | MicroVerticalReleaseEnvelopePayload
  | ShellReleaseEnvelopePayload;

export type ReleaseEnvelope =
  | MicroVerticalReleaseEnvelope
  | ShellReleaseEnvelope;

export type CreateMicroVerticalReleaseEnvelopeInput = {
  artifactRoot: string;
  target: MicroVerticalReleaseTarget;
  identity: MicroVerticalReleaseIdentity;
  ui?: MicroVerticalReleaseUi;
  artifacts: MicroVerticalReleaseArtifactInput[];
} & (
  | {
      kind?: typeof MICROVERTICAL_RELEASE_ENVELOPE_KIND;
      surfaces: MicroVerticalReleaseSurfaces;
    }
  | {
      kind: typeof SHELL_RELEASE_ENVELOPE_KIND;
      surfaces: ShellReleaseSurfaces;
    }
);

export type VerifyMicroVerticalReleaseEnvelopeOptions = {
  artifactRoot: string;
  logicalPathForArtifact?: (artifact: MicroVerticalReleaseArtifact) => string;
  expectedTarget?: MicroVerticalReleaseTarget;
  expectedRendererIdentity?: RendererIdentity;
  expectedRendererProfile?: RendererProfile;
};
