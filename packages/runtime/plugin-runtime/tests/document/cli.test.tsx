import type { AppTools, AppToolsContext } from '@modern-js/app-tools';
import {
  type CLIPluginAPI,
  createPluginManager,
  type Plugin,
} from '@modern-js/plugin';
import { createContext, initPluginAPI } from '@modern-js/plugin/cli';
import { rs } from '@rstest/core';
import path from 'path';
import { getBundleEntry } from '../../../../solutions/app-tools/src/plugins/analyze/getBundleEntry';
import {
  documentPlugin,
  getDocumentByEntryName,
  getDocumentTempEntry,
} from '../../src/document/cli';

describe('plugin runtime cli', () => {
  let pluginAPI: CLIPluginAPI<AppTools>;
  const setup = async ({ appDirectory }: { appDirectory: string }) => {
    const pluginManager = createPluginManager();
    pluginManager.addPlugins([documentPlugin() as Plugin]);
    const plugins = pluginManager.getPlugins();
    const context = await createContext<AppTools>({
      appContext: {
        appDirectory,
        plugins,
      } as any,
      config: {},
      normalizedConfig: { plugins: [] } as any,
    });
    pluginAPI = initPluginAPI<AppTools>({
      context,
      pluginManager,
    });
    context.pluginAPI = pluginAPI;
    for (const plugin of plugins) {
      await plugin?.setup?.(pluginAPI);
    }
  };
  beforeAll(async () => {
    await setup({ appDirectory: path.join(__dirname, './feature') });
  });
  it('plugin is defined', () => {
    expect(documentPlugin).toBeDefined();
  });

  it('plugin-document cli config is defined', async () => {
    const hooks = pluginAPI.getHooks();
    const config = await hooks.config.call();
    expect(config.find((item: any) => item.tools)).toBeTruthy();
    expect(config.find((item: any) => item.tools.htmlPlugin)).toBeTruthy();
  });

  it('runs the Document child compiler only in environments that emit HTML', async () => {
    const hooks = pluginAPI.getHooks();
    const config = await hooks.config.call();
    const { bundlerChain } = (
      config.find((item: any) => item.tools.bundlerChain)! as any
    ).tools;
    const applyChain = (htmlPaths: Record<string, string>) => {
      const use = rs.fn();
      const plugin = rs.fn(() => ({ use }));
      bundlerChain({ plugin }, { environment: { htmlPaths } });
      return use;
    };

    // The server compiler emits no HTML; running the child compiler there
    // races the web compiler over the shared temp entry file.
    expect(applyChain({})).not.toHaveBeenCalled();

    const use = applyChain({ main: 'html/main/index.html' });
    expect(use).toHaveBeenCalledTimes(1);
    expect([...use.mock.calls[0][1][0]]).toEqual(['main']);
  });

  it('gives each compiler its own Document temp entry', () => {
    expect(getDocumentTempEntry('/internal', 'web', 'main')).not.toEqual(
      getDocumentTempEntry('/internal', 'web-legacy', 'main'),
    );
  });

  it('plugin-document htmlPlugin can return the right', async () => {
    pluginAPI.updateAppContext({
      internalDirectory: path.join(__dirname, './feature'),
      appDirectory: path.join(__dirname, './feature'),
      entrypoints: [
        {
          entryName: 'main',
          absoluteEntryDir: path.join(__dirname, './feature'),
        },
      ],
    });
    const hooks = pluginAPI.getHooks();
    const config = await hooks.config.call();
    const { htmlPlugin } = (
      config.find((item: any) => item.tools.htmlPlugin)! as any
    ).tools;

    const templateParameters = rs.fn(async () => {
      return {
        title: 'abc',
      };
    });
    const mockBuilderOptions = {
      templateParameters,
      k: 'k',
    };
    const result = htmlPlugin(mockBuilderOptions, { entryName: 'main' });

    // mock renderer to bypass child-compiler output in unit test
    let documentParams: any;
    (global as any).__MODERN_DOC_RENDERERS__ = {
      main: (params: any) => {
        documentParams = params;
        return '<html><head></head><body>mock</body></html>';
      },
    };

    expect(result.k).toEqual(mockBuilderOptions.k);
    expect(result.templateParameters).toEqual(
      mockBuilderOptions.templateParameters,
    );
    expect(templateParameters).not.toHaveBeenCalled();
    expect(Object.keys(result).length > 2).toBeTruthy();
    const htmlPluginFn = result.templateContent;

    const compilation: Record<string, unknown> = {};
    compilation.self = compilation;
    const html = await htmlPluginFn({
      compilation,
      htmlPlugin: {
        tags: {
          headTags: [],
          bodyTags: '',
        },
      },
      rspackConfig: { name: 'client' },
      title: 'abc',
      asyncValue: 'resolved',
    });
    expect(html.includes('<!DOCTYPE html>')).toBeTruthy();
    expect(documentParams.templateParams).toEqual({
      title: 'abc',
      asyncValue: 'resolved',
    });
    expect(() => JSON.stringify(documentParams.templateParams)).not.toThrow();
  });
  it('when user config set empty entries and disableDefaultEntries true, should get the ', async () => {
    const hooks: any = pluginAPI.getHooks();
    const entries = await getBundleEntry(
      hooks,
      {
        internalDirectory: path.join(__dirname, './feature'),
        appDirectory: path.join(__dirname, './feature'),
      } as AppToolsContext,
      {
        source: {
          disableDefaultEntries: true,
        },
      } as any,
    );
    // empty entries
    expect(entries.length).toEqual(0);
    const documentFile = getDocumentByEntryName(
      [],
      'main',
      path.join(__dirname, './feature'),
    );
    // get the default /src/Document.tsx file
    expect(documentFile).toEqual(
      `${path.join(__dirname, './feature', './src/Document.tsx')}`,
    );
  });
});
