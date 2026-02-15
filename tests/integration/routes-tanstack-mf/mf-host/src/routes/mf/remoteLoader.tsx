import { loadRemote } from '@module-federation/modern-js-v3/runtime';
import * as React from 'react';

type RemoteModuleMap = {
  'remote/Widget': typeof import('remote/Widget');
  'remote/Mutator': typeof import('remote/Mutator');
  'remote2/Panel': typeof import('remote2/Panel');
};

type RemoteModuleKey = keyof RemoteModuleMap;

type LoadRemoteModuleOptions = {
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
};

type LazyRemoteComponentOptions<
  TRemote extends RemoteModuleKey,
  TExport extends keyof RemoteModuleMap[TRemote],
> = LoadRemoteModuleOptions & {
  exportName?: TExport;
};

const DEFAULT_REMOTE_TIMEOUT_MS = 4000;
const DEFAULT_REMOTE_RETRIES = 1;
const DEFAULT_REMOTE_RETRY_DELAY_MS = 200;

export class RemoteLoadTimeoutError extends Error {
  constructor(remote: string, timeoutMs: number) {
    super(`Loading remote "${remote}" timed out after ${timeoutMs}ms`);
    this.name = 'RemoteLoadTimeoutError';
  }
}

export class RemoteLoadError extends Error {
  readonly remote: string;
  readonly attempts: number;
  readonly causeError: Error;

  constructor(remote: string, attempts: number, causeError: Error) {
    super(
      `Unable to load remote "${remote}" after ${attempts} attempt${attempts > 1 ? 's' : ''}: ${causeError.message}`,
    );
    this.name = 'RemoteLoadError';
    this.remote = remote;
    this.attempts = attempts;
    this.causeError = causeError;
  }
}

export class RemoteComponentContractError extends Error {
  constructor(remote: string, exportName: string) {
    super(
      `Remote "${remote}" export "${exportName}" is not a valid React component`,
    );
    this.name = 'RemoteComponentContractError';
  }
}

function wait(ms: number) {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

function toError(error: unknown) {
  if (error instanceof Error) {
    return error;
  }
  return new Error(
    typeof error === 'string' ? error : 'Unknown remote load error',
  );
}

function withTimeout<T>(
  promise: Promise<T>,
  remote: string,
  timeoutMs: number,
) {
  return new Promise<T>((resolve, reject) => {
    const timeoutHandle = setTimeout(() => {
      reject(new RemoteLoadTimeoutError(remote, timeoutMs));
    }, timeoutMs);

    promise.then(
      value => {
        clearTimeout(timeoutHandle);
        resolve(value);
      },
      error => {
        clearTimeout(timeoutHandle);
        reject(error);
      },
    );
  });
}

function isRetryableRemoteError(error: Error) {
  if (error instanceof RemoteLoadTimeoutError) {
    return true;
  }
  return /network|fetch|script|timeout|chunk|loading/i.test(error.message);
}

function isComponentType(
  value: unknown,
): value is React.ComponentType<Record<string, never>> {
  if (typeof value === 'function') {
    return true;
  }
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  return '$$typeof' in value;
}

async function loadRemoteModuleWithRetry<TRemote extends RemoteModuleKey>(
  remote: TRemote,
  {
    retries = DEFAULT_REMOTE_RETRIES,
    timeoutMs = DEFAULT_REMOTE_TIMEOUT_MS,
    retryDelayMs = DEFAULT_REMOTE_RETRY_DELAY_MS,
  }: LoadRemoteModuleOptions = {},
): Promise<RemoteModuleMap[TRemote]> {
  const attempts = retries + 1;
  let lastError: Error = new Error(`Unknown remote load error for "${remote}"`);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const module = await withTimeout(loadRemote(remote), remote, timeoutMs);
      return module as RemoteModuleMap[TRemote];
    } catch (error) {
      lastError = toError(error);
      const canRetry = attempt < attempts && isRetryableRemoteError(lastError);
      if (!canRetry) {
        break;
      }
      await wait(retryDelayMs * attempt);
    }
  }

  throw new RemoteLoadError(remote, attempts, lastError);
}

function resolveRemoteComponent<
  TRemote extends RemoteModuleKey,
  TExport extends keyof RemoteModuleMap[TRemote],
>(remote: TRemote, module: RemoteModuleMap[TRemote], exportName: TExport) {
  const component = module[exportName];
  if (!isComponentType(component)) {
    throw new RemoteComponentContractError(remote, String(exportName));
  }
  return component;
}

export function lazyRemoteComponent<
  TRemote extends RemoteModuleKey,
  TExport extends keyof RemoteModuleMap[TRemote] = 'default',
>(remote: TRemote, options: LazyRemoteComponentOptions<TRemote, TExport> = {}) {
  const { exportName = 'default' as TExport, ...loadOptions } = options;
  return React.lazy(async () => {
    const module = await loadRemoteModuleWithRetry(remote, loadOptions);
    return {
      default: resolveRemoteComponent(remote, module, exportName),
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
      return (
        <div id={this.props.fallbackId}>
          remote-load-error:{this.state.error.name}
        </div>
      );
    }

    return this.props.children;
  }
}
