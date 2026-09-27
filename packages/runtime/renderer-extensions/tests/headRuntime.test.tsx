import { getHelmetContext } from '@modern-js/runtime-extensions/helmet-context';
import React, { useContext } from 'react';
import { renderToReadableStream, renderToString } from 'react-dom/server';
import {
  getGlobalEnableRsc,
  getGlobalInternalRuntimeContext,
  getInitialContext,
  InternalRuntimeContext,
  setGlobalContext,
  setGlobalInternalRuntimeContext,
} from '../../plugin-runtime/src/core/context';
import { registerPlugin } from '../../plugin-runtime/src/core/plugin';
import {
  wrapRuntimeContextProvider as nativeWrapRuntimeContextProvider,
  wrapRuntimeComponentResolver,
} from '../../plugin-runtime/src/core/react/wrapper';
import { Helmet } from '../../plugin-runtime/src/exports/head';
import rendererHeadPlugin from '../src/runtimePlugin';

const previousRuntime = getGlobalInternalRuntimeContext();
const previousRsc = getGlobalEnableRsc();
beforeEach(() => {
  setGlobalContext({ enableRsc: false });
  registerPlugin([rendererHeadPlugin()]);
});
afterEach(() => {
  setGlobalInternalRuntimeContext(previousRuntime);
  setGlobalContext({ enableRsc: previousRsc });
});

// Exercise the unchanged native provider/head entry points through registered
// collector providers. Transaction/lifecycle rendering is covered separately.
function wrapRuntimeContextProvider(
  app: React.ReactElement,
  context: ReturnType<typeof getInitialContext>,
) {
  const hooks = getGlobalInternalRuntimeContext().hooks;
  const App = hooks.wrapRoot.call(() => app);
  let root = nativeWrapRuntimeContextProvider(<App />, context);
  if (getGlobalEnableRsc() && !context.isBrowser) {
    root = wrapRuntimeComponentResolver(root);
  }
  const collectors = hooks.extendStringSSRCollectors.call({
    chunkSet: { renderLevel: 0, ssrScripts: '', jsChunk: '', cssChunk: '' },
    render: {
      runtimeContext: context,
      request: new Request('https://example.test/tractors'),
      platform: 'node',
      mode: 'string',
      isRsc: getGlobalEnableRsc() === true,
      monitors: console,
    },
  });
  for (const collector of collectors) root = collector.collect?.(root) ?? root;
  return root;
}

describe('registered native runtime/head compatibility', () => {
  it('keeps overlapping requests on their original head contexts after projection', async () => {
    const projectedContexts: object[] = [];
    getGlobalInternalRuntimeContext().pluginAPI?.transformRuntimeContext(
      (projection: any) => {
        const internalContext = { ...projection.internalContext };
        delete internalContext[
          Symbol.for('@modern-js/runtime:context-extensions')
        ];
        projectedContexts.push(internalContext);
        return { ...projection, internalContext };
      },
    );
    const SuspendedHead = ({
      ready,
      title,
    }: {
      ready: Promise<void>;
      title: string;
    }) => {
      React.use(ready);
      return (
        <Helmet>
          <title>{title}</title>
        </Helmet>
      );
    };
    const requests = ['first request', 'second request'].map(title => {
      let release = () => {};
      const ready = new Promise<void>(resolve => {
        release = resolve;
      });
      const context = getInitialContext(false);
      return { title, ready, release, context };
    });
    const streams = await Promise.all(
      requests.map(({ title, ready, context }) =>
        renderToReadableStream(
          wrapRuntimeContextProvider(
            <React.Suspense fallback="pending">
              <SuspendedHead ready={ready} title={title} />
            </React.Suspense>,
            context,
          ),
        ),
      ),
    );
    requests[1].release();
    requests[0].release();
    await Promise.all(
      streams.map(async stream => {
        await stream.allReady;
        return new Response(stream).text();
      }),
    );

    for (const { context, title } of requests) {
      expect(getHelmetContext(context)?.helmet?.title.toString()).toBe(
        `<title data-rh="true">${title}</title>`,
      );
    }
    expect(projectedContexts).toHaveLength(2);
    for (const context of projectedContexts) {
      expect(getHelmetContext(context)).toBeUndefined();
    }
  });

  it('keeps response functions outside the RSC internal context', () => {
    let internalValue: ReturnType<typeof getInitialContext> | undefined;

    const Probe = () => {
      internalValue = useContext(InternalRuntimeContext);
      return null;
    };

    const response = {
      setHeader: rstest.fn(),
      status: rstest.fn(),
      locals: { tenant: 'tractor-store' },
    };
    const context = getInitialContext(false);
    context.ssrContext = {
      request: {
        params: { category: 'compact' },
        pathname: '/tractors',
        query: { sort: 'price' },
        headers: { accept: 'text/html' },
        host: 'example.test',
        url: 'https://example.test/tractors?sort=price',
      },
      response,
    };

    setGlobalContext({ enableRsc: true });
    try {
      renderToString(wrapRuntimeContextProvider(<Probe />, context));
    } finally {
      setGlobalContext({ enableRsc: false });
    }

    expect(
      Object.values(internalValue?.requestContext.response ?? {}).some(
        value => typeof value === 'function',
      ),
    ).toBe(false);
  });
});
