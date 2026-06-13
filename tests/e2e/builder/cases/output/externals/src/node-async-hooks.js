import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage();

storage.run({ value: 'externalized' }, () => {
  window.__asyncHooksValue = storage.getStore().value;
});
