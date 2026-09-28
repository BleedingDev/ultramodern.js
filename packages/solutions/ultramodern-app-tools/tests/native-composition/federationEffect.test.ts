import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { rspack } from '@rsbuild/core';
import {
  type FrameworkSharedPackage,
  resolveFrameworkSharedPackages,
  withFrameworkShared,
} from '../../src/native-composition/module-federation-shared-plugin';

// The workspace `@modern-js/bff-effect`, installed as an app installs it. Its
// own `effect` is the copy the release cohort pins.
const bffEffectDirectory = path.resolve(
  __dirname,
  '../../../../server/bff-effect',
);
const effectModules = path.join(bffEffectDirectory, 'node_modules');
const effectVersion = (
  createRequire(path.join(effectModules, 'noop.js'))('effect/package.json') as {
    version: string;
  }
).version;

// Both containers reach Effect the way `@modern-js/bff-effect` does: through
// the `effect` index and through subpaths such as `effect/Schema`.
const EFFECT_ENTRIES = `
import { Schema } from 'effect';
import * as SchemaModule from 'effect/Schema';

export const effect = { index: Schema, subpath: SchemaModule };
`;

// The host decodes what a remote built.
const HOST_DECODE = `
import * as Schema from 'effect/Schema';

export { effect } from './entries.js';
export const decode = (schema, input) => Schema.decodeUnknownSync(schema)(input);
`;

const REMOTE_CONTACT = `
import { Schema } from 'effect';

export { effect } from './entries.js';
export class Contact extends Schema.Class('Contact')({ name: Schema.String }) {}
`;

const compile = (
  root: string,
  name: string,
  exposes: Record<string, string>,
  shared: object,
) =>
  new Promise<string[]>((resolve, reject) => {
    rspack({
      context: root,
      mode: 'development',
      devtool: false,
      target: 'async-node',
      entry: {},
      output: {
        path: path.join(root, 'dist', name),
        chunkLoading: 'async-node',
        uniqueName: name,
      },
      resolve: { modules: ['node_modules', effectModules] },
      plugins: [
        new rspack.container.ModuleFederationPlugin({
          name,
          filename: 'remoteEntry.js',
          library: { type: 'commonjs-module' },
          exposes,
          shared: shared as never,
        }),
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

describe('Module Federation Effect sharing', () => {
  let root: string;
  let packages: FrameworkSharedPackage[];
  beforeEach(async () => {
    // Outside the package, so the app installs `@modern-js/bff-effect` only.
    root = await realpath(
      await mkdtemp(path.join(tmpdir(), 'ultramodern-federation-effect-')),
    );
    await mkdir(path.join(root, 'node_modules/@modern-js'), {
      recursive: true,
    });
    await symlink(
      bffEffectDirectory,
      path.join(root, 'node_modules/@modern-js/bff-effect'),
    );
    await writeFile(path.join(root, 'entries.js'), EFFECT_ENTRIES);
    await writeFile(path.join(root, 'decode.js'), HOST_DECODE);
    await writeFile(path.join(root, 'contact.js'), REMOTE_CONTACT);
    packages = resolveFrameworkSharedPackages(root);
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('shares effect and its subpaths wherever it shares bff-effect', () => {
    expect(packages.map(({ prefix }) => prefix)).toEqual([
      '@modern-js/bff-effect/',
      'effect/',
    ]);
    const shared = withFrameworkShared({}, packages) as Record<string, object>;
    const effect = {
      requiredVersion: effectVersion,
      singleton: true,
      treeShaking: false,
    };
    expect(shared.effect).toEqual(effect);
    expect(shared['effect/']).toEqual(effect);
  });

  const federate = async (shared: object) => {
    expect(
      await compile(root, 'host', { './decode': './decode.js' }, shared),
    ).toEqual([]);
    expect(
      await compile(root, 'remote', { './contact': './contact.js' }, shared),
    ).toEqual([]);
    const load = (name: string) =>
      createRequire(__filename)(
        path.join(root, 'dist', name, 'remoteEntry.js'),
      ) as Container;
    const host = load('host');
    const remote = load('remote');
    const shareScope = {};
    await host.init(shareScope);
    const hostExports = (await host.get('./decode'))();
    await remote.init(shareScope);
    return { host: hostExports, remote: (await remote.get('./contact'))() };
  };

  it('resolves one Effect instance in the host and the remote', async () => {
    const { host, remote } = await federate(withFrameworkShared({}, packages));
    expect(remote.effect.index).toBe(host.effect.index);
    expect(remote.effect.subpath).toBe(host.effect.subpath);
    const contact = host.decode(remote.Contact, { name: 'Ada' });
    expect(contact).toBeInstanceOf(remote.Contact);
    expect(contact.name).toBe('Ada');
  });

  it('gives the remote its own Effect when only bff-effect is shared', async () => {
    const { host, remote } = await federate(
      withFrameworkShared(
        {},
        packages.filter(({ prefix }) => prefix !== 'effect/'),
      ),
    );
    expect(remote.effect.index).not.toBe(host.effect.index);
    expect(remote.effect.subpath).not.toBe(host.effect.subpath);
  });
});
