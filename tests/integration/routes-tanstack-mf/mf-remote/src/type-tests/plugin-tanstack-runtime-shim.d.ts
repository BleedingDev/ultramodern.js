declare module '@modern-js/plugin-tanstack/runtime' {
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
