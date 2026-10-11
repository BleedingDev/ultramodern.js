import fs from 'node:fs';
import path from 'node:path';
import type { Renderer } from '@modern-js/renderer-core';
import {
  extensionRenderer,
  ownedSourceExtensions,
  specifierRenderer,
} from './renderer-registration';

const maxScannedFiles = 2000;
const maxReportedFiles = 5;

/** Route source a renderer may own, independent of which renderers are installed. */
const routeSourceExtensions: ReadonlySet<string> = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mts',
  '.mjs',
  ...ownedSourceExtensions,
]);

function* routeSourceFiles(directory: string): Generator<string> {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && !entry.name.startsWith('.'))
        yield* routeSourceFiles(file);
    } else if (
      entry.isFile() &&
      routeSourceExtensions.has(path.extname(entry.name)) &&
      !entry.name.endsWith('.d.ts')
    ) {
      yield file;
    }
  }
}

/** The first evidence that a module was written for a specific renderer. */
export function detectSourceRenderer(
  file: string,
  source: string,
): { renderer: Renderer; evidence: string } | undefined {
  const extension = path.extname(file);
  const owner = extensionRenderer(extension);
  if (owner) return { renderer: owner, evidence: `is a ${extension} module` };
  const pragma = /@jsxImportSource\s+(\S+)/u.exec(source)?.[1];
  const pragmaRenderer = pragma ? specifierRenderer(pragma) : undefined;
  if (pragmaRenderer)
    return {
      renderer: pragmaRenderer,
      evidence: `declares @jsxImportSource ${pragma}`,
    };
  const code = source
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/(^|[^:'"`])\/\/.*$/gmu, '$1');
  const imports =
    /\b(?:from|import)\s*\(?\s*['"]([^'"\n]+)['"]|\brequire\(\s*['"]([^'"\n]+)['"]\s*\)/gu;
  for (const match of code.matchAll(imports)) {
    const specifier = match[1] ?? match[2];
    const renderer = specifier ? specifierRenderer(specifier) : undefined;
    if (renderer) return { renderer, evidence: `imports '${specifier}'` };
  }
  return undefined;
}

/**
 * Switching `renderer` leaves route modules written for the previous one.
 * Name them before compilation reports missing JSX runtimes or modules.
 */
export function assertRouteSourcesMatchRenderer(
  renderer: Renderer,
  appDirectory: string,
  srcDirectory: string,
): void {
  const mismatches: { file: string; renderer: Renderer; evidence: string }[] =
    [];
  let scanned = 0;
  for (const file of routeSourceFiles(path.join(srcDirectory, 'routes'))) {
    if (++scanned > maxScannedFiles) break;
    let source: string;
    try {
      source = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const detected = detectSourceRenderer(file, source);
    if (detected && detected.renderer !== renderer)
      mismatches.push({ file, ...detected });
  }
  if (!mismatches.length) return;
  const authored = [...new Set(mismatches.map(item => item.renderer))];
  const lines = mismatches
    .slice(0, maxReportedFiles)
    .map(
      item =>
        `  - ${path.relative(appDirectory, item.file).split(path.sep).join('/')} ${item.evidence} (${item.renderer})`,
    );
  if (mismatches.length > maxReportedFiles)
    lines.push(`  - and ${mismatches.length - maxReportedFiles} more`);
  throw new Error(
    [
      `renderer-source-mismatch: modern.config selects renderer ${renderer}, but these route modules are authored for ${authored.join(' and ')}:`,
      ...lines,
      `Port them to ${renderer} components and install its packages, or set renderer: '${authored[0]}' in modern.config.`,
    ].join('\n'),
  );
}
