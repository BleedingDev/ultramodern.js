import {
  lodash as _,
  compatibleRequire,
  ensureAbsolutePath,
  fs,
  OUTPUT_CONFIG_FILE,
} from '@modern-js/utils';
import { parse } from 'flatted';
import path from 'path';

type LoadConfigOptions = {
  cliConfig: Record<string, any>;
  serverConfig: Record<string, any>;
  resolvedConfigPath: string;
};

export const getServerConfigPath = (
  distDirectory: string,
  serverConfigFile?: string,
) => {
  const fileName = serverConfigFile || 'server.js';
  return path.join(distDirectory, fileName);
};

export const requireConfig = (
  serverConfigPath: string,
): Record<string, any> => {
  if (fs.pathExistsSync(serverConfigPath)) {
    return compatibleRequire(serverConfigPath) || {};
  }
  return {};
};

export const loadConfig = ({
  cliConfig,
  serverConfig,
  resolvedConfigPath,
}: LoadConfigOptions) => {
  let outputConfig: Record<string, any> = {};
  if (fs.pathExistsSync(resolvedConfigPath)) {
    try {
      const content = fs.readFileSync(resolvedConfigPath, 'utf8');
      outputConfig = parse(content) || {};
    } catch (_error) {
      outputConfig = {};
    }
  }

  return _.merge({}, outputConfig, serverConfig || {}, cliConfig || {});
};
