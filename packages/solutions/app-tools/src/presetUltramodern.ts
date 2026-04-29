import {
  type AppBaselineOptions,
  createAppBaselineConfig,
  withAppBaseline,
} from './baseline';
import type { AppUserConfig } from './types';

export interface PresetUltramodernOptions extends AppBaselineOptions {}

export const createPresetUltramodernConfig = (
  options: PresetUltramodernOptions = {},
): AppUserConfig => createAppBaselineConfig(options);

export const presetUltramodern = (
  config: AppUserConfig,
  options: PresetUltramodernOptions = {},
): AppUserConfig => withAppBaseline(config, options);
