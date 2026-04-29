import type { ServerOptions } from '@modern-js/server-core';
import type { ModernServerContext } from '@modern-js/types';
import { cutNameByHyphen, mime } from '@modern-js/utils';
import path from 'path';
import { ERROR_DIGEST } from '../../constants';
import type { RenderResult, ServerHookRunner } from '../../type';
import { shouldFlushServerHeader } from '../preload/shouldFlushServerHeader';
import type { ModernRoute } from '../route';
import { readFile } from './reader';
import * as ssr from './ssr';
import { handleDirectory } from './static';
import { injectServerData } from './utils';

export type RenderHandler = (options: {
  ctx: ModernServerContext;
  route: ModernRoute;
  runner: ServerHookRunner;
}) => Promise<RenderResult | null>;

type CreateRenderHandler = (ctx: {
  distDir: string;
  staticGenerate: boolean;
  conf: ServerOptions;
  ssrRender?: typeof ssr.render;
  forceCSR?: boolean;
  nonce?: string;
  metaName?: string;
}) => RenderHandler;

const calcFallback = (metaName: string) =>
  `x-${cutNameByHyphen(metaName)}-ssr-fallback`;

const readUnsafeHeaders = (ssrConfig: unknown): string[] | undefined => {
  if (!ssrConfig || typeof ssrConfig !== 'object') {
    return undefined;
  }
  const unsafeHeaders = (ssrConfig as { unsafeHeaders?: unknown })
    .unsafeHeaders;
  if (!Array.isArray(unsafeHeaders)) {
    return undefined;
  }
  return unsafeHeaders.filter(
    (header): header is string =>
      typeof header === 'string' && header.trim().length > 0,
  );
};

const resolveUnsafeHeaders = (
  conf: ServerOptions,
  entryName?: string,
): string[] | undefined => {
  if (!entryName) {
    return readUnsafeHeaders(conf.server?.ssr);
  }

  const entrySSRConfig = conf.server?.ssrByEntries?.[entryName];
  return (
    readUnsafeHeaders(entrySSRConfig) ?? readUnsafeHeaders(conf.server?.ssr)
  );
};

export const createRenderHandler: CreateRenderHandler = ({
  distDir,
  staticGenerate,
  conf,
  forceCSR,
  nonce,
  ssrRender,
  metaName = 'modern-js',
}: {
  distDir: string;
  staticGenerate: boolean;
  conf: ServerOptions;
  ssrRender?: typeof ssr.render;
  forceCSR?: boolean;
  nonce?: string;
  metaName?: string;
}): RenderHandler =>
  async function render({
    ctx,
    route,
    runner,
  }: {
    ctx: ModernServerContext;
    route: ModernRoute;
    runner: ServerHookRunner;
  }): Promise<RenderResult | null> {
    if (ctx.resHasHandled()) {
      return null;
    }

    const { entryPath, urlPath } = route;
    const unsafeHeaders = resolveUnsafeHeaders(conf, route.entryName);
    const entry = path.join(distDir, entryPath);

    if (!route.isSPA) {
      const result = await handleDirectory(ctx, entry, urlPath);
      return result;
    }

    const templatePath = entry;
    const content = await readFile(templatePath);
    if (!content) {
      return null;
    }

    // handles ssr first
    const useCSR =
      forceCSR && (ctx.query.csr || ctx.headers[calcFallback(metaName)]);
    if (route.isSSR && !useCSR) {
      try {
        const userAgent = ctx.getReqHeader('User-Agent') as string | undefined;
        // get disablePreload symbol from
        // the header is `x-modern-disable-preload`
        const disablePreload = Boolean(
          ctx.headers[`x-${cutNameByHyphen(metaName)}-disable-preload`],
        );

        if (shouldFlushServerHeader(conf.server, userAgent, disablePreload)) {
          const { flushServerHeader } = await import('../preload');
          flushServerHeader({
            serverConf: conf.server,
            ctx,
            distDir,
            template: content.toString(),
            headers: {
              'Content-Type': mime.contentType(
                path.extname(templatePath),
              ) as string,
            },
          });
        }
        const ssrRenderOptions = {
          distDir,
          entryName: route.entryName,
          urlPath: route.urlPath,
          bundle: route.bundle,
          template: content.toString(),
          staticGenerate,
          unsafeHeaders,
          nonce,
        };
        const result = await (ssrRender
          ? ssrRender(ctx, ssrRenderOptions, runner)
          : ssr.render(
              ctx,
              {
                distDir,
                entryName: route.entryName,
                urlPath: route.urlPath,
                bundle: route.bundle,
                template: content.toString(),
                staticGenerate,
                unsafeHeaders,
                nonce,
              },
              runner,
            ));
        return result;
      } catch (err) {
        ctx.error(
          ERROR_DIGEST.ERENDER,
          (err as Error).stack || (err as Error).message,
        );
        ctx.res.set(calcFallback(metaName), '1');
      }
    }

    return {
      content: route.entryName
        ? injectServerData(content.toString(), ctx, { unsafeHeaders })
        : content,
      contentType: mime.contentType(path.extname(templatePath)) as string,
    };
  };
