export { renderToReadableStream } from 'react-server-dom-rspack/server.node';

import {
  decodeReply,
  loadServerAction,
  renderToReadableStream,
} from 'react-server-dom-rspack/server.node';

export { createFromReadableStream } from 'react-server-dom-rspack/client.node';
export {
  registerClientReference,
  registerServerReference,
} from 'react-server-dom-rspack/server.node';

import { createHandleAction } from './handle-action';

type RenderRscOptions = {
  element: React.ReactElement;
};

export const renderRsc = (options: RenderRscOptions) => {
  const readable = renderToReadableStream(options.element);
  return readable;
};

export const handleAction = createHandleAction({
  decodeReply,
  loadServerAction,
  renderRsc,
});
