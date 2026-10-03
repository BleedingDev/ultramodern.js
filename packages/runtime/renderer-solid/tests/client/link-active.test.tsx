import type { ActiveOptions } from '@tanstack/router-core';
import { flush } from 'solid-js';
import { mountApplication } from '../../src/client';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  Link,
  RouterContextProvider,
} from '../../src/router-binding/index';

interface LinkCase {
  name: string;
  current: string;
  search: { page: number; filter?: string };
  activeOptions?: ActiveOptions;
  active: boolean;
}

const cases: LinkCase[] = [
  {
    name: 'partial search accepts an extra current key',
    current: '/?page=1&filter=open',
    search: { page: 1 },
    active: true,
  },
  {
    name: 'exact search rejects an extra current key',
    current: '/?page=1&filter=open',
    search: { page: 1 },
    activeOptions: { exact: true },
    active: false,
  },
  {
    name: 'exact search accepts equal keys',
    current: '/?page=1',
    search: { page: 1 },
    activeOptions: { exact: true },
    active: true,
  },
  {
    name: 'default search ignores an undefined link key',
    current: '/?page=1&filter=open',
    search: { page: 1, filter: undefined },
    active: true,
  },
  {
    name: 'explicit undefined rejects a defined current value',
    current: '/?page=1&filter=open',
    search: { page: 1, filter: undefined },
    activeOptions: { explicitUndefined: true },
    active: false,
  },
  {
    name: 'partial explicit undefined accepts a missing current key',
    current: '/?page=1',
    search: { page: 1, filter: undefined },
    activeOptions: { explicitUndefined: true },
    active: true,
  },
  {
    name: 'exact explicit undefined preserves the key-count distinction',
    current: '/?page=1',
    search: { page: 1, filter: undefined },
    activeOptions: { exact: true, explicitUndefined: true },
    active: false,
  },
];

describe('native Link search activity', () => {
  test.each(cases)('$name', async input => {
    const router = createRouter({
      routeTree: createRootRoute(),
      history: createMemoryHistory({ initialEntries: [input.current] }),
      isServer: false,
    });
    await router.load();
    const root = document.createElement('div');
    document.body.appendChild(root);
    const dispose = mountApplication(
      () => (
        <RouterContextProvider router={router}>
          {() => (
            <Link
              to="/"
              search={input.search}
              activeOptions={input.activeOptions}
            >
              Native link
            </Link>
          )}
        </RouterContextProvider>
      ),
      root,
    );
    try {
      flush();
      const link = root.querySelector('a');
      expect(link).not.toBeNull();
      expect(link?.getAttribute('data-status')).toBe(
        input.active ? 'active' : null,
      );
      expect(link?.getAttribute('aria-current')).toBe(
        input.active ? 'page' : null,
      );
    } finally {
      dispose();
      root.remove();
      flush();
    }
  });
});
