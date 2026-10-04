import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Renderer } from '@modern-js/renderer-core';
import type { RsbuildPlugin } from '@rsbuild/core';
import type {
  NativeRendererCompilerActivation,
  NativeRendererCompilerOptions,
} from '../../src/native-composition/renderer-registration';

/** Run the private dispatcher with real Node modules in a fresh owning package. */
export async function createCompilerActivationFixture(
  options: {
    renderers?: readonly Renderer[];
    format?: 'source' | 'import';
    specialPath?: boolean;
    freezeModule?: boolean;
    replaceActivation?(
      activation: NativeRendererCompilerActivation,
    ): NativeRendererCompilerActivation;
  } = {},
) {
  const sdkRoot = path.resolve(import.meta.dirname, '../..');
  const root = fs.realpathSync(
    fs.mkdtempSync(
      path.join(
        process.env.OWNED_TEMP_DIR ?? os.tmpdir(),
        options.specialPath
          ? 'um-compiler-activation-#?-'
          : 'um-compiler-activation-',
      ),
    ),
  );
  const callsFile = path.join(root, 'compiler-calls.jsonl');
  const write = (relative: string, contents: string) => {
    const filename = path.join(root, relative);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, contents);
  };
  try {
    write(
      'package.json',
      JSON.stringify({
        name: '@fixture/native-compiler-owner',
        version: '1.0.0',
        type: 'module',
      }),
    );
    write('dist/cjs/package.json', '{"type":"commonjs"}');
    const renderers = options.renderers ?? ['solid', 'octane'];
    const registrations = renderers.map(renderer => {
      const stem = `renderers/${renderer}/compiler/index`;
      const declared: NativeRendererCompilerActivation = {
        schema: 'ultramodern-native-compiler-activation',
        version: 1,
        renderer,
        operation: 'compiler',
        module: {
          source: `./src/${stem}.ts`,
          import: `./dist/esm-node/${stem}.mjs`,
          require: `./dist/cjs/${stem}.js`,
        },
        export: 'createFixtureCompiler',
      };
      const activation = options.replaceActivation?.(declared) ?? declared;
      const compiler = (format: 'import' | 'require') => `
${format === 'import' ? "import fs from 'node:fs';" : "const fs = require('node:fs');"}
const record = action => fs.appendFileSync(${JSON.stringify(callsFile)}, JSON.stringify({renderer:${JSON.stringify(renderer)},format:${JSON.stringify(format)},action}) + '\\n');
record('loaded');
${format === 'import' ? 'export ' : ''}function createFixtureCompiler(options) {
  record('factory');
  const plugin = {name:${JSON.stringify(`fixture:${renderer}:compiler`)},setup(){},rendererIdentities:options.rendererIdentities};
  Object.defineProperty(plugin, Symbol.for('ultramodern.renderer-compiler-claim'), {enumerable:true,value:Object.freeze({renderer:${JSON.stringify(renderer)},sourceExtensions:Object.freeze(['.tsx','.ts']),transform:'native',refresh:'native',svg:'url'})});
  return plugin;
}
${format === 'require' ? 'exports.createFixtureCompiler = createFixtureCompiler;' : ''}
`;
      write(
        `src/${stem}.ts`,
        'throw new Error("Compiler source is provenance only");',
      );
      write(`dist/esm-node/${stem}.mjs`, compiler('import'));
      write(`dist/cjs/${stem}.js`, compiler('require'));
      return `{renderer:${JSON.stringify(renderer)},kind:'native',candidateProfile:{renderer:${JSON.stringify(renderer)}},nativeAdapter:{renderer:${JSON.stringify(renderer)},profile:{renderer:${JSON.stringify(renderer)}},compiler:Object.freeze({...${JSON.stringify(activation)},module:${options.freezeModule === false ? JSON.stringify(activation.module) : `Object.freeze(${JSON.stringify(activation.module)})`}})}}`;
    });
    const directory =
      options.format === 'import'
        ? 'dist/esm-node/native-composition'
        : 'src/native-composition';
    const dispatcher = `${directory}/renderer-compiler-activation.${options.format === 'import' ? 'mjs' : 'ts'}`;
    const sourceFile = path.join(
      sdkRoot,
      'src/native-composition/renderer-compiler-activation.ts',
    );
    // Type erasure leaves the production dispatcher's runtime body and imports intact.
    write(
      dispatcher,
      stripTypeScriptTypes(fs.readFileSync(sourceFile, 'utf8')),
    );
    write(
      `${directory}/renderer-installed-profile`,
      `import fs from 'node:fs';
import path from 'node:path';
export function readRendererFrameworkPackage({filename,specifier}) {
  let directory = path.dirname(fs.realpathSync(filename));
  for (;;) {
    const manifestFile = path.join(directory, 'package.json');
    if (fs.existsSync(manifestFile)) {
      const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
      if (manifest.name && manifest.version) return {specifier,name:manifest.name,version:manifest.version,directory};
    }
    const parent = path.dirname(directory);
    if (parent === directory) throw new Error('Fixture dispatcher has no package owner');
    directory = parent;
  }
}`,
    );
    write(
      `${directory}/renderer-registration`,
      `const registrations = [{renderer:'react',kind:'composed'},${registrations.join(',')}];
export function resolveRendererRegistration(renderer = 'react') {
  const selected = registrations.find(registration => registration.renderer === renderer);
  if (!selected) throw new Error('Unsupported UltraModern renderer: ' + renderer);
  return selected;
}`,
    );
    const module = (await import(
      pathToFileURL(path.join(root, dispatcher)).href
    )) as {
      activateNativeRendererCompiler(
        renderer: Renderer,
        options: NativeRendererCompilerOptions,
      ): Promise<RsbuildPlugin>;
    };
    return {
      activate: module.activateNativeRendererCompiler,
      calls: () =>
        fs.existsSync(callsFile)
          ? fs
              .readFileSync(callsFile, 'utf8')
              .trim()
              .split('\n')
              .map(line => JSON.parse(line))
          : [],
      cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
      root,
    };
  } catch (error) {
    fs.rmSync(root, { recursive: true, force: true });
    throw error;
  }
}
