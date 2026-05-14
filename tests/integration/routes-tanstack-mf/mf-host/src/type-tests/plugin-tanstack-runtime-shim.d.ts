declare module '@modern-js/plugin-tanstack/runtime' {
  import type * as React from 'react';

  export const Link: React.ComponentType<
    React.AnchorHTMLAttributes<HTMLAnchorElement> & { to?: string }
  >;
  export const Outlet: React.ComponentType<Record<string, never>>;
  export function useMatch(_options?: unknown): any;
}
