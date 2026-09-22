// The headless entry must drive the real TanStack artifact writer. Checking
// only the createRunOptions/cli.init choreography would allow a no-op CLI to
// pass while leaving router.gen.ts stale or missing.
const createRunOptionsMock = rstest.fn(async (options: unknown) => ({
  mockRunOptions: true,
  received: options,
}));
const cliInitMock = rstest.fn(async () => ({
  appContext: { hooks: { onBeforeExit: { call: async () => {} } } },
}));

rstest.mock('@modern-js/app-tools/cli/run', () => ({
  createRunOptions: createRunOptionsMock,
}));
rstest.mock('@modern-js/plugin/cli', () => ({
  cli: { init: cliInitMock },
}));

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAsyncHook } from '@modern-js/plugin';
import { INTERNAL_RUNTIME_PLUGINS } from '@modern-js/utils';
import {
  generateTanstackRouteArtifacts,
  writeTanstackRouterTypesForEntries,
} from '../../src/cli';

function makeAppDir(withConfig: boolean): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tanstack-routes-gen-'));
  if (withConfig) {
    fs.writeFileSync(
      path.join(dir, 'modern.config.ts'),
      'export default {};\n',
      'utf-8',
    );
  }
  return dir;
}

describe('generateTanstackRouteArtifacts (headless routes-generate)', () => {
  beforeEach(() => {
    createRunOptionsMock.mockClear();
    cliInitMock.mockClear();
  });

  it('writes a real route artifact through the prepare-only CLI drive', async () => {
    const previousArgv = process.env.MODERN_ARGV;
    const appDirectory = makeAppDir(true);
    const srcDirectory = path.join(appDirectory, 'src');
    const componentPath = path.join(srcDirectory, 'routes', 'page.tsx');
    fs.mkdirSync(path.dirname(componentPath), { recursive: true });
    fs.writeFileSync(
      componentPath,
      'export default function Page() { return null; }\n',
      'utf-8',
    );

    const runOptions = {
      cwd: appDirectory,
      version: '9.9.9-test',
      internalPlugins: INTERNAL_RUNTIME_PLUGINS,
      configFile: path.resolve(appDirectory, 'modern.config'),
    };
    createRunOptionsMock.mockResolvedValue({
      mockRunOptions: true,
      received: runOptions,
    });
    const onBeforeExit = createAsyncHook<() => Promise<void>>();
    let disposed = false;
    onBeforeExit.tap(async () => {
      await Promise.resolve();
      disposed = true;
    });
    cliInitMock.mockImplementation(async () => {
      await writeTanstackRouterTypesForEntries({
        appContext: {
          srcDirectory,
          internalSrcAlias: '@/_',
          entrypoints: [{ entryName: 'main', isMainEntry: true }],
        } as any,
        routesByEntry: {
          main: [
            {
              type: 'nested',
              id: 'layout',
              isRoot: true,
              children: [
                {
                  type: 'nested',
                  id: 'page',
                  index: true,
                  _component: '@/_/routes/page',
                },
              ],
            },
          ] as any,
        },
      });
      return { appContext: { hooks: { onBeforeExit } } };
    });

    try {
      await generateTanstackRouteArtifacts({
        appDirectory,
        version: '9.9.9-test',
      });

      expect(createRunOptionsMock).toHaveBeenCalledTimes(1);
      const runOptionsArg = createRunOptionsMock.mock.calls[0][0] as Record<
        string,
        unknown
      >;
      // The headless entry must resolve cwd/configFile from the target app
      // directory, not the process's own cwd — that was the actual bug.
      expect(runOptionsArg.cwd).toBe(appDirectory);
      expect(runOptionsArg.configFile).toBe(
        path.resolve(appDirectory, 'modern.config'),
      );

      expect(cliInitMock).toHaveBeenCalledTimes(1);
      expect(disposed).toBe(true);

      expect(
        fs.existsSync(
          path.join(srcDirectory, 'modern-tanstack', 'main', 'router.gen.ts'),
        ),
      ).toBe(true);
      const registerArtifact = fs.readFileSync(
        path.join(srcDirectory, 'modern-tanstack', 'register.gen.d.ts'),
        'utf-8',
      );
      expect(registerArtifact).toContain('./main/router.gen');
    } finally {
      fs.rmSync(appDirectory, { force: true, recursive: true });
      if (previousArgv === undefined) {
        delete process.env.MODERN_ARGV;
      } else {
        process.env.MODERN_ARGV = previousArgv;
      }
    }
  });

  it('preserves initialization and cleanup failures', async () => {
    const appDirectory = makeAppDir(true);
    const initializationFailure = new Error('prepare failed');
    const cleanupFailure = new Error('dispose failed');
    const onBeforeExit = createAsyncHook<() => Promise<void>>();
    onBeforeExit.tap(async () => {
      throw cleanupFailure;
    });
    try {
      cliInitMock.mockRejectedValueOnce(initializationFailure);
      await expect(
        generateTanstackRouteArtifacts({ appDirectory }),
      ).rejects.toBe(initializationFailure);
      cliInitMock.mockResolvedValueOnce({
        appContext: { hooks: { onBeforeExit } },
      });
      await expect(
        generateTanstackRouteArtifacts({ appDirectory }),
      ).rejects.toBe(cleanupFailure);
    } finally {
      fs.rmSync(appDirectory, { force: true, recursive: true });
    }
  });

  it('throws a clear error when no config file exists', async () => {
    const appDirectory = makeAppDir(false);

    try {
      await expect(
        generateTanstackRouteArtifacts({ appDirectory }),
      ).rejects.toThrow(/Unable to locate a Modern\.js config file/u);
      expect(createRunOptionsMock).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(appDirectory, { force: true, recursive: true });
    }
  });
});
