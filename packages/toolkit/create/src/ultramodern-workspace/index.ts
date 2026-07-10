export {
  addUltramodernVertical,
  planUltramodernVertical,
} from './add-vertical';
export type {
  UltramodernBridgeConfig,
  UltramodernBridgeConfigInput,
  UltramodernBridgeGate,
  UltramodernBridgeGateInput,
  UltramodernBridgeLockfilePolicy,
  UltramodernBridgeTestAlias,
  UltramodernBridgeWorkspacePackage,
  UltramodernBridgeWorkspacePackageInput,
  UltramodernEnabledBridgeConfigInput,
} from './bridge-config';
export { normalizeUltramodernBridgeConfig } from './bridge-config';
export {
  BASELINE_DEPENDENCY_PINS,
  OverlayBaselineRelaxationError,
} from './overlay-baseline-guard';
export type { OverlayBaselineViolation } from './overlay-baseline-guard';
export { SHARED_ULTRAMODERN_WORKSPACE_PATCH_FILES } from './shared-patches';
export type {
  AddUltramodernVerticalOptions,
  UltramodernCodeSmithOverlay,
  UltramodernCodeSmithOverlayRuntimeConfig,
  UltramodernGeneratedAppDescriptor,
  UltramodernGeneratedContractChange,
  UltramodernGenerationOperation,
  UltramodernGenerationResult,
  UltramodernGenerationWarning,
  UltramodernJsonMutation,
  UltramodernShellDependencyChange,
  UltramodernVerticalPlan,
  UltramodernWorkspaceOptions,
} from './types';
export { ultramodernWorkspaceVersions } from './versions';
export { generateUltramodernWorkspace } from './write-workspace';
