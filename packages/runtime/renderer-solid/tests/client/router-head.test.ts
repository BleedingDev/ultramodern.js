import { createComponent } from 'solid-js';
import { mountApplication } from '../../src/client';
import {
  ApplicationRouter,
  createApplicationRouter,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  Outlet,
} from '../../src/router';

const disposers: Array<() => void> = [];

afterEach(async () => {
  for (const dispose of disposers.splice(0)) dispose();
  await Promise.resolve();
});

function fixture() {
  const root = createRootRoute({
    component: Outlet,
    head: () => ({
      meta: [
        { title: 'Root title' },
        { name: 'description', content: 'Root description' },
        { name: 'robots', content: 'noindex' },
      ],
    }),
  });
  const route = (path: string, label: string, color: string) =>
    createRoute({
      getParentRoute: () => root,
      path,
      component: () => `Native view ${label}`,
      head: () => ({
        meta: [
          { title: `Route ${label}` },
          { name: 'description', content: `Description ${label}` },
          { 'script:ld+json': { '@type': 'WebPage', name: `Route ${label}` } },
        ],
        links: [{ rel: 'canonical', href: `/${path}` }],
        styles: [
          {
            'data-route': path,
            children: `.route-${path}{color:${color}}`,
          },
        ],
      }),
    });
  const plain = createRoute({
    getParentRoute: () => root,
    path: 'plain',
    component: () => 'Native view plain',
  });
  return createApplicationRouter({
    routeTree: root.addChildren([
      route('a', 'A', 'red'),
      route('b', 'B', 'blue'),
      plain,
    ]),
    history: createMemoryHistory({ initialEntries: ['/a'] }),
    origin: 'https://shop.test',
    isServer: false,
  });
}

async function settleHead() {
  // The native registry reconciles its owned tags in a microtask.
  await Promise.resolve();
  await Promise.resolve();
}

function description() {
  const values = document.head.querySelectorAll<HTMLMetaElement>(
    'meta[name="description"]',
  );
  expect(values).toHaveLength(1);
  return values[0]!.content;
}

describe('native router head navigation', () => {
  test('native route transitions replace abandoned head tags and restore layout metadata', async () => {
    const router = fixture();
    await router.load();
    const root = document.createElement('div');
    document.body.appendChild(root);
    const dispose = mountApplication(
      () => createComponent(ApplicationRouter, { router }),
      root,
    );
    disposers.push(() => {
      dispose();
      root.remove();
    });
    await settleHead();
    expect(root.textContent).toContain('Native view A');
    expect(document.title).toBe('Route A');
    expect(document.head.querySelectorAll('title')).toHaveLength(1);
    expect(description()).toBe('Description A');
    expect(
      document.head
        .querySelector('meta[name="robots"]')
        ?.getAttribute('content'),
    ).toBe('noindex');
    expect(
      document.head
        .querySelector('link[rel="canonical"]')
        ?.getAttribute('href'),
    ).toBe('/a');
    expect(
      document.head.querySelectorAll('style[data-route="a"]'),
    ).toHaveLength(1);
    expect(
      document.head.querySelectorAll('script[type="application/ld+json"]'),
    ).toHaveLength(1);
    expect(
      document.head.querySelector('script[type="application/ld+json"]')
        ?.textContent,
    ).toContain('Route A');

    await router.navigate({ to: '/b' });
    await settleHead();
    expect(root.textContent).toContain('Native view B');
    expect(document.title).toBe('Route B');
    expect(description()).toBe('Description B');
    expect(
      document.head.querySelectorAll('link[rel="canonical"]'),
    ).toHaveLength(1);
    expect(
      document.head
        .querySelector('link[rel="canonical"]')
        ?.getAttribute('href'),
    ).toBe('/b');
    expect(document.head.querySelector('style[data-route="a"]')).toBeNull();
    expect(
      document.head.querySelectorAll('style[data-route="b"]'),
    ).toHaveLength(1);
    expect(
      document.head.querySelectorAll('script[type="application/ld+json"]'),
    ).toHaveLength(1);
    expect(
      document.head.querySelector('script[type="application/ld+json"]')
        ?.textContent,
    ).toContain('Route B');
    expect(document.head.innerHTML).not.toContain('Route A');

    await router.navigate({ to: '/plain' });
    await settleHead();
    expect(root.textContent).toContain('Native view plain');
    expect(document.title).toBe('Root title');
    expect(description()).toBe('Root description');
    expect(document.head.querySelector('style[data-route="b"]')).toBeNull();
    expect(document.head.querySelector('link[rel="canonical"]')).toBeNull();
    expect(
      document.head.querySelector('script[type="application/ld+json"]'),
    ).toBeNull();
    expect(document.head.innerHTML).not.toContain('window._$HY');

    dispose();
    await settleHead();
    expect(document.head.querySelector('meta[name="description"]')).toBeNull();
    expect(document.head.querySelector('meta[name="robots"]')).toBeNull();
  });
});
