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
