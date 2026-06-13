// @effect-diagnostics asyncFunction:off extendsNativeError:off globalTimers:off newPromise:off
import {
  classifyModuleFederationFallback,
  type ModuleFederationFallbackClassification,
  ModuleFederationRemoteComponentContractError,
  ModuleFederationRemoteLoadError,
  ModuleFederationRemoteLoadTimeoutError,
} from '@modern-js/runtime/module-federation';

export const DEFAULT_REMOTE_TIMEOUT_MS = 4000;
export const DEFAULT_REMOTE_RETRIES = 1;
export const DEFAULT_REMOTE_RETRY_DELAY_MS = 200;

export type RemoteLoadFailureClassification =
  ModuleFederationFallbackClassification;

export type LoadRemoteModuleBaseOptions<TModule> = {
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
  loadRemoteImpl: () => Promise<TModule>;
  waitImpl?: (ms: number) => Promise<void>;
};

export class RemoteLoadTimeoutError extends ModuleFederationRemoteLoadTimeoutError {
  constructor(remote: string, timeoutMs: number) {
    super(remote, timeoutMs);
    this.name = 'RemoteLoadTimeoutError';
  }
}

export class RemoteLoadError extends ModuleFederationRemoteLoadError {
  constructor(remote: string, attempts: number, causeError: Error) {
    super(remote, attempts, causeError);
    this.name = 'RemoteLoadError';
  }
}

export class RemoteComponentContractError extends ModuleFederationRemoteComponentContractError {
  constructor(remote: string, exportName: string) {
    super(remote, exportName);
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

export function classifyRemoteLoadFailure(
  error: Error,
): RemoteLoadFailureClassification {
  return classifyModuleFederationFallback(error);
}

function isComponentType(value: unknown) {
  if (typeof value === 'function') {
    return true;
  }
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  return '$$typeof' in value;
}

export async function loadRemoteModuleWithRetryBase<TModule>(
  remote: string,
  {
    retries = DEFAULT_REMOTE_RETRIES,
    timeoutMs = DEFAULT_REMOTE_TIMEOUT_MS,
    retryDelayMs = DEFAULT_REMOTE_RETRY_DELAY_MS,
    loadRemoteImpl,
    waitImpl,
  }: LoadRemoteModuleBaseOptions<TModule>,
): Promise<TModule> {
  const waitFn = waitImpl || wait;
  const attempts = retries + 1;
  let lastError: Error = new Error(`Unknown remote load error for "${remote}"`);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await withTimeout(loadRemoteImpl(), remote, timeoutMs);
    } catch (error) {
      lastError = toError(error);
      const canRetry = attempt < attempts && isRetryableRemoteError(lastError);
      if (!canRetry) {
        break;
      }
      await waitFn(retryDelayMs * attempt);
    }
  }

  throw new RemoteLoadError(remote, attempts, lastError);
}

export function resolveRemoteComponentBase(
  remote: string,
  module: Record<string, unknown>,
  exportName: string,
) {
  const component = module[exportName];
  if (!isComponentType(component)) {
    throw new RemoteComponentContractError(remote, String(exportName));
  }
  return component;
}
