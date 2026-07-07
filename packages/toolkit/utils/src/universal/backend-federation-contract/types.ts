import type {
  DELIVERY_UNIT_DEPLOY_PROFILE,
  DELIVERY_UNIT_KIND,
  DELIVERY_UNIT_SCHEMA_VERSION,
} from './constants';

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

export type UltramodernBuildSurface =
  | (UltramodernBuildDeliveryUnit & { surface: 'ui' })
  | (UltramodernBuildDeliveryUnit & { surface: 'api' });

export type UltramodernBuildArtifact = {
  schemaVersion: typeof DELIVERY_UNIT_SCHEMA_VERSION;
  kind: 'ultramodern-build-artifact';
  deliveryUnit: UltramodernBuildDeliveryUnit;
  surfaces: {
    ui: UltramodernBuildDeliveryUnit & { surface: 'ui' };
    api: UltramodernBuildDeliveryUnit & { surface: 'api' };
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
