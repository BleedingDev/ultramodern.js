export { renderToReadableStream } from 'react-server-dom-rspack/server.edge';

import {
  decodeReply,
  loadServerAction,
  renderToReadableStream,
} from 'react-server-dom-rspack/server.edge';

export { createFromReadableStream } from 'react-server-dom-rspack/client.edge';
export {
  registerClientReference,
  registerServerReference,
} from 'react-server-dom-rspack/server.edge';

import { createRenderCSRWithRSC } from './csr.shared';
import { createHandleAction } from './handle-action';

type RenderRscOptions = {
  element: React.ReactElement;
};

export const renderRsc = (options: RenderRscOptions) => {
  const readable = renderToReadableStream(options.element);
  return readable;
};

export const renderCSRWithRSC = createRenderCSRWithRSC(renderRsc);

// The worker (edge) lane binds the same shared handler as the Node lane in
// rsc.tsx — only the react-server-dom-rspack runtime differs.
export const handleAction = createHandleAction({
  decodeReply,
  loadServerAction,
  renderRsc,
});
