import { fs } from '@modern-js/utils';
import path from 'path';
import Watcher, {
  defaultWatchOptions,
  getWatchedFiles,
  mergeWatchOptions,
} from '../src/dev-tools/watcher';
import { DependencyTree } from '../src/dev-tools/watcher/dependencyTree';
import { StatsCache } from '../src/dev-tools/watcher/statsCache';

rstest.useRealTimers();

describe('watcher', () => {
  rstest.setConfig({
    testTimeout: 25000,
  });
  const pwd = path.join(__dirname, './fixtures/watch');
  const serverDir = path.normalize(path.join(pwd, './tmp-server'));

  beforeAll(() => {
    if (fs.existsSync(serverDir)) {
      fs.removeSync(serverDir);
    }
    fs.mkdirSync(serverDir);
  });

  afterAll(() => {
    fs.removeSync(serverDir);
  });

  // const writeFiles = (content: string, filepath: string) => {
  //   fs.writeFileSync(path.normalize(filepath), content, 'utf8');
  // };

  // TODO 容易导致 timeout，暂时注释掉
  // test('should emit add', done => {
  //   const watcher = new Watcher();
  //   const callback = rstest.fn();

  //   const watchDir = path.join(serverDir, 'add');
  //   fs.mkdirSync(watchDir);

  //   watcher.listen(
  //     [`${watchDir}/**/*`],
  //     {
  //       ignoreInitial: true,
  //       ignored: /api\/typings\/.*/,
  //     },
  //     async () => {
  //       try {
  //         callback();
  //         expect(callback).toHaveBeenCalledTimes(1);
  //         await watcher.close();
  //       } catch (e) {
  //         console.error(e);
  //       }
  //       done();
  //     },
  //   );

  //   setTimeout(() => writeFiles('test', path.join(watchDir, 'index.js')), 100);
  // });

  // TODO 容易导致 timeout，暂时注释掉
  // test('should emit unlink', done => {
  //   const watcher = new Watcher();

  //   const callback = rstest.fn();
  //   const watchDir = path.join(serverDir, 'unlink');
  //   fs.mkdirSync(watchDir);

  //   const filepath = path.join(watchDir, 'index.js');
  //   writeFiles('unlink', filepath);

  //   watcher.listen(
  //     [`${watchDir}/**/*`],
  //     {
  //       ignoreInitial: true,
  //       ignored: /api\/typings\/.*/,
  //     },
  //     async () => {
  //       callback();
  //       expect(callback).toHaveBeenCalledTimes(1);
  //       await watcher.close();
  //       done();
  //     },
  //   );

  //   setTimeout(() => {
  //     fs.removeSync(filepath);
  //   }, 100);
  // });

  // TODO 容易导致 timeout，暂时注释掉
  // test('should emit change', done => {
  //   const watcher = new Watcher();

  //   const callback = rstest.fn();
  //   const watchDir = path.join(serverDir, 'change');
  //   fs.mkdirSync(watchDir);

  //   const filepath = path.join(watchDir, 'index.js');
  //   writeFiles('start', filepath);

  //   watcher.listen(
  //     [`${watchDir}/**/*`],
  //     {
  //       ignoreInitial: true,
  //       ignored: /api\/typings\/.*/,
  //     },
  //     async () => {
  //       callback();
  //       expect(callback).toHaveBeenCalledTimes(1);
  //       await watcher.close();
  //       done();
  //     },
  //   );

  //   setTimeout(() => writeFiles('end', filepath), 100);
  // });

  test('watches symlinked shared source without traversing its installed dependencies', async () => {
    const root = path.join(serverDir, 'linked-shared');
    const shared = path.join(root, 'shared');
    const source = path.join(root, 'workspace-package');
    const dependencies = path.join(root, 'installed');
    fs.ensureDirSync(shared);
    fs.ensureDirSync(source);
    fs.ensureDirSync(dependencies);
    fs.writeFileSync(path.join(source, 'index.ts'), 'export const value = 1;');
    fs.writeFileSync(
      path.join(dependencies, 'dependency.js'),
      'module.exports = 1;',
    );
    fs.symlinkSync(source, path.join(shared, 'effect'), 'junction');
    fs.symlinkSync(dependencies, path.join(source, 'node_modules'), 'junction');
    const watcher = new Watcher();
    const events: string[] = [];
    let sourceChanged!: () => void;
    const changed = new Promise<void>(resolve => {
      sourceChanged = resolve;
    });
    watcher.listen([shared], mergeWatchOptions({}), file => {
      events.push(file);
      if (file === path.join(shared, 'effect/index.ts')) sourceChanged();
    });
    try {
      await new Promise<void>(resolve =>
        (watcher as any).watcher.once('ready', resolve),
      );
      fs.writeFileSync(
        path.join(dependencies, 'dependency.js'),
        'module.exports = 2;',
      );
      fs.writeFileSync(
        path.join(source, 'index.ts'),
        'export const value = 2;',
      );
      await changed;
      expect(
        getWatchedFiles((watcher as any).watcher).filter(file =>
          file.includes('node_modules'),
        ),
      ).toEqual([]);
      expect(events).toContain(path.join(shared, 'effect/index.ts'));
      expect(events.filter(file => file.includes('node_modules'))).toEqual([]);
    } finally {
      await watcher.close();
      fs.removeSync(root);
    }
  });

  test('should not emit change when typings file changed', async () => {
    const watcher = new Watcher();
    const apiDir = path.normalize(path.join(pwd, './api'));

    const callback = rstest.fn();

    if (fs.pathExistsSync(apiDir)) {
      fs.removeSync(apiDir);
    }

    const clear = () => {
      fs.removeSync(apiDir);
    };

    fs.mkdirSync(path.normalize(path.join(apiDir, 'typings')), {
      recursive: true,
    });

    watcher.listen(
      [apiDir],
      {
        ignoreInitial: true,
        ignored: /api\/typings\/.*/,
      },
      callback,
    );

    await new Promise<void>(resolve => {
      setTimeout(async () => {
        expect(callback).toHaveBeenCalledTimes(0);
        await watcher.close();
        clear();
        resolve();
      }, 1000);
    });
  });
});

describe('test watcher', () => {
  let watcher: any;
  const baseDir = path.join(__dirname, 'fixtures');
  const watchDir = path.join(baseDir, 'watch');
  const filepath = path.join(baseDir, 'watch', 'index.ts');
  const filepatha = path.join(baseDir, 'watch', 'a.ts');
  const txt = path.join(baseDir, 'watch', 'stats.txt');

  afterEach(() => {
    if (watcher) {
      watcher.close();
    }
    fs.writeFileSync(txt, '1');
  });

  it('should create watcher instance correctly', async () => {
    watcher = new Watcher();
    expect(watcher.dependencyTree).toBeNull();
    watcher.createDepTree();
    expect(watcher.dependencyTree).not.toBeNull();

    expect(watcher.watcher).toBeUndefined();
    watcher.listen([watchDir], {}, () => {
      // empty
    });

    expect(watcher.watcher).toBeDefined();
    require.cache[filepath] = {
      id: filepath,
      filename: filepath,
      loaded: true,
      exports: {},
      children: [],
      paths: [],
      parent: module,
    } as unknown as NodeModule;
    expect(watcher.dependencyTree.getNode(filepath)).toBeUndefined();
    watcher.updateDepTree();
    expect(watcher.dependencyTree.getNode(filepath)).toBeDefined();
    watcher.cleanDepCache(filepath);
    if (process.env.MODERN_LIB_FORMAT !== 'esm') {
      expect(watcher.dependencyTree.getNode(filepath)).toBeDefined();
      expect(require.cache[filepath]).toBeUndefined();
    }

    await new Promise<void>(resolve => {
      setTimeout(() => {
        const fl = getWatchedFiles(watcher.watcher);
        expect(fl.includes(filepatha)).toBeTruthy();
        expect(fl.includes(filepath)).toBeTruthy();
        expect(fl.includes(txt)).toBeTruthy();
        delete require.cache[filepath];
        resolve();
      }, 1000);
    });
  });

  it('should stats cache instance work correctly', () => {
    const statsCache = new StatsCache();

    // should not exist false before add
    expect(statsCache.has(txt)).toBeFalsy();

    // should exist true after add
    statsCache.add([txt]);
    expect(statsCache.has(txt)).toBeTruthy();

    // should diff correctly
    fs.writeFileSync(txt, 'foo');
    expect(statsCache.isDiff(txt)).toBeTruthy();

    // should not diff if not refresh
    fs.writeFileSync(txt, '1');
    expect(statsCache.isDiff(txt)).toBeFalsy();

    // should diff after refresh
    fs.writeFileSync(txt, 'foo');
    statsCache.refresh(txt);
    fs.writeFileSync(txt, '1');
    expect(statsCache.isDiff(txt)).toBeTruthy();

    // should diff when content change
    statsCache.refresh(txt);
    fs.writeFileSync(txt, '2');
    expect(statsCache.isDiff(txt)).toBeTruthy();

    // should not exist after del
    statsCache.del(txt);
    expect(statsCache.has(txt)).toBeFalsy();
  });

  it('mergeWatchOptions should works correctly', async () => {
    const options1 = undefined;
    const finalOptions1 = mergeWatchOptions(options1);
    expect(finalOptions1).toEqual(defaultWatchOptions);

    const options2 = {
      ignored: /api\/mock\/.*/,
    };
    const finalOptions2 = mergeWatchOptions(options2);
    expect(finalOptions2).toHaveProperty('ignoreInitial');
    expect(finalOptions2).toHaveProperty('ignored');
    expect((finalOptions2.ignored as unknown[]).length).toBe(2);
    expect(finalOptions2.ignored).toEqual([
      defaultWatchOptions.ignored,
      /api\/mock\/.*/,
    ]);

    const options3 = {
      ignored: [/api\/mock\/.*/],
    };
    const finalOptions = mergeWatchOptions(options3);
    expect(finalOptions).toHaveProperty('ignoreInitial');
    expect(finalOptions).toHaveProperty('ignored');
    expect((finalOptions.ignored as unknown[]).length).toBe(2);
    expect(finalOptions.ignored).toEqual([
      defaultWatchOptions.ignored,
      /api\/mock\/.*/,
    ]);

    const options4 = {
      useFsEvents: false,
    };
    const finalOptions4 = mergeWatchOptions(options4);
    expect(finalOptions4).toEqual({
      ...defaultWatchOptions,
      useFsEvents: false,
    });
  });
});

test('dependency tree preserves shared parents and cycles while excluding generated and installed modules', () => {
  const root = process.cwd();
  const node = (file: string) =>
    ({
      filename: path.join(root, file),
      children: [],
    }) as unknown as NodeModule;
  const first = node('server/first.js');
  const second = node('server/second.js');
  const shared = node('server/shared.js');
  const ignored = [
    node('node_modules/pkg/index.js'),
    node('server/.generated/index.js'),
    node('server/types.d.ts'),
    node('coverage/index.js'),
    node('server/output.log'),
  ];
  first.children = [shared, ...ignored];
  second.children = [shared];
  shared.children = [first];
  shared.parent = first;
  const cache = Object.fromEntries(
    [first, second, shared, ...ignored].map(module => [
      module.filename,
      module,
    ]),
  );
  const tree = new DependencyTree();
  tree.update(cache);
  expect(
    [...tree.getNode(shared.filename)!.parent]
      .map(node => node.module.filename)
      .sort(),
  ).toEqual([first.filename, second.filename].sort());
  expect(
    [...tree.getNode(first.filename)!.children].map(
      node => node.module.filename,
    ),
  ).toEqual([shared.filename]);
  expect(
    [...tree.getNode(shared.filename)!.children].map(
      node => node.module.filename,
    ),
  ).toEqual([first.filename]);
  for (const module of ignored)
    expect(tree.getNode(module.filename)).toBeUndefined();
  delete cache[second.filename];
  tree.update(cache);
  expect(tree.getNode(second.filename)).toBeUndefined();
  expect(
    [...tree.getNode(shared.filename)!.parent].map(
      node => node.module.filename,
    ),
  ).toEqual([first.filename]);
});
