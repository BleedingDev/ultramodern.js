declare module '@tanstack/react-router/ssr/client' {
  export function hydrate(router: unknown): Promise<unknown>;
}

declare module '@tanstack/react-router/ssr/server' {
  export function attachRouterServerSsrUtils(opts: {
    router: unknown;
    manifest?: unknown;
  }): void;
}
