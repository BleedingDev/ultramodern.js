import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Renderer } from '@modern-js/renderer-core';
import type { RsbuildPlugin } from '@rsbuild/core';
import { readRendererFrameworkPackage } from './renderer-installed-profile';
import {
  type NativeRendererCompilerOptions,
  type RendererRegistration,
  resolveRendererRegistration,
} from './renderer-registration';

/** Activate only the compiler declared by the selected static renderer owner. */
export async function activateNativeRendererCompiler(
  renderer: Renderer,
  options: NativeRendererCompilerOptions,
): Promise<RsbuildPlugin> {
  const registration: RendererRegistration =
    resolveRendererRegistration(renderer);
  if (registration.kind !== 'native')
    throw new Error(`Renderer ${renderer} has no native compiler activation`);
  const adapter = registration.nativeAdapter;
  const activation = adapter.compiler;
  if (
    !activation ||
    !activation.module ||
    registration.renderer !== renderer ||
    registration.candidateProfile.renderer !== renderer ||
    adapter.renderer !== renderer ||
    adapter.profile.renderer !== renderer ||
    activation.renderer !== renderer ||
    activation.schema !== 'ultramodern-native-compiler-activation' ||
    activation.version !== 1 ||
    activation.operation !== 'compiler' ||
    !Object.isFrozen(activation) ||
    !Object.isFrozen(activation.module) ||
    typeof activation.export !== 'string' ||
    !/^[$A-Z_a-z][$\w]*$/u.test(activation.export)
  )
    throw new Error(`Invalid native compiler activation for ${renderer}`);

  const entries = [
    ['source', './src/', '.ts'],
    ['import', './dist/esm-node/', '.mjs'],
    ['require', './dist/cjs/', '.js'],
  ] as const;
  let compilerStem: string | undefined;
  for (const [format, prefix, suffix] of entries) {
    const entry = activation.module[format];
    if (
      typeof entry !== 'string' ||
      !entry.startsWith(prefix) ||
      !entry.endsWith(suffix)
    )
      throw new Error(`Invalid ${format} compiler entry for ${renderer}`);
    const stem = entry.slice(prefix.length, -suffix.length);
    if (
      !/^[A-Za-z0-9_-][A-Za-z0-9._-]*(?:\/[A-Za-z0-9_-][A-Za-z0-9._-]*)*$/u.test(
        stem,
      ) ||
      (compilerStem !== undefined && compilerStem !== stem)
    )
      throw new Error(`Conflicting compiler module formats for ${renderer}`);
    compilerStem = stem;
  }

  const filename = fs.realpathSync(
    typeof __filename === 'string'
      ? __filename
      : fileURLToPath(import.meta.url),
  );
  const owner = readRendererFrameworkPackage({
    specifier: '@modern-js/ultramodern-app-tools',
    filename,
  });
  const relativeFilename = path
    .relative(owner.directory, filename)
    .split(path.sep)
    .join('/');
  const format =
    relativeFilename ===
      'src/native-composition/renderer-compiler-activation.ts' ||
    relativeFilename ===
      'dist/esm-node/native-composition/renderer-compiler-activation.mjs'
      ? 'import'
      : relativeFilename ===
          'dist/cjs/native-composition/renderer-compiler-activation.js'
        ? 'require'
        : undefined;
  if (!format)
    throw new Error('Native compiler dispatcher has no owning module format');
  const target = path.join(owner.directory, activation.module[format]);
  if (fs.realpathSync(target) !== target || !fs.statSync(target).isFile())
    throw new Error(`Native compiler entry is not owned by ${owner.name}`);
  const compiler: Record<string, unknown> = await import(
    pathToFileURL(target).href
  );
  const factory = compiler[activation.export];
  if (typeof factory !== 'function')
    throw new Error(
      `Native compiler ${renderer} does not export ${activation.export}`,
    );
  return (factory as (options: NativeRendererCompilerOptions) => RsbuildPlugin)(
    options,
  );
}
