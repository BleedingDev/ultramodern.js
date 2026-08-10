import type { ToolsDevServerConfig } from '@modern-js/builder';
import { normalizePrefixList } from './prefix';

type CompressConfig = Exclude<
  NonNullable<
    Extract<ToolsDevServerConfig, { compress?: unknown }>['compress']
  >,
  boolean
>;

export const createCompressConfig = (
  devServer: ToolsDevServerConfig | undefined,
  prefix: string | string[] | undefined,
) => {
  if (
    devServer === undefined ||
    typeof devServer !== 'object' ||
    Array.isArray(devServer)
  ) {
    return undefined;
  }

  const { compress } = devServer;

  if (compress === undefined || compress === true) {
    const prefixes = normalizePrefixList(prefix);
    return {
      filter: req => !prefixes.some(item => req.url?.includes(item)),
    } satisfies CompressConfig;
  }

  if (compress === false) {
    return false;
  }

  return compress;
};
