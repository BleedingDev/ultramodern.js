import os from 'node:os';
import path from 'node:path';
import { type NodeFileTraceResult, nodeFileTrace } from '@vercel/nft';

// Directories owned by the build host rather than the app. nft statically
// evaluates `os.homedir()`, `os.tmpdir()` and literal system paths, so code
// like `fs.readFileSync(path.join(os.homedir(), name))` becomes a glob of the
// whole home directory. With `base: '/'` that glob walks the machine.
const SYSTEM_ROOTS =
  process.platform === 'win32'
    ? []
    : ['/dev', '/etc', '/proc', '/run', '/sys', '/var/run'];

const GLOB_SEGMENT = /[*?[{]/;

const isInside = (parent: string, child: string) =>
  child === parent || child.startsWith(`${parent}${path.sep}`);

const globRoot = (absolutePattern: string) => {
  const { root } = path.parse(absolutePattern);
  const segments = absolutePattern.slice(root.length).split(path.sep);
  const index = segments.findIndex(segment => GLOB_SEGMENT.test(segment));
  return index === -1
    ? undefined
    : path.join(root, ...segments.slice(0, index));
};

/**
 * Builds the nft `ignore` predicate for a trace rooted at `base`: skip every
 * path under a system root, and skip globs that would enumerate the file
 * system root, the home directory or the temp directory as a whole. Files
 * inside home or temp are still traced, since package stores can live there.
 */
export const createBuildHostIgnore = (base: string) => {
  const wholeDirectories = new Set([
    path.parse(path.resolve(base)).root,
    path.resolve(os.homedir()),
    path.resolve(os.tmpdir()),
  ]);
  return (relativePath: string) => {
    const absolutePath = path.resolve(base, relativePath);
    if (SYSTEM_ROOTS.some(root => isInside(root, absolutePath))) {
      return true;
    }
    const root = globRoot(absolutePath);
    return root !== undefined && wholeDirectories.has(root);
  };
};

/**
 * `traceFiles` implementation for ndepe's `nodeDepEmit`, tracing with the
 * `@vercel/nft` release app-tools-extensions depends on instead of the one ndepe pins.
 */
export const traceDeployFiles = ({
  entryFiles,
  sourceDir,
  base = '/',
}: {
  entryFiles: string[];
  sourceDir: string;
  base?: string;
}): Promise<NodeFileTraceResult> =>
  nodeFileTrace(entryFiles, {
    base,
    processCwd: sourceDir,
    ignore: createBuildHostIgnore(base),
  });
