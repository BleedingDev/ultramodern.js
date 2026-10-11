import assert from 'node:assert/strict';
import { test } from '@rstest/core';
import { projectFileSystemRoutes, toTanstackPath } from '../../src/data/routes';

test('projects nested filesystem structure and module references without renderer values', () => {
  const source = [
    {
      id: 'root',
      path: '/',
      isRoot: true,
      component: '/routes/layout.tsx',
      element: { secret: 'React view' },
      loader: () => 'server secret',
      children: [
        {
          id: 'pathless',
          _component: '/routes/(account)/layout.tsx',
          children: [
            {
              id: 'index',
              index: true,
              file: '/routes/(account)/page.tsx',
              data: '/routes/(account)/page.data.ts',
              clientData: '/routes/(account)/page.data.client.ts',
              loading: '/routes/(account)/loading.tsx',
              error: '/routes/(account)/error.tsx',
              search: '/routes/(account)/page.search.ts',
              head: '/routes/(account)/page.head.ts',
              notFound: '/routes/(account)/not-found.tsx',
            },
            {
              id: 'detail',
              path: ':id?',
              filename: '/routes/(account)/[id$]/page.tsx',
            },
          ],
        },
      ],
    },
  ];

  const projected = projectFileSystemRoutes(source);
  assert.deepEqual(projected, [
    {
      id: 'root',
      file: '/routes/layout.tsx',
      path: '/',
      isRoot: true,
      children: [
        {
          id: 'pathless',
          file: '/routes/(account)/layout.tsx',
          children: [
            {
              id: 'index',
              file: '/routes/(account)/page.tsx',
              index: true,
              modules: {
                data: '/routes/(account)/page.data.ts',
                clientData: '/routes/(account)/page.data.client.ts',
                loading: '/routes/(account)/loading.tsx',
                error: '/routes/(account)/error.tsx',
                search: '/routes/(account)/page.search.ts',
                head: '/routes/(account)/page.head.ts',
                notFound: '/routes/(account)/not-found.tsx',
              },
              children: [],
            },
            {
              id: 'detail',
              file: '/routes/(account)/[id$]/page.tsx',
              path: ':id?',
              children: [],
            },
          ],
        },
      ],
    },
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(projected)), projected);
  assert.notEqual(projected[0], source[0]);
  assert.notEqual(projected[0].children, source[0].children);
});

test('preserves input ordering and root/index/pathless/dotted/dynamic/optional/splat path forms', () => {
  const paths = ['/', '', 'products.new', ':id', ':id?', 'files/*'];
  const source = paths.map((path, index) => ({ id: `id-${index}`, path }));
  assert.deepEqual(
    projectFileSystemRoutes(source).map(route => route.path),
    paths,
  );
  assert.deepEqual(projectFileSystemRoutes([{ children: [{}, {}] }]), [
    {
      id: 'route-0',
      children: [
        { id: 'route-0.0', children: [] },
        { id: 'route-0.1', children: [] },
      ],
    },
  ]);
  assert.deepEqual(projectFileSystemRoutes([{ file: '/a.tsx' }]), [
    { id: '/a.tsx', file: '/a.tsx', children: [] },
  ]);
});

test('rejects duplicate route ids across nested and sibling routes', () => {
  assert.throws(
    () => projectFileSystemRoutes([{ id: 'same', children: [{ id: 'same' }] }]),
    /duplicates route id "same"/,
  );
  assert.throws(
    () =>
      projectFileSystemRoutes([{ file: '/same.tsx' }, { file: '/same.tsx' }]),
    /duplicates route id/,
  );
});

test('rejects malformed known fields and executable module references', () => {
  for (const source of [
    [{ id: '' }],
    [{ id: 2 }],
    [{ path: null }],
    [{ index: 'true' }],
    [{ isRoot: 1 }],
    [{ children: {} }],
    [{ component: () => 'view' }],
    [{ data: () => 'secret' }],
    [{ loading: {} }],
    [{ error: '' }],
    [{ search: 1 }],
    [{ head: () => ({ meta: [] }) }],
    [{ notFound: {} }],
    [{ file: '/valid.tsx', component: () => 'hidden alternate view' }],
    [{ index: true, children: [{}] }],
    [{ index: true, isRoot: true }],
  ]) {
    assert.throws(() => projectFileSystemRoutes(source), TypeError);
  }
  for (const source of [
    null,
    {},
    'routes',
    [null],
    [() => null],
    [new Date()],
  ]) {
    assert.throws(() => projectFileSystemRoutes(source), TypeError);
  }
});

test('ignores unknown source properties without evaluating them', () => {
  const source = {
    id: 'safe',
    config: { privateFunction: () => 'secret' },
    get arbitrary() {
      throw new Error('unknown property was evaluated');
    },
  };
  assert.deepEqual(projectFileSystemRoutes([source]), [
    { id: 'safe', children: [] },
  ]);
  assert.throws(
    () =>
      projectFileSystemRoutes([
        {
          get data() {
            throw new Error('evaluated');
          },
        },
      ]),
    /not an accessor/,
  );
  for (const field of ['head', 'notFound']) {
    let reads = 0;
    const source = Object.defineProperty({}, field, {
      get() {
        reads++;
        throw new Error('The module reference accessor must never execute');
      },
    });
    assert.throws(() => projectFileSystemRoutes([source]), /not an accessor/);
    assert.equal(reads, 0);
  }
});

test('rejects cycles instead of overflowing or carrying source references', () => {
  const source: { id: string; children: unknown[] } = {
    id: 'root',
    children: [],
  };
  source.children.push(source);
  assert.throws(() => projectFileSystemRoutes([source]), /route cycle/);
});

test('maps only conventional parameter syntax to native TanStack paths', () => {
  for (const [source, expected] of [
    ['/', '/'],
    ['', ''],
    ['products.new', 'products.new'],
    ['/products/:id', '/products/$id'],
    [':lang?/products/:id?', '{-$lang}/products/{-$id}'],
    ['files/*', 'files/$'],
    ['/files/*/', '/files/$/'],
    ['asset.name/file.png', 'asset.name/file.png'],
  ]) {
    assert.equal(toTanstackPath(source), expected);
  }
  for (const path of [':', ':?', ':id??']) {
    assert.throws(() => toTanstackPath(path), /Invalid route parameter/);
  }
});
