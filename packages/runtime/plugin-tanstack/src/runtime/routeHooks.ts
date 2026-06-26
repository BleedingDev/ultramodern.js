import {
  useChildMatches as useTanstackChildMatches,
  useMatch as useTanstackMatch,
  useMatches as useTanstackMatches,
  useParentMatches as useTanstackParentMatches,
  useRouterState as useTanstackRouterState,
} from '@tanstack/react-router';

type WholeObjectStructuralSharingOptions = {
  readonly select?: unknown;
  readonly structuralSharing?: boolean;
};

const withWholeObjectStructuralSharingGuard = <
  TOptions extends WholeObjectStructuralSharingOptions | undefined,
>(
  options: TOptions,
): TOptions | WholeObjectStructuralSharingOptions => {
  if (
    options !== undefined &&
    (options.select !== undefined || options.structuralSharing !== undefined)
  ) {
    return options;
  }

  if (options === undefined) {
    return { structuralSharing: false };
  }

  return {
    ...options,
    structuralSharing: false,
  };
};

type UseMatchOptions = Parameters<typeof useTanstackMatch>[0];
type UseMatchResult = ReturnType<typeof useTanstackMatch>;
type UseMatchesOptions = Parameters<typeof useTanstackMatches>[0];
type UseMatchesResult = ReturnType<typeof useTanstackMatches>;
type UseParentMatchesOptions = Parameters<typeof useTanstackParentMatches>[0];
type UseParentMatchesResult = ReturnType<typeof useTanstackParentMatches>;
type UseChildMatchesOptions = Parameters<typeof useTanstackChildMatches>[0];
type UseChildMatchesResult = ReturnType<typeof useTanstackChildMatches>;
type UseRouterStateOptions = Parameters<typeof useTanstackRouterState>[0];
type UseRouterStateResult = ReturnType<typeof useTanstackRouterState>;

const useMatchWithWholeObjectGuard = (
  options: UseMatchOptions,
): UseMatchResult =>
  useTanstackMatch(
    withWholeObjectStructuralSharingGuard(
      options as WholeObjectStructuralSharingOptions,
    ) as UseMatchOptions,
  );

const useMatchesWithWholeObjectGuard = (
  options?: UseMatchesOptions,
): UseMatchesResult =>
  useTanstackMatches(
    withWholeObjectStructuralSharingGuard(options) as UseMatchesOptions,
  );

const useParentMatchesWithWholeObjectGuard = (
  options?: UseParentMatchesOptions,
): UseParentMatchesResult =>
  useTanstackParentMatches(
    withWholeObjectStructuralSharingGuard(options) as UseParentMatchesOptions,
  );

const useChildMatchesWithWholeObjectGuard = (
  options?: UseChildMatchesOptions,
): UseChildMatchesResult =>
  useTanstackChildMatches(
    withWholeObjectStructuralSharingGuard(options) as UseChildMatchesOptions,
  );

const useRouterStateWithWholeObjectGuard = (
  options?: UseRouterStateOptions,
): UseRouterStateResult =>
  useTanstackRouterState(
    withWholeObjectStructuralSharingGuard(options) as UseRouterStateOptions,
  );

export const useMatch = useMatchWithWholeObjectGuard as typeof useTanstackMatch;
export const useMatches =
  useMatchesWithWholeObjectGuard as typeof useTanstackMatches;
export const useParentMatches =
  useParentMatchesWithWholeObjectGuard as typeof useTanstackParentMatches;
export const useChildMatches =
  useChildMatchesWithWholeObjectGuard as typeof useTanstackChildMatches;
export const useRouterState =
  useRouterStateWithWholeObjectGuard as typeof useTanstackRouterState;
