import type { AppUserConfig } from './types';
import {
  createAppBaselineConfig,
  type AppBaselineOptions,
  withAppBaseline,
} from './baseline';

export interface PresetUltramodernOptions extends AppBaselineOptions {}

export const createPresetUltramodernConfig = (
  options: PresetUltramodernOptions = {},
): AppUserConfig => createAppBaselineConfig(options);

export const presetUltramodern = (
  config: AppUserConfig,
  options: PresetUltramodernOptions = {},
): AppUserConfig => withAppBaseline(config, options);
