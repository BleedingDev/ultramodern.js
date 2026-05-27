// @effect-diagnostics asyncFunction:off processEnv:off strictBooleanExpressions:off unnecessaryArrowBlock:off
// Todo: This import will introduce router code, like remix, even if router config is false
import { matchRoutes } from '@modern-js/runtime-utils/router';
import ReactHelmet, { type HelmetData } from 'react-helmet';
import { getRouterMatchedRouteIds } from '../../../router/runtime/lifecycle';
import type { TInternalRuntimeContext } from '../../context';
import { CHUNK_CSS_PLACEHOLDER } from '../constants';
import { createReplaceHelemt } from '../helmet';
import type { HandleRequestConfig } from '../requestHandler';
import { type BuildHtmlCb, buildHtml } from '../shared';
import { safeReplace } from '../utils';

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
}

export async function buildShellBeforeTemplate(
  beforeAppTemplate: string,
  options: BuildShellBeforeTemplateOptions,
) {
  const { config, runtimeContext, styledComponentsStyleTags, entryName } =
    options;

  const helmetData: HelmetData = ReactHelmet.renderStatic();

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
    return safeReplace(template, CHUNK_CSS_PLACEHOLDER, css);

    async function getCssChunks() {
      const { routeManifest, routerContext, routes } = runtimeContext;
      if (!routeManifest) {
        return '';
      }

      const { routeAssets } = routeManifest;

      type RouteManifest = {
        referenceCssAssets?: string[];
      };

      let matchedRouteManifests: RouteManifest[] = [];

      const matchedRouteIds = getRouterMatchedRouteIds(runtimeContext);

      if (matchedRouteIds?.length) {
        matchedRouteManifests = matchedRouteIds
          .map(routeId => routeAssets[routeId] as RouteManifest | undefined)
          .filter(Boolean) as RouteManifest[];
      } else if (routerContext && routes) {
        const matches = matchRoutes(
          routes,
          routerContext.location,
          routerContext.basename,
        );
        matchedRouteManifests =
          matches
            ?.map((match, index) => {
              if (!index) {
                return;
              }

              const routeId = match.route.id;
              if (routeId) {
                return routeAssets[routeId] as RouteManifest | undefined;
              }
            })
            .filter(Boolean) ?? [];
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
              asset?.endsWith('.css') && !template.includes(asset),
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
