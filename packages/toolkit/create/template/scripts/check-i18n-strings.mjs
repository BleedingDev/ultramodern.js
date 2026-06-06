import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const scanRoots = ['src'].map((scanRoot) => path.join(root, scanRoot));
const ignoredDirectories = new Set(['.modern', '.modernjs', 'dist', 'node_modules']);
const visibleAttributePattern =
  /\s(?:aria-label|alt|placeholder|title)=["']([^"']*[A-Za-z][^"']*)["']/gu;
const jsxTextPattern = />([^<>{}]*[A-Za-z][^<>{}]*)</gu;
const jsxIntrinsicTags = new Set([
  'a',
  'abbr',
  'address',
  'area',
  'article',
  'aside',
  'audio',
  'b',
  'blockquote',
  'body',
  'br',
  'button',
  'canvas',
  'caption',
  'cite',
  'code',
  'col',
  'colgroup',
  'data',
  'datalist',
  'dd',
  'del',
  'details',
  'dfn',
  'dialog',
  'div',
  'dl',
  'dt',
  'em',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'head',
  'header',
  'hr',
  'html',
  'i',
  'iframe',
  'img',
  'input',
  'label',
  'legend',
  'li',
  'link',
  'main',
  'mark',
  'menu',
  'meta',
  'meter',
  'nav',
  'ol',
  'option',
  'p',
  'picture',
  'pre',
  'progress',
  'q',
  'script',
  'section',
  'select',
  'small',
  'source',
  'span',
  'strong',
  'style',
  'summary',
  'svg',
  'table',
  'tbody',
  'td',
  'template',
  'textarea',
  'tfoot',
  'th',
  'thead',
  'time',
  'title',
  'tr',
  'u',
  'ul',
  'video',
]);

const collectFiles = (directory) => {
  if (!fs.existsSync(directory)) {
    return [];
  }

  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) {
        files.push(...collectFiles(path.join(directory, entry.name)));
      }
      continue;
    }

    if (entry.isFile() && /\.(jsx|tsx)$/u.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      files.push(path.join(directory, entry.name));
    }
  }
  return files;
};

const lineNumberForIndex = (content, index) => content.slice(0, index).split('\n').length;
const isCodeElementText = (content, index) => {
  const tagStart = content.lastIndexOf('<', index);
  if (tagStart === -1) {
    return false;
  }
  return /^<code(?:\s|>)/u.test(content.slice(tagStart, index));
};
const isJsxTagEnd = (content, index) => {
  const tagStart = content.lastIndexOf('<', index);
  if (tagStart === -1 || content.slice(tagStart + 1, index).includes('<')) {
    return false;
  }
  const match = content
    .slice(tagStart, index + 1)
    .match(/^<\/?\s*([A-Za-z][\w:.-]*)\b[^<>]*>$/u);
  if (!match) {
    return false;
  }
  const [, tagName] = match;
  return (
    /^[A-Z]/u.test(tagName) ||
    tagName.includes('-') ||
    jsxIntrinsicTags.has(tagName)
  );
};
const isIgnoredLine = (content, index) => {
  const lineStart = content.lastIndexOf('\n', index) + 1;
  const lineEnd = content.indexOf('\n', index);
  const currentLineEnd = lineEnd === -1 ? content.length : lineEnd;
  const previousLineStart = content.lastIndexOf('\n', Math.max(0, lineStart - 2)) + 1;
  const nextLineEnd = content.indexOf('\n', currentLineEnd + 1);
  const context = content.slice(
    previousLineStart,
    nextLineEnd === -1 ? content.length : nextLineEnd,
  );
  return /i18n-ignore/u.test(context);
};

const violations = [];
for (const filePath of scanRoots.flatMap(collectFiles)) {
  const content = fs.readFileSync(filePath, 'utf-8');
  for (const match of content.matchAll(visibleAttributePattern)) {
    const [, visibleText] = match;
    if (!isIgnoredLine(content, match.index ?? 0)) {
      violations.push({
        filePath,
        line: lineNumberForIndex(content, match.index ?? 0),
        text: visibleText.trim(),
      });
    }
  }

  for (const match of content.matchAll(jsxTextPattern)) {
    const [, jsxText] = match;
    const text = jsxText.replaceAll(/\s+/gu, ' ').trim();
    if (
      text &&
      !isIgnoredLine(content, match.index ?? 0) &&
      isJsxTagEnd(content, match.index ?? 0) &&
      !isCodeElementText(content, match.index ?? 0)
    ) {
      violations.push({
        filePath,
        line: lineNumberForIndex(content, match.index ?? 0),
        text,
      });
    }
  }
}

if (violations.length > 0) {
  console.error('Hardcoded user-visible JSX strings found. Move copy to locale JSON files.');
  for (const violation of violations) {
    console.error(
      `${path.relative(root, violation.filePath)}:${violation.line} ${JSON.stringify(
        violation.text,
      )}`,
    );
  }
  process.exit(1);
}

console.log('No hardcoded user-visible JSX strings found.');
