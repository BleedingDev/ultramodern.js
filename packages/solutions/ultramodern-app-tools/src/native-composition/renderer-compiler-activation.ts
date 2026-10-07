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
    !activation?.module ||
    activation.renderer !== renderer ||
    activation.schema !== 'ultramodern-native-compiler-activation' ||
    activation.version !== 1 ||
    activation.operation !== 'compiler'
  )
    throw new Error(`Invalid native compiler activation for ${renderer}`);

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
