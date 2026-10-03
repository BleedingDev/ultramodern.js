import type { RendererIdentity } from '@bleedingdev/modern-js-renderer-core/identity';
import {
  createRequestSession,
  type RequestSession,
  type ResponsePolicy,
} from '@bleedingdev/modern-js-renderer-core/session';
import {
  renderApplication,
  renderCSRDocument,
  renderDocumentApplication,
  respondApplication,
  respondApplicationResponse,
  runApplicationRequest,
  type SolidApplicationDocumentOptions,
  type SolidDocumentRenderOptions,
  type SolidRenderOptions,
} from '@bleedingdev/modern-js-renderer-solid/server';
import {
  getRequestEvent,
  httpHeader,
  httpStatus,
  type JSX,
} from '@solidjs/web';
import { createRoot } from 'solid-js';

interface Bindings {
  tenant: string;
}

const identity: RendererIdentity = {
  renderer: 'solid',
  appId: 'public-sdk',
  entryName: 'main',
  protocolVersion: 1,
  buildId: 'source-profile-build',
};
const policy: ResponsePolicy = {
  kind: 'document',
  status: 200,
  statusText: 'OK',
  headers: [['content-type', 'text/html; charset=utf-8']],
  cache: { mode: 'no-store' },
};
const document: SolidApplicationDocumentOptions = {
  rootId: 'public-sdk-root',
  lang: 'en',
  renderId: 'public-sdk:',
  nonce: { script: 'public-sdk-nonce', style: false },
  assets: [
    { kind: 'stylesheet', href: '/entry.css' },
    { kind: 'script', href: '/entry.js', scriptType: 'module' },
  ],
};

function newSession(name: string): RequestSession<Bindings> {
  return createRequestSession({
    request: new Request(`https://public.test/${name}`),
    identity,
    platform: { kind: 'node', bindings: { tenant: 'public' } },
  });
}

function view(session: RequestSession<Bindings>): () => JSX.Element {
  return () => {
    if (getRequestEvent()?.request !== session.request)
      throw new Error('Native request identity');
    httpStatus(201, 'Created');
    httpHeader('x-native', session.platform.bindings.tenant);
    return 'Native public view';
  };
}

async function complete(
  session: RequestSession<Bindings>,
  response: Response,
): Promise<void> {
  if (!session.ownsResponseBody(response))
    throw new Error('Session body ownership');
  await response.text();
  if ((await session.completion).state !== 'completed')
    throw new Error('Request completion');
}

export async function serverPublicProgram(): Promise<void> {
  const plain = newSession('plain');
  plain.resolveResponse(policy);
  const plainOptions: SolidRenderOptions<Bindings> = {
    session: plain,
    view: view(plain),
    document: { renderId: 'plain:', nonce: 'public-sdk-nonce' },
    onError: (_error, context) => {
      void context.handling;
    },
  };
  const scoped: Promise<Response> = runApplicationRequest(plain, async () => {
    const event = getRequestEvent();
    if (!event || event.request !== plain.request)
      throw new Error('Native top-level request scope');
    await Promise.resolve();
    if (getRequestEvent() !== event) throw new Error('Native await scope');
    return renderApplication(plainOptions);
  });
  await complete(plain, await scoped);

  const full = newSession('document');
  full.resolveResponse(policy);
  const fullOptions: SolidDocumentRenderOptions<Bindings> = {
    session: full,
    view: view(full),
    document,
  };
  await complete(
    full,
    await runApplicationRequest(full, () =>
      renderDocumentApplication(fullOptions),
    ),
  );

  const csr = newSession('csr');
  csr.resolveResponse(policy);
  await complete(
    csr,
    await runApplicationRequest(csr, () =>
      renderCSRDocument({ session: csr, document }),
    ),
  );

  const bytes = newSession('bytes');
  bytes.resolveResponse({
    ...policy,
    kind: 'terminal',
    headers: [['content-type', 'text/plain']],
  });
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('Public bytes'));
      controller.close();
    },
  });
  await complete(
    bytes,
    await runApplicationRequest(bytes, () => respondApplication(bytes, body)),
  );

  const empty = newSession('empty');
  empty.resolveResponse({
    kind: 'terminal',
    status: 204,
    statusText: 'No content',
    headers: [],
    cache: { mode: 'no-store' },
  });
  await complete(
    empty,
    await runApplicationRequest(empty, () => respondApplication(empty, null)),
  );

  const terminal = newSession('terminal');
  await complete(
    terminal,
    await runApplicationRequest(terminal, () =>
      createRoot(dispose => {
        terminal.registerCleanup(dispose);
        httpHeader('set-cookie', 'public=1; Path=/', { append: true });
        return respondApplicationResponse(
          terminal,
          new Response('Public data', {
            status: 202,
            statusText: 'Accepted',
            headers: { 'content-type': 'text/plain' },
          }),
        );
      }),
    ),
  );
}
