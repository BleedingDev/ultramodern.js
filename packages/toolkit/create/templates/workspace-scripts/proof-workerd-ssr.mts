#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { Log, LogLevel, Miniflare } from "miniflare";

const workspaceRoot = process.cwd();
const defaultProofRoutes = ["/en"];
const reportPath = path.join(
  workspaceRoot,
  ".codex/reports/cloudflare-workerd-ssr/composition-proof.json",
);

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};
const readJson = (absolutePath) => JSON.parse(fs.readFileSync(absolutePath, "utf-8"));
const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const count = (source, value) => source.split(value).length - 1;
const normalizePath = (value) => String(value).replace(/\\/gu, "/");
const DISTRIBUTED_SSR_FRAGMENT_REQUEST_HEADER =
  "x-modern-js-fragment-request";
const DISTRIBUTED_SSR_REQUIRED_HEADERS = [
  "x-modern-distributed-ssr-boundary-id",
  "x-modern-distributed-ssr-expose",
  "x-modern-distributed-ssr-props",
  "x-modern-distributed-ssr-remote",
  "x-modern-distributed-ssr-source-url",
];

const collectJavaScriptFiles = (absoluteDirectory) => {
  if (!fs.existsSync(absoluteDirectory)) {
    return [];
  }

  return fs
    .readdirSync(absoluteDirectory, { withFileTypes: true })
    .flatMap((entry) => {
      const absolutePath = path.join(absoluteDirectory, entry.name);
      if (entry.isDirectory()) {
        return collectJavaScriptFiles(absolutePath);
      }
      return entry.isFile() && /\.(?:c|m)?js$/u.test(entry.name) ? [absolutePath] : [];
    })
    .sort();
};

const createWorkerModules = (outputRoot, main) => {
  const entryPath = path.resolve(outputRoot, main);
  const modulePaths = [
    entryPath,
    ...collectJavaScriptFiles(path.join(outputRoot, "server")),
    ...collectJavaScriptFiles(path.join(outputRoot, "worker")),
  ].filter((modulePath, index, paths) => paths.indexOf(modulePath) === index);

  return modulePaths.map((modulePath) => ({
    type: modulePath.endsWith(".cjs") ? "CommonJS" : "ESModule",
    path: modulePath,
  }));
};

const readExecutionEnvelope = (appId, outputRoot, expectedUnitId) => {
  const envelopePath = path.join(
    outputRoot,
    "release/microvertical-release-envelope.json",
  );
  assert(fs.existsSync(envelopePath), `${appId} executed .output release envelope is missing`);
  const envelope = readJson(envelopePath);
  assert(envelope.schemaVersion === 3, `${appId} executed envelope schema must be 3`);
  assert(envelope.target === "cloudflare", `${appId} executed envelope must target cloudflare`);
  assert(
    typeof expectedUnitId === "string" &&
      expectedUnitId.length > 0 &&
      envelope.identity?.unitId === expectedUnitId,
    `${appId} executed envelope unit identity is invalid`,
  );
  assert(
    typeof envelope.envelopeDigest === "string" &&
      /^[a-f\d]{64}$/u.test(envelope.envelopeDigest),
    `${appId} executed envelope digest is invalid`,
  );
  assert(
    Array.isArray(envelope.artifacts) && envelope.artifacts.length > 0,
    `${appId} executed envelope has no artifacts`,
  );
  return { envelope, envelopePath };
};

const bindExecutedModule = (app, envelope, module) => {
  const logicalPath = normalizePath(path.relative(app.outputRoot, module.path));
  assert(
    logicalPath.length > 0 &&
      !logicalPath.startsWith("../") &&
      !path.posix.isAbsolute(logicalPath),
    `${app.id} selected module escapes .output: ${logicalPath}`,
  );
  const artifact = envelope.artifacts.find(
    (candidate) => candidate.logicalPath === logicalPath,
  );
  assert(artifact, `${app.id} selected module ${logicalPath} is not envelope-bound`);
  assert(
    artifact.kind === "file",
    `${app.id} selected module ${logicalPath} is bound to a non-file artifact`,
  );
  const bytes = fs.readFileSync(module.path);
  const digest = sha256(bytes);
  assert(
    artifact.byteLength === bytes.byteLength && artifact.sha256 === digest,
    `${app.id} selected module ${logicalPath} differs from its envelope artifact`,
  );
  return {
    byteLength: bytes.byteLength,
    logicalPath,
    runtime: artifact.runtime,
    sha256: digest,
    type: module.type,
  };
};

const compactConfig = readJson(path.join(workspaceRoot, ".modernjs/ultramodern.json"));
const apps = (compactConfig.topology?.apps ?? []).map((rawApp) => {
  const kind = rawApp.kind === "vertical" ? "vertical" : "shell";
  const appPath =
    typeof rawApp.path === "string"
      ? normalizePath(rawApp.path)
      : kind === "shell"
        ? "apps/shell-super-app"
        : `verticals/${rawApp.id}`;
  const moduleFederation =
    rawApp.moduleFederation && typeof rawApp.moduleFederation === "object"
      ? rawApp.moduleFederation
      : {};
  const configuredProofRoutes = rawApp.deploy?.cloudflare?.distributedSsrProofRoutes;
  const proofRoutes = Array.isArray(configuredProofRoutes)
    ? [...new Set(configuredProofRoutes.filter(
        (route) => typeof route === "string" && route.startsWith("/"),
      ))]
    : [];
  const outputRoot = path.join(workspaceRoot, appPath, ".output");
  const wranglerPath = path.join(outputRoot, "wrangler.json");
  assert(
    fs.existsSync(wranglerPath),
    `${rawApp.id} Cloudflare output is missing; run pnpm cloudflare:build first`,
  );
  const wrangler = readJson(wranglerPath);
  const executedEnvelope =
    kind === "vertical"
      ? readExecutionEnvelope(
          String(rawApp.id),
          outputRoot,
          rawApp.deliveryUnit?.unitId,
        )
      : {};

  return {
    id: String(rawApp.id),
    kind,
    path: appPath,
    mfName: typeof moduleFederation.name === "string" ? moduleFederation.name : String(rawApp.id),
    verticalRefs: Array.isArray(moduleFederation.verticalRefs)
      ? moduleFederation.verticalRefs.filter((ref) => typeof ref === "string")
      : [],
    apiPrefix:
      typeof rawApp.api?.prefix === "string"
        ? rawApp.api.prefix.replace(/\/+$/u, "")
        : undefined,
    proofRoutes: proofRoutes.length > 0 ? proofRoutes : defaultProofRoutes,
    jsonSmokeChecks: Array.isArray(rawApp.deploy?.cloudflare?.jsonSmokeChecks)
      ? rawApp.deploy.cloudflare.jsonSmokeChecks
      : [],
    ...executedEnvelope,
    outputRoot,
    port: Number(rawApp.port),
    wrangler,
  };
});

const shells = apps.filter((app) => app.kind === "shell");
assert(shells.length > 0, "Workerd SSR proof requires at least one shell");
if (process.env.ULTRAMODERN_KEEP_WORKERD === "1") {
  assert(shells.length === 1, "Browser workerd proof requires exactly one shell");
}

const workerName = (app) => {
  assert(
    typeof app.wrangler.name === "string" && app.wrangler.name.length > 0,
    `${app.id} wrangler output must define a worker name`,
  );
  return app.wrangler.name;
};

const createWorkerOptions = (app, extra = {}) => {
  const main = typeof app.wrangler.main === "string" ? app.wrangler.main : "server/index.mjs";
  const assets =
    app.wrangler.assets && typeof app.wrangler.assets === "object" ? app.wrangler.assets : {};
  const directory = typeof assets.directory === "string" ? assets.directory : "./public";

  const modules = createWorkerModules(app.outputRoot, main);
  const boundModules = modules.map((module) => {
    if (app.envelope) {
      return bindExecutedModule(app, app.envelope, module);
    }
    const bytes = fs.readFileSync(module.path);
    return {
      byteLength: bytes.byteLength,
      logicalPath: normalizePath(path.relative(app.outputRoot, module.path)),
      runtime: "workerd",
      sha256: sha256(bytes),
      type: module.type,
    };
  });
  const mainLogicalPath = normalizePath(
    path.relative(app.outputRoot, path.resolve(app.outputRoot, main)),
  );
  assert(
    boundModules.some((module) => module.logicalPath === mainLogicalPath),
    `${app.id} Miniflare main ${mainLogicalPath} is not in the selected module set`,
  );
  const apiBackend = app.envelope?.surfaces?.apiBackend;
  const ssr = app.envelope?.surfaces?.ssr;
  assert(
    app.kind !== "vertical" ||
      (Array.isArray(apiBackend) &&
        apiBackend.length > 0 &&
        apiBackend.every((logicalPath) =>
          boundModules.some((module) => module.logicalPath === logicalPath),
        )),
    `${app.id} BFF worker surface is not selected by Miniflare`,
  );
  assert(
    app.kind !== "vertical" ||
      (Array.isArray(ssr) &&
        ssr.includes(mainLogicalPath) &&
        boundModules.every((module) =>
          [...ssr, ...(apiBackend ?? [])].includes(module.logicalPath),
        )),
    `${app.id} Miniflare main/SSR modules are not envelope-bound SSR surfaces`,
  );

  return {
    executionEvidence: {
      appId: app.id,
      apiBackend: apiBackend ?? [],
      envelopeDigest: app.envelope?.envelopeDigest ?? null,
      envelopePath: app.envelopePath
        ? normalizePath(path.relative(workspaceRoot, app.envelopePath))
        : null,
      identity: app.envelope?.identity ?? null,
      main: mainLogicalPath,
      modules: boundModules,
      modulesRoot: normalizePath(path.relative(workspaceRoot, app.outputRoot)),
      worker: workerName(app),
    },
    name: workerName(app),
    modules,
    modulesRoot: app.outputRoot,
    compatibilityDate: app.wrangler.compatibility_date,
    compatibilityFlags: app.wrangler.compatibility_flags,
    assets: {
      workerName: workerName(app),
      binding: typeof assets.binding === "string" ? assets.binding : "ASSETS",
      directory: path.resolve(app.outputRoot, directory),
      routerConfig: {
        has_user_worker: true,
        invoke_user_worker_ahead_of_assets: assets.run_worker_first !== false,
      },
    },
    ...extra,
  };
};

const findReleaseMarkers = (value, markers = []) => {
  if (Array.isArray(value)) {
    for (const item of value) {
      findReleaseMarkers(item, markers);
    }
    return markers;
  }
  if (!value || typeof value !== "object") {
    return markers;
  }
  if (
    value.marker &&
    typeof value.marker === "object" &&
    typeof value.marker.build === "string"
  ) {
    markers.push(value.marker);
  }
  for (const nested of Object.values(value)) {
    findReleaseMarkers(nested, markers);
  }
  return markers;
};

const responseEvidence = async (app, response) => {
  const bytes = Buffer.from(await response.arrayBuffer());
  let body;
  try {
    body = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new Error(`${app.id} API response is not JSON: ${error.message}`);
  }
  const markers = findReleaseMarkers(body);
  const marker = markers.find(
    (candidate) =>
      candidate.appId === app.id &&
      candidate.build === app.envelope.identity.buildMarker &&
      candidate.version === app.envelope.identity.releaseVersion,
  );
  assert(marker, `${app.id} API response is not tied to its executed release identity`);
  assert(response.ok, `${app.id} API response returned HTTP ${response.status}`);
  return {
    bodyBase64: bytes.toString("base64"),
    byteLength: bytes.byteLength,
    releaseMarker: marker,
    sha256: sha256(bytes),
    status: response.status,
  };
};

const resolveApiSmokeChecks = (app, shell) => {
  const shellChecks =
    typeof app.apiPrefix === "string" && app.apiPrefix.startsWith("/")
      ? shell.jsonSmokeChecks.filter(
          (check) =>
            typeof check?.route === "string" &&
            (check.route === app.apiPrefix ||
              check.route.startsWith(`${app.apiPrefix}/`)),
        )
      : [];
  const checks = [...app.jsonSmokeChecks, ...shellChecks];
  const uniqueChecks = new Map();
  for (const check of checks) {
    const key = JSON.stringify([
      String(check.method ?? "GET").toUpperCase(),
      check.route,
      check.body ?? null,
      check.expect ?? null,
      check.id ?? null,
    ]);
    if (!uniqueChecks.has(key)) {
      uniqueChecks.set(key, check);
    }
  }
  return [...uniqueChecks.values()];
};

const runApiProofs = async (miniflare, shell, executionByAppId) => {
  const results = [];
  for (const app of apps.filter((candidate) => candidate.kind === "vertical")) {
    const jsonSmokeChecks = resolveApiSmokeChecks(app, shell);
    assert(
      jsonSmokeChecks.length > 0,
      `${app.id} has no real Cloudflare API smoke check`,
    );
    const binding = (shell.wrangler.services ?? []).find(
      (candidate) => candidate.service === workerName(app),
    );
    assert(binding, `${shell.id} has no service binding for ${app.id}`);
    for (const check of jsonSmokeChecks) {
      const method = String(check.method ?? "GET").toUpperCase();
      const headers = {};
      const init = { method, headers };
      if (check.body !== undefined) {
        headers["content-type"] = "application/json";
        init.body = JSON.stringify(check.body);
      }
      const direct = await responseEvidence(
        app,
        await (
          await miniflare.getWorker(workerName(app))
        ).fetch(`https://${workerName(app)}.invalid${check.route}`, init),
      );
      const throughShell = await responseEvidence(
        app,
        await miniflare.dispatchFetch(
          `https://${workerName(shell)}.invalid${check.route}`,
          init,
        ),
      );
      assert(
        direct.sha256 === throughShell.sha256,
        `${app.id} direct and service-binding API responses differ`,
      );
      results.push({
        appId: app.id,
        binding: binding.binding,
        bindingTarget: {
          appId: app.id,
          envelopeDigest: executionByAppId.get(app.id).envelopeDigest,
          worker: workerName(app),
        },
        direct,
        id: check.id,
        method,
        route: check.route,
        throughShell,
      });
    }
  }
  return results;
};

const readRequestBody = async (request) => {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return chunks.length > 0 ? Buffer.concat(chunks) : undefined;
};

const listen = (server, port) =>
  new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

const closeServer = (server) =>
  new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });

const startWorkerdTargetServers = async (
  miniflare,
  failedServices,
  workerConfigurations,
) => {
  const servers = [];
  const isolatedVerticalRuntimes = [];
  const targetUrls = {};
  try {
    for (const [index, app] of apps.entries()) {
      assert(
        Number.isInteger(app.port) && app.port > 0,
        `${app.id} requires a configured local port for all-workerd browser proof`,
      );
      // Miniflare 4 currently assigns one shared assets storage service inside
      // a multi-worker instance. Keep the shell composition runtime intact,
      // but give every directly browsed MicroVertical its own runtime so its
      // static assets and MF manifest cannot resolve from a sibling Worker.
      const runtime =
        app.kind === "vertical"
          ? new Miniflare({
              log: new Log(LogLevel.ERROR),
              workers: [workerConfigurations[index]],
            })
          : miniflare;
      if (runtime !== miniflare) {
        isolatedVerticalRuntimes.push(runtime);
      }
      const server = http.createServer(async (incoming, outgoing) => {
        try {
          const body = await readRequestBody(incoming);
          if (
            incoming.method === "POST" &&
            incoming.url === "/_ultramodern-proof/service-binding-fault"
          ) {
            const command = JSON.parse(body?.toString("utf8") ?? "{}");
            const targetApp = apps.find((candidate) => candidate.id === command.appId);
            assert(targetApp, `Unknown service-binding fault target ${String(command.appId)}`);
            const service = workerName(targetApp);
            if (command.failed === true) {
              failedServices.add(service);
            } else {
              failedServices.delete(service);
            }
            outgoing.writeHead(200, { "content-type": "application/json" });
            outgoing.end(JSON.stringify({ failed: failedServices.has(service), service }));
            return;
          }
          // Miniflare's WorkerFetcher owns its own Request implementation.
          // Passing a Node-global Request across that realm boundary makes
          // Miniflare stringify it as "[object Request]" and reject the URL.
          // Keep the internal URL on the target Worker's canonical fake host
          // so Miniflare also selects that Worker's asset namespace.
          const response = await runtime.dispatchFetch(
            `https://${workerName(app)}.invalid${incoming.url ?? "/"}`,
            {
              ...(body === undefined ? {} : { body }),
              headers: incoming.headers,
              method: incoming.method,
            },
          );
          outgoing.writeHead(
            response.status,
            Object.fromEntries(response.headers.entries()),
          );
          outgoing.end(Buffer.from(await response.arrayBuffer()));
        } catch (error) {
          outgoing.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
          outgoing.end(error instanceof Error ? error.stack ?? error.message : String(error));
        }
      });
      await listen(server, app.port);
      servers.push(server);
      targetUrls[app.id] = `http://127.0.0.1:${app.port}`;
    }
    return {
      targetUrls,
      async stop() {
        await Promise.allSettled(servers.map(closeServer));
        await Promise.allSettled(
          isolatedVerticalRuntimes.map((runtime) => runtime.dispose()),
        );
      },
    };
  } catch (error) {
    await Promise.allSettled(servers.map(closeServer));
    await Promise.allSettled(
      isolatedVerticalRuntimes.map((runtime) => runtime.dispose()),
    );
    throw error;
  }
};

const readAttribute = (tag, name) => {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = new RegExp(`\\s${escapedName}=(?:"([^"]*)"|'([^']*)')`, "u").exec(tag);
  return match?.[1] ?? match?.[2];
};

const collectDistributedBoundaries = (html) =>
  [...html.matchAll(/<[a-z][^>]*data-modern-distributed-ssr-boundary=(?:"[^"]+"|'[^']+')[^>]*>/giu)].map(
    (match) => {
      const tag = match[0];
      const key = readAttribute(tag, "data-modern-distributed-ssr-boundary");
      const separator = key?.indexOf("::") ?? -1;
      assert(separator > 0, `Invalid distributed SSR boundary key ${key}`);
      return {
        buildMarker: readAttribute(tag, "data-modern-distributed-ssr-build"),
        digest: readAttribute(tag, "data-modern-distributed-ssr-digest"),
        expose: key.slice(separator + 2),
        key,
        remote: key.slice(0, separator),
        status: readAttribute(tag, "data-modern-distributed-ssr-status"),
      };
    },
  );

const collectStylesheetHrefs = (html) =>
  [...html.matchAll(/<link\b[^>]*>/giu)]
    .filter((match) => readAttribute(match[0], "rel")?.split(/\s+/u).includes("stylesheet"))
    .map((match) => readAttribute(match[0], "href"))
    .filter(Boolean);

const isDistributedSsrFragmentRequest = (request) =>
  request.headers.get(DISTRIBUTED_SSR_FRAGMENT_REQUEST_HEADER) === "1";

const readRequiredFragmentHeader = (request, header) => {
  const value = request.headers.get(header);
  assert(
    typeof value === "string" && value.length > 0,
    `Distributed SSR fragment request is missing ${header}`,
  );
  return value;
};

const decodeDistributedSsrFragmentRequest = (request) => {
  assert(
    isDistributedSsrFragmentRequest(request),
    "Distributed SSR fragment request is missing its request marker",
  );
  assert(
    request.method === "GET",
    `Distributed SSR fragment request must use GET, received ${request.method}`,
  );

  const headers = Object.fromEntries(
    DISTRIBUTED_SSR_REQUIRED_HEADERS.map((header) => [
      header,
      readRequiredFragmentHeader(request, header),
    ]),
  );
  const props = JSON.parse(
    decodeURIComponent(headers["x-modern-distributed-ssr-props"]),
  );
  assert(props && typeof props === "object" && !Array.isArray(props), "Fragment props must be an object");
  const sourceUrl = headers["x-modern-distributed-ssr-source-url"];
  try {
    new URL(sourceUrl);
  } catch {
    throw new Error("Distributed SSR fragment source URL must be absolute");
  }

  return {
    boundaryId: headers["x-modern-distributed-ssr-boundary-id"],
    expose: headers["x-modern-distributed-ssr-expose"],
    props,
    remote: headers["x-modern-distributed-ssr-remote"],
    sourceUrl,
  };
};

const createServiceBindings = (
  caller,
  { apiBindingRequests, failedServices, fragmentBindingRequests },
) => {
  const services = Array.isArray(caller.wrangler.services) ? caller.wrangler.services : [];
  return Object.fromEntries(
    services.map((service) => {
      assert(
        typeof service.binding === "string" && typeof service.service === "string",
        `${caller.id} has an invalid service binding`,
      );
      return [
        service.binding,
        async (request, miniflare) => {
          if (failedServices.has(service.service)) {
            throw new Error(
              `Injected unavailable service binding ${service.binding} -> ${service.service}`,
            );
          }
          const requestUrl = new URL(request.url);
          let apiBindingRequest;
          if (isDistributedSsrFragmentRequest(request)) {
            const fragment = decodeDistributedSsrFragmentRequest(request);
            fragmentBindingRequests.push({
              binding: service.binding,
              boundaryId: fragment.boundaryId,
              callerId: caller.id,
              expose: fragment.expose,
              method: request.method,
              pathname: requestUrl.pathname,
              props: fragment.props,
              remote: fragment.remote,
              service: service.service,
              sourceUrl: fragment.sourceUrl,
            });
          } else {
            apiBindingRequest = {
              binding: service.binding,
              callerId: caller.id,
              method: request.method,
              pathname: requestUrl.pathname,
              requestBody: {
                contentLength: request.headers.get("content-length"),
                contentType: request.headers.get("content-type"),
                present: request.body !== null,
              },
              service: service.service,
            };
            apiBindingRequests.push(apiBindingRequest);
          }
          const target = await miniflare.getWorker(service.service);
          const response = await target.fetch(request);
          if (apiBindingRequest !== undefined) {
            apiBindingRequest.response = {
              contentType: response.headers.get("content-type"),
              status: response.status,
            };
          }
          return response;
        },
      ];
    }),
  );
};

const proofs = [];
const apiProofs = [];
let executions = [];

const writeReport = () => {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(
    reportPath,
    `${JSON.stringify(
      {
        schemaVersion: 3,
        runtime: "workerd",
        routes: [...new Set(proofs.map((proof) => proof.route))],
        executions,
        apiProofs,
        proofs,
      },
      null,
      2,
    )}\n`,
  );
};

for (const shell of shells) {
  const expectedRemotes = shell.verticalRefs.map((ref) => {
    const remote = apps.find((app) => app.id === ref);
    assert(remote, `${shell.id} references missing MicroVertical ${ref}`);
    return remote;
  });
  assert(expectedRemotes.length > 0, `${shell.id} has no MicroVerticals to prove`);

  const apiBindingRequests = [];
  const failedServices = new Set();
  const fragmentBindingRequests = [];
  const outboundRequests = [];
  const workerConfigurations = apps.map((app) =>
    createWorkerOptions(app, {
      serviceBindings: createServiceBindings(app, {
        apiBindingRequests,
        failedServices,
        fragmentBindingRequests,
      }),
      async outboundService(request) {
        const requestUrl = new URL(request.url);
        outboundRequests.push({ callerId: app.id, url: requestUrl.href });
        return new Response("External network disabled by SSR proof", {
          status: 502,
        });
      },
    }),
  );
  executions = workerConfigurations.map((configuration) => configuration.executionEvidence);
  const executionByAppId = new Map(
    apps.map((app, index) => [app.id, executions[index]]),
  );
  const workers = workerConfigurations.map(
    ({ executionEvidence: _executionEvidence, ...configuration }) => configuration,
  );
  const miniflare = new Miniflare({
    log: new Log(LogLevel.ERROR),
    workers,
  });
  const renderedRemoteIds = new Set();

  try {
    for (const route of shell.proofRoutes) {
      const apiBindingRequestStart = apiBindingRequests.length;
      const fragmentBindingRequestStart = fragmentBindingRequests.length;
      const outboundRequestStart = outboundRequests.length;
      const response = await miniflare.dispatchFetch(
        `https://${workerName(shell)}.invalid${route}`,
        { headers: { accept: "text/html" } },
      );
      const html = await response.text();
      assert(
        response.status === 200,
        `${shell.id} returned HTTP ${response.status} for ${route} in workerd`,
      );
      assert(
        !html.includes('data-modern-distributed-ssr-status="degraded"'),
        `${shell.id} rendered a degraded MicroVertical fallback for ${route} in workerd`,
      );

      const boundaries = collectDistributedBoundaries(html);
      assert(
        boundaries.length > 0,
        `${shell.id} rendered no distributed SSR boundaries for ${route}`,
      );
      const routeApiBindingRequests = apiBindingRequests.slice(
        apiBindingRequestStart,
      );
      const routeFragmentBindingRequests = fragmentBindingRequests.slice(
        fragmentBindingRequestStart,
      );
      const routeOutboundRequests = outboundRequests.slice(outboundRequestStart);
      for (const boundary of boundaries) {
        renderedRemoteIds.add(boundary.remote);
        assert(
          boundary.status === "ready",
          `${shell.id} did not mark ${boundary.key} as ready for ${route}`,
        );
        assert(
          typeof boundary.buildMarker === "string" && boundary.buildMarker.length > 0,
          `${shell.id} ${boundary.key} is missing immutable build provenance`,
        );
        assert(
          /^[a-f\d]{64}$/u.test(boundary.digest ?? ""),
          `${shell.id} ${boundary.key} is missing a verified SHA-256 digest`,
        );
        const remote = apps.find((app) => app.id === boundary.remote);
        assert(remote, `${shell.id} rendered unknown remote ${boundary.remote}`);
        const requests = routeFragmentBindingRequests.filter(
          (request) =>
            request.service === workerName(remote) &&
            request.remote === boundary.remote &&
            request.expose === boundary.expose,
        );
        const renderedCount = boundaries.filter(
          (candidate) => candidate.key === boundary.key,
        ).length;
        assert(
          requests.length === renderedCount &&
            requests.every((request) => request.pathname.includes("/_mf/fragment/")),
          `${shell.id} must compose each ${boundary.key} occurrence through its remote service binding`,
        );
      }

      const stylesheetHrefs = collectStylesheetHrefs(html);
      assert(
        new Set(stylesheetHrefs).size === stylesheetHrefs.length,
        `${shell.id} rendered duplicate distributed SSR stylesheets for ${route}`,
      );
      assert(
        !routeOutboundRequests.some(({ url }) => /(?:remoteEntry|\.m?js(?:\?|$))/u.test(url)),
        `${shell.id} attempted to fetch remote JavaScript during ${route} server composition`,
      );

      proofs.push({
        shellId: shell.id,
        worker: workerName(shell),
        route,
        status: response.status,
        boundaries,
        fragmentBindingRequests: routeFragmentBindingRequests,
        apiBindingRequests: routeApiBindingRequests,
        outboundRequests: routeOutboundRequests,
        stylesheetHrefs,
        degradedBoundaryCount: count(html, 'data-modern-distributed-ssr-status="degraded"'),
      });
    }

    for (const remote of expectedRemotes) {
      assert(
        renderedRemoteIds.has(remote.id),
        `${shell.id} proof routes are missing independently rendered ${remote.id} content`,
      );
    }
    apiProofs.push(...(await runApiProofs(miniflare, shell, executionByAppId)));
    if (process.env.ULTRAMODERN_KEEP_WORKERD === "1") {
      writeReport();
      const targetServers = await startWorkerdTargetServers(
        miniflare,
        failedServices,
        workers,
      );
      console.log(`WORKERD_TARGET_URLS=${JSON.stringify(targetServers.targetUrls)}`);
      console.log(`WORKERD_URL=${targetServers.targetUrls[shell.id]}`);
      try {
        await new Promise((resolve) => {
          process.once("SIGINT", resolve);
          process.once("SIGTERM", resolve);
        });
      } finally {
        await targetServers.stop();
      }
    }
  } finally {
    await miniflare.dispose();
  }
}

writeReport();
console.log(`Workerd SSR composition proof passed for ${shells.length} shell(s): ${reportPath}`);
