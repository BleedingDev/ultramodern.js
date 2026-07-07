import { DEFAULT_RUNTIME_FALLBACK_SIGNAL_ENDPOINT } from './constants';

export function resolveRuntimeFallbackSignalEndpoint(
  configuredEndpoint?: string,
) {
  const rawEndpoint = configuredEndpoint?.trim();
  if (!rawEndpoint) {
    return DEFAULT_RUNTIME_FALLBACK_SIGNAL_ENDPOINT;
  }

  if (rawEndpoint.startsWith('/')) {
    return rawEndpoint;
  }

  try {
    return (
      new URL(rawEndpoint).pathname || DEFAULT_RUNTIME_FALLBACK_SIGNAL_ENDPOINT
    );
  } catch (_error) {
    return `/${rawEndpoint.replace(/^\/+/, '')}`;
  }
}
