import {
  createPresetUltramodernConfig,
  type PresetUltramodernOptions,
  presetUltramodern,
} from './presetUltramodern';

/**
 * @deprecated Use `PresetUltramodernOptions` from `@modern-js/app-tools`
 * instead. This alias will be removed in a future release.
 */
export type AppBaselineOptions = PresetUltramodernOptions;

/**
 * @deprecated Use `createPresetUltramodernConfig` from `@modern-js/app-tools`
 * instead. This alias will be removed in a future release.
 */
export const createAppBaselineConfig = createPresetUltramodernConfig;

/**
 * @deprecated Use `presetUltramodern` from `@modern-js/app-tools` instead.
 * This alias will be removed in a future release.
 */
export const withAppBaseline = presetUltramodern;
