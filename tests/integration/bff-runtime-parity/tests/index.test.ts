import { execFileSync } from 'node:child_process';
import dns from 'node:dns';
import path from 'node:path';
import {
  getPort,
  killApp,
  launchApp,
  modernBuild,
  modernServe,
} from '../../../utils/modernTestUtils';
import { setSuiteTimeout } from '../../../utils/setSuiteTimeout';

dns.setDefaultResultOrder('ipv4first');

const appDir = path.resolve(__dirname, '../');
const tsgoBin = path.join(
  path.dirname(require.resolve('@typescript/native-preview/package.json')),
  'bin/tsgo.js',
);
const host = 'http://localhost';
const ensureWorkspacePackages = [
  '@modern-js/plugin-bff',
  '@modern-js/server-core',
  '@modern-js/server-runtime',
];

type Runtime = 'hono' | 'effect';
type Mode = 'dev' | 'prod';
type AppProcess = Awaited<ReturnType<typeof launchApp>>;

type JsonResponseSnapshot = {
  status: number;
  body: unknown;
  headers: {
    contentType: string | null;
    middleware: string | null;
    bffApiPath: string | null;
    functionMiddleware: string | null;
    requestId: string | null;
  };
};

type ImageResponseSnapshot = {
  status: number;
  bodyBase64: string;
  byteLength: number;
  headers: {
    contentType: string | null;
    cacheControl: string | null;
    middleware: string | null;
  };
};

type NotFoundSnapshot = {
  status: number;
  contentType: string | null;
  hasBody: boolean;
};

type RuntimeParitySnapshot = {
  basic: JsonResponseSnapshot;
  postHello: JsonResponseSnapshot;
  getHello: JsonResponseSnapshot;
  context: JsonResponseSnapshot;
  upload: JsonResponseSnapshot;
  image: ImageResponseSnapshot;
  error: JsonResponseSnapshot;
  exception: JsonResponseSnapshot;
  managedError: JsonResponseSnapshot;
  managedException: JsonResponseSnapshot;
  notFound: NotFoundSnapshot;
};

function expectTypecheckPasses() {
  try {
    execFileSync(
      process.execPath,
      [tsgoBin, '--noEmit', '-p', 'tsconfig.json'],
      {
        cwd: appDir,
        stdio: 'pipe',
      },
    );
  } catch (error: unknown) {
    const maybeError = error as { stdout?: unknown; stderr?: unknown };
    const stdout =
      typeof maybeError.stdout === 'string'
        ? maybeError.stdout
        : maybeError.stdout
          ? String(maybeError.stdout)
          : '';
    const stderr =
      typeof maybeError.stderr === 'string'
        ? maybeError.stderr
        : maybeError.stderr
          ? String(maybeError.stderr)
          : '';
    throw new Error(`TypeScript typecheck failed:\n${stdout}\n${stderr}`);
  }
}

function toUrl(port: number, pathname: string) {
  return `${host}:${port}${pathname}`;
}

function asRecord(value: unknown) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Expected record, received: ${typeof value}`);
  }
  return value as Record<string, unknown>;
}

function expectDurationHeader(value: string | null) {
  expect(value).toMatch(/^dur=\d+$/);
}

async function parseJsonBody(response: Response): Promise<unknown> {
  const raw = await response.text();
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

async function fetchJsonSnapshot(
  port: number,
  pathname: string,
  init?: RequestInit,
): Promise<JsonResponseSnapshot> {
  const response = await fetch(toUrl(port, pathname), init);
  return {
    status: response.status,
    body: await parseJsonBody(response),
    headers: {
      contentType: response.headers.get('content-type'),
      middleware: response.headers.get('x-middleware'),
      bffApiPath: response.headers.get('x-bff-api'),
      functionMiddleware: response.headers.get('x-bff-fn-middleware'),
      requestId: response.headers.get('x-id'),
    },
  };
}

async function fetchImageSnapshot(
  port: number,
  pathname: string,
): Promise<ImageResponseSnapshot> {
  const response = await fetch(toUrl(port, pathname));
  const binary = Buffer.from(await response.arrayBuffer());
  return {
    status: response.status,
    bodyBase64: binary.toString('base64'),
    byteLength: binary.byteLength,
    headers: {
      contentType: response.headers.get('content-type'),
      cacheControl: response.headers.get('cache-control'),
      middleware: response.headers.get('x-middleware'),
    },
  };
}

async function fetchNotFoundSnapshot(
  port: number,
  pathname: string,
): Promise<NotFoundSnapshot> {
  const response = await fetch(toUrl(port, pathname));
  const body = await response.text();
  return {
    status: response.status,
    contentType: response.headers.get('content-type'),
    hasBody: body.length > 0,
  };
}

async function captureRuntimeSnapshot(
  port: number,
): Promise<RuntimeParitySnapshot> {
  const query = new URLSearchParams();
  query.set('user', 'user@example.com');
  query.append('ext[0][from]', 'client');
  query.append('arr[0]', 'one');
  query.append('arr[1]', 'two');
  query.append('obj[a]', 'alpha');

  const uploadData = new FormData();
  uploadData.append(
    'images',
    new Blob(['mock-image'], { type: 'image/png' }),
    'mock_image.png',
  );

  return {
    basic: await fetchJsonSnapshot(port, '/bff-api'),
    postHello: await fetchJsonSnapshot(
      port,
      `/bff-api/hello/123?${query.toString()}`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-header': 'header-from-test',
        },
        body: JSON.stringify({
          message: 'hello-from-test',
        }),
      },
    ),
    getHello: await fetchJsonSnapshot(
      port,
      '/bff-api/hello/get?user=user%40example.com',
    ),
    context: await fetchJsonSnapshot(port, '/bff-api/context'),
    upload: await fetchJsonSnapshot(port, '/bff-api/upload', {
      method: 'POST',
      body: uploadData,
    }),
    image: await fetchImageSnapshot(port, '/bff-api/hello/image'),
    error: await fetchJsonSnapshot(port, '/bff-api/error'),
    exception: await fetchJsonSnapshot(port, '/bff-api/exception'),
    managedError: await fetchJsonSnapshot(port, '/bff-api/error/managed'),
    managedException: await fetchJsonSnapshot(
      port,
      '/bff-api/managed/exception',
    ),
    notFound: await fetchNotFoundSnapshot(port, '/bff-api/does-not-exist'),
  };
}

async function collectSnapshot(
  mode: Mode,
  runtime: Runtime,
): Promise<RuntimeParitySnapshot> {
  let app: AppProcess | undefined;
  const port = await getPort();
  const env = {
    BFF_RUNTIME: runtime,
  };

  if (mode === 'dev') {
    app = await launchApp(
      appDir,
      port,
      {
        ensureWorkspacePackages,
      },
      env,
    );
  } else {
    await modernBuild(appDir, [], { env, ensureWorkspacePackages });
    app = await modernServe(appDir, port, {
      env: {
        PORT: `${port}`,
        NODE_ENV: 'production',
        ...env,
      },
    });
  }

  try {
    return await captureRuntimeSnapshot(port);
  } finally {
    await killApp(app);
  }
}

let typecheckVerified = false;

describe.each<Mode>(['dev', 'prod'])('bff runtime parity (%s)', mode => {
  let honoSnapshot: RuntimeParitySnapshot;
  let effectSnapshot: RuntimeParitySnapshot;

  beforeAll(async () => {
    setSuiteTimeout(1000 * 60 * (mode === 'prod' ? 8 : 4));
    if (!typecheckVerified) {
      expectTypecheckPasses();
      typecheckVerified = true;
    }
    honoSnapshot = await collectSnapshot(mode, 'hono');
    effectSnapshot = await collectSnapshot(mode, 'effect');
  });

  test('parity: basic lambda route and middleware header', () => {
    expect(honoSnapshot.basic.status).toBe(200);
    expect(effectSnapshot.basic.status).toBe(200);
    expect(effectSnapshot.basic.body).toEqual(honoSnapshot.basic.body);

    const basicBody = asRecord(effectSnapshot.basic.body);
    expect(basicBody.message).toBe('Hello Modern.js');

    expectDurationHeader(honoSnapshot.basic.headers.middleware);
    expectDurationHeader(effectSnapshot.basic.headers.middleware);
  });

  test('parity: params/query/data/headers pipeline route', () => {
    expect(honoSnapshot.postHello.status).toBe(200);
    expect(effectSnapshot.postHello.status).toBe(200);
    expect(effectSnapshot.postHello.body).toEqual(honoSnapshot.postHello.body);
    expect(honoSnapshot.postHello.headers.functionMiddleware).toBe('1');
    expect(effectSnapshot.postHello.headers.functionMiddleware).toBe('1');
    expect(honoSnapshot.postHello.headers.bffApiPath).toBe(
      '/bff-api/hello/123',
    );
    expect(effectSnapshot.postHello.headers.bffApiPath).toBe(
      '/bff-api/hello/123',
    );

    const body = asRecord(effectSnapshot.postHello.body);
    const data = asRecord(body.data);
    const query = asRecord(body.query);
    const headers = asRecord(body.headers);

    expect(data.message).toBe('msg: hello-from-test');
    expect(query.user).toBe('user@example.com');
    expect(headers['x-header']).toBe('header-from-test');
  });

  test('parity: query-only lambda route', () => {
    expect(honoSnapshot.getHello.status).toBe(200);
    expect(effectSnapshot.getHello.status).toBe(200);
    expect(effectSnapshot.getHello.body).toEqual(honoSnapshot.getHello.body);
    expect(honoSnapshot.getHello.headers.bffApiPath).toBe('/bff-api/hello/get');
    expect(effectSnapshot.getHello.headers.bffApiPath).toBe(
      '/bff-api/hello/get',
    );
  });

  test('parity: useHonoContext response headers', () => {
    expect(honoSnapshot.context.status).toBe(200);
    expect(effectSnapshot.context.status).toBe(200);
    expect(effectSnapshot.context.body).toEqual(honoSnapshot.context.body);
    expect(honoSnapshot.context.headers.requestId).toBe('1');
    expect(effectSnapshot.context.headers.requestId).toBe('1');
  });

  test('parity: upload route', () => {
    expect(honoSnapshot.upload.status).toBe(200);
    expect(effectSnapshot.upload.status).toBe(200);
    expect(effectSnapshot.upload.body).toEqual(honoSnapshot.upload.body);

    const body = asRecord(effectSnapshot.upload.body);
    const data = asRecord(body.data);
    expect(data.file_name).toBe('mock_image.png');
  });

  test('parity: custom Response payload route', () => {
    expect(honoSnapshot.image.status).toBe(200);
    expect(effectSnapshot.image.status).toBe(200);
    expect(honoSnapshot.image.headers.contentType).toContain('image/png');
    expect(effectSnapshot.image.headers.contentType).toContain('image/png');
    expect(honoSnapshot.image.headers.cacheControl).toBe('no-store');
    expect(effectSnapshot.image.headers.cacheControl).toBe('no-store');
    expect(effectSnapshot.image.bodyBase64).toBe(honoSnapshot.image.bodyBase64);
    expect(effectSnapshot.image.byteLength).toBeGreaterThan(0);
  });

  test('parity: unmanaged and managed errors', () => {
    expect(honoSnapshot.error.status).toBe(500);
    expect(effectSnapshot.error.status).toBe(500);
    expect(effectSnapshot.error.body).toEqual(honoSnapshot.error.body);

    expect(honoSnapshot.exception.status).toBe(401);
    expect(effectSnapshot.exception.status).toBe(401);
    expect(effectSnapshot.exception.body).toEqual(honoSnapshot.exception.body);

    expect(honoSnapshot.managedError.status).toBe(501);
    expect(effectSnapshot.managedError.status).toBe(501);
    expect(effectSnapshot.managedError.body).toEqual(
      honoSnapshot.managedError.body,
    );

    expect(honoSnapshot.managedException.status).toBe(501);
    expect(effectSnapshot.managedException.status).toBe(501);
    expect(effectSnapshot.managedException.body).toEqual(
      honoSnapshot.managedException.body,
    );

    const managedBody = asRecord(effectSnapshot.managedError.body);
    expect(managedBody.error).toBe('customize parity response in serverConfig');
  });

  test('parity: not-found handling', () => {
    expect(honoSnapshot.notFound.status).toBe(404);
    expect(effectSnapshot.notFound.status).toBe(404);
    expect(effectSnapshot.notFound.hasBody).toBe(honoSnapshot.notFound.hasBody);
    expect(effectSnapshot.notFound.contentType).toBe(
      honoSnapshot.notFound.contentType,
    );
  });
});
