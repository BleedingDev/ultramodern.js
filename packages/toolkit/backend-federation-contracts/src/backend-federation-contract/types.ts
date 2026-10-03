import type {
  DELIVERY_UNIT_DEPLOY_PROFILE,
  DELIVERY_UNIT_KIND,
  DELIVERY_UNIT_SCHEMA_VERSION,
  ULTRAMODERN_BUILD_ARTIFACT_SCHEMA_VERSION,
} from './constants';
import type { RendererIdentity, RendererProfile } from './renderer-profile';
import type { RendererRouterBindings } from './renderer-router-bindings';

export type DeliveryUnitIdentity = {
  unitId: string;
  buildMarker: string;
  sourceRevision: string;
};

export type DeliveryUnitRecord = DeliveryUnitIdentity & {
  schemaVersion: typeof DELIVERY_UNIT_SCHEMA_VERSION;
  kind: typeof DELIVERY_UNIT_KIND;
  appId: string;
  packageName: string;
  version: string;
  deployProfile: typeof DELIVERY_UNIT_DEPLOY_PROFILE;
};

export type DeliveryUnitContractBlock = Omit<
  DeliveryUnitRecord,
  'appId' | 'deployProfile'
>;

export type UltramodernBuildDeliveryUnit = DeliveryUnitRecord & {
  build: string;
};

export type UltramodernBuildUiSurface = UltramodernBuildDeliveryUnit & {
  surface: 'ui';
  rendererIdentity: RendererIdentity;
  rendererProfile: RendererProfile;
  routerBindings: RendererRouterBindings;
};

export type UltramodernBuildApiSurface = UltramodernBuildDeliveryUnit & {
  surface: 'api';
};

export type UltramodernBuildSurface =
  | UltramodernBuildUiSurface
  | UltramodernBuildApiSurface;

export type CreateUltramodernBuildArtifactOptions = {
  ui?: {
    identity: RendererIdentity;
    profile: RendererProfile;
    routerBindings: RendererRouterBindings;
  };
};

export type UltramodernBuildArtifact = {
  schemaVersion: typeof ULTRAMODERN_BUILD_ARTIFACT_SCHEMA_VERSION;
  kind: 'ultramodern-build-artifact';
  deliveryUnit: UltramodernBuildDeliveryUnit;
  surfaces: {
    ui?: UltramodernBuildUiSurface;
    api: UltramodernBuildApiSurface;
  };
};

export type BackendFederationContractValidationError = {
  path: string;
  message: string;
};

export type BackendFederationContractValidationResult = {
  ok: boolean;
  errors: BackendFederationContractValidationError[];
};

export type ValidateDeliveryUnitIdentityOptions = {
  path?: string;
  allowBuildAlias?: boolean;
};

export type ValidateBackendFederationMetadataOptions = {
  path?: string;
  expectedContractVersion?: string | false;
  expectedNodeAdapterVersion?: string | false;
  validateDeliveryUnit?: boolean;
  requireEffectExpose?: boolean;
  requireEffectRuntime?: boolean;
  requireVersionFields?: boolean;
};

export type ValidateBackendFederationManifestOptions =
  ValidateBackendFederationMetadataOptions & {
    requireBackendFederation?: boolean;
  };
