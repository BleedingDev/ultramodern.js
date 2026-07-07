import type { ToolsDevServerConfig } from '@modern-js/builder';
import type { IncomingMessage } from 'http';
import { normalizePrefixList } from './prefix';

export const createCompressConfig = (
  devServer: ToolsDevServerConfig | undefined,
  prefix: string | string[] | undefined,
) => {
  if (!devServer || typeof devServer !== 'object' || Array.isArray(devServer)) {
    return undefined;
  }

  const { compress } = devServer;

  if (compress === undefined || compress === true) {
    const prefixes = normalizePrefixList(prefix);
    return {
      filter: (req: IncomingMessage) =>
        !prefixes.some(item => req.url?.includes(item)),
    };
  }

  if (compress === false) {
    return false;
  }

  return compress;
};
