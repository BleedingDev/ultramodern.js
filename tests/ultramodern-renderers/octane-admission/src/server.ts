import {
  createRequestHandler,
  defaultStreamHandler,
} from '@octanejs/tanstack-router/ssr/server';
import { renderToReadableStream } from 'octane/server';
import { App } from './App';
import { getRouter } from './router';
import { Signals } from './Signals.tsrx';

export function render(
  props: Parameters<typeof App>[0],
  options: Parameters<typeof renderToReadableStream>[2],
) {
  return renderToReadableStream(App, props, options);
}

export function routerRequest(request: Request) {
  return createRequestHandler({ request, createRouter: getRouter })(
    defaultStreamHandler,
  );
}

export function renderSignals(
  props: Parameters<typeof Signals>[0],
  options: Parameters<typeof renderToReadableStream>[2],
) {
  return renderToReadableStream(Signals, props, options);
}

export { earlySignalBootstrapScript } from 'octane/server';
