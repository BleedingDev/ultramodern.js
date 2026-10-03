import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { initializeOwningConfigNativeBinding } from '../../src/native-composition/config-evaluator/native-bootstrap';
import { observeConfigSourceInputs } from '../../src/native-composition/config-evaluator/observed-inputs';
import {
  assertConfigSourceSnapshotUnchanged,
  captureConfigSourceSnapshot,
} from '../../src/native-composition/config-evaluator/source-snapshot';

// Resolve the actual provider used by the owning Modern config loader.
const owningRequire = createRequire(
  path.resolve(__dirname, '../../../../toolkit/plugin/package.json'),
);
const { createJiti } = owningRequire('jiti');

type ResolutionOperation = 'cache' | 'name' | 'type' | 'content';
type ResolutionRead = <T>(
  manifestFile: string,
  operation: ResolutionOperation,
  originalRead: () => T,
) => T;
type ResolutionEvent = {
  manifestFile: string;
  operation: ResolutionOperation;
  record?: unknown;
};

function logReads(events: ResolutionEvent[]): ResolutionRead {
  return (manifestFile, operation, originalRead) => {
    const event: ResolutionEvent = { manifestFile, operation };
    events.push(event);
    const record = originalRead();
    event.record = record;
    return record;
  };
}

function loader(root: string, packageMetadataRead?: ResolutionRead) {
  return createJiti(path.join(root, 'entry.ts'), {
    fsCache: false,
    moduleCache: false,
    ...(packageMetadataRead ? { packageMetadataRead } : {}),
  });
}

function normalizedResult(root: string, result: string) {
  return path.relative(
    root,
    result.startsWith('file:') ? fileURLToPath(result) : result,
  );
}

function eventsFor(events: readonly ResolutionEvent[], filename: string) {
  return events.filter(event => event.manifestFile === filename);
}

function thrownBy(read: () => unknown): unknown {
  try {
    read();
  } catch (error) {
    return error;
  }
  throw new Error('The malformed native manifest did not throw.');
}

function errorDescription(error: unknown, root: string): unknown {
  if (!(error instanceof Error)) return error;
  return {
    name: error.name,
    message: error.message.replaceAll(root, '<fixture>'),
    code: 'code' in error ? error.code : undefined,
    cause: 'cause' in error ? errorDescription(error.cause, root) : undefined,
  };
}

async function fixture(
  run: (fixture: {
    root: string;
    baselineRoot: string;
    write: (filename: string, content: string) => void;
  }) => void | Promise<void>,
) {
  const directory = fs.realpathSync.native(
    fs.mkdtempSync(
      path.join(process.env.OWNED_TEMP_DIR ?? os.tmpdir(), 'um-jiti-metadata-'),
    ),
  );
  const root = path.join(directory, 'instrumented');
  const baselineRoot = path.join(directory, 'baseline');
  const write = (filename: string, content: string) => {
    for (const owner of [root, baselineRoot]) {
      const target = path.join(owner, filename);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
    }
  };
  write(
    'package.json',
    JSON.stringify({
      name: 'fixture-app',
      type: 'module',
      exports: { '.': './self.cjs' },
      imports: { '#fixture': './internal.cjs' },
    }),
  );
  write('entry.ts', 'export default "fixture";\n');
  for (const filename of ['self.cjs', 'internal.cjs'])
    write(
      filename,
      'throw new Error("Resolution must not execute this file");\n',
    );
  write(
    'node_modules/fixture-dependency/package.json',
    JSON.stringify({
      name: 'fixture-dependency',
      exports: { '.': './selected.cjs' },
    }),
  );
  write(
    'node_modules/fixture-dependency/selected.cjs',
    'throw new Error("Resolution must not execute this dependency");\n',
  );
  try {
    await run({ root, baselineRoot, write });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

describe('actual Jiti native package metadata branches', () => {
  it('keeps non-self bare imports independent of unconsumed app exports', () =>
    fixture(({ root, baselineRoot }) => {
      const events: ResolutionEvent[] = [];
      const original = loader(baselineRoot).esmResolve('fixture-dependency');
      const selected = loader(root, logReads(events)).esmResolve(
        'fixture-dependency',
      );
      expect(normalizedResult(root, selected)).toBe(
        normalizedResult(baselineRoot, original),
      );
      expect(normalizedResult(root, selected)).toBe(
        'node_modules/fixture-dependency/selected.cjs',
      );
      const appEvents = eventsFor(events, path.join(root, 'package.json'));
      expect(appEvents.some(event => event.operation === 'name')).toBe(true);
      expect(appEvents.some(event => event.operation === 'content')).toBe(
        false,
      );
    }));

  it.each([
    ['self-reference exports', 'fixture-app', 'self.cjs'],
    ['package imports', '#fixture', 'internal.cjs'],
  ])('attests manifest content for consumed %s', (_branch, specifier, filename) =>
    fixture(({ root, baselineRoot }) => {
      const events: ResolutionEvent[] = [];
      const original = loader(baselineRoot).esmResolve(specifier);
      const selected = loader(root, logReads(events)).esmResolve(specifier);
      expect(normalizedResult(root, selected)).toBe(
        normalizedResult(baselineRoot, original),
      );
      expect(normalizedResult(root, selected)).toBe(filename);
      expect(
        eventsFor(events, path.join(root, 'package.json')).some(
          event => event.operation === 'content',
        ),
      ).toBe(true);
    }));

  it('attests the selected legacy package main without changing resolution', () =>
    fixture(({ root, baselineRoot, write }) => {
      write(
        'node_modules/fixture-legacy/package.json',
        JSON.stringify({ name: 'fixture-legacy', main: './legacy.cjs' }),
      );
      write(
        'node_modules/fixture-legacy/legacy.cjs',
        'throw new Error("Do not execute");\n',
      );
      const events: ResolutionEvent[] = [];
      const original = loader(baselineRoot).esmResolve('fixture-legacy');
      const selected = loader(root, logReads(events)).esmResolve(
        'fixture-legacy',
      );
      expect(normalizedResult(root, selected)).toBe(
        normalizedResult(baselineRoot, original),
      );
      expect(normalizedResult(root, selected)).toBe(
        'node_modules/fixture-legacy/legacy.cjs',
      );
      expect(
        eventsFor(
          events,
          path.join(root, 'node_modules/fixture-legacy/package.json'),
        ).some(event => event.operation === 'content'),
      ).toBe(true);
    }));

  it('attests the genuine legacy JavaScript format branch without changing resolution', () =>
    fixture(({ root, baselineRoot, write }) => {
      write(
        'node_modules/fixture-format/package.json',
        JSON.stringify({
          name: 'fixture-format',
          type: 'module',
          main: './typed',
        }),
      );
      write(
        'node_modules/fixture-format/typed.js',
        'throw new Error("Do not execute");\n',
      );
      const events: ResolutionEvent[] = [];
      const original = loader(baselineRoot).esmResolve('fixture-format');
      const selected = loader(root, logReads(events)).esmResolve(
        'fixture-format',
      );
      expect(normalizedResult(root, selected)).toBe(
        normalizedResult(baselineRoot, original),
      );
      expect(
        eventsFor(
          events,
          path.join(root, 'node_modules/fixture-format/package.json'),
        ).some(event => event.operation === 'type'),
      ).toBe(true);
    }));

  it('attests every cached branch use and returns the unchanged native record', () =>
    fixture(({ root, baselineRoot }) => {
      const events: ResolutionEvent[] = [];
      const jiti = loader(root, logReads(events));
      const original = loader(baselineRoot);
      const originalFirst = original.esmResolve('fixture-app');
      const originalSecond = original.esmResolve('fixture-app');
      const manifest = path.join(root, 'package.json');
      const first = jiti.esmResolve('fixture-app');
      const firstEvents = eventsFor(events, manifest);
      const second = jiti.esmResolve('fixture-app');
      const allEvents = eventsFor(events, manifest);
      expect(second).toBe(first);
      expect(normalizedResult(root, first)).toBe(
        normalizedResult(baselineRoot, originalFirst),
      );
      expect(normalizedResult(root, second)).toBe(
        normalizedResult(baselineRoot, originalSecond),
      );
      for (const operation of ['name', 'content']) {
        expect(
          allEvents.filter(event => event.operation === operation).length,
        ).toBeGreaterThan(
          firstEvents.filter(event => event.operation === operation).length,
        );
      }
      const records = allEvents.map(event => event.record);
      expect(records.length).toBeGreaterThan(1);
      for (const record of records) expect(record).toBe(records[0]);
      expect(records[0]).toMatchObject({
        exists: true,
        pjsonPath: manifest,
        name: 'fixture-app',
      });
    }));

  it('preserves malformed manifest errors and their native causes', () =>
    fixture(({ root, baselineRoot, write }) => {
      write('package.json', '{invalid native manifest');
      const events: ResolutionEvent[] = [];
      const original = thrownBy(() =>
        loader(baselineRoot).esmResolve('fixture-dependency'),
      );
      const selected = thrownBy(() =>
        loader(root, logReads(events)).esmResolve('fixture-dependency'),
      );
      expect(errorDescription(selected, root)).toEqual(
        errorDescription(original, baselineRoot),
      );
      expect(
        eventsFor(events, path.join(root, 'package.json')).some(
          event => event.operation === 'cache',
        ),
      ).toBe(true);
    }));
});

describe('Jiti package reads retain authored config authority', () => {
  it('keeps repeated cached require values while retaining authored module evidence', () =>
    fixture(async ({ root }) => {
      const manifest = path.join(root, 'package.json');
      const author = createRequire(path.join(root, 'authored.cjs'));
      const cached = author(manifest);
      const nativeBinding = initializeOwningConfigNativeBinding();
      const sourceSnapshot = captureConfigSourceSnapshot({
        sourceRoots: [root],
      });
      const observed = await observeConfigSourceInputs(
        sourceSnapshot,
        async () => [author(manifest), author(manifest)],
        undefined,
        undefined,
        nativeBinding,
      );
      for (const value of observed.value) expect(value).toBe(cached);
      expect(observed.consumedSourceInputs.packageMetadata).toEqual([]);
      expect(observed.consumedSourceInputs.observations).toContainEqual({
        path: manifest,
        canonicalPath: manifest,
        operation: 'module',
        existed: true,
      });
      expect(() =>
        assertConfigSourceSnapshotUnchanged(sourceSnapshot),
      ).not.toThrow();
    }));

  it('rejects a source manifest edit after load even when authored Jiti returns its original JSON cache', () =>
    fixture(async ({ root }) => {
      const manifest = path.join(root, 'package.json');
      const author = createJiti(path.join(root, 'entry.ts'), {
        fsCache: false,
      });
      const cached = author(manifest);
      const nativeBinding = initializeOwningConfigNativeBinding();
      const sourceSnapshot = captureConfigSourceSnapshot({
        sourceRoots: [root],
      });
      const observed = await observeConfigSourceInputs(
        sourceSnapshot,
        async () => author(manifest),
        undefined,
        undefined,
        nativeBinding,
      );
      expect(observed.value).toBe(cached);
      expect(observed.consumedSourceInputs.observations).toContainEqual({
        path: manifest,
        canonicalPath: manifest,
        operation: 'module',
        existed: true,
      });
      expect(() =>
        assertConfigSourceSnapshotUnchanged(sourceSnapshot),
      ).not.toThrow();
      const original = JSON.parse(fs.readFileSync(manifest, 'utf8'));
      fs.writeFileSync(
        manifest,
        JSON.stringify({
          ...original,
          dependencies: { 'fixture-api': 'workspace:*' },
        }),
      );
      expect(author(manifest)).toBe(cached);
      expect(Object.hasOwn(cached, 'dependencies')).toBe(false);
      expect(() => assertConfigSourceSnapshotUnchanged(sourceSnapshot)).toThrow(
        manifest,
      );
    }));

  it('keeps native non-self scope consumption field-only after warming its cache', () =>
    fixture(async ({ root, baselineRoot }) => {
      const manifest = path.join(root, 'package.json');
      const original = loader(baselineRoot).esmResolve('fixture-dependency');
      loader(root).esmResolve('fixture-dependency');
      const nativeBinding = initializeOwningConfigNativeBinding();
      const observed = await observeConfigSourceInputs(
        captureConfigSourceSnapshot({ sourceRoots: [root] }),
        async packageMetadataRead => {
          const resolutionRead = packageMetadataRead.resolutionRead;
          if (!resolutionRead)
            throw new Error(
              'The owning Jiti resolution reader is unavailable.',
            );
          return loader(root, resolutionRead).esmResolve('fixture-dependency');
        },
        undefined,
        undefined,
        nativeBinding,
      );
      expect(normalizedResult(root, observed.value)).toBe(
        normalizedResult(baselineRoot, original),
      );
      expect(observed.consumedSourceInputs.packageMetadata).toContainEqual({
        path: manifest,
        canonicalPath: manifest,
        field: 'name',
        value: 'fixture-app',
      });
      expect(
        observed.consumedSourceInputs.observations.filter(
          input =>
            input.path === manifest &&
            (input.operation === 'content' || input.operation === 'module'),
        ),
      ).toEqual([]);
    }));

  it('preserves warm cached records through the actual observer delegate exactly once per call', () =>
    fixture(async ({ root }) => {
      const manifest = path.join(root, 'package.json');
      loader(root).esmResolve('fixture-app');
      const nativeBinding = initializeOwningConfigNativeBinding();
      const events: ResolutionEvent[] = [];
      await observeConfigSourceInputs(
        captureConfigSourceSnapshot({ sourceRoots: [root] }),
        async packageMetadataRead => {
          const resolutionRead = packageMetadataRead.resolutionRead;
          if (!resolutionRead)
            throw new Error(
              'The owning Jiti resolution reader is unavailable.',
            );
          const transparent: ResolutionRead = (
            filename,
            operation,
            originalRead,
          ) => {
            let original: unknown;
            let reads = 0;
            const returned = resolutionRead(filename, operation, () => {
              reads++;
              const value = originalRead();
              original = value;
              return value;
            });
            expect(reads).toBe(1);
            expect(returned).toBe(original);
            events.push({
              manifestFile: filename,
              operation,
              record: returned,
            });
            return returned;
          };
          const jiti = loader(root, transparent);
          const first = jiti.esmResolve('fixture-app');
          expect(jiti.esmResolve('fixture-app')).toBe(first);
        },
        undefined,
        undefined,
        nativeBinding,
      );
      const appEvents = eventsFor(events, manifest);
      expect(appEvents.some(event => event.operation === 'cache')).toBe(true);
      expect(
        appEvents.filter(event => event.operation === 'name').length,
      ).toBeGreaterThan(1);
      expect(
        appEvents.filter(event => event.operation === 'content').length,
      ).toBeGreaterThan(1);
      for (const event of appEvents)
        expect(event.record).toBe(appEvents[0]?.record);
    }));

  it.each([
    'filesystem',
    'cached Node JSON import',
    'cached Jiti JSON import',
  ])('records an authored %s after native cache consumption', kind =>
    fixture(async ({ root }) => {
      const manifest = path.join(root, 'package.json');
      const nodeAuthor = createRequire(path.join(root, 'authored.cjs'));
      const jitiAuthor = createJiti(path.join(root, 'entry.ts'), {
        fsCache: false,
      });
      const cached =
        kind === 'cached Node JSON import'
          ? nodeAuthor(manifest)
          : kind === 'cached Jiti JSON import'
            ? jitiAuthor(manifest)
            : undefined;
      const nativeBinding = initializeOwningConfigNativeBinding();
      const observed = await observeConfigSourceInputs(
        captureConfigSourceSnapshot({ sourceRoots: [root] }),
        async packageMetadataRead => {
          const resolutionRead = packageMetadataRead.resolutionRead;
          if (!resolutionRead)
            throw new Error(
              'The owning Jiti resolution reader is unavailable.',
            );
          loader(root, resolutionRead).esmResolve('fixture-dependency');
          if (kind === 'filesystem') {
            expect(JSON.parse(fs.readFileSync(manifest, 'utf8')).name).toBe(
              'fixture-app',
            );
          } else if (kind === 'cached Node JSON import') {
            expect(nodeAuthor(manifest)).toBe(cached);
          } else {
            expect(jitiAuthor(manifest)).toBe(cached);
          }
        },
        undefined,
        undefined,
        nativeBinding,
      );
      expect(observed.consumedSourceInputs.packageMetadata).toContainEqual({
        path: manifest,
        canonicalPath: manifest,
        field: 'name',
        value: 'fixture-app',
      });
      expect(observed.consumedSourceInputs.observations).toContainEqual({
        path: manifest,
        canonicalPath: manifest,
        operation: kind === 'filesystem' ? 'content' : 'module',
        existed: true,
      });
    }));

  it.each([
    'fixture-app',
    '#fixture',
  ])('records full content when native resolution consumes %s', specifier =>
    fixture(async ({ root }) => {
      const manifest = path.join(root, 'package.json');
      const nativeBinding = initializeOwningConfigNativeBinding();
      const observed = await observeConfigSourceInputs(
        captureConfigSourceSnapshot({ sourceRoots: [root] }),
        async packageMetadataRead => {
          const resolutionRead = packageMetadataRead.resolutionRead;
          if (!resolutionRead)
            throw new Error(
              'The owning Jiti resolution reader is unavailable.',
            );
          return loader(root, resolutionRead).esmResolve(specifier);
        },
        undefined,
        undefined,
        nativeBinding,
      );
      expect(observed.consumedSourceInputs.observations).toContainEqual({
        path: manifest,
        canonicalPath: manifest,
        operation: 'content',
        existed: true,
      });
    }));
});
