import { normalisePathPattern } from './normalise';
import { buildPathFromPattern, matchPathPattern } from './patterns';

interface RouteIdentity {
  id?: string;
  path?: string;
  canonicalPath: string;
  paths?: Record<string, string>;
}

interface RouteNode {
  id?: string;
  path?: string;
  children?: RouteNode[];
  modernLocalisedRoute?: RouteIdentity;
}

type PathRewrite = { from: string; to: string };

function rewritePath(url: URL, mappings: PathRewrite[]) {
  for (const { from, to } of mappings) {
    const params = matchPathPattern(url.pathname, from);
    if (params) {
      url.pathname = buildPathFromPattern(to, params);
      break;
    }
  }
  return url;
}

/** Use the router's URL rewrite seam; browser URLs retain their locale spelling. */
export function createLocalisedRouteRewrite(routes: RouteNode[]) {
  const input: PathRewrite[] = [];
  const output: PathRewrite[] = [];
  const visit = (nodes: RouteNode[], parent: string) => {
    for (const route of nodes) {
      const fullPath = normalisePathPattern(`${parent}/${route.path ?? ''}`);
      const identity = route.modernLocalisedRoute;
      if (identity?.paths && fullPath.endsWith(identity.canonicalPath)) {
        const prefix = fullPath.slice(0, -identity.canonicalPath.length);
        const hasLocale = prefix
          .split('/')
          .some(segment => /^:(?:lang|locale|language)\??$/.test(segment));
        for (const [language, localisedPath] of Object.entries(
          identity.paths,
        )) {
          const localePrefix = prefix
            .split('/')
            .map(segment =>
              /^:(?:lang|locale|language)\??$/.test(segment)
                ? language
                : segment,
            )
            .join('/');
          const canonical = normalisePathPattern(
            `${localePrefix}/${identity.canonicalPath}`,
          );
          const localised = normalisePathPattern(
            `${localePrefix}/${localisedPath}`,
          );
          if (canonical !== localised) {
            input.push({ from: localised, to: canonical });
            if (hasLocale) output.push({ from: canonical, to: localised });
          }
        }
      }
      if (route.children) visit(route.children, fullPath);
    }
  };
  visit(routes, '');
  if (input.length === 0) return undefined;
  const specificity = (pattern: string) =>
    pattern
      .split('/')
      .filter(segment => segment && !segment.startsWith(':') && segment !== '*')
      .length;
  for (const mappings of [input, output])
    mappings.sort((a, b) => specificity(b.from) - specificity(a.from));
  return {
    input: ({ url }: { url: URL }) => rewritePath(url, input),
    output: ({ url }: { url: URL }) => rewritePath(url, output),
  };
}
