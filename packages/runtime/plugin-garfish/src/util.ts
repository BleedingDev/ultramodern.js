/**
 * Tips: this package will be bundled and run in the browser.
 * Do not import from `@modern-js/utils` here.
 */
import createDebug from 'debug';
import type { ModuleInfo } from './runtime';

export const logger = createDebug('modern-js:plugin-garfish');

export const SUBMODULE_APP_COMPONENT_KEY = 'SubModuleComponent';

export function generateSubAppContainerKey(moduleInfo?: ModuleInfo) {
  return moduleInfo
    ? `modern_sub_app_container_${decodeURIComponent(moduleInfo?.name)}`
    : 'modern_sub_app_container';
}
