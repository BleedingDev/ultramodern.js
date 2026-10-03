import type { CLIOptions } from '@modern-js/plugin/cli';
import { observeUltramodernConfigLoad } from './config';
import {
  createConfigurationReadContextPlugin,
  type ObservedConfigSourceInputs,
} from './configuration-read-context';

/** Capture the native load and bind its original read context before setup. */
export function createNativeConfigLoad(): Pick<
  CLIOptions,
  'wrapConfigLoad' | 'internalPlugins'
> {
  let consumedSourceInputs: ObservedConfigSourceInputs | undefined;
  return {
    async wrapConfigLoad(load, context) {
      const observed = await observeUltramodernConfigLoad(context, load);
      consumedSourceInputs = observed.consumedSourceInputs;
      return observed.value;
    },
    internalPlugins: [
      createConfigurationReadContextPlugin(() => consumedSourceInputs),
    ],
  };
}
