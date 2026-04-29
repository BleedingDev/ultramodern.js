import { findMatchedSourcePath, findSourceEntry } from '@modern-js/utils';
import { createMatchPath } from '@modern-js/utils/tsconfig-paths';
import { load as tsNodeLoad, resolve as tsNodeResolve } from 'ts-node/esm';
import { pathToFileURL } from 'url';

let matchPath;

export async function initialize({ baseUrl, paths }) {
  matchPath = createMatchPath(baseUrl || './', paths || {});
}

export function resolve(specifier, context, defaultResolve) {
  // Without this rewrite, aliases such as `@service/user` and
  // `@service/user.js` would never reach ts-node as real source files.
  const match = findMatchedSourcePath(matchPath, specifier);

  return match
    ? tsNodeResolve(
        pathToFileURL(findSourceEntry(match) || match).href,
        context,
        defaultResolve,
      )
    : tsNodeResolve(specifier, context, defaultResolve);
}

export function load(url, context, defaultLoad) {
  const filePath = new URL(url).pathname;

  if (url.startsWith('node:')) {
    return defaultLoad(url, context);
  }

  if (filePath.includes('node_modules')) {
    return defaultLoad(url, context);
  }

  // Without ts-node here, local `.ts` files would be handed to Node as-is and
  // fail to execute in environments that do not natively run TypeScript.
  return tsNodeLoad(url, context, defaultLoad);
}
