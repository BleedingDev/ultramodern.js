import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AppTools, CliPlugin } from '@modern-js/app-tools';
import { createCli } from '@modern-js/plugin/cli';
import { loadServerPlugins } from '../../src/utils/loadPlugins';

describe('server plugin paths', () => {
  it.each(['modern-js', 'another-host'])(
    'loads absolute paths and retains the %s namespace filter through the CLI lifecycle',
    async metaName => {
      const directory = fs.mkdtempSync(
        path.join(os.tmpdir(), 'server-plugin-paths-'),
      );
      const cli = createCli<AppTools>();
      let finish: (() => Promise<unknown>) | undefined;
      try {
        const marker = path.join(directory, 'loaded.jsonl');
        const absolutePlugin = path.join(directory, 'explicit-plugin.cjs');
        const namespacedPlugin = `@${metaName}/named-fixture`;
        const foreignPlugin = 'foreign-relative-fixture';
        const factory = `const fs = require('node:fs');
module.exports = options => {
  fs.appendFileSync(${JSON.stringify(marker)}, JSON.stringify(options) + '\\n');
  return { name: options.instanceName, setup() {} };
};`;
        fs.writeFileSync(
          path.join(directory, 'package.json'),
          JSON.stringify({ name: 'server-plugin-path-test' }),
        );
        fs.writeFileSync(absolutePlugin, factory);
        for (const name of [namespacedPlugin, foreignPlugin]) {
          const packageDirectory = path.join(directory, 'node_modules', name);
          fs.mkdirSync(packageDirectory, { recursive: true });
          fs.writeFileSync(
            path.join(packageDirectory, 'package.json'),
            JSON.stringify({ name, main: 'index.cjs' }),
          );
          fs.writeFileSync(path.join(packageDirectory, 'index.cjs'), factory);
        }
        expect(absolutePlugin).not.toContain('modern-js');
        const instances: string[] = [];
        const discovered: string[] = [];
        const lifecycle: string[] = [];
        const plugin: CliPlugin<AppTools> = {
          name: 'server-plugin-path-discovery',
          setup(api) {
            finish = () => api.getHooks().onBeforeExit.call();
            api._internalServerPlugins(({ plugins }) => ({
              plugins: [
                ...plugins,
                {
                  name: absolutePlugin,
                  options: { instanceName: 'absolute-instance' },
                },
                {
                  name: namespacedPlugin,
                  options: { instanceName: 'namespaced-instance' },
                },
                {
                  name: foreignPlugin,
                  options: { instanceName: 'foreign-instance' },
                },
              ],
            }));
            api.onPrepare(async () => {
              lifecycle.push('prepare');
              const context = api.getAppContext();
              const loaded = await loadServerPlugins(
                api,
                context.appDirectory,
                context.metaName,
              );
              instances.push(...loaded.map(instance => instance.name));
              discovered.push(
                ...api.getAppContext().serverPlugins.map(item => item.name),
              );
            });
            api.onBeforeExit(() => {
              lifecycle.push('dispose');
            });
          },
        };
        await cli.init({
          cwd: directory,
          metaName,
          command: 'inspect',
          configFile: false,
          config: {},
          internalPlugins: [plugin],
        });
        expect(discovered).toEqual([absolutePlugin, namespacedPlugin]);
        expect(instances).toEqual(['absolute-instance', 'namespaced-instance']);
        expect(
          fs
            .readFileSync(marker, 'utf8')
            .trim()
            .split('\n')
            .map(line => JSON.parse(line)),
        ).toEqual([
          { instanceName: 'absolute-instance' },
          { instanceName: 'namespaced-instance' },
        ]);
        if (!finish) throw new Error('CLI lifecycle was not initialized');
        await finish();
        finish = undefined;
        expect(lifecycle).toEqual(['prepare', 'dispose']);
      } finally {
        try {
          await finish?.();
        } finally {
          cli.dispose();
          fs.rmSync(directory, { recursive: true, force: true });
        }
      }
    },
  );
});
