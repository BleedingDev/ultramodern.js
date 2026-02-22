declare module '@modern-js/runtime/tanstack-router' {
  import type * as React from 'react';

  export type Fetcher = {
    state: 'idle' | 'submitting' | 'loading';
    data: unknown;
    error: unknown;
    Form: React.ComponentType<
      React.FormHTMLAttributes<HTMLFormElement> & { action?: string }
    >;
    submit: (
      target: Record<string, unknown>,
      options?: {
        action?: string;
        method?: string;
      },
    ) => Promise<void>;
  };

  export function useFetcher(): Fetcher;
}
