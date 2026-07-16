#!/usr/bin/env node
import fs from "node:fs";
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
const count = (source, value) => source.split(value).length - 1;
const normalizePath = (value) => String(value).replace(/\\/gu, "/");

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

  return {
    id: String(rawApp.id),
    kind,
    path: appPath,
    mfName: typeof moduleFederation.name === "string" ? moduleFederation.name : String(rawApp.id),
    verticalRefs: Array.isArray(moduleFederation.verticalRefs)
      ? moduleFederation.verticalRefs.filter((ref) => typeof ref === "string")
      : [],
    proofRoutes: proofRoutes.length > 0 ? proofRoutes : defaultProofRoutes,
    outputRoot,
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

  return {
    name: workerName(app),
    modules: createWorkerModules(app.outputRoot, main),
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

const decodeFragmentProps = (request) => {
  const encoded = request.headers.get("x-modern-distributed-ssr-props");
  assert(encoded !== null, "Distributed SSR service request is missing serialized props");
  const props = JSON.parse(decodeURIComponent(encoded));
  assert(props && typeof props === "object" && !Array.isArray(props), "Fragment props must be an object");
  return props;
};

const createServiceBindings = (caller, bindingRequests) => {
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
          const requestUrl = new URL(request.url);
          bindingRequests.push({
            binding: service.binding,
            boundaryId: request.headers.get("x-modern-distributed-ssr-boundary-id"),
            callerId: caller.id,
            expose: request.headers.get("x-modern-distributed-ssr-expose"),
            pathname: requestUrl.pathname,
            props: decodeFragmentProps(request),
            remote: request.headers.get("x-modern-distributed-ssr-remote"),
            service: service.service,
            sourceUrl: request.headers.get("x-modern-distributed-ssr-source-url"),
          });
          const target = await miniflare.getWorker(service.service);
          return target.fetch(request);
        },
      ];
    }),
  );
};

const proofs = [];

for (const shell of shells) {
  const expectedRemotes = shell.verticalRefs.map((ref) => {
    const remote = apps.find((app) => app.id === ref);
    assert(remote, `${shell.id} references missing MicroVertical ${ref}`);
    return remote;
  });
  assert(expectedRemotes.length > 0, `${shell.id} has no MicroVerticals to prove`);

  const bindingRequests = [];
  const outboundRequests = [];
  const workers = apps.map((app) =>
    createWorkerOptions(app, {
      serviceBindings: createServiceBindings(app, bindingRequests),
      async outboundService(request) {
        const requestUrl = new URL(request.url);
        outboundRequests.push({ callerId: app.id, url: requestUrl.href });
        return new Response("External network disabled by SSR proof", {
          status: 502,
        });
      },
    }),
  );
  const miniflare = new Miniflare({
    log: new Log(LogLevel.ERROR),
    workers,
  });
  const renderedRemoteIds = new Set();

  try {
    for (const route of shell.proofRoutes) {
      const bindingRequestStart = bindingRequests.length;
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
      const routeBindingRequests = bindingRequests.slice(bindingRequestStart);
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
        const requests = routeBindingRequests.filter(
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
        bindingRequests: routeBindingRequests,
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
    if (process.env.ULTRAMODERN_KEEP_WORKERD === "1") {
      console.log(`WORKERD_URL=${await miniflare.ready}`);
      await new Promise((resolve) => {
        process.once("SIGINT", resolve);
        process.once("SIGTERM", resolve);
      });
    }
  } finally {
    await miniflare.dispose();
  }
}

fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(
  reportPath,
  `${JSON.stringify(
    {
      schemaVersion: 1,
      runtime: "workerd",
      routes: [...new Set(proofs.map((proof) => proof.route))],
      proofs,
    },
    null,
    2,
  )}\n`,
);
console.log(`Workerd SSR composition proof passed for ${shells.length} shell(s): ${reportPath}`);
