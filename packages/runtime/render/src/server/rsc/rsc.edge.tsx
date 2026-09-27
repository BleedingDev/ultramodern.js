// Edge twin of `./index.ts`: the same Flight surface bound to
// react-server-dom-rspack's `server.edge` / `client.edge` builds. Package
// export conditions (`workerd`, `worker`, `edge-light`) select it.
import type { ReactElement } from 'react';
import {
  decodeReply,
  loadServerAction,
  renderToReadableStream,
} from 'react-server-dom-rspack/server.edge';
import { createRenderCSRWithRSC } from './csr.shared';
import { createHandleAction } from './handle-action';

export { createFromReadableStream } from 'react-server-dom-rspack/client.edge';
export {
  registerClientReference,
  registerServerReference,
  renderToReadableStream,
} from 'react-server-dom-rspack/server.edge';

export const renderRsc = (options: { element: ReactElement }) =>
  renderToReadableStream(options.element);

export const handleAction = createHandleAction({
  decodeReply,
  loadServerAction,
  renderRsc,
});

export const renderCSRWithRSC = createRenderCSRWithRSC(renderRsc);
