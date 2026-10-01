import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Workers and CSP pages forbid string code generation. Upstream Effect's
// FindMyWay compiles param objects with `new Function` and must fall back to
// assignment there; the fork carries no router patch or sidecar for it.
const requireFromPackage = createRequire(
  path.resolve(__dirname, '../package.json'),
);
const effectHttp = pathToFileURL(
  path.join(
    path.dirname(requireFromPackage.resolve('effect/package.json')),
    'dist/http/index.js',
  ),
).href;

const child = `
import { FindMyWay } from ${JSON.stringify(effectHttp)};
let codegenBlocked = false;
try { new Function('return 1'); } catch { codegenBlocked = true; }
const router = FindMyWay.make();
router.on('GET', '/users/:userId/posts/:postId', 'posts');
router.on('GET', '/odd/:constructor/:__proto__', 'odd');
const routes = ['/users/7/posts/9', '/odd/a/b'].map(url => {
  const found = router.find('GET', url);
  return {
    handler: found.handler,
    nullPrototype: Object.getPrototypeOf(found.params) === null,
    params: Object.entries(found.params),
  };
});
process.stdout.write(JSON.stringify({ codegenBlocked, routes }));
`;

test('FindMyWay registers and matches routes when string code generation is blocked', () => {
  const result = spawnSync(
    process.execPath,
    [
      '--disallow-code-generation-from-strings',
      '--input-type=module',
      '--eval',
      child,
    ],
    { encoding: 'utf8' },
  );

  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({
    codegenBlocked: true,
    routes: [
      {
        handler: 'posts',
        nullPrototype: true,
        params: [
          ['userId', '7'],
          ['postId', '9'],
        ],
      },
      {
        handler: 'odd',
        nullPrototype: true,
        params: [
          ['constructor', 'a'],
          ['__proto__', 'b'],
        ],
      },
    ],
  });
});
