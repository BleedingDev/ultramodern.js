// @effect-diagnostics asyncFunction:off strictBooleanExpressions:off
import type { StaticHandlerContext } from '@modern-js/runtime-utils/router';
import { time } from '@modern-js/runtime-utils/time';
import { SSR_HYDRATION_ID_PREFIX } from '@modern-js/utils/universal/constants';
import type React from 'react';
import ReactDomServer from 'react-dom/server';
import { RenderLevel } from '../../constants';
import type { TInternalRuntimeContext } from '../../context';
import { getGlobalInternalRuntimeContext } from '../../context';
import { wrapRuntimeContextProvider } from '../../react/wrapper';
import type { SSRServerContext } from '../../types';
import {
  CHUNK_CSS_PLACEHOLDER,
  HTML_PLACEHOLDER,
  SSR_DATA_PLACEHOLDER,
} from '../constants';
import { createReplaceHelemt, getHelmetData } from '../helmet';
import { replaceChunkJsPlaceholder } from '../scriptOrder';
import { type BuildHtmlCb, buildHtml, type RenderString } from '../shared';
import { SSRErrors, SSRTimings, type Tracer } from '../tracer';
import { getSSRConfigByEntry, safeReplace } from '../utils';
import { LoadableCollector } from './loadable';
import { SSRDataCollector } from './ssrData';
import type { ChunkSet, Collector } from './types';

export const renderString: RenderString = async (
  request,
  serverRoot,
  options,
) => {
  const { resource, runtimeContext, config, onError, onTiming } = options;

  const tracer: Tracer = { onError, onTiming };

  const routerContext = runtimeContext.routerContext as StaticHandlerContext;

  const {
    htmlTemplate,
    entryName,
    loadableStats,
    routeManifest,
    moduleFederationCssAssets,
  } = resource;

  const ssrConfig = getSSRConfigByEntry(
    entryName,
    config.ssr,
    config.ssrByEntries,
  );

  const chunkSet: ChunkSet = {
    renderLevel: RenderLevel.CLIENT_RENDER,
    ssrScripts: '',
    jsChunk: '',
    cssChunk: '',
  };

  const collectors: Collector[] = [
    new LoadableCollector({
      stats: loadableStats,
      nonce: config.nonce,
      routeManifest,
      runtimeContext,
      template: htmlTemplate,
      entryName,
      moduleFederationCssAssets,
      chunkSet,
      config,
    }),
    new SSRDataCollector({
      runtimeContext,
      request,
      ssrConfig,
      ssrContext: runtimeContext.ssrContext! as SSRServerContext,
      chunkSet,
      routerContext,
      nonce: config.nonce,
      useJsonScript: config.useJsonScript,
    }),
  ];

  const internalRuntimeContext = getGlobalInternalRuntimeContext();
  const hooks = internalRuntimeContext.hooks;

  const extraCollectors = hooks.extendStringSSRCollectors.call({
    chunkSet,
  });

  for (const c of extraCollectors) {
    if (c) collectors.unshift(c);
  }

  const rootElement = wrapRuntimeContextProvider(
    serverRoot,
    Object.assign(runtimeContext, { ssr: true }),
  );

  const html = await generateHtml(
    rootElement,
    htmlTemplate,
    chunkSet,
    collectors,
    runtimeContext.ssrContext?.htmlModifiers || [],
    runtimeContext,
    entryName,
    tracer,
  );

  return html;
};

async function generateHtml(
  App: React.ReactElement,
  htmlTemplate: string,
  chunkSet: ChunkSet,
  collectors: Collector[],
  htmlModifiers: BuildHtmlCb[],
  runtimeContext: TInternalRuntimeContext,
  entryName: string,
  { onError, onTiming }: Tracer,
): Promise<string> {
  let html = '';
  let helmetData;

  const finalApp = collectors.reduce(
    (pre, creator) => creator.collect?.(pre) || pre,
    App,
  );
  try {
    const end = time();
    // react render to string
    html = ReactDomServer.renderToString(finalApp, {
      identifierPrefix: SSR_HYDRATION_ID_PREFIX,
    });
    chunkSet.renderLevel = RenderLevel.SERVER_RENDER;
    helmetData = getHelmetData(runtimeContext);

    const cost = end();
    onTiming(SSRTimings.RENDER_HTML, cost);
  } catch (e) {
    chunkSet.renderLevel = RenderLevel.CLIENT_RENDER;
    onError(e, SSRErrors.RENDER_HTML);
  }

  // collectors do effect
  await Promise.all(collectors.map(component => component.effect()));

  const { ssrScripts, cssChunk, jsChunk } = chunkSet;

  const finalHtml = await buildHtml(htmlTemplate, [
    createReplaceHtml(html),
    createReplaceChunkJs(jsChunk, entryName),
    createReplaceChunkCss(cssChunk),
    createReplaceSSRDataScript(ssrScripts, entryName),
    createReplaceHelemt(helmetData),
    ...htmlModifiers,
  ]);

  return finalHtml;
}

function createReplaceHtml(html: string): BuildHtmlCb {
  return (template: string) => safeReplace(template, HTML_PLACEHOLDER, html);
}

// FORK: upstream uses a plain `safeReplace` here, which leaves the SSR data +
// router hydration block wherever the template author put the placeholder —
// usually AFTER the entry script tag. We reuse the fork's stream-mode
// primitive (stream/afterTemplate.ts) so `window._SSR_DATA` and the TanStack
// `$_TSR` bootstrap are emitted BEFORE the entry script in string mode too,
// giving string mode the same script-ordering guarantee stream mode has.
// `replaceChunkJsPlaceholder` degrades to `safeReplace` when no entry script
// tag is found (custom HTML templates, MF host shells): THOSE templates are
// byte-identical. Every template that DOES carry an entry script tag — i.e.
// every standard Modern.js app — changes by design: the SSR data + router
// bootstrap block moves out of the placeholder position to in front of the
// entry tag, which in the common head-script layout relocates it above the
// rendered `<div id="root">`. Do NOT restore upstream's `safeReplace` call when
// resolving a sync merge — the guard is
// tests/ssr/serverRender/renderToString/buildTemplate.test.tsx.
function createReplaceSSRDataScript(
  data: string,
  entryName?: string,
): BuildHtmlCb {
  return (template: string) =>
    replaceChunkJsPlaceholder(template, data, entryName, SSR_DATA_PLACEHOLDER);
}

function createReplaceChunkJs(js: string, entryName?: string): BuildHtmlCb {
  return (template: string) =>
    replaceChunkJsPlaceholder(template, js, entryName);
}

function createReplaceChunkCss(css: string): BuildHtmlCb {
  return (template: string) =>
    safeReplace(template, CHUNK_CSS_PLACEHOLDER, css);
}
