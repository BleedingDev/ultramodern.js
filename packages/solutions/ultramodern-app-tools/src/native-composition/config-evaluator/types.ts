import type { RendererRouterBindings } from '@modern-js/backend-federation-contracts';
import type { Renderer } from '@modern-js/renderer-core';
import type { ObservedConfigSourceInputs } from './observed-inputs';
import type { ConfigSourceSnapshot } from './source-snapshot';

export interface ConfigEvaluatorResult {
  renderer: Renderer;
  entries: { entryName: string; isMainEntry: boolean }[];
  primaryEntryName: string;
  routerBindings: RendererRouterBindings;
  consumedSourceInputs: ObservedConfigSourceInputs;
}

export interface ConfigEvaluatorRequest {
  kind: 'evaluate';
  options: {
    appDirectory: string;
    configFile?: string;
    env: string;
    command: string;
    sourceRoots: string[];
    dependencyRoots: string[];
    sourceSnapshot: ConfigSourceSnapshot;
  };
}

export type ConfigEvaluatorMessage =
  | { kind: 'result'; result: ConfigEvaluatorResult }
  | {
      kind: 'error';
      error: { name: string; message: string; stack?: string; code?: string };
    };
