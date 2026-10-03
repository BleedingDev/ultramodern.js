import type { ObservedConfigSourceInputs } from './config-evaluator/observed-inputs';
import type { ConfigSourceSnapshot } from './config-evaluator/source-snapshot';
import type { ConfigurationSourceNode } from './configuration-read-context';

declare const state: {
  readonly inputs: WeakMap<object, ObservedConfigSourceInputs>;
  readonly snapshots: WeakMap<ObservedConfigSourceInputs, ConfigSourceSnapshot>;
  readonly nodes: WeakMap<
    ObservedConfigSourceInputs,
    readonly ConfigurationSourceNode[]
  >;
};

export = state;
