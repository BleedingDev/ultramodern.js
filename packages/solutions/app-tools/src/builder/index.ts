export async function createBuilderGenerator() {
  const { createRspackBuilderForModern } = await import(
    './builder-rspack/index.js'
  );
  return createRspackBuilderForModern;
}

export { parseRspackConfig } from '@modern-js/builder';
export { getBundleEntry } from '../plugins/analyze/getBundleEntry';

export {
  builderPluginAdapterBasic,
  builderPluginAdapterHooks,
} from './shared/builderPlugins';
