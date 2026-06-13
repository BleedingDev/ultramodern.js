// @effect-diagnostics asyncFunction:off newPromise:off strictBooleanExpressions:off

import {
  createModuleFederationFallbackTelemetry,
  emitModuleFederationFallbackTelemetry,
  type ModuleFederationFallbackTelemetryPayload,
  toModuleFederationFallbackAttributes,
} from '@modern-js/runtime/module-federation';
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
  remote: RemoteModuleKey;
  children: React.ReactNode;
};

type RemoteErrorBoundaryState = {
  error: Error | null;
  telemetry: ModuleFederationFallbackTelemetryPayload | null;
};

const CLIENT_REMOTE_FALLBACK_EVENT = 'mf.client.remote.fallback';

export class RemoteErrorBoundary extends React.Component<
  RemoteErrorBoundaryProps,
  RemoteErrorBoundaryState
> {
  state: RemoteErrorBoundaryState = {
    error: null,
    telemetry: null,
  };

  static getDerivedStateFromError(
    error: Error,
  ): Partial<RemoteErrorBoundaryState> {
    return {
      error,
    };
  }

  componentDidCatch(error: Error) {
    const classification = classifyRemoteLoadFailure(error);
    const telemetry = createModuleFederationFallbackTelemetry({
      appName: 'routes-tanstack-mf-host',
      classification,
      entry: typeof window === 'undefined' ? undefined : window.location.href,
      error,
      eventName: CLIENT_REMOTE_FALLBACK_EVENT,
      exportName: 'default',
      phase: 'load',
      remote: this.props.remote,
    });

    this.setState({ telemetry });
    void emitModuleFederationFallbackTelemetry({
      appName: telemetry.appName,
      classification,
      entry: telemetry.entry,
      error,
      eventName: telemetry.eventName,
      exportName: 'default',
      metadata: telemetry.metadata,
      phase: telemetry.phase,
      remote: this.props.remote,
      status: 'degraded',
    });
  }

  render() {
    if (this.state.error) {
      const classification = classifyRemoteLoadFailure(this.state.error);
      const telemetry =
        this.state.telemetry ??
        createModuleFederationFallbackTelemetry({
          appName: 'routes-tanstack-mf-host',
          classification,
          error: this.state.error,
          eventName: CLIENT_REMOTE_FALLBACK_EVENT,
          exportName: 'default',
          phase: 'load',
          remote: this.props.remote,
        });
      return (
        <div
          id={this.props.fallbackId}
          {...toModuleFederationFallbackAttributes(telemetry)}
          data-mf-fallback-contract="typed-ssr-fallback-client-hydration"
        >
          remote-load-error:{this.state.error.name}
        </div>
      );
    }

    return this.props.children;
  }
}
