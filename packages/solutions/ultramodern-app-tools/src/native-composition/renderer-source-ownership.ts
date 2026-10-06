import fs from 'node:fs';
import path from 'node:path';
import type { Renderer } from '@modern-js/renderer-core';

/** Packages that only exist for one renderer's authored components. */
const rendererPackages: Record<Renderer, readonly string[]> = {
  react: [
    'react',
    'react-dom',
    '@modern-js/runtime',
    '@modern-js/plugin-tanstack',
    '@modern-js/plugin-i18n',
    '@tanstack/react-router',
  ],
  solid: [
    'solid-js',
    '@solidjs/web',
    '@solidjs/signals',
    '@solidjs/router',
    '@modern-js/renderer-solid',
  ],
  octane: ['octane', '@octanejs/', '@modern-js/renderer-octane'],
};

const sourceExtensions = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mts',
  '.mjs',
  '.tsrx',
]);
const maxScannedFiles = 2000;
const maxReportedFiles = 5;

function packageRenderer(specifier: string): Renderer | undefined {
  for (const [renderer, packages] of Object.entries(rendererPackages)) {
    if (
      packages.some(name =>
        name.endsWith('/')
          ? specifier.startsWith(name)
          : specifier === name || specifier.startsWith(`${name}/`),
      )
    )
      return renderer as Renderer;
  }
  return undefined;
}

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
      sourceExtensions.has(path.extname(entry.name)) &&
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
  if (path.extname(file) === '.tsrx')
    return { renderer: 'octane', evidence: 'is an Octane .tsrx module' };
  const pragma = /@jsxImportSource\s+(\S+)/u.exec(source)?.[1];
  const pragmaRenderer = pragma ? packageRenderer(pragma) : undefined;
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
    const renderer = specifier ? packageRenderer(specifier) : undefined;
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
