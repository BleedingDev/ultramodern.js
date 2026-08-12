export { addUltramodernVertical } from './add-vertical/execute';
export { planUltramodernVertical } from './add-vertical/plan';
export type { AddUltramodernVerticalPreflight } from './add-vertical/preflight';
export { prepareAddUltramodernVertical } from './add-vertical/preflight';
export {
  rewriteShellAppFiles,
  updateRootWorkspaceScripts,
} from './add-vertical/shell-files';
export {
  ownershipEntry,
  verticalsFromTopology,
  verticalTopologyEntry,
} from './add-vertical/topology';
export {
  assertCanCreate,
  assertValidVerticalName,
  existingBridgeConfig,
  existingPackageSource,
  existingTailwindEnabled,
  nextAvailablePort,
} from './add-vertical/workspace-state';
