import type {
  RouterNavigationCapability,
  RouterNavigationSnapshot,
} from '@modern-js/runtime-extensions/router-state';
import type { AnyRouter } from '@tanstack/react-router';
import { Link } from './prefetchLink';

/** Native TanStack navigation, exposed through the provider contract. */
export function createTanstackNavigation(
  router: AnyRouter,
): RouterNavigationCapability {
  let location: AnyRouter['state']['location'] | undefined;
  let matches: AnyRouter['state']['matches'] | undefined;
  let snapshot: RouterNavigationSnapshot;
  return {
    Link: Link as RouterNavigationCapability['Link'],
    getSnapshot() {
      const state = router.state;
      if (
        location !== state.location ||
        matches === undefined ||
        matches.length !== state.matches.length ||
        matches.some(
          (match, index) => match.params !== state.matches[index]?.params,
        )
      ) {
        location = state.location;
        matches = state.matches;
        snapshot = {
          location: {
            pathname: location.pathname,
            search: location.searchStr,
            hash:
              location.hash !== '' ? `#${location.hash.replace(/^#/, '')}` : '',
          },
          params: Object.assign({}, ...matches.map(match => match.params)),
        };
      }
      return snapshot;
    },
    subscribe(listener) {
      const stops = (
        ['onBeforeNavigate', 'onBeforeLoad', 'onLoad', 'onResolved'] as const
      ).map(event => router.subscribe(event, listener));
      return () => {
        for (const stop of stops) stop();
      };
    },
    navigate(href, options) {
      return router.navigate({
        to: href,
        replace: options?.replace,
        ...(options?.state === undefined
          ? {}
          : { state: options.state as never }),
      });
    },
    createLinkProps(target) {
      const preload =
        target.preload !== undefined
          ? target.preload
          : target.prefetch === 'none'
            ? false
            : target.prefetch;
      return {
        to: target.pathname,
        ...(target.search !== undefined ? { search: target.search } : {}),
        ...(target.hash !== undefined && target.hash !== ''
          ? { hash: target.hash }
          : {}),
        ...(target.hashScrollIntoView === undefined
          ? {}
          : { hashScrollIntoView: target.hashScrollIntoView }),
        ...(preload === undefined ? {} : { preload }),
      };
    },
  };
}
