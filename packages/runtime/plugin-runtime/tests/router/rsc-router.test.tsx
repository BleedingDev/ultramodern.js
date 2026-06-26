import type {
  RouteObject,
  StaticHandlerContext,
} from '@modern-js/runtime-utils/router';
import { describe, expect, it } from '@rstest/core';
import React from 'react';

(
  globalThis as typeof globalThis & {
    __webpack_require__?: { u: (chunkId: unknown) => string };
  }
).__webpack_require__ = {
  u: chunkId => String(chunkId),
};

const ComponentRoute = ({ loaderData }: { loaderData?: string }) => (
  <div>{loaderData}</div>
);

describe('RSC router payload', () => {
  it('serializes React Router Component routes into payload elements', async () => {
    (
      globalThis as typeof globalThis & {
        __webpack_require__?: { u: (chunkId: unknown) => string };
      }
    ).__webpack_require__ = {
      u: chunkId => String(chunkId),
    };

    const { createServerPayload } = await import(
      '../../src/router/runtime/rsc-router'
    );
    const route: RouteObject = {
      id: 'root',
      path: '/',
      Component: ComponentRoute,
      loader: () => 'from-loader',
    };
    const routerContext = {
      actionData: null,
      errors: null,
      loaderData: {
        root: 'from-loader',
      },
      location: {
        pathname: '/',
        search: '',
        hash: '',
        state: null,
        key: 'default',
      },
      matches: [
        {
          params: {},
          pathname: '/',
          pathnameBase: '/',
          route,
        },
      ],
    } as unknown as StaticHandlerContext;

    const payload = createServerPayload(routerContext, [route]);
    const element = payload.routes[0]?.element;

    expect(React.isValidElement(element)).toBe(true);
    expect(
      (element as React.ReactElement<{ loaderData?: string }>).props.loaderData,
    ).toBe('from-loader');
  });
});
