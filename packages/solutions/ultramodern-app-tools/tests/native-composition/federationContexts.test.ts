import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { rspack } from '@rsbuild/core';
import {
  FederationPrivateContextsPlugin,
  resolveFrameworkSharedPackages,
  withFrameworkShared,
  withReactJsxRuntimeShared,
} from '../../src/native-composition/module-federation-shared-plugin';

// The real `@modern-js/runtime` build, resolved as the fixture apps install it.
const packages = resolveFrameworkSharedPackages(__dirname).filter(
  ({ prefix }) => prefix === '@modern-js/runtime/',
);
const runtimeModules = path.join(packages[0].directory, 'node_modules');
const reactVersion = (
  createRequire(path.join(runtimeModules, 'noop.js'))('react/package.json') as {
    version: string;
  }
).version;
const reactShared = withReactJsxRuntimeShared({
  react: { requiredVersion: reactVersion, singleton: true },
  'react-dom': { requiredVersion: reactVersion, singleton: true },
});

// The host provides the request value and a component resolver through
// `@modern-js/runtime/context` only.
const HOST_RENDER = `
import {
  RuntimeComponentResolverContext,
  RuntimeContext,
} from '@modern-js/runtime/context';
import { useContext } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const RequestTitle = ({ title }) => {
  const { requestId } = useContext(RuntimeContext);
  return <p>{\`\${requestId}:\${title}\`}</p>;
};

export const render = (Widget, requestId) =>
  renderToStaticMarkup(
    <RuntimeComponentResolverContext.Provider value={() => RequestTitle}>
      <RuntimeContext.Provider value={{ requestId }}>
        <Widget />
      </RuntimeContext.Provider>
    </RuntimeComponentResolverContext.Provider>,
  );
`;

// The remote uses `/head` and `/router`, which the host never imports.
const REMOTE_WIDGET = `
import { Helmet } from '@modern-js/runtime/head';
import { Link } from '@modern-js/runtime/router';

export default () => <Helmet title={typeof Link} />;
`;

const compile = (
  root: string,
  name: string,
  exposes: Record<string, string>,
  shared: object,
  { federation = true }: { federation?: boolean } = {},
) =>
  new Promise<string[]>((resolve, reject) => {
    rspack({
      context: root,
      mode: 'development',
      devtool: false,
      target: 'async-node',
      entry: federation ? {} : exposes,
      output: {
        path: path.join(root, 'dist', name),
        chunkLoading: 'async-node',
        uniqueName: name,
      },
      resolve: {
        extensions: ['.tsx', '.ts', '.mjs', '.js'],
        modules: ['node_modules', runtimeModules],
      },
      module: {
        rules: [
          {
            test: /\.tsx$/,
            loader: 'builtin:swc-loader',
            options: {
              jsc: {
                parser: { syntax: 'typescript', tsx: true },
                transform: { react: { runtime: 'automatic' } },
              },
            },
          },
        ],
      },
      plugins: [
        ...(federation
          ? [
              new rspack.container.ModuleFederationPlugin({
                name,
                filename: 'remoteEntry.js',
                library: { type: 'commonjs-module' },
                exposes,
                shared: shared as never,
              }),
            ]
          : []),
        new FederationPrivateContextsPlugin(packages),
      ],
    }).run((error, stats) => {
      if (error) return reject(error);
      resolve(
        stats!.toJson({ all: false, errors: true }).errors!.map(e => e.message),
      );
    });
  });

type Container = {
  init: (shareScope: object) => Promise<void> | void;
  get: (request: string) => Promise<() => Record<string, any>>;
};

describe('Module Federation runtime contexts', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(path.join(__dirname, '.federation-contexts-'));
    await writeFile(path.join(root, 'render.tsx'), HOST_RENDER);
    await writeFile(path.join(root, 'Widget.tsx'), REMOTE_WIDGET);
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('renders remote /head and /router with the host request value', async () => {
    const shared = withFrameworkShared(reactShared, packages);
    expect(
      await compile(root, 'host', { './render': './render.tsx' }, shared),
    ).toEqual([]);
    expect(
      await compile(root, 'remote', { './Widget': './Widget.tsx' }, shared),
    ).toEqual([]);

    const load = (name: string) =>
      createRequire(__filename)(
        path.join(root, 'dist', name, 'remoteEntry.js'),
      ) as Container;
    const host = load('host');
    const remote = load('remote');
    const shareScope = {};
    await host.init(shareScope);
    const { render } = (await host.get('./render'))();
    await remote.init(shareScope);
    const { default: Widget } = (await remote.get('./Widget'))();

    expect(render(Widget, 'first')).toBe('<p>first:object</p>');
    expect(render(Widget, 'second')).toBe('<p>second:object</p>');
    expect(
      Object.getOwnPropertySymbols(globalThis).map(String),
    ).not.toContainEqual(expect.stringContaining('@modern-js/runtime'));
  });

  it('fails a remote build that bundles a private copy of the contexts', async () => {
    const errors = await compile(
      root,
      'remote',
      { './Widget': './Widget.tsx' },
      reactShared,
    );
    expect(errors).toEqual([
      expect.stringContaining(
        'bundles a private copy of @modern-js/runtime/context',
      ),
    ]);
    expect(errors[0]).toContain('Share the "@modern-js/runtime/" subpaths');
  });

  // The Cloudflare workerd SSR environment starts from the remote's chain,
  // where the guard is registered, and then drops the federation plugin: it
  // renders distributed fragments instead of loading remote code. That graph
  // has no container and no host, so importing the contexts directly is
  // correct there.
  it('leaves a graph whose federation plugin was dropped alone', async () => {
    expect(
      await compile(
        root,
        'worker',
        { './Widget': './Widget.tsx' },
        {},
        {
          federation: false,
        },
      ),
    ).toEqual([]);
  });
});
