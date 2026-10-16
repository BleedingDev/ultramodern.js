import {
  type AdmittedWorkerFederationExpose,
  type AdmitWorkerRendererContract,
  admitWorkerFederationExpose,
  readWorkerFederationEnvelope,
  readWorkerFederationManifestUrl,
  readWorkerFederationPath,
  workerFederationEnvelope,
  workerFederationWireJson,
} from './contract';
import {
  assertWorkerFederationBodySize,
  checkWorkerFederationDeadline,
  readWorkerFederationJsonBody,
  workerAbortable,
  workerAbortReason,
} from './lease';

export interface WorkerFederationService {
  readonly remote: string;
  /** Existing MF import alias, mapped to the pinned topology publisher. */
  readonly alias?: string;
  readonly manifestUrl: string;
  readonly fragments: readonly {
    readonly expose: string;
    readonly boundaryId: string;
    readonly paths: Readonly<Record<string, string>>;
  }[];
  /** A configured Workers service binding, never a caller-selected fetch target. */
  fetch(request: Request): Promise<Response>;
}

export interface WorkerFederationSnapshot {
  readonly admitted: AdmittedWorkerFederationExpose;
  readonly payload: unknown;
}

export interface WorkerFederationTransport {
  /** Admit lazily before constructing the native snapshot boundary. */
  admit(options: {
    remote: string;
    expose: string;
    locale: string;
    signal?: AbortSignal;
  }): Promise<AdmittedWorkerFederationExpose>;
  /** Instantiate once per host document request; caches never cross documents. */
  request(options: {
    remote: string;
    expose: string;
    locale: string;
    /** Already encoded by the renderer's native wire codec. */
    payload: unknown;
    signal?: AbortSignal;
  }): Promise<WorkerFederationSnapshot>;
}

async function readResponseJson(
  response: Response,
  expectedUrl: string,
  signal: AbortSignal,
  checkDeadline: () => void,
): Promise<unknown> {
  const cancelBody = () => {
    void response.body?.cancel().catch(() => undefined);
  };
  if (signal.aborted) {
    cancelBody();
    throw workerAbortReason(signal);
  }
  try {
    checkDeadline();
  } catch (error) {
    cancelBody();
    throw error;
  }
  if (
    !response.ok ||
    response.redirected ||
    (response.url && response.url !== expectedUrl)
  ) {
    cancelBody();
    throw new Error(
      `Worker federation publication request failed (${response.status}).`,
    );
  }
  if (!response.body)
    throw new Error('Worker federation response has no body.');
  return readWorkerFederationJsonBody(
    response.body,
    signal,
    response.headers.get('content-length'),
    checkDeadline,
  );
}

async function fetchJson(
  fetchResponse: (request: Request) => Promise<Response>,
  request: Request,
  signal: AbortSignal,
  checkDeadline: () => void,
) {
  checkDeadline();
  if (signal.aborted) throw workerAbortReason(signal);
  const pending = fetchResponse(request);
  // A service binding may ignore abort. Dispose a response arriving after its lease.
  void pending.then(
    response => {
      if (signal.aborted) void response.body?.cancel().catch(() => undefined);
    },
    () => undefined,
  );
  return readResponseJson(
    await workerAbortable(pending, signal),
    request.url,
    signal,
    checkDeadline,
  );
}

interface PendingValue<Value> {
  readonly controller: AbortController;
  readonly promise: Promise<Value>;
  waiters: number;
  settled: boolean;
}

export function createWorkerFederationTransport(options: {
  services: readonly WorkerFederationService[];
  admitRendererContract: AdmitWorkerRendererContract;
  fetchManifest?: (request: Request) => Promise<Response>;
  /** One lease covers manifest headers/body and snapshot headers/body. */
  requestTimeout?: number;
}): WorkerFederationTransport {
  const timeout = options.requestTimeout ?? 3000;
  const admitRendererContract = options.admitRendererContract;
  if (typeof admitRendererContract !== 'function')
    throw new Error('Worker federation requires canonical renderer admission.');
  if (!Number.isFinite(timeout) || timeout <= 0)
    throw new Error('Worker federation requires a positive request deadline.');
  const services = new Map<string, WorkerFederationService>();
  for (const service of options.services) {
    if (!service.remote || services.has(service.remote))
      throw new Error('Worker federation service remotes must be unique.');
    const exposes = new Set<string>();
    for (const fragment of service.fragments) {
      Object.values(fragment.paths).forEach(readWorkerFederationPath);
      if (!fragment.boundaryId || exposes.has(fragment.expose))
        throw new Error(
          'Worker federation service exposes must be explicit and unique.',
        );
      exposes.add(fragment.expose);
    }
    const captured = {
      ...service,
      manifestUrl: readWorkerFederationManifestUrl(service.manifestUrl).href,
      fetch: service.fetch.bind(service),
      fragments: service.fragments.map(fragment =>
        Object.freeze({
          ...fragment,
          paths: Object.freeze({ ...fragment.paths }),
        }),
      ),
    };
    services.set(service.remote, captured);
    if (service.alias && service.alias !== service.remote) {
      if (services.has(service.alias))
        throw new Error('Worker federation service aliases must be unique.');
      services.set(service.alias, captured);
    }
  }
  const snapshots = new Map<string, PendingValue<WorkerFederationSnapshot>>();
  const admissions = new Map<
    string,
    PendingValue<AdmittedWorkerFederationExpose>
  >();
  const fetchManifest = options.fetchManifest;

  function serviceCoordinate(remote: string, expose: string, locale: string) {
    const service = services.get(remote);
    const fragment = service?.fragments.find(value => value.expose === expose);
    if (!service || !fragment || !Object.hasOwn(fragment.paths, locale))
      throw new Error(
        'Worker federation remote/expose has no configured service binding.',
      );
    return { service, fragment };
  }

  async function shared<Value>(
    cache: Map<string, PendingValue<Value>>,
    key: string,
    operation: (
      signal: AbortSignal,
      checkDeadline: () => void,
    ) => Promise<Value>,
    signal?: AbortSignal,
    deadlineAt = performance.now() + timeout,
  ): Promise<Value> {
    if (signal?.aborted) throw workerAbortReason(signal);
    let pending = cache.get(key);
    if (!pending) {
      const controller = new AbortController();
      const checkDeadline = () =>
        checkWorkerFederationDeadline(
          deadlineAt,
          controller.signal,
          controller,
        );
      const deadline = setTimeout(
        () =>
          controller.abort(
            new Error('Worker federation request deadline exceeded.'),
          ),
        Math.max(0, deadlineAt - performance.now()),
      );
      const promise = operation(controller.signal, checkDeadline);
      pending = { controller, promise, waiters: 0, settled: false };
      const captured = pending;
      cache.set(key, captured);
      void promise.then(
        () => {
          captured.settled = true;
          clearTimeout(deadline);
        },
        () => {
          captured.settled = true;
          clearTimeout(deadline);
          if (cache.get(key) === captured) cache.delete(key);
        },
      );
    }
    const captured = pending;
    captured.waiters++;
    try {
      return await (signal
        ? workerAbortable(captured.promise, signal)
        : captured.promise);
    } finally {
      captured.waiters--;
      if (!captured.settled && captured.waiters === 0) {
        captured.controller.abort(
          new Error('Worker federation request has no active consumers.'),
        );
        if (cache.get(key) === captured) cache.delete(key);
      }
    }
  }

  function admitWithin(
    {
      remote,
      expose,
      locale,
      signal,
    }: {
      remote: string;
      expose: string;
      locale: string;
      signal?: AbortSignal;
    },
    deadlineAt = performance.now() + timeout,
  ): Promise<AdmittedWorkerFederationExpose> {
    const { service, fragment } = serviceCoordinate(remote, expose, locale);
    return shared(
      admissions,
      workerFederationWireJson([service.remote, expose, locale]),
      async (signal, checkDeadline) => {
        checkDeadline();
        const request = new Request(service.manifestUrl, {
          redirect: 'error',
          signal,
        });
        const manifest = await fetchJson(
          fetchManifest ?? service.fetch,
          request,
          signal,
          checkDeadline,
        );
        const admitted = admitWorkerFederationExpose({
          manifest,
          manifestUrl: request.url,
          remote: service.remote,
          expose,
          locale,
          admitRendererContract,
        });
        checkDeadline();
        if (
          admitted.coordinate.boundaryId !== fragment.boundaryId ||
          admitted.path !== fragment.paths[locale]
        )
          throw new Error(
            'Worker federation publication conflicts with its service coordinate.',
          );
        return admitted;
      },
      signal,
      deadlineAt,
    );
  }

  return {
    admit: options => admitWithin(options),
    async request({ remote, expose, locale, payload, signal }) {
      const deadlineAt = performance.now() + timeout;
      if (signal?.aborted) throw workerAbortReason(signal);
      const { service } = serviceCoordinate(remote, expose, locale);
      if (typeof payload === 'string') assertWorkerFederationBodySize(payload);
      const encodedPayload = assertWorkerFederationBodySize(
        workerFederationWireJson(payload),
      );
      const key = workerFederationWireJson([
        service.remote,
        expose,
        locale,
        encodedPayload,
      ]);
      checkWorkerFederationDeadline(deadlineAt, signal);
      return shared(
        snapshots,
        key,
        async (signal, checkDeadline) => {
          checkDeadline();
          const admitted = await admitWithin(
            { remote, expose, locale, signal },
            deadlineAt,
          );
          checkDeadline();
          const admissionKey = workerFederationWireJson([
            service.remote,
            expose,
            locale,
          ]);
          const capturedAdmission = admissions.get(admissionKey);
          try {
            const body = assertWorkerFederationBodySize(
              workerFederationWireJson(
                workerFederationEnvelope(
                  'request',
                  admitted,
                  JSON.parse(encodedPayload),
                ),
              ),
            );
            checkDeadline();
            const response = await fetchJson(
              service.fetch,
              new Request(admitted.endpoint, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body,
                redirect: 'error',
                signal,
              }),
              signal,
              checkDeadline,
            );
            checkDeadline();
            const decodedPayload = readWorkerFederationEnvelope(
              response,
              'response',
              admitted,
            );
            checkDeadline();
            return { admitted, payload: decodedPayload };
          } catch (error) {
            // Consumers keep their captured authority; retry may admit a new publisher.
            if (admissions.get(admissionKey) === capturedAdmission)
              admissions.delete(admissionKey);
            throw error;
          }
        },
        signal,
        deadlineAt,
      );
    },
  };
}
