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
  VerticalApiProtocol,
  VerticalPreset,
} from './types';
export { generateUltramodernWorkspace } from './write-workspace';
