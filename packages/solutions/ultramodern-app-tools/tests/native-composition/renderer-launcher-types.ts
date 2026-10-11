import type {
  RunOptions as AppToolsRunOptions,
  createRunOptions as createAppToolsRunOptions,
} from '@modern-js/app-tools/cli/run';
import type {
  CreatedRunOptions,
  RunOptions,
} from '../../src/native-composition/cli';

type UpstreamRunOptions = Omit<AppToolsRunOptions, 'internalPlugins'>;
type UpstreamCreatedRunOptions = Awaited<
  ReturnType<typeof createAppToolsRunOptions>
>;

/** Static contract fixture, checked against the actual public producer types. */
export function inputs(
  upstream: UpstreamRunOptions,
  fork: RunOptions,
): [RunOptions, UpstreamRunOptions] {
  return [upstream, fork];
}

export function outputs(
  upstream: UpstreamCreatedRunOptions,
  fork: CreatedRunOptions,
): [CreatedRunOptions, UpstreamCreatedRunOptions] {
  const upstreamResult: void = upstream.handleSetupResult({}, {});
  const forkResult: void = fork.handleSetupResult({}, {});
  void upstreamResult;
  void forkResult;
  return [upstream, fork];
}
