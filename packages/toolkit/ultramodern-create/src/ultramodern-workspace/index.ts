export { addUltramodernShell, planUltramodernShell } from './add-shell';
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
export type { OverlayBaselineViolation } from './overlay-baseline-guard';
export {
  BASELINE_DEPENDENCY_PINS,
  OverlayBaselineRelaxationError,
} from './overlay-baseline-guard';
export { SHARED_ULTRAMODERN_WORKSPACE_PATCH_FILES } from './shared-patches';
export {
  createShellDescriptor,
  PRIMARY_SHELL_ID,
  resolveConfiguredAdditionalShells,
} from './shells';
export type {
  AddUltramodernShellOptions,
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
export { generateUltramodernWorkspace } from './write-workspace';
