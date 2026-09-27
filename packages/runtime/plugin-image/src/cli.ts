import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Http2ServerRequest, Http2ServerResponse } from 'node:http2';
import path from 'node:path';
import type { AppTools, CliPlugin, Rspack } from '@modern-js/app-tools';
import {
  type PluginImageOptions as BuilderPluginImageOptions,
  pluginImage as builderPluginImage,
  type ExtendedIPXOptions,
} from '@rsbuild-image/core';
import type { createIPXNodeHandler } from 'ipx';

export interface ImagePluginOptions
  extends Omit<BuilderPluginImageOptions, 'ipx'> {
  /** Options for the dev server's IPX route, `/_modern/ipx` by default. */
  ipx?: ExtendedIPXOptions;
}

export const imagePlugin = (
  options: ImagePluginOptions = {},
): CliPlugin<AppTools> => ({
  name: '@modern-js/image',
  setup: api => {
    const { ipx = {}, ...builderPluginOptions } = options;
    const { assetPrefix = '/_modern/ipx', ...ipxOptions } = ipx;
    const route = `${assetPrefix.replace(/\/+$/, '')}/`;
    // Dev output may live only in memory (`dev.writeToDisk: false`).
    let web: Rspack.Compiler | undefined;
    api.onAfterCreateCompiler(({ compiler }) => {
      const all = 'compilers' in compiler ? compiler.compilers : [compiler];
      web = all.find(item => item.name === 'web') ?? all[0];
    });
    const output = <T>(method: 'stat' | 'readFile', id: string) =>
      new Promise<T>((resolve, reject) => {
        const outputFileSystem = web?.outputFileSystem;
        const read = outputFileSystem?.[method] as
          | ((file: string, done: (error?: unknown, value?: T) => void) => void)
          | undefined;
        if (!web || !read) return reject(new Error('No web compiler output'));
        const file = path.resolve(web.outputPath, `.${path.sep}${id}`);
        const inside = path.relative(web.outputPath, file);
        if (
          inside === '..' ||
          inside.startsWith(`..${path.sep}`) ||
          path.isAbsolute(inside)
        ) {
          return reject(new Error(`IPX source outside the dev output: ${id}`));
        }
        read.call(outputFileSystem, file, (error, value) =>
          error ? reject(error) : resolve(value as T),
        );
      });
    let handler: Promise<ReturnType<typeof createIPXNodeHandler>> | undefined;
    const serveIPX = () =>
      (handler ??= import('ipx').then(({ createIPX, createIPXNodeHandler }) =>
        createIPXNodeHandler(
          createIPX({
            storage: {
              name: '@modern-js/image:dev-output',
              getMeta: async id => ({
                mtime: (await output<{ mtime: Date }>('stat', id)).mtime,
              }),
              getData: id => output<Buffer>('readFile', id),
            },
            ...ipxOptions,
          }),
        ),
      ));

    api.config(() => ({
      source: {
        define: {
          __RSBUILD_IMAGE_IPX_ASSET_PREFIX__: JSON.stringify(assetPrefix),
        },
      },
      dev: {
        setupMiddlewares: [
          middlewares => {
            middlewares.push((req, res, next) => {
              if (!req.url?.startsWith(route)) return next();
              req.url = req.url.slice(route.length - 1);
              // srvx types an HTTP/1 or HTTP/2 handler; it serves either.
              serveIPX()
                .then(serve =>
                  serve(
                    req as IncomingMessage & Http2ServerRequest,
                    res as ServerResponse & Http2ServerResponse,
                  ),
                )
                .catch(next);
            });
          },
        ],
      },
      builderPlugins: [
        builderPluginImage({
          ...builderPluginOptions,
          // rsbuild-image would mount IPX with ipx 3; the dev server serves
          // ipx 4 itself. Builds still require a custom loader.
          loader:
            builderPluginOptions.loader ??
            (api.getAppContext().command === 'dev'
              ? require.resolve('@rsbuild-image/core/image-loader')
              : undefined),
        }) as any,
      ],
    }));
  },
});

export default imagePlugin;
