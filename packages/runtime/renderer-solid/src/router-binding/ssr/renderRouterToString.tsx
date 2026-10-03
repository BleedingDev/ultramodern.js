import type { JSX } from '@solidjs/web';
import * as Solid from '@solidjs/web';
import type { AnyRouter } from '@tanstack/router-core';
import { renderSsrHtmlResponse } from '@tanstack/router-core/ssr/server';
import {
  getSolidRenderOptions,
  type SolidRenderOptions,
} from './renderOptions';

export const renderRouterToString = ({
  router,
  responseHeaders,
  children,
  manifest,
}: {
  router: AnyRouter;
  responseHeaders: Headers;
  children: () => JSX.Element;
  manifest?: SolidRenderOptions['manifest'];
}) => {
  return renderSsrHtmlResponse({
    router,
    responseHeaders,
    render: () =>
      Solid.renderToString(children, getSolidRenderOptions(router, manifest)),
  });
};
