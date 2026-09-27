import React from 'react';
import { renderToString } from 'react-dom/server';
import { createHeadRuntime } from '../src/headRuntime';
import { ensureHelmetContext, getHelmetContext } from '../src/helmetContext';
import * as rendererHead from '../src/rendererHead';

const { Head: Helmet, wrapServerRoot } = createHeadRuntime();
const getHelmetData = (context: object) => getHelmetContext(context)?.helmet;

const createServerContext = () => ({ isBrowser: false }) as any;

const renderWithContext = (context: any, node: React.ReactNode) => {
  rendererHead.beginHeadRender(context, () => {});
  try {
    const html = renderToString(
      wrapServerRoot(node, {
        runtimeContext: context,
        helmetContext: ensureHelmetContext(context),
      }),
    );
    return rendererHead.completeHeadRender(context, html);
  } catch (error) {
    rendererHead.abortHeadRender(context);
    throw error;
  }
};

describe('server Helmet collection', () => {
  it('keeps independently registered adapters scoped to their own providers', () => {
    const outer = createHeadRuntime();
    const inner = createHeadRuntime();
    const outerContext = {};
    const innerContext = {};

    renderToString(
      outer.wrapServerRoot(
        inner.wrapServerRoot(
          <>
            <outer.Head>
              <title>outer application</title>
            </outer.Head>
            <inner.Head>
              <title>inner application</title>
            </inner.Head>
          </>,
          {
            runtimeContext: innerContext,
            helmetContext: ensureHelmetContext(innerContext),
          },
        ),
        {
          runtimeContext: outerContext,
          helmetContext: ensureHelmetContext(outerContext),
        },
      ),
    );

    expect(getHelmetData(outerContext)?.title.toString()).toBe(
      '<title data-rh="true">outer application</title>',
    );
    expect(getHelmetData(innerContext)?.title.toString()).toBe(
      '<title data-rh="true">inner application</title>',
    );
  });

  it('excludes Helmet records from a discarded Suspense primary branch', () => {
    const context = createServerContext();
    const never = new Promise<never>(() => {});

    const SuspendForever = (): null => {
      throw never;
    };

    const html = renderWithContext(
      context,
      <>
        <Helmet>
          <meta name="outside" content="committed" />
        </Helmet>
        <React.Suspense
          fallback={
            <>
              <Helmet>
                <meta name="fallback" content="committed" />
              </Helmet>
              <span>fallback rendered</span>
            </>
          }
        >
          <Helmet>
            <meta name="abandoned-unique" content="ghost" />
          </Helmet>
          <SuspendForever />
        </React.Suspense>
      </>,
    );

    expect(html).toContain('fallback rendered');
    const meta = getHelmetData(context)!.meta.toString();
    expect(meta).toContain('name="outside"');
    expect(meta).toContain('name="fallback"');
    expect(meta).not.toContain('name="abandoned-unique"');
  });

  it('collects title/meta during SSR and renders nothing inline', () => {
    const context = createServerContext();
    const html = renderWithContext(
      context,
      <main>
        <Helmet>
          <title>Server Title</title>
          <meta name="description" content="hello" />
        </Helmet>
        body
      </main>,
    );

    expect(html).not.toContain('Server Title');
    const helmet = getHelmetData(context)!;
    expect(helmet.title.toString()).toBe(
      '<title data-rh="true">Server Title</title>',
    );
    expect(helmet.meta.toString()).toBe(
      '<meta data-rh="true" name="description" content="hello">',
    );
  });

  it('dedupes meta by primary attribute across nested Helmets, inner wins', () => {
    const context = createServerContext();
    renderWithContext(
      context,
      <>
        <Helmet>
          <meta name="description" content="outer" />
          <meta name="keywords" content="modernjs" />
        </Helmet>
        <section>
          <Helmet>
            <meta name="description" content="inner" />
          </Helmet>
        </section>
      </>,
    );

    const meta = getHelmetData(context)!.meta.toString();
    expect(meta).toContain('content="inner"');
    expect(meta).not.toContain('content="outer"');
    expect(meta).toContain('content="modernjs"');
  });

  it('applies the innermost title and the innermost titleTemplate', () => {
    const context = createServerContext();
    renderWithContext(
      context,
      <>
        <Helmet titleTemplate="%s | Site">
          <title>Outer</title>
        </Helmet>
        <Helmet>
          <title>Inner</title>
        </Helmet>
      </>,
    );

    expect(getHelmetData(context)!.title.toString()).toBe(
      '<title data-rh="true">Inner | Site</title>',
    );
  });

  it('publishes prioritized SEO tags separately with component parity', () => {
    const context = createServerContext();
    renderWithContext(
      context,
      <Helmet prioritizeSeoTags htmlAttributes={{ class: 'app' } as any}>
        <title>Priority Page</title>
        <meta name="description" content="priority description" />
        <meta name="keywords" content="ordinary keywords" />
        <link rel="canonical" href="https://example.com/page" />
        <link rel="stylesheet" href="/page.css" />
        <script type="application/ld+json">{'{"name":"page"}'}</script>
        <script src="/ordinary.js" />
      </Helmet>,
    );

    const helmet = getHelmetData(context)!;
    expect(helmet.priority.toString()).toContain('priority description');
    expect(helmet.priority.toString()).toContain('https://example.com/page');
    expect(helmet.priority.toString()).toContain('application/ld+json');
    expect(helmet.meta.toString()).toContain('ordinary keywords');
    expect(helmet.meta.toString()).not.toContain('priority description');
    expect(helmet.link.toString()).toContain('/page.css');
    expect(helmet.link.toString()).not.toContain('https://example.com/page');
    expect(helmet.script.toString()).toContain('/ordinary.js');
    expect(helmet.script.toString()).not.toContain('application/ld+json');
  });

  it('is idempotent when React replays the tree (streaming SSR retry)', () => {
    const context = createServerContext();
    const app = (
      <>
        <Helmet titleTemplate="%s | Site">
          <title>Page</title>
          <meta name="description" content="stable" />
          <html lang="en" />
        </Helmet>
        <Helmet>
          <meta property="og:title" content="Page" />
        </Helmet>
      </>
    );

    renderWithContext(context, app);
    const first = getHelmetData(context)!;
    const firstSnapshot = {
      title: first.title.toString(),
      meta: first.meta.toString(),
      htmlAttributes: first.htmlAttributes.toString(),
    };

    // Simulate a replayed render against the same per-request context.
    renderWithContext(context, app);
    const second = getHelmetData(context)!;

    expect(second.title.toString()).toBe(firstSnapshot.title);
    expect(second.meta.toString()).toBe(firstSnapshot.meta);
    expect(second.htmlAttributes.toString()).toBe(firstSnapshot.htmlAttributes);
    expect(second.meta.toString().match(/description/g)).toHaveLength(1);
  });
});
