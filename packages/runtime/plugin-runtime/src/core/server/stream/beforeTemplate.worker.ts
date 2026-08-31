// @effect-diagnostics asyncFunction:off processEnv:off strictBooleanExpressions:off unnecessaryArrowBlock:off
import { getRouterMatchedRouteIds } from '../../../router/runtime/lifecycle';
import type { TInternalRuntimeContext } from '../../context';
import { CHUNK_CSS_PLACEHOLDER } from '../constants';
import { createFederatedCssLinks } from '../federatedCss';
import { createReplaceHelemt, getHelmetData } from '../helmet';
import type { HandleRequestConfig } from '../requestHandler';
import { type BuildHtmlCb, buildHtml } from '../shared';
import { hasStylesheetLink, safeReplace } from '../utils';

const checkIsInline = (
  chunk: string,
  enableInline: boolean | RegExp | undefined,
) => {
  // only production apply the inline config
  if (process.env.NODE_ENV === 'production') {
    if (enableInline instanceof RegExp) {
      return enableInline.test(chunk);
    } else {
      return Boolean(enableInline);
    }
  } else {
    return false;
  }
};

export interface BuildShellBeforeTemplateOptions {
  runtimeContext: TInternalRuntimeContext;
  entryName: string;
  config: HandleRequestConfig;
  styledComponentsStyleTags?: string;
  moduleFederationCssAssets?: string[];
}

type RouteManifest = {
  referenceCssAssets?: string[];
};

type RouteManifestLike = {
  routeAssets?: Record<string, RouteManifest | undefined>;
};

export async function buildShellBeforeTemplate(
  beforeAppTemplate: string,
  options: BuildShellBeforeTemplateOptions,
) {
  const {
    config,
    runtimeContext,
    styledComponentsStyleTags,
    entryName,
    moduleFederationCssAssets,
  } = options;

  const helmetData = getHelmetData(runtimeContext);

  const callbacks: BuildHtmlCb[] = [
    createReplaceHelemt(helmetData),
    template => injectCss(template, entryName, styledComponentsStyleTags),
  ];

  return buildHtml(beforeAppTemplate, callbacks);

  async function injectCss(
    template: string,
    entryName: string,
    styledComponentsStyleTags?: string,
  ) {
    let css = await getCssChunks();
    if (styledComponentsStyleTags) {
      css += styledComponentsStyleTags;
    }
    css += createFederatedCssLinks(moduleFederationCssAssets, {
      template,
      existingAssets: css
        .match(/href="([^"]+)"/g)
        ?.map(item => item.replace(/^href="/, '').replace(/"$/, '')),
    });
    return safeReplace(template, CHUNK_CSS_PLACEHOLDER, css);

    async function getCssChunks() {
      const { routeManifest } = runtimeContext;
      const routeAssets = (routeManifest as RouteManifestLike | undefined)
        ?.routeAssets;
      if (!routeAssets) {
        return '';
      }

      let matchedRouteManifests: RouteManifest[] = [];

      const matchedRouteIds = getRouterMatchedRouteIds(runtimeContext);

      if (matchedRouteIds?.length) {
        matchedRouteManifests = matchedRouteIds
          .map(routeId => routeAssets[routeId] as RouteManifest | undefined)
          .filter(Boolean) as RouteManifest[];
      }

      const asyncEntry = routeAssets[`async-${entryName}`] as
        | RouteManifest
        | undefined;
      if (asyncEntry) {
        matchedRouteManifests.push(asyncEntry);
      }

      const cssChunks = matchedRouteManifests.reduce(
        (chunks, routeManifest) => {
          const { referenceCssAssets = [] } = routeManifest;
          const _cssChunks = referenceCssAssets.filter(
            (asset?: string) =>
              asset?.endsWith('.css') && !hasStylesheetLink(template, asset),
          );
          return [...chunks, ..._cssChunks];
        },
        [] as string[],
      );

      const { inlineStyles } = config;

      const styles = cssChunks.map(chunk => {
        const link = `<link href="${chunk}" rel="stylesheet" />`;
        if (checkIsInline(chunk, inlineStyles)) {
          return link;
        }
        return link;
      });

      return `${styles.join('')}`;
    }
  }
}
