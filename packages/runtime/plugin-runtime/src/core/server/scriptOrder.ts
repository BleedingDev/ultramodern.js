type ScriptTagMatch = {
  index: number;
  tag: string;
  src: string;
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
