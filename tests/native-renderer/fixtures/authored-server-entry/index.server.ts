import { appendFileSync } from 'node:fs';
import type { NativeRequestContext } from '@modern-js/renderer-core/server';

appendFileSync(
  new URL('../authored-entry-imported.txt', import.meta.url),
  'authored module imported\n',
);

export default function handle(
  request: Request,
  context: NativeRequestContext<{ loaderContext: Map<string, unknown> }>,
): Response {
  const pathname = new URL(request.url).pathname;
  appendFileSync(
    new URL('../authored-entry-dispatches.txt', import.meta.url),
    `${request.method} ${pathname}\n`,
  );
  return Response.json(
    {
      authored: true,
      renderer: context.entry.renderer,
      buildId: context.entry.buildId,
      sessionRenderer: context.session.identity.renderer,
      entryName: context.entry.entryName,
      loaderContextIsMap:
        context.session.platform.bindings.loaderContext instanceof Map,
      method: request.method,
      pathname,
    },
    {
      status: 207,
      statusText: 'Authored Native Entry',
      headers: { 'x-authored-entry': 'fetch-handler' },
    },
  );
}
