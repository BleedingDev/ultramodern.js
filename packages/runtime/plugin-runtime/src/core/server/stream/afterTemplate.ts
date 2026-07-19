// @effect-diagnostics asyncFunction:off nodeBuiltinImport:off strictBooleanExpressions:off unnecessaryArrowBlock:off
import { serializeJson } from '@modern-js/runtime-utils/node';
import type { HeadersData } from '@modern-js/runtime-utils/universal/request';
import type { IncomingHttpHeaders } from 'http';
import { getRouterHydrationScripts } from '../../../router/runtime/lifecycle';
import { type RenderLevel, SSR_DATA_JSON_ID } from '../../constants';
import type { TInternalRuntimeContext } from '../../context';
import type { SSRContainer } from '../../types';
import { SSR_DATA_PLACEHOLDER } from '../constants';
import type { HandleRequestConfig } from '../requestHandler';
import {
  createRouteHydrationScriptTags,
  replaceChunkJsPlaceholder,
} from '../scriptOrder';
import { type BuildHtmlCb, buildHtml, type SSRConfig } from '../shared';
import { attributesToString } from '../utils';

export type BuildShellAfterTemplateOptions = {
  runtimeContext: TInternalRuntimeContext;
  renderLevel: RenderLevel;
  ssrConfig: SSRConfig;
  request: Request;
  entryName: string;
  config: HandleRequestConfig;
};

export function buildShellAfterTemplate(
  afterAppTemplate: string,
  options: BuildShellAfterTemplateOptions,
) {
  const { request, config, ssrConfig, runtimeContext, renderLevel, entryName } =
    options;

  const callbacks: BuildHtmlCb[] = [
    template => injectJs(template, entryName, config.nonce),
    createReplaceSSRData({
      request,
      ssrConfig,
      nonce: config.nonce,
      useJsonScript: config.useJsonScript,
      runtimeContext,
      renderLevel,
      entryName,
    }),
  ];

  async function injectJs(template: string, entryName: string, nonce?: string) {
    const jsChunkStr = createRouteHydrationScriptTags(
      runtimeContext,
      entryName,
      {
        nonce,
        template,
      },
    );
    if (!jsChunkStr) {
      return template;
    }

    return replaceChunkJsPlaceholder(template, jsChunkStr, entryName);
  }

  return buildHtml(afterAppTemplate, callbacks);
}

function createReplaceSSRData(options: {
  request: Request;
  runtimeContext: TInternalRuntimeContext;
  ssrConfig: SSRConfig;
  nonce?: string;
  useJsonScript?: boolean;
  renderLevel: RenderLevel;
  entryName: string;
}) {
  const {
    runtimeContext,
    nonce,
    renderLevel,
    useJsonScript,
    ssrConfig,
    entryName,
  } = options;

  const { request, reporter } = runtimeContext.ssrContext!;

  const headers =
    typeof ssrConfig === 'object' && ssrConfig.unsafeHeaders
      ? Object.fromEntries(
          Object.entries(request.headers as HeadersData).filter(([key, _]) => {
            return ssrConfig.unsafeHeaders
              ?.map(header => header.toLowerCase())
              ?.includes(key.toLowerCase());
          }),
        )
      : undefined;

  const ssrData: SSRContainer = {
    data: {
      initialData: runtimeContext.initialData,
      i18nData: runtimeContext.__i18nData__ as Record<string, unknown>,
    },
    context: {
      reporter: {
        sessionId: reporter?.sessionId,
      },

      request: {
        query: request.query,
        params: request.params,
        pathname: request.pathname,
        host: request.host,
        url: request.url,
        headers: headers as IncomingHttpHeaders,
      },
    },
    mode: 'stream',
    renderLevel,
  };
  const attrsStr = attributesToString({ nonce });
  const serializeSSRData = serializeJson(ssrData);

  const ssrDataScript = useJsonScript
    ? `<script type="application/json" id="${SSR_DATA_JSON_ID}">${serializeSSRData}</script>`
    : `<script${attrsStr}>window._SSR_DATA = ${serializeSSRData}</script>`;

  const hydrationScripts = getRouterHydrationScripts(runtimeContext);
  const ssrScripts = hydrationScripts.length
    ? `${ssrDataScript}\n${hydrationScripts.join('\n')}`
    : ssrDataScript;

  return (template: string) => {
    if (!template.includes(SSR_DATA_PLACEHOLDER)) {
      return template;
    }
    return replaceChunkJsPlaceholder(
      template,
      ssrScripts,
      entryName,
      SSR_DATA_PLACEHOLDER,
    );
  };
}
