import * as rendererHead from '@modern-js/runtime-extensions';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { InternalRuntimeContext } from '../../src/core/context';
import { getHelmetData } from '../../src/core/server/helmet';
import { Helmet } from '../../src/exports/head';

const createServerContext = () => ({ isBrowser: false }) as any;

const renderWithContext = (context: any, node: React.ReactNode) => {
  rendererHead.beginHeadRender(context);
  try {
    const html = renderToString(
      <InternalRuntimeContext.Provider value={context}>
        {node}
      </InternalRuntimeContext.Provider>,
    );
    return rendererHead.completeHeadRender(context, html);
  } catch (error) {
    rendererHead.abortHeadRender(context);
    throw error;
  }
};

describe('server Helmet collection', () => {
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
    // outer instance tags come first, like react-helmet-async
    expect(meta.indexOf('keywords')).toBeLessThan(meta.indexOf('description'));
  });

  it('keeps duplicate metas within a single Helmet instance', () => {
    const context = createServerContext();
    renderWithContext(
      context,
      <Helmet>
        <meta name="author" content="a" />
        <meta name="author" content="b" />
      </Helmet>,
    );

    const meta = getHelmetData(context)!.meta.toString();
    expect(meta).toContain('content="a"');
    expect(meta).toContain('content="b"');
  });

  it('normalizes charSet when deduping and drops meta without primary attribute', () => {
    const context = createServerContext();
    renderWithContext(
      context,
      <>
        <Helmet>
          <meta charSet="utf-8" />
          <meta content="orphan" />
        </Helmet>
        <Helmet meta={[{ charSet: 'utf-8' } as any]} />
      </>,
    );

    const meta = getHelmetData(context)!.meta.toString();
    expect(meta.match(/charset/g)).toHaveLength(1);
    expect(meta).not.toContain('orphan');
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

  it('falls back to defaultTitle without applying the template', () => {
    const context = createServerContext();
    renderWithContext(
      context,
      <Helmet defaultTitle="Default" titleTemplate="%s | Site" />,
    );

    expect(getHelmetData(context)!.title.toString()).toBe(
      '<title data-rh="true">Default</title>',
    );
  });

  it('maps <html>/<body> children to html/body attributes', () => {
    const context = createServerContext();
    renderWithContext(
      context,
      <Helmet>
        <html lang="en" />
        <body className="dark" />
      </Helmet>,
    );

    const helmet = getHelmetData(context)!;
    expect(helmet.htmlAttributes.toString()).toBe('lang="en"');
    expect(helmet.bodyAttributes.toString()).toBe('class="dark"');
  });

  it('keeps one canonical link but all distinct stylesheets', () => {
    const context = createServerContext();
    renderWithContext(
      context,
      <>
        <Helmet>
          <link rel="canonical" href="https://outer.example/" />
          <link rel="stylesheet" href="/a.css" />
          <link rel="stylesheet" href="/b.css" />
        </Helmet>
        <Helmet>
          <link rel="canonical" href="https://inner.example/" />
        </Helmet>
      </>,
    );

    const link = getHelmetData(context)!.link.toString();
    expect(link).toContain('https://inner.example/');
    expect(link).not.toContain('https://outer.example/');
    expect(link).toContain('/a.css');
    expect(link).toContain('/b.css');
  });

  it('does not serialize script innerHTML as an attribute', () => {
    const context = createServerContext();
    renderWithContext(
      context,
      <Helmet>
        <script type="application/ld+json">{'{"@context":"a"}'}</script>
      </Helmet>,
    );

    const script = getHelmetData(context)!.script.toString();
    expect(script).toBe(
      '<script data-rh="true" type="application/ld+json">{"@context":"a"}</script>',
    );
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

  it('keeps the innermost base tag only', () => {
    const context = createServerContext();
    renderWithContext(
      context,
      <>
        <Helmet base={{ href: 'https://outer.example/' } as any} />
        <Helmet>
          <base href="https://inner.example/" />
        </Helmet>
      </>,
    );

    const base = getHelmetData(context)!.base.toString();
    expect(base).toContain('https://inner.example/');
    expect(base).not.toContain('https://outer.example/');
  });
});
