export const BACKEND_FEDERATION_EFFECT_EXPOSE = './effect-api';

export const BACKEND_FEDERATION_MANIFEST_FILE = 'backend-mf-manifest.json';

export const BACKEND_FEDERATION_REMOTE_ENTRY_FILE = 'backendRemoteEntry.cjs';

export const BACKEND_FEDERATION_CONTRACT_VERSION =
  'microvertical-server-effect-v1';

export const BACKEND_FEDERATION_NODE_ADAPTER_VERSION = 'backend-mf-effect-v1';

export const DELIVERY_UNIT_SCHEMA_VERSION = 1;

export const DELIVERY_UNIT_KIND = 'microvertical-delivery-unit';

export const DELIVERY_UNIT_DEPLOY_PROFILE = 'cloudflare-ssr-mf-effect-v1';

export const DELIVERY_UNIT_IDENTITY_FIELDS = [
  'unitId',
  'buildMarker',
  'sourceRevision',
] as const;

export type DeliveryUnitIdentityField =
  (typeof DELIVERY_UNIT_IDENTITY_FIELDS)[number];

export const ULTRAMODERN_BUILD_ARTIFACT_FILE = 'ultramodern-build.json';

export const ULTRAMODERN_BUILD_ARTIFACT_PATH = `shared/${ULTRAMODERN_BUILD_ARTIFACT_FILE}`;

export const ULTRAMODERN_BUILD_MODULE_FILE = 'ultramodern-build.ts';

export const ULTRAMODERN_BUILD_MODULE_PATH = `shared/${ULTRAMODERN_BUILD_MODULE_FILE}`;
