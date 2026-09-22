import { escapeHtmlAttribute } from './html';

type RouteAssetManifest = {
  assets?: string[];
};

export type RouteManifestLike = {
  routeAssets?: Record<string, RouteAssetManifest | undefined>;
};

type ScriptTagMatch = {
  index: number;
  tag: string;
  src: string;
};

export type ScriptChunkLike = {
  filename?: string;
  url?: string;
};

function getScriptTags(template: string): ScriptTagMatch[] {
  const scriptRegExp = /<script\b[^>]*\bsrc=(["'])(.*?)\1[^>]*><\/script>/g;
  return Array.from(template.matchAll(scriptRegExp)).map(match => ({
    index: match.index ?? 0,
    tag: match[0],
    src: match[2],
  }));
}

function getAssetBasename(src: string) {
  const withoutQuery = src.split(/[?#]/)[0];
  return withoutQuery.split('/').pop() || withoutQuery;
}

function isEntryScript(src: string, entryName: string, asyncEntry: boolean) {
  const basename = getAssetBasename(src);
  const prefix = asyncEntry ? `async-${entryName}` : entryName;
  return (
    basename === `${prefix}.js` ||
    basename.startsWith(`${prefix}.`) ||
    basename.startsWith(`${prefix}-`)
  );
}

const dedupeByUrl = <T extends ScriptChunkLike>(chunks: T[]) => {
  const seen = new Set<string>();
  return chunks.filter(chunk => {
    if (chunk.url === undefined || chunk.url === '' || seen.has(chunk.url)) {
      return false;
    }
    seen.add(chunk.url);
    return true;
  });
};

const isAsyncEntryScriptChunk = (chunk: ScriptChunkLike, entryName: string) => {
  if (chunk.url === undefined || !chunk.url.endsWith('.js')) {
    return false;
  }

  const asyncEntryName = `async-${entryName}`;
  const filename = chunk.filename ?? chunk.url;
  const basename = filename.split('/').pop() ?? filename;
  return (
    basename === `${asyncEntryName}.js` ||
    basename.startsWith(`${asyncEntryName}.`) ||
    basename.startsWith(`${asyncEntryName}-`)
  );
};

export function getMatchedRouteChunks<T>(
  routeManifest: RouteManifestLike | undefined,
  matchedRouteIds: readonly string[],
  routeAssetToChunk: (asset: string) => T,
): T[] {
  const routeAssets = routeManifest?.routeAssets;
  if (routeAssets === undefined) {
    return [];
  }

  return matchedRouteIds
    .flatMap(routeId => routeAssets[routeId]?.assets ?? [])
    .map(routeAssetToChunk);
}

export const orderHydrationScriptChunks = <T extends ScriptChunkLike>({
  asyncEntryChunks,
  collectedChunks,
  matchedRouteChunks,
  entryName,
}: {
  asyncEntryChunks: T[];
  collectedChunks: T[];
  matchedRouteChunks: T[];
  entryName: string;
}) => {
  const asyncEntryScriptChunks: T[] = [];
  const asyncEntryDependencyChunks: T[] = [];

  for (const chunk of asyncEntryChunks) {
    if (isAsyncEntryScriptChunk(chunk, entryName)) {
      asyncEntryScriptChunks.push(chunk);
    } else {
      asyncEntryDependencyChunks.push(chunk);
    }
  }

  return dedupeByUrl([
    ...asyncEntryDependencyChunks,
    ...collectedChunks,
    ...matchedRouteChunks,
    ...asyncEntryScriptChunks,
  ]);
};

export function injectBeforeHydrationEntryScript(
  template: string,
  scripts: string,
  entryName = 'index',
) {
  if (scripts === '') {
    return template;
  }

  const scriptTags = getScriptTags(template);
  const target =
    scriptTags.find(match => isEntryScript(match.src, entryName, false)) ??
    scriptTags.find(match => isEntryScript(match.src, entryName, true));

  if (target === undefined) {
    return template;
  }

  return `${template.slice(0, target.index)}${scripts}${template.slice(
    target.index,
  )}`;
}

export function replaceChunkJsPlaceholder(
  template: string,
  scripts: string,
  entryName: string | undefined,
  placeholder: string,
) {
  if (!template.includes(placeholder)) {
    return template;
  }

  if (scripts === '') {
    return template.replace(placeholder, () => '');
  }

  const withoutPlaceholder = template.replace(placeholder, () => '');
  const withEarlyScripts = injectBeforeHydrationEntryScript(
    withoutPlaceholder,
    scripts,
    entryName,
  );

  if (withEarlyScripts !== withoutPlaceholder) {
    return withEarlyScripts;
  }

  return template.replace(placeholder, () => scripts);
}

export function createRouteHydrationScriptTags(
  routeManifest: RouteManifestLike | undefined,
  matchedRouteIds: readonly string[],
  entryName: string,
  options: {
    nonce?: string;
    template?: string;
  } = {},
) {
  const { nonce, template } = options;
  const routeAssets = routeManifest?.routeAssets;
  if (routeAssets === undefined) {
    return '';
  }
  const existingScriptSrcs =
    template === undefined
      ? new Set<string>()
      : new Set(getScriptTags(template).map(({ src }) => src));

  const jsAssets = Array.from(
    new Set(
      [
        ...getMatchedRouteChunks(
          routeManifest,
          matchedRouteIds,
          asset => asset,
        ),
        ...(routeAssets[`async-${entryName}`]?.assets ?? []),
      ].filter((asset: string) => asset.endsWith('.js')),
    ),
  );
  return jsAssets
    .filter(asset => !existingScriptSrcs.has(asset))
    .map(
      asset =>
        `<script src="${escapeHtmlAttribute(asset)}"${
          nonce ? ` nonce="${escapeHtmlAttribute(nonce)}"` : ''
        }></script>`,
    )
    .join(' ');
}
