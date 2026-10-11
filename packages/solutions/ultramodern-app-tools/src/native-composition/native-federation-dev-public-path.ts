import { isIPv6 } from 'node:net';
import type { RsbuildContext } from '@rsbuild/core';

const invalid = (message: string): Error =>
  new Error(`Native Module Federation: ${message}`);

/**
 * A dev remote must publish its own origin, rather than the consuming host's.
 * Rsbuild resolves its live address before creating compiler configuration.
 */
export function resolveNativeFederationDevPublicPath(
  publicPath: string,
  devServer: RsbuildContext['devServer'],
  assetPrefix?: string | boolean,
): string {
  if (!publicPath || publicPath === 'auto')
    throw invalid('development containers require a resolved publicPath.');
  if (
    !devServer ||
    !Number.isInteger(devServer.port) ||
    devServer.port < 1 ||
    devServer.port > 65535
  )
    throw invalid(
      'development containers require the resolved dev server address.',
    );

  const protocol = devServer.https ? 'https:' : 'http:';
  const hostname = devServer.hostname || 'localhost';
  const host =
    hostname === '0.0.0.0' || hostname === 'localhost'
      ? 'localhost'
      : hostname === '::'
        ? '[::1]'
        : isIPv6(hostname)
          ? `[${hostname}]`
          : hostname;
  const origin = `${protocol}//${host}:${devServer.port}`;
  let prefix = publicPath;
  if (assetPrefix === true) {
    // Rsbuild's boolean prefix currently omits IPv6 brackets. Repair only its
    // generated address, preserving server.base and any explicit compiler URL.
    const generatedHost = hostname === '0.0.0.0' ? 'localhost' : hostname;
    const generatedOrigin = `${protocol}//${generatedHost}:${devServer.port}`;
    if (
      publicPath === generatedOrigin ||
      publicPath.startsWith(`${generatedOrigin}/`)
    )
      prefix = origin + publicPath.slice(generatedOrigin.length);
  }
  let url: URL;
  try {
    url = new URL(prefix, `${origin}/`);
  } catch (error) {
    throw Object.assign(
      invalid('development publicPath must be a valid URL or path prefix.'),
      { cause: error },
    );
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw invalid('development publicPath must use HTTP or HTTPS.');
  // Absolute authored prefixes already passed through Rsbuild's formatting.
  return /^https?:\/\//u.test(prefix) ? prefix : url.href;
}
