export type { ModuleFederationConfigInspection } from '@modern-js/app-tools-extensions/module-federation-config';
export {
  inspectModuleFederationConfigSource,
  readModuleFederationExposePaths,
} from '@modern-js/app-tools-extensions/module-federation-config';
export { discoverModuleFederationConfigs } from './mf-validation/discovery';
export type {
  ModuleFederationDiscoveredConfig,
  ModuleFederationValidationOptions,
  ModuleFederationValidationResult,
  ModuleFederationValidationTarget,
} from './mf-validation/types';
export { validateModuleFederationTypes } from './mf-validation/validate';
