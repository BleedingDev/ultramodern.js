import { pkgUp } from '@modern-js/utils';
import path from 'path';
import type { ConfigPackageMetadataRead } from '../config/loadConfig';

export const initAppDir = async (
  currentDir?: string,
  packageMetadataRead?: ConfigPackageMetadataRead,
): Promise<string> => {
  const cwd: string = currentDir || process.cwd();
  const read = () => pkgUp({ cwd });
  const pkg = await (packageMetadataRead?.packageDiscoveryRead
    ? packageMetadataRead.packageDiscoveryRead(read)
    : read());

  if (!pkg) {
    throw new Error(`no package.json found in current work dir: ${cwd}`);
  }

  return path.dirname(pkg);
};
