import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const scanRoots = ['src'].map((scanRoot) => path.join(root, scanRoot));
const ignoredDirectories = new Set(['.modern', '.modernjs', 'dist', 'node_modules']);
const visibleAttributePattern =
  /\s(?:aria-label|alt|placeholder|title)=["']([^"']*[A-Za-z][^"']*)["']/gu;
const jsxTextPattern = />([^<>{}]*[A-Za-z][^<>{}]*)</gu;

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
    if (!isIgnoredLine(content, match.index ?? 0)) {
      violations.push({
        filePath,
        line: lineNumberForIndex(content, match.index ?? 0),
        text: match[1].trim(),
      });
    }
  }

  for (const match of content.matchAll(jsxTextPattern)) {
    const text = match[1].replaceAll(/\s+/gu, ' ').trim();
    if (text && !isIgnoredLine(content, match.index ?? 0)) {
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
