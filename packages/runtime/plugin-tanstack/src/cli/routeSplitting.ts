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
};

export function resolveTanstackRouteCodeSplittingEnabled(
  option?: TanstackRouteCodeSplittingOption,
) {
  if (typeof option === 'boolean') {
    return option;
  }

  return option?.enabled ?? true;
}

/**
 * Route chunking for TanStack entries is owned by Modern's
 * `output.splitRouteChunks`; the TanStack Start Rspack splitter does not
 * apply because Modern generates TanStack route trees from Modern route
 * metadata rather than TanStack file-route factory modules.
 */
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
  };
}
