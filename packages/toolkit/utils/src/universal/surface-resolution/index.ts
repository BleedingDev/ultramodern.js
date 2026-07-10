export {
  createEnvStaticSurfaceResolutionProvider,
  DEFAULT_LOCAL_ENVIRONMENTS,
  ENV_STATIC_PROVIDER_NAME,
  type EnvRecord,
  type EnvStaticIdentityVerification,
  type EnvStaticMajorConfig,
  type EnvStaticProviderOptions,
  type EnvStaticSurfaceConfig,
  type EnvStaticSurfacePlatforms,
  type EnvStaticUnitConfig,
} from './env-static-provider';
export {
  formatSurfaceRef,
  type ParsedSurfaceRef,
  parseSurfaceRef,
  type SurfaceRefParseError,
  type SurfaceRefParseResult,
  validateSurfaceRef,
} from './surface-ref';
export type {
  CompatibilityStatus,
  CompatibilityVerdict,
  DiscoveryError,
  DiscoveryErrorCode,
  DiscoveryResult,
  EnvironmentId,
  ResolvedDeliveryUnit,
  ResolvedSurface,
  ResolvedSurfaceKind,
  ResolvedSurfaceLocation,
  ResolvedSurfaceLocationPlatform,
  SurfaceResolutionProvider,
} from './types';
export {
  createDiscoveryError,
  type ExpectedDeliveryUnitIdentity,
  matchDeliveryUnitIdentity,
  type ResolvedDeliveryUnitIssue,
  type ResolvedDeliveryUnitValidationResult,
  selectResolvedSurface,
  validateResolvedDeliveryUnit,
} from './validation';
