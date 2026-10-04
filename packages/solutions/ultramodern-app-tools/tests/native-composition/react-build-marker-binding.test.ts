import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import {
  createUltramodernBuildArtifact,
  DELIVERY_UNIT_DEPLOY_PROFILE,
  DELIVERY_UNIT_KIND,
  DELIVERY_UNIT_SCHEMA_VERSION,
  resolveUltramodernBuildArtifact,
} from '@modern-js/backend-federation-contracts';
import { type Rspack, rspack } from '@rsbuild/core';
import { afterEach, describe, expect, it } from '@rstest/core';
import {
  installReactBuildMarkerBinding,
  REACT_BUILD_MARKER_EXPRESSION,
  REACT_SOURCE_REVISION_EXPRESSION,
  type ReactBuildMarkerBinding,
} from '../../src/native-composition/react-build-marker-binding';

const roots: string[] = [];
const compilers: Rspack.Compiler[] = [];
const markerA = 'a'.repeat(64);
const markerB = 'b'.repeat(64);
const revisionA = '1'.repeat(40);
const revisionB = '2'.repeat(40);

const source = `const resolve = require('shared-build-resolver');
module.exports = {
  artifact: resolve({
    buildMarker: () => ULTRAMODERN_BUILD_MARKER,
    sourceRevision: () => ULTRAMODERN_SOURCE_REVISION,
  }),
  marker: ULTRAMODERN_BUILD_MARKER,
  revision: ULTRAMODERN_SOURCE_REVISION,
  type: typeof ULTRAMODERN_BUILD_MARKER,
  branch: ULTRAMODERN_BUILD_MARKER === '${markerA}' ? 'bound' : 'other',
};\n`;

// Every executed compiler calls this same public resolver function. Its
// readers still belong to the caller's native compilation runtime.
const originalArtifact = createUltramodernBuildArtifact({
  appId: 'native-marker',
  buildMarker: 'original',
  deployProfile: DELIVERY_UNIT_DEPLOY_PROFILE,
  kind: DELIVERY_UNIT_KIND,
  packageName: '@fixture/native-marker',
  schemaVersion: DELIVERY_UNIT_SCHEMA_VERSION,
  sourceRevision: 'workspace',
  unitId: 'fixture/native-marker',
  version: '0.1.0',
});
const sharedResolver = (
  readers: Parameters<typeof resolveUltramodernBuildArtifact>[1],
) => resolveUltramodernBuildArtifact(originalArtifact, readers);

afterEach(async () => {
  const failures: unknown[] = [];
  for (const compiler of compilers.splice(0).reverse()) {
    try {
      await new Promise<void>((resolve, reject) =>
        compiler.close(error => (error ? reject(error) : resolve())),
      );
    } catch (error) {
      failures.push(error);
    }
  }
  for (const root of roots.splice(0)) {
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length) {
    throw new AggregateError(failures, 'Native marker compiler cleanup failed');
  }
});

function fixture(
  target: 'web' | 'node',
  name: string,
  getBinding: () => ReactBuildMarkerBinding | undefined,
  shouldEmit: () => boolean,
) {
  const root = fs.realpathSync(
    fs.mkdtempSync(
      path.join(process.env.OWNED_TEMP_DIR ?? os.tmpdir(), 'um-marker-'),
    ),
  );
  roots.push(root);
  const entry = path.join(root, 'entry.cjs');
  const output = path.join(root, 'dist');
  fs.writeFileSync(entry, source);
  const compiler = rspack({
    context: root,
    name,
    mode: 'production',
    target,
    entry,
    cache: true,
    devtool: 'source-map',
    externals: { 'shared-build-resolver': 'commonjs shared-build-resolver' },
    output: {
      path: output,
      filename: '[name].[contenthash].cjs',
      library: { type: 'commonjs2' },
      clean: true,
    },
    optimization: { minimize: true },
    plugins: [
      new rspack.DefinePlugin({
        ULTRAMODERN_BUILD_MARKER: REACT_BUILD_MARKER_EXPRESSION,
        ULTRAMODERN_SOURCE_REVISION: REACT_SOURCE_REVISION_EXPRESSION,
      }),
    ],
  });
  compilers.push(compiler);
  installReactBuildMarkerBinding(compiler, rspack, {
    getBinding,
    shouldEmit,
  });
  return { compiler, entry, output };
}

function run(compiler: Rspack.Compiler): Promise<Rspack.Stats> {
  return new Promise((resolve, reject) => {
    compiler.run((error, stats) => {
      if (error) return reject(error);
      if (!stats) return reject(new Error('Native compiler returned no stats'));
      if (stats.hasErrors()) {
        return reject(new Error(stats.toString({ all: false, errors: true })));
      }
      resolve(stats);
    });
  });
}

function execute(output: string, binding: ReactBuildMarkerBinding) {
  const files = fs.readdirSync(output).filter(file => file.endsWith('.cjs'));
  expect(files).toHaveLength(1);
  const filename = files[0]!;
  const module = { exports: {} };
  runInNewContext(fs.readFileSync(path.join(output, filename), 'utf8'), {
    module,
    exports: module.exports,
    require(specifier: string) {
      expect(specifier).toBe('shared-build-resolver');
      return sharedResolver;
    },
  });
  expect(module.exports).toEqual({
    artifact: resolveUltramodernBuildArtifact(originalArtifact, {
      buildMarker: () => binding.buildMarker,
      sourceRevision: () => binding.sourceRevision,
    }),
    marker: binding.buildMarker,
    revision: binding.sourceRevision,
    type: 'string',
    branch: binding.buildMarker === markerA ? 'bound' : 'other',
  });
  const map = JSON.parse(
    fs.readFileSync(path.join(output, `${filename}.map`), 'utf8'),
  );
  expect(map.sourcesContent).toContain(source);
  return filename;
}

describe('native finalized marker runtime binding', () => {
  for (const target of ['web', 'node'] as const) {
    it(`discovers without emission and updates minimized ${target} output on one cached compiler`, async () => {
      let binding: ReactBuildMarkerBinding | undefined;
      let emitting = false;
      const actual = fixture(
        target,
        target,
        () => binding,
        () => emitting,
      );
      await run(actual.compiler);
      expect(fs.existsSync(actual.output)).toBe(false);

      binding = { buildMarker: markerA, sourceRevision: revisionA };
      emitting = true;
      await run(actual.compiler);
      const first = execute(actual.output, binding);

      binding = { buildMarker: markerB, sourceRevision: revisionB };
      await run(actual.compiler);
      const second = execute(actual.output, binding);
      expect(second).not.toBe(first);
      expect(fs.readFileSync(actual.entry, 'utf8')).toBe(source);
    });
  }

  it('keeps two producer identities isolated while using one shared public resolver', async () => {
    let clientBinding = { buildMarker: markerA, sourceRevision: revisionA };
    const serverBinding = { buildMarker: markerB, sourceRevision: revisionB };
    const client = fixture(
      'web',
      'client',
      () => clientBinding,
      () => true,
    );
    const server = fixture(
      'node',
      'server',
      () => serverBinding,
      () => true,
    );
    await run(client.compiler);
    await run(server.compiler);
    const first = execute(client.output, clientBinding);
    const serverFile = execute(server.output, serverBinding);

    clientBinding = { buildMarker: 'c'.repeat(64), sourceRevision: revisionA };
    await run(client.compiler);
    expect(execute(client.output, clientBinding)).not.toBe(first);
    expect(execute(server.output, serverBinding)).toBe(serverFile);
  });

  it('withholds emitted assets when the owning phase has no finalized marker', async () => {
    const actual = fixture(
      'node',
      'unbound',
      () => undefined,
      () => true,
    );
    await expect(run(actual.compiler)).rejects.toThrow(
      'requires its finalized runtime build identity',
    );
    expect(fs.existsSync(actual.output)).toBe(false);
  });

  it('preserves nonpromotable source revisions admitted by the renderer manifest', async () => {
    let binding = { buildMarker: markerA, sourceRevision: 'dirty' };
    const actual = fixture(
      'node',
      'nonpromotable',
      () => binding,
      () => true,
    );
    for (const sourceRevision of ['dirty', 'unknown', 'snapshot:local']) {
      binding = { buildMarker: markerA, sourceRevision };
      await run(actual.compiler);
      execute(actual.output, binding);
    }
  });

  it('rejects empty source provenance before publishing runtime assets', async () => {
    for (const sourceRevision of ['', '   ']) {
      const actual = fixture(
        'node',
        'empty-provenance',
        () => ({ buildMarker: markerA, sourceRevision }),
        () => true,
      );
      await expect(run(actual.compiler)).rejects.toThrow(
        'requires its finalized runtime build identity',
      );
      expect(fs.existsSync(actual.output)).toBe(false);
    }
  });

  it('preserves a later native emission veto after validating its binding', async () => {
    const actual = fixture(
      'node',
      'native-veto',
      () => ({ buildMarker: markerA, sourceRevision: revisionA }),
      () => true,
    );
    let vetoCalls = 0;
    actual.compiler.hooks.shouldEmit.tap('LaterNativeEmissionGate', () => {
      vetoCalls++;
      return false;
    });
    await run(actual.compiler);
    expect(vetoCalls).toBe(1);
    expect(fs.existsSync(actual.output)).toBe(false);
  });
});
