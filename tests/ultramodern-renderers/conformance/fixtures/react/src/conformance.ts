interface ReactResourceObservations {
  active: { counter: number; stable: number };
  cleanup: { counter: number; stable: number };
}

declare global {
  var __ultramodernConformance: ReactResourceObservations | undefined;
}

/** Observations are registered and released by actual React effect lifecycles. */
export function observeResource(owner: 'counter' | 'stable') {
  if (typeof window === 'undefined') return () => {};
  const observations = (globalThis.__ultramodernConformance ??= {
    active: { counter: 0, stable: 0 },
    cleanup: { counter: 0, stable: 0 },
  });
  observations.active[owner]++;
  return () => {
    observations.active[owner]--;
    observations.cleanup[owner]++;
  };
}
