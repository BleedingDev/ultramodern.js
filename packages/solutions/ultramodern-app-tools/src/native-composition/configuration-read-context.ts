import { createRequire } from 'node:module';
import type { Plugin } from '@modern-js/plugin/cli';
import type {
  ObservedConfigSourceInput,
  ObservedConfigSourceInputs,
} from './config-evaluator/observed-inputs';
import type { ConfigSourceSnapshot } from './config-evaluator/source-snapshot';

export type { ObservedConfigSourceInputs } from './config-evaluator/observed-inputs';
export type { ConfigSourceSnapshot } from './config-evaluator/source-snapshot';

type RendererGeneratedOutputValue =
  | null
  | boolean
  | number
  | string
  | readonly RendererGeneratedOutputValue[]
  | { readonly [key: string]: RendererGeneratedOutputValue };

export interface RendererGeneratedOutputMetadata {
  readonly device: string;
  readonly inode: string;
  readonly [key: string]: RendererGeneratedOutputValue;
}

export type RendererGeneratedOutputNode = {
  readonly path: { readonly lexical: string; readonly canonical: string };
} & (
  | { readonly kind: 'missing' }
  | {
      readonly kind: 'file';
      readonly byteDigest: string;
      readonly metadata: RendererGeneratedOutputMetadata;
    }
  | {
      readonly kind: 'directory';
      readonly entries: readonly {
        readonly name: string;
        readonly kind: 'file' | 'directory' | 'symlink';
      }[];
      readonly metadata: RendererGeneratedOutputMetadata;
    }
);

export type ConfigurationSourceNode = {
  readonly observation: ObservedConfigSourceInput;
  readonly node: RendererGeneratedOutputNode;
  readonly requiredAncestors?: readonly RendererGeneratedOutputNode[];
};

// One physical owner shares provenance across the native CJS and ESM modules.
// The public hook bus still owns each command's immutable read context.
const {
  inputs: configurationSourceInputs,
  snapshots: configurationSourceSnapshots,
  nodes: configurationSourceNodes,
}: typeof import('./configuration-read-context-state.cjs') = createRequire(
  import.meta.url,
)(
  process.env.MODERN_LIB_FORMAT === 'esm'
    ? '../../cjs/native-composition/configuration-read-context-state.cjs'
    : './configuration-read-context-state.cjs',
);

/** Internal capture handoff; this module is not a package public export. */
export function retainConfigurationSourceSnapshot(
  inputs: ObservedConfigSourceInputs,
  snapshot: ConfigSourceSnapshot,
  nodes: readonly ConfigurationSourceNode[],
): void {
  const previous = configurationSourceSnapshots.get(inputs);
  const previousNodes = configurationSourceNodes.get(inputs);
  if (previous && previous !== snapshot)
    throw new Error('The configuration read baseline already has an owner');
  if (previousNodes && previousNodes !== nodes)
    throw new Error('The configuration physical nodes already have an owner');
  Object.freeze(snapshot.sourceRoots);
  Object.freeze(snapshot.extraInputs);
  Object.freeze(snapshot.exclusions);
  for (const boundary of snapshot.coverage) Object.freeze(boundary);
  Object.freeze(snapshot.coverage);
  for (const state of snapshot.states) Object.freeze(state);
  Object.freeze(snapshot.states);
  Object.freeze(snapshot);
  configurationSourceSnapshots.set(inputs, snapshot);
  configurationSourceNodes.set(inputs, nodes);
}

export function getConfigurationSourceInputs(api: {
  getHooks(): object;
}): ObservedConfigSourceInputs | undefined {
  return configurationSourceInputs.get(api.getHooks());
}

/** The original pre-load baseline, selected by the exact bound read set. */
export function getConfigurationSourceSnapshot(api: {
  getHooks(): object;
}): ConfigSourceSnapshot | undefined {
  const inputs = getConfigurationSourceInputs(api);
  return inputs ? configurationSourceSnapshots.get(inputs) : undefined;
}

/** Original physical values for the actual captured reads, without live IO. */
export function getConfigurationSourceNodes(api: {
  getHooks(): object;
}): readonly ConfigurationSourceNode[] | undefined {
  const inputs = getConfigurationSourceInputs(api);
  return inputs ? configurationSourceNodes.get(inputs) : undefined;
}

export function createConfigurationReadContextPlugin(
  readInputs: () => ObservedConfigSourceInputs | undefined,
): Plugin<{ getHooks(): object }> {
  return {
    name: '@modern-js/ultramodern-configuration-read-context',
    setup(api) {
      const inputs = readInputs();
      if (!inputs)
        throw new Error(
          'The configuration read context requires a captured load',
        );
      if (
        !Object.isFrozen(inputs) ||
        !Object.isFrozen(inputs.observations) ||
        !inputs.observations.every(input => Object.isFrozen(input)) ||
        !Array.isArray(inputs.packageMetadata) ||
        !Object.isFrozen(inputs.packageMetadata) ||
        !inputs.packageMetadata.every(input => Object.isFrozen(input))
      )
        throw new Error(
          'The configuration read context requires immutable inputs',
        );
      const hooks = api.getHooks();
      const previous = configurationSourceInputs.get(hooks);
      if (previous && previous !== inputs)
        throw new Error('The configuration read context already has an owner');
      configurationSourceInputs.set(hooks, inputs);
    },
  };
}
