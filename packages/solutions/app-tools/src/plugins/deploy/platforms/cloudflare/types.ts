import type { CreatePreset } from '../platform';

type CloudflarePresetOptions = Parameters<CreatePreset>[0];

export type CloudflareAppContext = CloudflarePresetOptions['appContext'];
export type CloudflareModernConfig = CloudflarePresetOptions['modernConfig'];
