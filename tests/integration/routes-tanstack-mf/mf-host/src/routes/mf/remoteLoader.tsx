// @effect-diagnostics asyncFunction:off newPromise:off strictBooleanExpressions:off
import { loadRemote } from '@module-federation/modern-js-v3/runtime';
import * as React from 'react';
import {
  classifyRemoteLoadFailure,
  type LoadRemoteModuleBaseOptions,
  loadRemoteModuleWithRetryBase,
  RemoteComponentContractError,
  RemoteLoadError,
  RemoteLoadTimeoutError,
  resolveRemoteComponentBase,
} from './remoteLoaderCore';

type RemoteModuleMap = {
  'remote/Widget': typeof import('remote/Widget');
  'remote/Mutator': typeof import('remote/Mutator');
  'remote2/Panel': typeof import('remote2/Panel');
};

type RemoteModuleKey = keyof RemoteModuleMap;

type LoadRemoteModuleOptions<TRemote extends RemoteModuleKey> = Omit<
  LoadRemoteModuleBaseOptions<RemoteModuleMap[TRemote]>,
  'loadRemoteImpl'
> & {
  loadRemoteImpl?: (remote: TRemote) => Promise<RemoteModuleMap[TRemote]>;
};

type LazyRemoteComponentOptions<
  TRemote extends RemoteModuleKey,
  TExport extends keyof RemoteModuleMap[TRemote],
> = LoadRemoteModuleOptions<TRemote> & {
  exportName?: TExport;
};

export {
  RemoteComponentContractError,
  RemoteLoadError,
  RemoteLoadTimeoutError,
};

export async function loadRemoteModuleWithRetry<
  TRemote extends RemoteModuleKey,
>(
  remote: TRemote,
  options: LoadRemoteModuleOptions<TRemote> = {},
): Promise<RemoteModuleMap[TRemote]> {
  const loadRemoteImpl =
    options.loadRemoteImpl ||
    ((target: TRemote) =>
      loadRemote(target) as Promise<RemoteModuleMap[TRemote]>);

  return loadRemoteModuleWithRetryBase(remote, {
    ...options,
    loadRemoteImpl: () => loadRemoteImpl(remote),
  });
}

export function resolveRemoteComponent<
  TRemote extends RemoteModuleKey,
  TExport extends keyof RemoteModuleMap[TRemote],
>(remote: TRemote, module: RemoteModuleMap[TRemote], exportName: TExport) {
  return resolveRemoteComponentBase(
    remote,
    module as unknown as Record<string, unknown>,
    String(exportName),
  ) as RemoteModuleMap[TRemote][TExport];
}

function getFailureInjectionOptions<TRemote extends RemoteModuleKey>(
  remote: TRemote,
): LoadRemoteModuleOptions<TRemote> {
  if (typeof window === 'undefined') {
    return {};
  }

  const params = new URLSearchParams(window.location.search);
  const mode = params.get('mfRemoteFailure');
  const target = params.get('mfRemoteTarget');
  if (!mode || (target && target !== remote)) {
    return {};
  }

  if (mode === 'timeout') {
    return {
      timeoutMs: 30,
      retries: 0,
      loadRemoteImpl: () =>
        new Promise<RemoteModuleMap[TRemote]>(() => {
          // Keep pending to trigger timeout branch deterministically.
        }),
    };
  }

  if (mode === 'network') {
    return {
      retries: 0,
      loadRemoteImpl: async () => {
        throw new Error('network failure injection');
      },
    };
  }

  if (mode === 'contract') {
    return {
      retries: 0,
      loadRemoteImpl: async () =>
        ({
          default: {
            unexpected: true,
          },
        }) as unknown as RemoteModuleMap[TRemote],
    };
  }

  if (mode === 'version-skew') {
    return {
      retries: 0,
      loadRemoteImpl: async () => {
        throw new Error(
          'version skew: @tanstack/react-router requiredVersion mismatch',
        );
      },
    };
  }

  return {};
}

export function lazyRemoteComponent<
  TRemote extends RemoteModuleKey,
  TExport extends keyof RemoteModuleMap[TRemote] = 'default',
>(remote: TRemote, options: LazyRemoteComponentOptions<TRemote, TExport> = {}) {
  const { exportName = 'default' as TExport, ...loadOptions } = options;
  return React.lazy(async () => {
    const module = await loadRemoteModuleWithRetry(remote, {
      ...loadOptions,
      ...getFailureInjectionOptions(remote),
    });
    const component = resolveRemoteComponent(
      remote,
      module,
      exportName,
    ) as React.ComponentType<any>;
    return {
      default: component,
    };
  });
}

type RemoteErrorBoundaryProps = {
  fallbackId: string;
  children: React.ReactNode;
};

type RemoteErrorBoundaryState = {
  error: Error | null;
};

export class RemoteErrorBoundary extends React.Component<
  RemoteErrorBoundaryProps,
  RemoteErrorBoundaryState
> {
  state: RemoteErrorBoundaryState = {
    error: null,
  };

  static getDerivedStateFromError(error: Error): RemoteErrorBoundaryState {
    return {
      error,
    };
  }

  render() {
    if (this.state.error) {
      const classification = classifyRemoteLoadFailure(this.state.error);
      return (
        <div
          id={this.props.fallbackId}
          data-mf-fallback-contract="typed-ssr-fallback-client-hydration"
          data-mf-fallback-classification={classification}
          data-mf-telemetry-event="mf.client.remote.fallback"
        >
          remote-load-error:{this.state.error.name}
        </div>
      );
    }

    return this.props.children;
  }
}
