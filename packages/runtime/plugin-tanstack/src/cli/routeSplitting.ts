export type TanstackRouteCodeSplittingOption =
  | boolean
  | {
      enabled?: boolean;
    };

export type TanstackRsbuildRouteSplittingProfile = {
  defaultConfig: {
    output: {
      splitRouteChunks: boolean;
    };
  };
  modernRouteChunks: {
    enabled: boolean;
    owner: 'modern';
  };
  builderChunkSplit: {
    owner: 'modern-rsbuild';
    preserved: true;
  };
  tanstackStartRspackSplitter: {
    compatible: boolean;
    reason: string;
    clientDeleteNodes: string[];
    routeFactoryCalls: string[];
  };
};

const TANSTACK_START_ROUTE_FACTORY_CALLS = [
  'createFileRoute',
  'createRootRoute',
  'createRootRouteWithContext',
] as const;

const TANSTACK_START_ROUTE_FACTORY_REGEX =
  /\b(createFileRoute|createRootRoute|createRootRouteWithContext)\s*(?:<|\()/;

export function isTanstackStartRouteModuleSource(source: string) {
  return TANSTACK_START_ROUTE_FACTORY_REGEX.test(source);
}

export function resolveTanstackRouteCodeSplittingEnabled(
  option?: TanstackRouteCodeSplittingOption,
) {
  if (typeof option === 'boolean') {
    return option;
  }

  return option?.enabled ?? true;
}

export function createTanstackRsbuildRouteSplittingProfile(opts: {
  routeCodeSplitting?: TanstackRouteCodeSplittingOption;
}): TanstackRsbuildRouteSplittingProfile {
  return {
    defaultConfig: {
      output: {
        splitRouteChunks: resolveTanstackRouteCodeSplittingEnabled(
          opts.routeCodeSplitting,
        ),
      },
    },
    modernRouteChunks: {
      enabled: resolveTanstackRouteCodeSplittingEnabled(
        opts.routeCodeSplitting,
      ),
      owner: 'modern',
    },
    builderChunkSplit: {
      owner: 'modern-rsbuild',
      preserved: true,
    },
    tanstackStartRspackSplitter: {
      compatible: false,
      reason:
        'TanStack Start Rsbuild route splitting is tied to TanStack file-route factory modules; Modern generates TanStack route trees from Modern route metadata and owns route chunking through output.splitRouteChunks.',
      clientDeleteNodes: ['ssr', 'server', 'headers'],
      routeFactoryCalls: [...TANSTACK_START_ROUTE_FACTORY_CALLS],
    },
  };
}
