import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { types as babelTypes, parseSync } from '@babel/core';

function declarationFiles(root) {
  return readdirSync(root, { recursive: true })
    .filter(file => file.endsWith('.d.ts'))
    .map(file => join(root, file));
}

function rewrite(file, transform) {
  const before = readFileSync(file, 'utf8');
  const after = transform(before);
  if (before !== after) writeFileSync(file, after);
}

function modulePath(file, target) {
  const path = relative(dirname(file), target).replaceAll('\\', '/');
  return path.startsWith('.') ? path : `./${path}`;
}

// A plugin's configuration aliases do not need its compiler class or private
// implementation declarations. Copy the reachable aliases from the installed
// version so supported options stay in sync without importing Webpack's API.
function emitOptionDeclarations(
  packageRoot,
  target,
  roots,
  footer,
  overrides = {},
) {
  const source = readFileSync(join(packageRoot, 'types/index.d.ts'), 'utf8');
  const ast = parseSync(source, {
    babelrc: false,
    configFile: false,
    // Ambient namespaces can re-export aliases declared in their enclosing
    // module. Babel's JS export-binding check does not model that TS scope.
    parserOpts: {
      allowUndeclaredExports: true,
      plugins: [['typescript', { dts: true }]],
    },
  });
  const aliases = new Map(
    ast.program.body
      .filter(node => node.type === 'TSTypeAliasDeclaration')
      .map(node => [node.id.name, node]),
  );
  const selected = new Set();
  function visit(name) {
    if (selected.has(name)) return;
    const alias = aliases.get(name);
    if (!alias)
      throw new Error(`Missing declaration input ${name} in ${packageRoot}`);
    selected.add(name);
    if (Object.hasOwn(overrides, name)) return;
    babelTypes.traverseFast(alias.typeAnnotation, node => {
      if (
        node.type === 'TSTypeReference' &&
        node.typeName.type === 'Identifier' &&
        aliases.has(node.typeName.name)
      )
        visit(node.typeName.name);
    });
  }
  roots.forEach(visit);
  mkdirSync(target, { recursive: true });
  const declarations = [...selected].map(name => {
    if (Object.hasOwn(overrides, name))
      return `type ${name} = ${overrides[name]};`;
    const node = aliases.get(name);
    return source.slice(node.start, node.end);
  });
  writeFileSync(
    join(target, 'index.d.ts'),
    `${declarations.join('\n')}\n${footer}\n`,
  );
  cpSync(join(packageRoot, 'LICENSE'), join(target, 'LICENSE'));
}

/** Keep Builder's optional Sass configuration graph on the actual Rspack/Sass implementation. */
export function emitBuilderDeclarations(types, resolvePackage) {
  const css = join(types, 'css-minimizer');
  const cssPlugin = packageResolver(
    resolvePackage('@rsbuild/plugin-css-minimizer'),
  )('css-minimizer-webpack-plugin');
  emitOptionDeclarations(
    cssPlugin,
    css,
    [
      'BasePluginOptions',
      'DefinedDefaultMinimizerAndOptions',
      'CssNanoOptionsExtended',
    ],
    "export type PluginCssMinimizerOptions = { pluginOptions?: import('@rsbuild/core').ConfigChain<BasePluginOptions & DefinedDefaultMinimizerAndOptions<CssNanoOptionsExtended>> };",
  );
  const plugin = resolvePackage('@rsbuild/plugin-sass');
  const target = join(types, 'sass');
  mkdirSync(target, { recursive: true });
  cpSync(join(plugin, 'dist/types.d.ts'), join(target, 'index.d.ts'));
  cpSync(
    join(plugin, 'compiled/sass-loader/index.d.ts'),
    join(target, 'loader.d.ts'),
  );
  cpSync(join(plugin, 'LICENSE'), join(target, 'LICENSE'));
  rewrite(join(target, 'index.d.ts'), text =>
    text.replace('../compiled/sass-loader/index.js', './loader.js'),
  );
  rewrite(join(target, 'loader.d.ts'), text =>
    text
      .replace(
        "import * as Sass from 'sass';",
        "import * as Sass from 'sass-embedded';",
      )
      .replace(
        "import Webpack from 'webpack';",
        "import type { Rspack } from '@rsbuild/core';",
      )
      .replaceAll('Webpack.loader.LoaderContext', 'Rspack.LoaderContext'),
  );
  for (const file of declarationFiles(types)) {
    if (file.startsWith(`${target}/`)) continue;
    rewrite(file, text =>
      text
        .replace(
          /import type \{ SvgDefaultExport \} from ['"]@rsbuild\/plugin-svgr['"];?/g,
          "type SvgDefaultExport = 'component' | 'url';",
        )
        .replace(
          /(['"])@rsbuild\/plugin-sass\1/g,
          (_, quote) =>
            `${quote}${modulePath(file, join(target, 'index.js'))}${quote}`,
        )
        .replace(
          /(['"])@rsbuild\/plugin-css-minimizer\1/g,
          (_, quote) =>
            `${quote}${modulePath(file, join(css, 'index.js'))}${quote}`,
        ),
    );
  }
}

export function emitAppToolsExtensionsDeclarations(types, resolvePackage) {
  const target = join(types, 'precompress');
  emitOptionDeclarations(
    resolvePackage('compression-webpack-plugin'),
    target,
    ['BasePluginOptions', 'DefinedDefaultAlgorithmAndOptions', 'ZlibOptions'],
    'export type CompressionPluginOptions = BasePluginOptions<ZlibOptions> & DefinedDefaultAlgorithmAndOptions<ZlibOptions>;',
    { PathData: "import('@rsbuild/core').Rspack.PathData" },
  );
  rewrite(join(types, 'build-config/precompress/types.d.ts'), text =>
    text.replace(
      /import type CompressionPlugin from ['"]compression-webpack-plugin['"];\s*type CompressionPluginOptions = NonNullable<ConstructorParameters<typeof CompressionPlugin>\[0\]>;/,
      "import type { CompressionPluginOptions } from '../../precompress/index.js';",
    ),
  );
}

function packageResolver(packageRoot) {
  const require = createRequire(join(packageRoot, 'package.json'));
  return name => {
    let root = dirname(require.resolve(name));
    // Skip RxJS's dist/cjs format marker and find the actual package identity.
    while (true) {
      const manifest = join(root, 'package.json');
      if (
        existsSync(manifest) &&
        JSON.parse(readFileSync(manifest, 'utf8')).name === name
      )
        return root;
      const parent = dirname(root);
      if (parent === root)
        throw new Error(`Cannot locate declaration dependency ${name}`);
      root = parent;
    }
  };
}

export function publicDeclarationsPlugin(kind) {
  return {
    name: `ultramodern:${kind}-public-declarations`,
    setup(api) {
      api.onAfterBuild(() => {
        const root = api.context.rootPath;
        const resolver = packageResolver(root);
        if (kind === 'builder')
          emitBuilderDeclarations(resolve(root, 'dist/types'), resolver);
        else if (kind === 'app-tools-extensions')
          emitAppToolsExtensionsDeclarations(
            resolve(root, 'dist/types'),
            resolver,
          );
        else throw new Error(`Unknown declaration producer: ${kind}`);
      });
    },
  };
}
