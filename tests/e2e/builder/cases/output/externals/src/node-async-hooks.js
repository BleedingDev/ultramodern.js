import { AsyncLocalStorage } from 'node:async_hooks';
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { inspect } from 'node:util';

const storage = new AsyncLocalStorage();

storage.run({ value: 'externalized' }, () => {
  window.__asyncHooksValue = {
    file: basename('/workers/index.mjs'),
    id: randomUUID(),
    payload: Buffer.from(storage.getStore().value).toString('utf8'),
  };
  window.__asyncHooksInspect = inspect(window.__asyncHooksValue);
});
