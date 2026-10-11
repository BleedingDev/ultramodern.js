import { AsyncLocalStorage } from 'node:async_hooks';

// A metadata read runs the real selected entry hooks with the requested command,
// but does not produce a compilation or admit application dependencies. The
// store is process-wide: a config loaded in-process may reach this framework
// through another installed copy (CJS/ESM or the app's own node_modules).
const storeKey = Symbol.for('ultramodern.entry-metadata-read');
const entryMetadataRead: AsyncLocalStorage<boolean> = ((
  globalThis as { [storeKey]?: AsyncLocalStorage<boolean> }
)[storeKey] ??= new AsyncLocalStorage<boolean>());

export function withEntryMetadataRead<T>(read: () => Promise<T>): Promise<T> {
  return entryMetadataRead.run(true, read);
}

export function isEntryMetadataRead(): boolean {
  return entryMetadataRead.getStore() === true;
}
