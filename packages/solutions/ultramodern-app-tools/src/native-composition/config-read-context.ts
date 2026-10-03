import { AsyncLocalStorage } from 'node:async_hooks';

// A metadata read runs the real selected entry hooks with the requested command,
// but does not produce a compilation or admit application dependencies.
const entryMetadataRead = new AsyncLocalStorage<boolean>();

export function withEntryMetadataRead<T>(read: () => Promise<T>): Promise<T> {
  return entryMetadataRead.run(true, read);
}

export function isEntryMetadataRead(): boolean {
  return entryMetadataRead.getStore() === true;
}
