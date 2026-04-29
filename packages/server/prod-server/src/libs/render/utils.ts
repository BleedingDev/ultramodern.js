// It will inject _SERVER_DATA twice, when SSG mode.
// The first time was in ssg html created, the seoncd time was in prod-server start.
// but the second wound causes route error.

import { sanitizeSSRPayload } from '@modern-js/runtime-utils/node';
import type { ModernServerContext } from '@modern-js/types';
import { type Readable, Transform } from 'stream';

const SERVER_DATA_MARKUP = (payload: string) =>
  `<script type="application/json" id="__MODERN_SERVER_DATA__">${payload}</script>`;

const injectIntoHead = (content: string, payload: string) => {
  const scriptTag = SERVER_DATA_MARKUP(payload);
  if (content.includes('</head>')) {
    return content.replace('</head>', `${scriptTag}</head>`);
  }
  return `${scriptTag}${content}`;
};

// To ensure that the second injection fails, the _SERVER_DATA inject at the front of head,
export const injectServerData = (
  content: string,
  context: ModernServerContext,
  options?: { unsafeHeaders?: string[] },
) => {
  const serverData = sanitizeSSRPayload(context.serverData, {
    unsafeHeaders: options?.unsafeHeaders,
    treatRootAsHeaders: true,
  }).payload;
  return injectIntoHead(content, JSON.stringify(serverData));
};

export const injectServerDataStream = (
  content: Readable,
  context: ModernServerContext,
  options?: { unsafeHeaders?: string[] },
) => {
  const serverData = sanitizeSSRPayload(context.serverData, {
    unsafeHeaders: options?.unsafeHeaders,
    treatRootAsHeaders: true,
  }).payload;
  const payload = JSON.stringify(serverData);

  let buffer = '';
  const injector = new Transform({
    transform(chunk, _encoding, callback) {
      buffer += chunk.toString();
      callback();
    },
    flush(callback) {
      this.push(injectIntoHead(buffer, payload));
      callback();
    },
  });

  return content.pipe(injector);
};
