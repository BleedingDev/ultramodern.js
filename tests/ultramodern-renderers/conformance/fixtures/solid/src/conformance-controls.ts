interface Group {
  released: boolean;
  activeRequests: number;
  cleanupCount: number;
  cancelled: boolean;
  producers: Set<() => void>;
}

// Fixture-owned controls, isolated to this renderer's server module. Completed
// records stay observable; the fixed limit bounds storage for the host lifetime.
const groups = new Map<string, Group>();
const maximumGroups = 128;
const producerTimeoutMs = 30_000;

function controlError(status: number, code: string): Response {
  return Response.json(
    { error: code },
    {
      status,
      headers: { 'cache-control': 'no-store' },
    },
  );
}

function conformanceId(request: Request): string {
  const ids = new URL(request.url).searchParams.getAll('conformanceId');
  const id = ids[0];
  if (
    ids.length !== 1 ||
    typeof id !== 'string' ||
    !/^[A-Za-z0-9_-]{1,64}$/u.test(id)
  ) {
    throw controlError(400, 'INVALID_CONFORMANCE_ID');
  }
  return id;
}

function groupFor(request: Request): Group {
  const id = conformanceId(request);
  const existing = groups.get(id);
  if (existing) return existing;
  if (groups.size >= maximumGroups) {
    throw controlError(429, 'CONFORMANCE_GROUP_LIMIT');
  }
  const group: Group = {
    released: false,
    activeRequests: 0,
    cleanupCount: 0,
    cancelled: false,
    producers: new Set(),
  };
  groups.set(id, group);
  return group;
}

/** Headers travel through the native loader/action response policy. */
export function responseHeaders(request: Request): Headers {
  const id = conformanceId(request);
  const privateValue = request.headers.get('x-conformance-private') ?? '';
  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-conformance-private': privateValue,
  });
  headers.append(
    'set-cookie',
    `conformance-group=${encodeURIComponent(id)}; Path=/; SameSite=Lax`,
  );
  headers.append(
    'set-cookie',
    `conformance-private=${encodeURIComponent(privateValue)}; Path=/; SameSite=Lax`,
  );
  return headers;
}

/** The supplied native request owns cancellation and the producer's timeout. */
export async function holdProducer(request: Request): Promise<string> {
  const group = groupFor(request);
  if (group.released) throw controlError(409, 'CONFORMANCE_GROUP_RELEASED');
  const privateValue = request.headers.get('x-conformance-private');
  const value = privateValue
    ? `Native late value ${privateValue}`
    : 'Native late value';
  group.activeRequests += 1;
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;
    const finish = (kind: 'release' | 'abort' | 'timeout') => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      request.signal.removeEventListener('abort', abort);
      group.producers.delete(release);
      group.activeRequests -= 1;
      group.cleanupCount += 1;
      if (kind === 'abort') {
        group.cancelled = true;
        reject(request.signal.reason);
      } else if (kind === 'timeout') {
        reject(new Error('Conformance producer exceeded its 30s deadline'));
      } else {
        resolve(value);
      }
    };
    const abort = () => finish('abort');
    const release = () => finish('release');
    group.producers.add(release);
    timer = setTimeout(() => finish('timeout'), producerTimeoutMs);
    if (request.signal.aborted) abort();
    else request.signal.addEventListener('abort', abort, { once: true });
  });
}

export function observeControl(request: Request): Response {
  try {
    const group = groupFor(request);
    return Response.json(
      {
        released: group.released,
        activeRequests: group.activeRequests,
        cleanupCount: group.cleanupCount,
        cancelled: group.cancelled,
      },
      { headers: responseHeaders(request) },
    );
  } catch (error) {
    if (error instanceof Response) return error;
    throw error;
  }
}

export function releaseControl(request: Request): Response {
  try {
    const group = groupFor(request);
    group.released = true;
    for (const release of group.producers) release();
    return observeControl(request);
  } catch (error) {
    if (error instanceof Response) return error;
    throw error;
  }
}
